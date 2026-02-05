use crate::state::AppState;
use crate::types::{Invocation, InvocationContext, InvocationUi};
use crate::windowing::{ensure_window, resolve_target_window, show_window_by_label};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

pub fn handle_deep_link(app: &AppHandle, url: String) {
    if let Ok(parsed_url) = Url::parse(&url) {
        if parsed_url.scheme() == "inflow"
            && (parsed_url.host_str() == Some("invoke") || parsed_url.path().contains("invoke"))
        {
            let mut capability_id = "translate.selection".to_string();
            let mut selected_text = None;
            let mut args = serde_json::Map::new();

            // New routing params
            let mut mode = None;
            let mut instance_id = None;
            let mut reuse = None;
            let mut focus = Some(true);
            let mut auto_send = None;

            for (key, value) in parsed_url.query_pairs() {
                match key.as_ref() {
                    "capabilityId" => capability_id = value.to_string(),
                    "selectedText" | "text" => selected_text = Some(value.to_string()),
                    "mode" => mode = Some(value.to_string()),
                    "instanceId" => instance_id = Some(value.to_string()),
                    "reuse" => reuse = Some(value.to_string()),
                    "focus" => focus = Some(value.parse().unwrap_or(true)),
                    "autoSend" => auto_send = Some(value.parse().unwrap_or(false)),
                    _ => {
                        args.insert(
                            key.to_string(),
                            serde_json::Value::String(value.to_string()),
                        );
                    }
                }
            }

            // Enforce mode presence
            if mode.is_none() {
                println!("[deep_link] Rejected: mode is required. URL: {}", url);
                return;
            }

            let state = app.state::<AppState>();
            let mode_str = mode.clone().unwrap();

            println!("[deep_link] Processing URL: {}", url);

            // Resolve target
            let (window_type, label) = match resolve_target_window(
                &state,
                &mode_str,
                instance_id.as_deref(),
                reuse.as_deref(),
            ) {
                Ok(res) => res,
                Err(e) => {
                    println!("[deep_link] Resolution failed: {}", e);
                    return;
                }
            };

            println!(
                "[deep_link] Resolved target: type={} label={}",
                window_type, label
            );

            let invocation = Invocation {
                id: uuid::Uuid::new_v4().to_string(),
                capability_id,
                args: if args.is_empty() {
                    None
                } else {
                    Some(serde_json::Value::Object(args))
                },
                context: Some(InvocationContext {
                    selected_text,
                    clipboard_text: None,
                    file_paths: None,
                    active_window: None,
                    cursor: None,
                    url: None,
                    extra: None,
                }),
                source: "protocol".to_string(),
                ui: Some(InvocationUi {
                    mode,
                    instance_id,
                    reuse,
                    focus,
                    position: None,
                    auto_close: None,
                    target_label: Some(label.clone()),
                    auto_send,
                }),
                created_at: chrono::Utc::now().timestamp(),
            };

            {
                let mut invocations = state.invocations_by_label.lock().unwrap();
                invocations.insert(label.clone(), invocation.clone());
                println!("[deep_link] Inserted invocation for label: {}", label);
            }

            let _ = app.emit("app://invocation", invocation);

            let focus_val = focus.unwrap_or(true);

            // Execute window operations
            match ensure_window(app, &label, &window_type) {
                Ok(_) => {
                    println!("[deep_link] ensure_window success: {}", label);
                    match show_window_by_label(app, &label, focus_val) {
                        Ok(_) => println!("[deep_link] show_window success: {}", label),
                        Err(e) => println!("[deep_link] show_window failed: {}: {}", label, e),
                    }
                }
                Err(e) => println!("[deep_link] ensure_window failed: {}: {}", label, e),
            }
            println!("[deep_link] Done processing: {}", url);
        }
    }
}
