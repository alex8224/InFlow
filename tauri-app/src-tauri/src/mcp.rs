use reqwest::header::HeaderMap;
use crate::config::{AppConfig, McpRemoteServer};
use crate::state::{AppState, CachedMcpTools, McpServerSession, McpToolMeta};

pub fn mcp_accept_header_value() -> &'static str {
    // Streamable HTTP transport requires declaring support for both.
    // https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
    "application/json, text/event-stream"
}

pub fn mcp_default_protocol_version() -> &'static str {
    "2025-06-18"
}

pub fn parse_sse_data_events(body: &str) -> Vec<String> {
    // Minimal SSE parser: collect `data:` payload per event.
    // We ignore `event:` type and other fields; MCP servers typically send JSON-RPC messages in `data:`.
    let mut out: Vec<String> = Vec::new();
    let mut cur_data: Vec<String> = Vec::new();

    for raw_line in body.lines() {
        let line = raw_line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            if !cur_data.is_empty() {
                out.push(cur_data.join("\n"));
                cur_data.clear();
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            cur_data.push(rest.trim_start().to_string());
        }
    }

    if !cur_data.is_empty() {
        out.push(cur_data.join("\n"));
    }

    out
}

pub async fn mcp_post_jsonrpc(
    server: &McpRemoteServer,
    state: Option<&AppState>,
    message: serde_json::Value,
    include_session_headers: bool,
) -> Result<(reqwest::StatusCode, HeaderMap, String), String> {
    let client = reqwest::Client::new();
    let mut req = client
        .post(&server.url)
        .header(reqwest::header::ACCEPT, mcp_accept_header_value())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&message);

    if let Some(headers) = server.headers.as_ref() {
        for (k, v) in headers {
            req = req.header(k, v);
        }
    }

    if include_session_headers {
        if let Some(st) = state {
            if let Some(sess) = st.mcp_sessions.lock().unwrap().get(&server.id).cloned() {
                if sess.initialized {
                    req = req.header("MCP-Protocol-Version", sess.protocol_version);
                    if let Some(sid) = sess.session_id.as_ref() {
                        req = req.header("Mcp-Session-Id", sid);
                    }
                } else {
                    req = req.header("MCP-Protocol-Version", mcp_default_protocol_version());
                }
            } else {
                req = req.header("MCP-Protocol-Version", mcp_default_protocol_version());
            }
        } else {
            req = req.header("MCP-Protocol-Version", mcp_default_protocol_version());
        }
    }

    let resp = req.send().await.map_err(|e| format!("MCP 请求失败: {}", e))?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp.text().await.map_err(|e| format!("MCP 响应读取失败: {}", e))?;
    Ok((status, headers, body))
}

pub async fn mcp_call_request(
    server: &McpRemoteServer,
    state: &AppState,
    method: &str,
    params: serde_json::Value,
    include_session_headers: bool,
) -> Result<serde_json::Value, String> {
    let rpc_id = uuid::Uuid::new_v4().to_string();
    let message = serde_json::json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": method,
        "params": params,
    });

    let (status, headers, body) =
        mcp_post_jsonrpc(server, Some(state), message, include_session_headers).await?;

    // Some servers may return 404 for expired session; caller may retry after re-init.
    if !status.is_success() {
        return Err(format!("MCP HTTP 错误: {}", status));
    }

    // Try JSON first (some servers reply with application/json).
    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if content_type.contains("application/json") {
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("MCP 响应解析失败: {}", e))?;
        if let Some(err) = json.get("error") {
            return Err(format!("MCP RPC 错误: {}", err));
        }
        return json
            .get("result")
            .cloned()
            .ok_or_else(|| "MCP 响应缺少 result".to_string());
    }

    // Streamable HTTP servers often respond with text/event-stream.
    if content_type.contains("text/event-stream") {
        let events = parse_sse_data_events(&body);
        let mut parsed: Vec<serde_json::Value> = Vec::new();
        for data in events {
            let msg: serde_json::Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => continue,
            };
            parsed.push(msg.clone());
            let id_match = msg
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s == rpc_id)
                .unwrap_or(false);
            if !id_match {
                continue;
            }
            if let Some(err) = msg.get("error") {
                return Err(format!("MCP RPC 错误: {}", err));
            }
            return msg
                .get("result")
                .cloned()
                .ok_or_else(|| "MCP 响应缺少 result".to_string());
        }

        // Non-compliant but observed in some hosted servers: omit `id` in SSE payload.
        // If we got exactly one message with a result, accept it.
        let mut lone_result: Option<serde_json::Value> = None;
        for msg in parsed {
            if msg.get("error").is_some() {
                return Err(format!("MCP RPC 错误: {}", msg.get("error").unwrap()));
            }
            if msg.get("id").is_none() {
                if let Some(r) = msg.get("result") {
                    if lone_result.is_some() {
                        lone_result = None;
                        break;
                    }
                    lone_result = Some(r.clone());
                }
            }
        }
        if let Some(r) = lone_result {
            return Ok(r);
        }

        return Err("MCP SSE 响应缺少匹配的 response".to_string());
    }

    Err(format!(
        "MCP 响应 Content-Type 不支持: {}",
        headers
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("<missing>")
    ))
}

