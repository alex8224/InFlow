use genai::chat::ChatMessage;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::types::{Invocation, PetEvent};

#[derive(Debug, Clone)]
pub struct ChatSession {
    pub messages: Vec<ChatMessage>,
    pub mcp_enabled: bool,
}

#[derive(Debug, Clone)]
pub struct McpToolMeta {
    pub server_id: String,
    pub tool_name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct McpServerSession {
    pub url: String,
    pub protocol_version: String,
    pub session_id: Option<String>,
    pub initialized: bool,
    pub initialized_at: i64,
}

#[derive(Debug, Clone)]
pub struct CachedMcpTools {
    pub tools: Vec<McpToolMeta>,
    pub fetched_at: i64,
}

pub struct AppState {
    pub invocations_by_label: Mutex<HashMap<String, Invocation>>,
    pub pet_queue_by_label: Mutex<HashMap<String, VecDeque<PetEvent>>>,
    pub last_active_by_type: Mutex<HashMap<String, String>>,
    pub chat_sessions: Mutex<HashMap<String, ChatSession>>,
    pub chat_cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub mcp_tools_cache: Mutex<HashMap<String, CachedMcpTools>>,
    pub mcp_sessions: Mutex<HashMap<String, McpServerSession>>,
    pub is_quitting: AtomicBool,
    #[cfg(desktop)]
    pub tray: Mutex<Option<tauri::tray::TrayIcon>>,
}
