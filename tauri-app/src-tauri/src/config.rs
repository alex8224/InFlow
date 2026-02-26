use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub kind: String, // "OpenAI", "Gemini", "Anthropic", "Ollama"
    pub base_url: Option<String>,
    pub api_key: String,
    pub model_id: String,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRemoteServer {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub headers: Option<std::collections::BTreeMap<String, String>>,
    pub tools_allowlist: Option<Vec<String>>,
}

#[derive(Deserialize, Serialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    pub google_api_key: Option<String>,
    pub llm_providers: Vec<LlmProvider>,
    pub active_provider_id: Option<String>,
    pub translate_provider_id: Option<String>,
    pub translate_system_prompt: Option<String>,
    pub preferred_service: String, // "google" or "ai"
    pub mcp_remote_servers: Vec<McpRemoteServer>,

    // Chat system prompt customization.
    // - chat_system_prompt: inline prompt text stored in config.json (supports \n).
    // - chat_system_prompt_path: path to a text file containing the prompt (easier to edit).
    pub chat_system_prompt: Option<String>,
    pub chat_system_prompt_path: Option<String>,

    // WebFetch tool proxy settings.
    // - webfetch_use_system_proxy: if true (default), use OS proxy settings.
    // - webfetch_proxy: optional explicit proxy URL (overrides system proxy).
    //   Example: "http://127.0.0.1:7890"
    pub webfetch_use_system_proxy: Option<bool>,
    pub webfetch_proxy: Option<String>,

    // Optional path to agent-browser CLI executable.
    // Example (Windows): "C:\\...\\agent-browser-win32-x64.exe"
    pub agent_browser_cli_path: Option<String>,

    // Optional browser executable path used by agent-browser (`--executable-path`).
    // Example (Windows): "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    pub agent_browser_executable_path: Option<String>,

    // Allowed directories for fs tools (readFile, writeFile, listFile, grep).
    // Example: ["C:\\Users\\Documents", "D:\\Projects"]
    pub fs_allowed_dirs: Option<Vec<String>>,

    // Markdown Editor Overlay settings.
    pub markdown_editor_theme: Option<String>, // "light" or "dark"
    pub markdown_editor_font_size: Option<u32>, // 12-24
    pub markdown_editor_auto_save: Option<bool>,
    pub markdown_editor_outline_enabled: Option<bool>,
    pub markdown_editor_recent_files: Option<Vec<String>>, // recent opened files
}

impl AppConfig {
    pub fn config_path() -> PathBuf {
        Self::get_config_path()
    }

