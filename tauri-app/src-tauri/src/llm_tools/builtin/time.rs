use futures::future::BoxFuture;
use genai::chat::Tool;

use crate::config::{AppConfig, LlmProvider};
use crate::genai_client::sanitize_tool_schema_for_provider;
use crate::state::AppState;

use super::{BuiltinToolSpec, ToolCategory};
use crate::llm_tools::ToolExecResult;

pub const TOOL_GET_CURRENT_DATETIME: &str = "inflow__get_current_datetime";

fn build(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_GET_CURRENT_DATETIME)
        .with_description(
            "Return current local datetime (ISO), date, time, unix, and UTC offset minutes.",
        )
        .with_schema(schema)
}

fn exec<'a>(
    _provider: &'a LlmProvider,
    _config: &'a AppConfig,
    _state: &'a AppState,
    _args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
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
        Ok(ToolExecResult {
            content,
            response_content,
        })
    })
}

pub fn spec() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_GET_CURRENT_DATETIME,
        title: "Local datetime",
        category: ToolCategory::System,
        description: Some("Get current local date/time (prevents wrong year in search)."),
        build,
        exec,
    }
}
