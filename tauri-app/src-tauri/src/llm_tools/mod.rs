use std::collections::{BTreeMap, HashSet};

use genai::chat::Tool;
use serde::Serialize;

use crate::config::{AppConfig, LlmProvider, McpRemoteServer};
use crate::genai_client::sanitize_tool_schema_for_provider;
use crate::mcp::{get_cached_mcp_tools, mcp_rpc, parse_mcp_fn_name};
use crate::state::AppState;

mod builtin;

pub use builtin::time::TOOL_GET_CURRENT_DATETIME;

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

pub async fn catalog(config: &AppConfig, state: &AppState) -> Result<Vec<ToolCatalogItem>, String> {
    let mut out = Vec::new();
    out.extend(builtin::builtin_catalog_items());

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

// Build the list of enabled tools (builtin + MCP) for the provider.
pub async fn build_genai_tools(
    selected: &HashSet<String>,
    provider: &LlmProvider,
    config: &AppConfig,
    state: &AppState,
) -> Result<Vec<Tool>, String> {
    if selected.is_empty() {
        return Ok(Vec::new());
    }

    let debug = std::env::var("INFLOW_DEBUG_TOOLS").ok().as_deref() == Some("1");
    if debug {
        let mut sel: Vec<String> = selected.iter().cloned().collect();
        sel.sort();
        println!("[tools][debug] selected_count={} selected={}", sel.len(), sel.join(","));
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

    if debug {
        println!("[tools][debug] mcp_meta_count={}", by_key.len());
    }

    for fn_name in selected_sorted {
        if let Some(tool) = builtin::build_builtin_tool(&fn_name, provider) {
            if debug {
                println!("[tools][debug] enable builtin fn_name={}", fn_name);
            }
            out.push(tool);
            continue;
        }

        if let Some((server_id, tool_name)) = parse_mcp_fn_name(&fn_name) {
            if let Some(meta) = by_key.get(&(server_id.clone(), tool_name.clone())) {
                if debug {
                    println!(
                        "[tools][debug] enable mcp fn_name={} server_id={} tool_name={}",
                        fn_name, server_id, tool_name
                    );
                }
                let mut tool = Tool::new(fn_name);
                if let Some(desc) = meta.description.as_ref() {
                    tool = tool.with_description(desc.clone());
                }
                if let Some(schema) = meta.input_schema.as_ref() {
                    let sanitized = sanitize_tool_schema_for_provider(provider, schema);
                    tool = tool.with_schema(sanitized);
                }
                out.push(tool);
            } else if debug {
                println!(
                    "[tools][debug] skip mcp (no meta) fn_name={} server_id={} tool_name={}",
                    fn_name, server_id, tool_name
                );
            }
        } else if debug {
            println!("[tools][debug] skip unknown fn_name={}", fn_name);
        }
    }

    Ok(out)
}

pub async fn execute_tool_call(
    selected: &HashSet<String>,
    provider: &LlmProvider,
    config: &AppConfig,
    state: &AppState,
    server_map: &BTreeMap<String, McpRemoteServer>,
    fn_name: &str,
    fn_arguments: &serde_json::Value,
) -> Result<ToolExecResult, String> {
    if !selected.contains(fn_name) {
        return Err(format!("Tool not enabled: {}", fn_name));
    }

    if let Some(fut) = builtin::exec_builtin_tool(fn_name, provider, config, state, fn_arguments) {
        return fut.await;
    }

    if let Some((server_id, tool_name)) = parse_mcp_fn_name(fn_name) {
        let server = server_map
            .get(&server_id)
            .ok_or_else(|| format!("MCP server not found: {}", server_id))?;

        // Some providers emit `null` for tool arguments; MCP expects an object.
        let args = if fn_arguments.is_null() {
            serde_json::json!({})
        } else {
            fn_arguments.clone()
        };
        let call_params = serde_json::json!({
            "name": tool_name,
            "arguments": args,
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
