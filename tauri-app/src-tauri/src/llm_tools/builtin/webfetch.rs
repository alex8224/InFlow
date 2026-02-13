use std::sync::OnceLock;
use std::time::Duration;

use futures::future::BoxFuture;
use futures::StreamExt;
use genai::chat::Tool;
use html2md_rs::to_md::safe_from_html_to_md;
use reqwest::header::{HeaderMap, HeaderValue};
use url::Url;

use crate::config::{AppConfig, LlmProvider};
use crate::genai_client::sanitize_tool_schema_for_provider;
use crate::llm_tools::ToolExecResult;
use crate::state::AppState;

use super::{BuiltinToolSpec, ToolCategory};

pub const TOOL_WEBFETCH: &str = "inflow__webfetch";

const MAX_RESPONSE_SIZE: usize = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 120;
const DEFAULT_MAX_CHARS: usize = 20_000;
const MAX_MAX_CHARS: usize = 200_000;
const MIN_MAX_CHARS: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WebFetchFormat {
    Text,
    Markdown,
    Html,
}

impl WebFetchFormat {
    fn from_str(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "text" => Some(Self::Text),
            "markdown" => Some(Self::Markdown),
            "html" => Some(Self::Html),
            _ => None,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Markdown => "markdown",
            Self::Html => "html",
        }
    }
}

fn webfetch_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .pool_idle_timeout(Duration::from_secs(90))
            // Disable implicit env proxy handling; we control proxy selection explicitly.
            .no_proxy()
            .build()
            .expect("failed to build webfetch http client")
    })
}

fn build_webfetch_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .pool_idle_timeout(Duration::from_secs(90))
        // Disable implicit env proxy handling; we control proxy selection explicitly.
        .no_proxy();

    if let Some(p) = proxy_url {
        let proxy = reqwest::Proxy::all(p).map_err(|e| format!("Invalid proxy URL: {}", e))?;
        builder = builder.proxy(proxy);
    }

    builder
        .build()
        .map_err(|e| format!("failed to build webfetch http client: {}", e))
}

fn normalize_proxy_url(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }

    // System proxy sources may return:
    // - "DIRECT" / "<local>"
    // - PAC-style lists: "PROXY host:port; DIRECT"
    // - per-scheme lists: "http=host:80;https=host:443"
    // We only support a single proxy URL for reqwest; pick the first usable entry.
    for part in s.split(';') {
        let mut p = part.trim();
        if p.is_empty() {
            continue;
        }

        let upper = p.to_ascii_uppercase();
        if upper == "DIRECT" || upper == "<LOCAL>" {
            continue;
        }

        // Handle PAC tokens like "PROXY host:port" / "HTTPS host:port" / "HTTP host:port".
        if let Some((kw, rest)) = p.split_once(' ') {
            let kw_u = kw.trim().to_ascii_uppercase();
            if matches!(
                kw_u.as_str(),
                "PROXY" | "HTTP" | "HTTPS" | "SOCKS" | "SOCKS5"
            ) {
                p = rest.trim();
            }
        }

        // Handle scheme-qualified forms like "http=host:port".
        if let Some((_, rest)) = p.split_once('=') {
            p = rest.trim();
        }

        if p.is_empty() {
            continue;
        }

        if p.contains("://") {
            return Some(p.to_string());
        }

        // Commonly returned as host:port.
        return Some(format!("http://{}", p));
    }

    None
}

fn redact_proxy_url(raw: &str) -> String {
    // Avoid leaking proxy credentials in logs/tool results.
    if let Ok(mut u) = Url::parse(raw) {
        if !u.username().is_empty() || u.password().is_some() {
            let _ = u.set_username("<redacted>");
            let _ = u.set_password(Some("<redacted>"));
        }
        return u.to_string();
    }
    raw.to_string()
}