pub async fn mcp_send_notification(
    server: &McpRemoteServer,
    state: &AppState,
    method: &str,
    params: serde_json::Value,
    include_session_headers: bool,
) -> Result<(), String> {
    let message = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });
    let (status, _headers, _body) =
        mcp_post_jsonrpc(server, Some(state), message, include_session_headers).await?;
    if status.as_u16() == 202 || status.is_success() {
        return Ok(());
    }
    Err(format!("MCP HTTP 错误: {}", status))
}

pub async fn mcp_ensure_initialized(server: &McpRemoteServer, state: &AppState) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let needs_init = {
        let sessions = state.mcp_sessions.lock().unwrap();
        match sessions.get(&server.id) {
            Some(s) if s.initialized && s.url == server.url => false,
            _ => true,
        }
    };
    if !needs_init {
        return Ok(());
    }

    let init_id = uuid::Uuid::new_v4().to_string();
    let init_msg = serde_json::json!({
        "jsonrpc": "2.0",
        "id": init_id,
        "method": "initialize",
        "params": {
            "protocolVersion": mcp_default_protocol_version(),
            "capabilities": {},
            "clientInfo": {
                "name": "inflow",
                "version": env!("CARGO_PKG_VERSION"),
            }
        }
    });

    let (status, headers, body) = mcp_post_jsonrpc(server, Some(state), init_msg, false).await?;
    if !status.is_success() {
        return Err(format!("MCP HTTP 错误: {}", status));
    }

    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let init_result: serde_json::Value = if content_type.contains("application/json") {
        serde_json::from_str(&body).map_err(|e| format!("MCP initialize 响应解析失败: {}", e))?
    } else if content_type.contains("text/event-stream") {
        let mut found: Option<serde_json::Value> = None;
        let mut parsed: Vec<serde_json::Value> = Vec::new();
        for data in parse_sse_data_events(&body) {
            let msg: serde_json::Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => continue,
            };
            parsed.push(msg.clone());
            let id_match = msg
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s == init_id)
                .unwrap_or(false);
            if id_match {
                found = Some(msg);
                break;
            }
        }
        if let Some(v) = found {
            v
        } else {
            // Non-compliant fallback: accept a single init result without id.
            let mut lone: Option<serde_json::Value> = None;
            for msg in parsed {
                if msg.get("id").is_none() && msg.get("result").is_some() {
                    if lone.is_some() {
                        lone = None;
                        break;
                    }
                    lone = Some(msg);
                }
            }
            lone.ok_or_else(|| "MCP initialize SSE 响应缺少匹配的 response".to_string())?
        }
    } else {
        return Err(format!(
            "MCP initialize 响应 Content-Type 不支持: {}",
            headers
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("<missing>")
        ));
    };

    if let Some(err) = init_result.get("error") {
        return Err(format!("MCP initialize RPC 错误: {}", err));
    }

    let negotiated = init_result
        .get("result")
        .and_then(|r| r.get("protocolVersion"))
        .and_then(|v| v.as_str())
        .unwrap_or(mcp_default_protocol_version())
        .to_string();

    let session_id = headers
        .get("Mcp-Session-Id")
        .or_else(|| headers.get("mcp-session-id"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());

    {
        let mut sessions = state.mcp_sessions.lock().unwrap();
        sessions.insert(
            server.id.clone(),
            McpServerSession {
                url: server.url.clone(),
                protocol_version: negotiated.clone(),
                session_id,
                initialized: true,
                initialized_at: now,
            },
        );
    }

    // Per spec: client should send notifications/initialized after initialize.
    mcp_send_notification(server, state, "notifications/initialized", serde_json::json!({}), true).await?;
    Ok(())
}

