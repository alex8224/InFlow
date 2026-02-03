use std::collections::HashMap;
use std::sync::OnceLock;

use futures::future::BoxFuture;
use genai::chat::Tool;

use crate::config::{AppConfig, LlmProvider};
use crate::state::AppState;

use super::{ToolCatalogItem, ToolExecResult};

pub mod time;
pub mod webfetch;

pub struct BuiltinToolSpec {
    pub fn_name: &'static str,
    pub title: &'static str,
    pub description: Option<&'static str>,
    pub build: fn(&LlmProvider) -> Tool,
    pub exec: for<'a> fn(
        &'a LlmProvider,
        &'a AppConfig,
        &'a AppState,
        &'a serde_json::Value,
    ) -> BoxFuture<'a, Result<ToolExecResult, String>>,
}

fn builtin_registry() -> &'static HashMap<&'static str, BuiltinToolSpec> {
    static REGISTRY: OnceLock<HashMap<&'static str, BuiltinToolSpec>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut m = HashMap::new();
        let spec = time::spec();
        m.insert(spec.fn_name, spec);
        let spec = webfetch::spec();
        m.insert(spec.fn_name, spec);
        m
    })
}

pub fn builtin_catalog_items() -> Vec<ToolCatalogItem> {
    let mut keys: Vec<&&'static str> = builtin_registry().keys().collect();
    keys.sort();
    keys.into_iter()
        .filter_map(|k| builtin_registry().get(k))
        .map(|spec| ToolCatalogItem {
            fn_name: spec.fn_name.to_string(),
            source: "builtin".to_string(),
            title: spec.title.to_string(),
            description: spec.description.map(|s| s.to_string()),
            server_id: None,
            server_name: None,
            tool_name: None,
        })
        .collect()
}

pub fn build_builtin_tool(fn_name: &str, provider: &LlmProvider) -> Option<Tool> {
    builtin_registry().get(fn_name).map(|spec| (spec.build)(provider))
}

pub fn exec_builtin_tool<'a>(
    fn_name: &str,
    provider: &'a LlmProvider,
    config: &'a AppConfig,
    state: &'a AppState,
    args: &'a serde_json::Value,
) -> Option<BoxFuture<'a, Result<ToolExecResult, String>>> {
    builtin_registry()
        .get(fn_name)
        .map(|spec| (spec.exec)(provider, config, state, args))
}