fn resolve_proxy_for_url(config: &AppConfig, target_url: &Url) -> Option<String> {
    // Explicit proxy wins.
    if let Some(p) = config
        .webfetch_proxy
        .as_ref()
        .and_then(|s| normalize_proxy_url(s))
    {
        return Some(p);
    }

    // Default to system proxy if not specified.
    let use_system = config.webfetch_use_system_proxy.unwrap_or(true);
    if !use_system {
        return None;
    }

    match proxy_cfg::get_proxy_config() {
        Ok(Some(cfg)) => cfg
            .get_proxy_for_url(target_url)
            .and_then(|s| normalize_proxy_url(&s)),
        _ => None,
    }
}

fn accept_header_for_format(fmt: WebFetchFormat) -> &'static str {
    match fmt {
        WebFetchFormat::Markdown => {
            "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
        }
        WebFetchFormat::Text => {
            "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
        }
        WebFetchFormat::Html => {
            "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
        }
    }
}

fn header_value(s: &str) -> HeaderValue {
    HeaderValue::from_str(s).unwrap_or_else(|_| HeaderValue::from_static(""))
}

fn build_headers(fmt: WebFetchFormat) -> HeaderMap {
    let mut h = HeaderMap::new();
    // Mirror the opencode WebFetch UA to reduce server blocks.
    h.insert(
        reqwest::header::USER_AGENT,
        header_value(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        ),
    );
    h.insert(
        reqwest::header::ACCEPT,
        header_value(accept_header_for_format(fmt)),
    );
    h.insert(
        reqwest::header::ACCEPT_LANGUAGE,
        header_value("en-US,en;q=0.9"),
    );
    h
}

fn is_html_content_type(ct: &str) -> bool {
    ct.to_ascii_lowercase().contains("text/html")
}

fn html_to_text(html: &str) -> String {
    // Use a very large width to avoid aggressive wrapping.
    // (html2text wraps at a given column.)
    match html2text::from_read(html.as_bytes(), 1000) {
        Ok(s) => s.trim().to_string(),
        Err(_) => html.to_string(),
    }
}

fn html_to_markdown(html: &str) -> String {
    // html2md-rs provides HTML -> Markdown conversion.
    // Keep defaults; downstream model can further clean up.
    match safe_from_html_to_md(html.to_string()) {
        Ok(s) => s.trim().to_string(),
        Err(_) => html.to_string(),
    }
}

fn build(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to fetch content from"
            },
            "format": {
                "type": "string",
                "description": "The format to return the content in (text, markdown, or html). Defaults to markdown.",
                "enum": ["text", "markdown", "html"],
                "default": "markdown"
            },
            "timeout": {
                "type": "number",
                "description": "Optional timeout in seconds (max 120)"
            },
            "maxChars": {
                "type": "integer",
                "description": "Maximum number of characters to return (default 20000, max 200000).",
                "default": 20000
            },
            "rangeStart": {
                "type": "integer",
                "description": "Optional starting byte position for range request (0-indexed). Use with rangeEnd to fetch a specific byte range."
            },
            "rangeEnd": {
                "type": "integer",
                "description": "Optional ending byte position for range request (inclusive). If only rangeEnd is specified without rangeStart, fetches the last rangeEnd bytes."
            }
        },
        "required": ["url"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_WEBFETCH)
        .with_description("Fetch content from a URL and return it as markdown/text/html.")
        .with_schema(schema)
}

