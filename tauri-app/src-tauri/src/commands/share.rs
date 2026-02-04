use crate::share_server::{self, ShareCreateResponse, SharedMessage, SharedSession};

/// Create a share for the current chat session
#[tauri::command]
pub fn chat_share_create(
    session_id: String,
    messages_json: String,
    provider_name: Option<String>,
) -> Result<ShareCreateResponse, String> {
    // Parse the messages from JSON (sent from frontend)
    let messages: Vec<SharedMessage> = serde_json::from_str(&messages_json)
        .map_err(|e| format!("Failed to parse messages: {}", e))?;

    if messages.is_empty() {
        return Err("Cannot share an empty conversation".to_string());
    }

    // Generate a short share ID from the session ID
    let share_id = if session_id.len() >= 8 {
        session_id[session_id.len() - 8..].to_string()
    } else {
        session_id.clone()
    };

    // Generate title from first user message (truncate by chars, not bytes, for UTF-8 safety)
    let title = messages.iter().find(|m| m.role == "user").map(|m| {
        let content = m.content.trim();
        let char_count: usize = content.chars().count();
        if char_count > 50 {
            let truncated: String = content.chars().take(47).collect();
            format!("{}...", truncated)
        } else {
            content.to_string()
        }
    });

    let session = SharedSession {
        id: share_id,
        created_at: chrono::Utc::now().timestamp_millis(),
        messages,
        provider_name,
        title,
    };

    let response = share_server::create_share(session);

    println!(
        "[share] Created share_id={} url={}",
        response.share_id, response.url
    );

    Ok(response)
}

/// Get the share server port
#[tauri::command]
pub fn get_share_server_port() -> Option<u16> {
    share_server::get_server_port()
}
