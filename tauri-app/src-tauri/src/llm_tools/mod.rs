use std::collections::{BTreeMap, HashSet};

use genai::chat::Tool;
use serde::Serialize;

use crate::config::{AppConfig, LlmProvider, McpRemoteServer};
use crate::genai_client::sanitize_tool_schema_for_provider;
use crate::mcp::{get_cached_mcp_tools, parse_mcp_fn_name, mcp_rpc};
use crate::state::AppState;

pub const TOOL_GET_CURRENT_DATETIME: &str = "inflow__get_current_datetime";

#[derive(Debug, Clone)]
pub struct ToolExecResult {
    pub content: serde_json::Value,
    pub response_content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCatalogItem {
    pub fn_name: String,
    pub source: String, // "builtin" | "mcp"
    pub title: String,
    pub description: Option<String>,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    pub tool_name: Option<String>,
}

fn builtin_catalog() -> Vec<ToolCatalogItem> {
    vec![ToolCatalogItem {
        fn_name: TOOL_GET_CURRENT_DATETIME.to_string(),
        source: "builtin".to_string(),
        title: "Local datetime".to_string(),
        description: Some("Get current local date/time (prevents wrong year in search).".to_string()),
        server_id: None,
        server_name: None,
        tool_name: None,
    }]
}

pub async fn catalog(config: &AppConfig, state: &AppState) -> Result<Vec<ToolCatalogItem>, String> {
    let mut out = Vec::new();
    out.extend(builtin_catalog());

    let servers: BTreeMap<String, String> = config
        .mcp_remote_servers
        .iter()
        .map(|s| (s.id.clone(), s.name.clone()))
        .collect();

    let mcp_tools = get_cached_mcp_tools(config, state).await?;
    for t in mcp_tools {
        let server_name = servers.get(&t.server_id).cloned();
        out.push(ToolCatalogItem {
            fn_name: format!("mcp__{}__{}", t.server_id, t.tool_name),
            source: "mcp".to_string(),
            title: t.tool_name.clone(),
            description: t.description.clone(),
            server_id: Some(t.server_id.clone()),
            server_name,
            tool_name: Some(t.tool_name.clone()),
        });
    }

    Ok(out)
}

pub fn is_time_tool_selected(selected: &HashSet<String>) -> bool {
    selected.contains(TOOL_GET_CURRENT_DATETIME)
}

fn builtin_time_tool(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_GET_CURRENT_DATETIME)
        .with_description("Return current local datetime (ISO), date, time, unix, and UTC offset minutes.")
        .with_schema(schema)
}

pub async fn build_genai_tools(
    selected: &HashSet<String>,
    provider: &LlmProvider,
    config: &AppConfig,
    state: &AppState,
) -> Result<Vec<Tool>, String> {
    if selected.is_empty() {
        return Ok(Vec::new());
    }

    let mut out: Vec<Tool> = Vec::new();

    // Stable ordering for deterministic tool list.
    let mut selected_sorted: Vec<String> = selected.iter().cloned().collect();
    selected_sorted.sort();

    let mcp_tools = get_cached_mcp_tools(config, state).await?;
    let mut by_key: BTreeMap<(String, String), crate::state::McpToolMeta> = BTreeMap::new();
    for t in mcp_tools {
        by_key.insert((t.server_id.clone(), t.tool_name.clone()), t);
    }

    for fn_name in selected_sorted {
        if fn_name == TOOL_GET_CURRENT_DATETIME {
            out.push(builtin_time_tool(provider));
            continue;
        }

        if let Some((server_id, tool_name)) = parse_mcp_fn_name(&fn_name) {
            if let Some(meta) = by_key.get(&(server_id.clone(), tool_name.clone())) {
                let mut tool = Tool::new(fn_name);
                if let Some(desc) = meta.description.as_ref() {
                    tool = tool.with_description(desc.clone());
                }
                if let Some(schema) = meta.input_schema.as_ref() {
                    let sanitized = sanitize_tool_schema_for_provider(provider, schema);
                    tool = tool.with_schema(sanitized);
                }
                out.push(tool);
            }
        }
    }

    Ok(out)
}

pub async fn execute_tool_call(
    selected: &HashSet<String>,
    provider: &LlmProvider,
    _config: &AppConfig,
    state: &AppState,
    server_map: &BTreeMap<String, McpRemoteServer>,
    fn_name: &str,
    fn_arguments: &serde_json::Value,
) -> Result<ToolExecResult, String> {
    let _ = provider; // reserved for future builtin behavior differences

    if !selected.contains(fn_name) {
        return Err(format!("Tool not enabled: {}", fn_name));
    }

    if fn_name == TOOL_GET_CURRENT_DATETIME {
        let now = chrono::Local::now();
        let utc_offset_minutes: i32 = now.offset().local_minus_utc() / 60;
        let content = serde_json::json!({
            "iso": now.to_rfc3339(),
            "date": now.date_naive().to_string(),
            "time": now.time().format("%H:%M:%S").to_string(),
            "unix": now.timestamp(),
            "utcOffsetMinutes": utc_offset_minutes,
        });
        let response_content =
            serde_json::to_string_pretty(&content).unwrap_or_else(|_| content.to_string());
        return Ok(ToolExecResult {
            content,
            response_content,
        });
    }

    if let Some((server_id, tool_name)) = parse_mcp_fn_name(fn_name) {
        let server = server_map
            .get(&server_id)
            .ok_or_else(|| format!("MCP server not found: {}", server_id))?;
        let call_params = serde_json::json!({
            "name": tool_name,
            "arguments": fn_arguments.clone(),
        });
        let content = mcp_rpc(server, state, "tools/call", call_params).await?;
        let response_content =
            serde_json::to_string_pretty(&content).unwrap_or_else(|_| content.to_string());
        return Ok(ToolExecResult {
            content,
            response_content,
        });
    }

    Err(format!("Unknown tool: {}", fn_name))
}