fn exec<'a>(
    _provider: &'a LlmProvider,
    config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let url = args
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "url is required".to_string())?
            .trim()
            .to_string();

        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("URL must start with http:// or https://".to_string());
        }

        let target_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

        let fmt = args
            .get("format")
            .and_then(|v| v.as_str())
            .and_then(WebFetchFormat::from_str)
            .unwrap_or(WebFetchFormat::Markdown);

        let timeout_secs = args
            .get("timeout")
            .and_then(|v| v.as_f64())
            .map(|n| if n.is_finite() { n.max(0.0) } else { 0.0 })
            .map(|n| n.round() as u64)
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .min(MAX_TIMEOUT_SECS)
            .max(1);

        let max_chars = args
            .get("maxChars")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_MAX_CHARS)
            .min(MAX_MAX_CHARS)
            .max(MIN_MAX_CHARS);

        let range_start = args.get("rangeStart").and_then(|v| v.as_u64());
        let range_end = args.get("rangeEnd").and_then(|v| v.as_u64());

        let range_header: Option<String> = match (range_start, range_end) {
            (Some(start), Some(end)) => {
                if start > end {
                    return Err("rangeStart must be less than or equal to rangeEnd".to_string());
                }
                Some(format!("bytes={}-{}", start, end))
            }
            (Some(start), None) => Some(format!("bytes={}-", start)),
            (None, Some(end)) => Some(format!("bytes=-{}", end)),
            (None, None) => None,
        };

        let proxy_url = resolve_proxy_for_url(config, &target_url);
        let client = if proxy_url.is_some() {
            build_webfetch_client(proxy_url.as_deref())?
        } else {
            // Keep a shared client for the common no-proxy case.
            webfetch_http_client().clone()
        };
        let mut headers = build_headers(fmt);
        if let Some(ref range_val) = range_header {
            headers.insert(reqwest::header::RANGE, header_value(range_val));
        }

        let resp = client
            .get(&url)
            .headers(headers)
            .timeout(Duration::from_secs(timeout_secs))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = resp.status();
        let final_url = resp.url().to_string();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if !status.is_success() {
            return Err(format!("Request failed with status code: {}", status));
        }

        if let Some(len) = resp.content_length() {
            if len as usize > MAX_RESPONSE_SIZE {
                return Err("Response too large (exceeds 5MB limit)".to_string());
            }
        }

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| format!("Response read failed: {}", e))?;
            if buf.len().saturating_add(chunk.len()) > MAX_RESPONSE_SIZE {
                return Err("Response too large (exceeds 5MB limit)".to_string());
            }
            buf.extend_from_slice(&chunk);
        }

        let raw = String::from_utf8_lossy(&buf).to_string();
        let is_html = is_html_content_type(&content_type);

        let output = match fmt {
            WebFetchFormat::Html => raw,
            WebFetchFormat::Text => {
                if is_html {
                    html_to_text(&raw)
                } else {
                    raw
                }
            }
            WebFetchFormat::Markdown => {
                if is_html {
                    html_to_markdown(&raw)
                } else {
                    raw
                }
            }
        };

        let (output, truncated) = truncate_to_chars(&output, max_chars);

        let title = if content_type.trim().is_empty() {
            final_url.clone()
        } else {
            format!("{} ({})", final_url, content_type)
        };

        let proxy_info = proxy_url
            .as_ref()
            .map(|p| serde_json::json!({ "url": redact_proxy_url(p) }))
            .unwrap_or_else(|| serde_json::Value::Null);

        let content = serde_json::json!({
            "url": url,
            "finalUrl": final_url,
            "status": status.as_u16(),
            "contentType": content_type,
            "format": fmt.as_str(),
            "title": title,
            "output": output,
            "truncated": truncated,
            "maxChars": max_chars,
            "proxy": proxy_info
        });

        Ok(ToolExecResult {
            content,
            response_content: output,
        })
    })
}

fn truncate_to_chars(s: &str, max_chars: usize) -> (String, bool) {
    if max_chars == 0 {
        return (String::new(), !s.is_empty());
    }
    let mut out = String::new();
    let mut truncated = false;
    for (i, ch) in s.chars().enumerate() {
        if i >= max_chars {
            truncated = true;
            break;
        }
        out.push(ch);
    }
    (out, truncated)
}

pub fn spec() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_WEBFETCH,
        title: "Web fetch",
        category: ToolCategory::Web,
        description: Some("Fetch a URL and return markdown/text/html."),
        build,
        exec,
    }
}
