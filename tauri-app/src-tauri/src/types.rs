use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindow {
    pub title: Option<String>,
    pub process_name: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvocationContext {
    pub selected_text: Option<String>,
    pub clipboard_text: Option<String>,
    pub file_paths: Option<Vec<String>>,
    pub active_window: Option<ActiveWindow>,
    pub cursor: Option<Cursor>,
    pub url: Option<String>,
    #[serde(flatten)]
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InvocationUi {
    pub mode: Option<String>,
    pub instance_id: Option<String>,
    pub reuse: Option<String>,
    pub focus: Option<bool>,
    pub position: Option<String>,
    pub auto_close: Option<bool>,
    pub target_label: Option<String>,
    pub auto_send: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityRequestV2 {
    pub request_version: Option<String>,
    pub capability_id: String,
    pub args: Option<serde_json::Value>,
    pub context: Option<InvocationContext>,
    pub ui: Option<InvocationUi>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invocation {
    pub id: String,
    pub capability_id: String,
    pub capability_version: Option<String>,
    pub request_version: Option<String>,
    pub args: Option<serde_json::Value>,
    pub context: Option<InvocationContext>,
    pub source: String,
    pub ui: Option<InvocationUi>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetEvent {
    pub id: String,
    pub event_type: String, // "notify" | "action"
    pub payload: serde_json::Value,
    pub created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateResponse {
    pub translated_text: String,
    pub detected_source_language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionCreateResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTokenEvent {
    pub session_id: String,
    pub delta: Option<String>,
    pub reasoning_delta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCallEvent {
    pub session_id: String,
    pub call_id: String,
    pub name: String,
    pub arguments: serde_json::Value,
    pub status: String, // "started" | "done" | "error"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolResultEvent {
    pub session_id: String,
    pub call_id: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEndEvent {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatErrorEvent {
    pub session_id: String,
    pub message: String,
}
