use crate::commands::capability::execute_capability_request;
use crate::types::{CapabilityRequestV2, InvocationContext, InvocationUi};
use tauri::{AppHandle, Manager};
use url::Url;

fn parse_bool(value: &str, default: bool) -> bool {
    value.parse::<bool>().unwrap_or(default)
}

fn parse_json_value(value: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str::<serde_json::Value>(value)
        .map_err(|e| format!("invalid JSON payload: {}", e))
}

fn parse_invocation_ui(value: &str) -> Result<InvocationUi, String> {
    serde_json::from_str::<InvocationUi>(value).map_err(|e| format!("invalid ui payload: {}", e))
}

fn parse_invocation_context(value: &str) -> Result<InvocationContext, String> {
    serde_json::from_str::<InvocationContext>(value)
        .map_err(|e| format!("invalid context payload: {}", e))
}

fn request_from_v2_url(parsed_url: &Url) -> Result<CapabilityRequestV2, String> {
    let mut capability_id = None;
    let mut args: Option<serde_json::Value> = None;
    let mut context: Option<InvocationContext> = None;
    let mut ui: Option<InvocationUi> = None;
    let mut mode: Option<String> = None;
    let mut instance_id: Option<String> = None;
    let mut reuse: Option<String> = None;
    let mut focus: Option<bool> = None;
    let mut auto_send: Option<bool> = None;
    let mut text: Option<String> = None;
    let mut file: Option<String> = None;
    let mut content: Option<String> = None;
    let mut action: Option<String> = None;

    for (key, value) in parsed_url.query_pairs() {
        match key.as_ref() {
            "capability" | "capabilityId" => capability_id = Some(value.to_string()),
            "args" => args = Some(parse_json_value(&value)?),
            "context" => context = Some(parse_invocation_context(&value)?),
            "ui" => ui = Some(parse_invocation_ui(&value)?),
            "mode" => mode = Some(value.to_string()),
            "instanceId" => instance_id = Some(value.to_string()),
            "reuse" => reuse = Some(value.to_string()),
            "focus" => focus = Some(parse_bool(&value, true)),
            "autoSend" => auto_send = Some(parse_bool(&value, false)),
            "text" | "selectedText" => text = Some(value.to_string()),
            // Convenience params (no JSON encoding required). Useful for deep linking.
            // Example:
            // inflow://invoke/?v=2&capabilityId=markdown.editor&mode=edit&file=C%3A%5Cpath%5Cnote.md
            "file" | "filePath" | "path" => file = Some(value.to_string()),
            "content" => content = Some(value.to_string()),
            "action" => action = Some(value.to_string()),
            _ => {}
        }
    }

    let capability_id = capability_id.ok_or("v2 deep link requires capability")?;
    let mut resolved_ui = ui.unwrap_or_default();
    if mode.is_some() {
        resolved_ui.mode = mode;
    }
    if instance_id.is_some() {
        resolved_ui.instance_id = instance_id;
    }
    if reuse.is_some() {
        resolved_ui.reuse = reuse;
    }
    if focus.is_some() {
        resolved_ui.focus = focus;
    }
    if auto_send.is_some() {
        resolved_ui.auto_send = auto_send;
    }

    let mut resolved_context = context.unwrap_or(InvocationContext {
        selected_text: None,
        clipboard_text: None,
        file_paths: None,
        active_window: None,
        cursor: None,
        url: None,
        extra: None,
    });
    if resolved_context.selected_text.is_none() {
        resolved_context.selected_text = text;
    }

    // Merge convenience params into args.
    if file.is_some() || content.is_some() || action.is_some() {
        let mut map = match args.take() {
            None => serde_json::Map::new(),
            Some(serde_json::Value::Object(m)) => m,
            Some(_) => {
                return Err("v2 deep link 'args' must be an object when using 'file/content/action' query params".to_string());
            }
        };
        if let Some(v) = file {
            map.entry("file".to_string())
                .or_insert_with(|| serde_json::Value::String(v));
        }
        if let Some(v) = content {
            map.entry("content".to_string())
                .or_insert_with(|| serde_json::Value::String(v));
        }
        if let Some(v) = action {
            map.entry("action".to_string())
                .or_insert_with(|| serde_json::Value::String(v));
        }
        if !map.is_empty() {
            args = Some(serde_json::Value::Object(map));
        }
    }

    Ok(CapabilityRequestV2 {
        request_version: Some("v2".to_string()),
        capability_id,
        args,
        context: Some(resolved_context),
        ui: Some(resolved_ui),
        source: Some("protocol".to_string()),
    })
}

fn request_from_legacy_url(parsed_url: &Url) -> CapabilityRequestV2 {
    let mut capability_id = "translate.selection".to_string();
    let mut selected_text = None;
    let mut args = serde_json::Map::new();

    let mut mode = None;
    let mut instance_id = None;
    let mut reuse = None;
    let mut focus = None;
    let mut auto_send = None;

    for (key, value) in parsed_url.query_pairs() {
        match key.as_ref() {
            "capabilityId" => capability_id = value.to_string(),
            "selectedText" | "text" => selected_text = Some(value.to_string()),
            "mode" => mode = Some(value.to_string()),
            "instanceId" => instance_id = Some(value.to_string()),
            "reuse" => reuse = Some(value.to_string()),
            "focus" => focus = Some(parse_bool(&value, true)),
            "autoSend" => auto_send = Some(parse_bool(&value, false)),
            "v" | "requestVersion" => {}
            _ => {
                args.insert(
                    key.to_string(),
                    serde_json::Value::String(value.to_string()),
                );
            }
        }
    }

    println!(
        "[deep_link][deprecated] Legacy query params detected for capability='{}'",
        capability_id
    );

    CapabilityRequestV2 {
        request_version: Some("legacy".to_string()),
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
        ui: Some(InvocationUi {
            mode,
            instance_id,
            reuse,
            focus,
            position: None,
            auto_close: None,
            target_label: None,
            auto_send,
        }),
        source: Some("protocol".to_string()),
    }
}

pub fn handle_deep_link(app: &AppHandle, url: String) {
    let parsed_url = match Url::parse(&url) {
        Ok(v) => v,
        Err(e) => {
            println!("[deep_link] invalid URL '{}': {}", url, e);
            return;
        }
    };

    let is_invoke = parsed_url.scheme() == "inflow"
        && (parsed_url.host_str() == Some("invoke") || parsed_url.path().contains("invoke"));
    if !is_invoke {
        return;
    }

    let is_v2 = parsed_url
        .query_pairs()
        .any(|(k, v)| (k == "v" || k == "requestVersion") && v == "2");

    let request = if is_v2 {
        match request_from_v2_url(&parsed_url) {
            Ok(req) => req,
            Err(err) => {
                println!("[deep_link] v2 parse rejected: {}. URL: {}", err, url);
                return;
            }
        }
    } else {
        request_from_legacy_url(&parsed_url)
    };

    let state = app.state::<crate::state::AppState>();
    match execute_capability_request(request, app, &state) {
        Ok(_) => println!("[deep_link] handled: {}", url),
        Err(e) => println!("[deep_link] execute failed: {}. URL: {}", e, url),
    }
}
