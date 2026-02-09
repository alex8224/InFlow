use std::time::Duration;

use rmcp::model::*;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::{Peer, RoleClient, ServiceExt};

use crate::config::{AppConfig, McpRemoteServer};
use crate::state::{AppState, CachedMcpTools, McpToolMeta};

fn mcp_debug_enabled() -> bool {
    std::env::var("INFLOW_DEBUG_MCP").ok().as_deref() == Some("1")
}

pub async fn get_or_create_mcp_service(
    server: &McpRemoteServer,
    state: &AppState,
) -> Result<Peer<RoleClient>, String> {
    {
        let services = state.mcp_services.lock().unwrap();
        if let Some(service) = services.get(&server.id) {
            return Ok(service.peer().clone());
        }
    }

    if mcp_debug_enabled() {
        println!("[mcp][debug] creating new service for {}", server.id);
    }

    let mut default_headers = reqwest::header::HeaderMap::new();
    if let Some(headers) = &server.headers {
        for (k, v) in headers {
            if let Ok(name) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
                if let Ok(val) = reqwest::header::HeaderValue::from_str(v) {
                    default_headers.insert(name, val);
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .default_headers(default_headers)
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {}", e))?;

    let transport = StreamableHttpClientTransport::with_client(
        client,
        StreamableHttpClientTransportConfig::with_uri(server.url.clone()),
    );

    let service = ().serve(transport).await
        .map_err(|e| format!("Failed to serve MCP client: {}", e))?;

    let peer = service.peer().clone();

    {
        let mut services = state.mcp_services.lock().unwrap();
        services.insert(server.id.clone(), service);
    }
    Ok(peer)
}

pub async fn mcp_rpc(
    server: &McpRemoteServer,
    state: &AppState,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let peer = get_or_create_mcp_service(server, state).await?;

    if mcp_debug_enabled() {
        println!(
            "[mcp][debug] rpc request server_id={} method={}",
            server.id, method
        );
    }

    if method == "tools/call" {
        let tool_name = params.get("name").and_then(|v| v.as_str()).ok_or("Missing tool name")?;
        let arguments = params.get("arguments").and_then(|v| v.as_object()).cloned();
        
        let req = CallToolRequestParams {
            meta: None,
            name: tool_name.to_string().into(),
            arguments,
            task: None,
        };

        let result = peer.call_tool(req).await
            .map_err(|e| format!("MCP call_tool failed: {}", e))?;
        
        return serde_json::to_value(result).map_err(|e| e.to_string());
    }

    if method == "tools/list" {
        let res = peer.list_tools(Default::default()).await
            .map_err(|e| format!("MCP list_tools failed: {}", e))?;
        return serde_json::to_value(res).map_err(|e| e.to_string());
    }

    Err(format!("Unsupported MCP method via generic rpc: {}", method))
}

pub async fn mcp_tools_list(
    server: &McpRemoteServer,
    state: &AppState,
) -> Result<Vec<McpToolMeta>, String> {
    let peer = get_or_create_mcp_service(server, state).await?;
    
    let res = peer.list_tools(Default::default()).await
        .map_err(|e| format!("MCP list_tools failed: {}", e))?;

    let mut out = Vec::new();
    for t in res.tools {
        out.push(McpToolMeta {
            server_id: server.id.clone(),
            tool_name: t.name.to_string(),
            description: t.description.map(|s| s.to_string()),
            input_schema: Some(serde_json::to_value(t.input_schema).unwrap_or(serde_json::Value::Null)),
        });
    }

    if mcp_debug_enabled() {
        let names: Vec<String> = out.iter().map(|t| t.tool_name.clone()).collect();
        println!(
            "[mcp][debug] tools/list ok server_id={} tools_count={} tools={}",
            server.id,
            names.len(),
            names.join(",")
        );
    }
    Ok(out)
}

pub async fn get_cached_mcp_tools(
    config: &AppConfig,
    state: &AppState,
) -> Result<Vec<McpToolMeta>, String> {
    let servers: Vec<McpRemoteServer> = config
        .mcp_remote_servers
        .iter()
        .cloned()
        .filter(|s| s.enabled)
        .collect();

    if servers.is_empty() {
        return Ok(Vec::new());
    }

    let now = chrono::Utc::now().timestamp();
    let ttl_seconds: i64 = 300; // 5 minutes

    let mut results = Vec::new();
    for server in servers {
        let cache_hit = {
            let cache = state.mcp_tools_cache.lock().unwrap();
            cache
                .get(&server.id)
                .filter(|c| now - c.fetched_at < ttl_seconds)
                .cloned()
        };

        let mut tools = if let Some(cached) = cache_hit {
            cached.tools
        } else {
            match mcp_tools_list(&server, state).await {
                Ok(fetched) => {
                    let mut cache = state.mcp_tools_cache.lock().unwrap();
                    cache.insert(
                        server.id.clone(),
                        CachedMcpTools {
                            tools: fetched.clone(),
                            fetched_at: now,
                        },
                    );
                    fetched
                }
                Err(err) => {
                    println!(
                        "[mcp] tools/list failed server_id={} url={}: {}",
                        server.id, server.url, err
                    );
                    Vec::new()
                }
            }
        };

        if let Some(allow) = server.tools_allowlist.as_ref() {
            tools.retain(|t| allow.contains(&t.tool_name));
        }
        results.push(tools);
    }

    let mut out = Vec::new();
    for mut tools in results {
        out.append(&mut tools);
    }
    Ok(out)
}

pub fn parse_mcp_fn_name(fn_name: &str) -> Option<(String, String)> {
    let prefix = "mcp__";
    if !fn_name.starts_with(prefix) {
        return None;
    }
    let rest = &fn_name[prefix.len()..];
    let mut parts = rest.splitn(2, "__");
    let server_id = parts.next()?.to_string();
    let tool_name = parts.next()?.to_string();
    if server_id.is_empty() || tool_name.is_empty() {
        return None;
    }
    Some((server_id, tool_name))
}