pub fn mcp_http_status_from_error(err: &str) -> Option<u16> {
    let prefix = "MCP HTTP 错误:";
    let rest = err.strip_prefix(prefix)?.trim_start();
    let code_str = rest.split_whitespace().next()?;
    code_str.parse::<u16>().ok()
}

pub async fn mcp_rpc(
    server: &McpRemoteServer,
    state: &AppState,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    mcp_ensure_initialized(server, state).await?;

    let attempt = mcp_call_request(server, state, method, params.clone(), true).await;
    if let Err(e) = &attempt {
        // If session expired or server requires re-init, reset session and retry once.
        if let Some(code) = mcp_http_status_from_error(e) {
            if code == 404 || code == 400 {
                {
                    let mut sessions = state.mcp_sessions.lock().unwrap();
                    sessions.remove(&server.id);
                }
                // Clear tools cache too; tools list may be session-scoped.
                {
                    let mut cache = state.mcp_tools_cache.lock().unwrap();
                    cache.remove(&server.id);
                }

                mcp_ensure_initialized(server, state).await?;
                return mcp_call_request(server, state, method, params, true).await;
            }
        }
    }
    attempt
}

pub async fn mcp_tools_list(server: &McpRemoteServer, state: &AppState) -> Result<Vec<McpToolMeta>, String> {
    let res = mcp_rpc(server, state, "tools/list", serde_json::json!({})).await?;
    let tools = res
        .get("tools")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "MCP tools/list 返回缺少 tools".to_string())?;

    let mut out = Vec::new();
    for t in tools {
        let tool_name = t
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "MCP tool 缺少 name".to_string())?
            .to_string();
        let description = t.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
        let input_schema = t.get("inputSchema").cloned();
        out.push(McpToolMeta {
            server_id: server.id.clone(),
            tool_name,
            description,
            input_schema,
        });
    }
    Ok(out)
}

pub async fn get_cached_mcp_tools(config: &AppConfig, state: &AppState) -> Result<Vec<McpToolMeta>, String> {
    let servers: Vec<McpRemoteServer> = config
        .mcp_remote_servers
        .iter()
        .filter(|s| s.enabled)
        .cloned()
        .collect();

    if servers.is_empty() {
        return Ok(Vec::new());
    }

    let now = chrono::Utc::now().timestamp();
    let ttl_seconds: i64 = 300; // 5 minutes

    let mut out = Vec::new();
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
            let fetched = mcp_tools_list(&server, state).await?;
            let mut cache = state.mcp_tools_cache.lock().unwrap();
            cache.insert(
                server.id.clone(),
                CachedMcpTools {
                    tools: fetched.clone(),
                    fetched_at: now,
                },
            );
            fetched
        };

        if let Some(allow) = server.tools_allowlist.as_ref() {
            tools.retain(|t| allow.contains(&t.tool_name));
        }

        out.extend(tools);
    }

    Ok(out)
}

pub fn parse_mcp_fn_name(fn_name: &str) -> Option<(String, String)> {
    // mcp__{serverId}__{toolName}
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