    fn get_appdata_config_path() -> PathBuf {
        let mut path = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "./".to_string()));
        path.push("inFlow");
        fs::create_dir_all(&path).ok();
        path.push("config.json");
        path
    }

    fn get_project_config_path_candidates() -> Vec<PathBuf> {
        // NOTE:
        // - In dev, this resolves to the local workspace path.
        // - In release, this points to a build-time path and likely won't exist.
        //   That's OK: we fall back to %APPDATA%.
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

        // Prefer repo-root config.json if present: <repo>/config.json
        // src-tauri is typically: <repo>/tauri-app/src-tauri
        let repo_root = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());
        let repo_config = repo_root.map(|p| p.join("config.json"));

        // Secondary: <repo>/tauri-app/config.json
        let tauri_app_config = manifest_dir
            .parent()
            .map(|p| p.to_path_buf())
            .map(|p| p.join("config.json"));

        [repo_config, tauri_app_config]
            .into_iter()
            .flatten()
            .collect()
    }

    pub fn get_config_path() -> PathBuf {
        for p in Self::get_project_config_path_candidates() {
            if p.exists() {
                return p;
            }
        }
        Self::get_appdata_config_path()
    }

    pub fn load() -> Self {
        let path = Self::get_config_path();
        let debug_enabled = std::env::var("INFLOW_DEBUG_CONFIG").ok().as_deref() == Some("1");

        // Track where the effective config came from. This intentionally does not
        // log the raw JSON to avoid leaking secrets like API keys.
        let mut source: &'static str = "default_missing";
        let mut read_error: Option<String> = None;
        let mut parse_error: Option<String> = None;

        let mut config = if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<Self>(&content) {
                    Ok(cfg) => {
                        source = "file";
                        cfg
                    }
                    Err(e) => {
                        source = "default_parse_error";
                        parse_error = Some(e.to_string());
                        Self::default_internal()
                    }
                },
                Err(e) => {
                    source = "default_read_error";
                    read_error = Some(e.to_string());
                    Self::default_internal()
                }
            }
        } else {
            Self::default_internal()
        };

        // Normalize: ensure required defaults exist even when config.json is partial.
        let injected_providers = config.llm_providers.is_empty();
        if injected_providers {
            config.llm_providers = Self::get_default_providers();
        }

        let injected_active_provider = config.active_provider_id.is_none();
        if injected_active_provider {
            config.active_provider_id = config.llm_providers.first().map(|p| p.id.clone());
        }

        let injected_preferred_service = config.preferred_service.is_empty();
        if injected_preferred_service {
            config.preferred_service = "google".to_string();
        }

        if debug_enabled {
            println!(
                "[config][debug] loaded path={} source={} providers={} mcp_servers={} active_provider_id={:?} preferred_service={} injected={{providers:{},active_provider:{},preferred_service:{}}}",
                path.display(),
                source,
                config.llm_providers.len(),
                config.mcp_remote_servers.len(),
                config.active_provider_id,
                config.preferred_service,
                injected_providers,
                injected_active_provider,
                injected_preferred_service
            );

            if let Some(e) = read_error.as_deref() {
                eprintln!(
                    "[config][debug] read_error path={} err={}",
                    path.display(),
                    e
                );
            }
            if let Some(e) = parse_error.as_deref() {
                eprintln!(
                    "[config][debug] parse_error path={} err={}",
                    path.display(),
                    e
                );
            }

            for s in &config.mcp_remote_servers {
                println!(
                    "[config][debug] mcp_server id={} name={} enabled={} url={} allowlist={}",
                    s.id,
                    s.name,
                    s.enabled,
                    s.url,
                    s.tools_allowlist.as_ref().map(|v| v.len()).unwrap_or(0)
                );
            }
        }

        config
    }

    fn default_internal() -> Self {
        Self {
            google_api_key: None,
            llm_providers: Self::get_default_providers(),
            active_provider_id: Some("deepseek".to_string()),
            translate_provider_id: None,
            translate_system_prompt: None,
            preferred_service: "google".to_string(),
            mcp_remote_servers: Vec::new(),
            chat_system_prompt: None,
            chat_system_prompt_path: None,
            webfetch_use_system_proxy: Some(true),
            webfetch_proxy: None,
            agent_browser_cli_path: None,
            agent_browser_executable_path: None,
            fs_allowed_dirs: None,
            markdown_editor_theme: Some("light".to_string()),
            markdown_editor_font_size: Some(14),
            markdown_editor_auto_save: Some(false),
            markdown_editor_outline_enabled: Some(false),
            markdown_editor_recent_files: Some(Vec::new()),
        }
    }

    pub fn get_default_providers() -> Vec<LlmProvider> {
        vec![
            LlmProvider {
                id: "deepseek".to_string(),
                name: "DeepSeek".to_string(),
                kind: "OpenAI".to_string(),
                base_url: Some("https://api.deepseek.com/v1".to_string()),
                api_key: "".to_string(),
                model_id: "deepseek-chat".to_string(),
                reasoning_effort: None,
            },
            LlmProvider {
                id: "siliconflow".to_string(),
                name: "硅基流动".to_string(),
                kind: "OpenAI".to_string(),
                base_url: Some("https://api.siliconflow.cn/v1".to_string()),
                api_key: "".to_string(),
                model_id: "deepseek-ai/DeepSeek-V3".to_string(),
                reasoning_effort: None,
            },
            LlmProvider {
                id: "anthropic".to_string(),
                name: "Anthropic".to_string(),
                kind: "Anthropic".to_string(),
                base_url: Some("https://api.anthropic.com/v1".to_string()),
                api_key: "".to_string(),
                model_id: "claude-3-5-sonnet-20241022".to_string(),
                reasoning_effort: None,
            },
            LlmProvider {
                id: "gemini".to_string(),
                name: "Google Gemini".to_string(),
                kind: "Gemini".to_string(),
                base_url: Some("https://generativelanguage.googleapis.com".to_string()),
                api_key: "".to_string(),
                model_id: "gemini-2.0-flash".to_string(),
                reasoning_effort: None,
            },
            LlmProvider {
                id: "openai".to_string(),
                name: "OpenAI".to_string(),
                kind: "OpenAI".to_string(),
                base_url: Some("https://api.openai.com/v1".to_string()),
                api_key: "".to_string(),
                model_id: "gpt-4o-mini".to_string(),
                reasoning_effort: None,
            },
        ]
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::get_config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())
    }
}
