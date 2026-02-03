use crate::state::AppState;
use crate::types::{Invocation, InvocationUi};
use crate::windowing::{ensure_window, resolve_target_window, show_window_by_label};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn execute_capability(
    capability_id: String,
    args: Option<serde_json::Value>,
    context: Option<serde_json::Value>,
    ui: Option<serde_json::Value>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut invocation_ui: Option<InvocationUi> = match ui {
        Some(u) => {
            Some(serde_json::from_value(u).map_err(|e| format!("UI parsing failed: {}", e))?)
        }
        None => None,
    };

    let mode = invocation_ui
        .as_ref()
        .and_then(|u| u.mode.clone())
        .ok_or("ui.mode is required")?;

    let instance_id = invocation_ui
        .as_ref()
        .and_then(|u| u.instance_id.as_deref());
    let reuse = invocation_ui.as_ref().and_then(|u| u.reuse.as_deref());

    let (window_type, label) = resolve_target_window(&state, &mode, instance_id, reuse)?;

    if let Some(ui) = &mut invocation_ui {
        ui.target_label = Some(label.clone());
    }

    let invocation = Invocation {
        id: uuid::Uuid::new_v4().to_string(),
        capability_id: capability_id.clone(),
        args,
        context: context.map(|ctx| {
            serde_json::from_value(ctx).unwrap_or_else(|_| crate::types::InvocationContext {
                selected_text: None,
                clipboard_text: None,
                file_paths: None,
                active_window: None,
                cursor: None,
                url: None,
                extra: None,
            })
        }),
        source: "internal".to_string(),
        ui: invocation_ui.clone(),
        created_at: chrono::Utc::now().timestamp(),
    };

    {
        let mut invocations = state.invocations_by_label.lock().unwrap();
        invocations.insert(label.clone(), invocation.clone());
    }

    app.emit("app://invocation", invocation)
        .map_err(|e| e.to_string())?;

    let _ = ensure_window(&app, &label, &window_type)?;

    let focus = invocation_ui
        .as_ref()
        .and_then(|u| u.focus)
        .unwrap_or_else(|| match window_type.as_str() {
            "translate" | "chat" => true,
            "pet" => false,
            _ => true,
        });

    show_window_by_label(&app, &label, focus)?;

    Ok(())
}

#[tauri::command]
pub fn get_current_invocation(
    state: State<'_, AppState>,
    label: Option<String>,
) -> Option<Invocation> {
    if let Some(l) = &label {
        println!("[get_current_invocation] Fetching for label: {}", l);
    } else {
        println!("[get_current_invocation] Fetching with NO label (legacy)");
    }

    let invocations = state.invocations_by_label.lock().unwrap();
    if let Some(l) = label {
        let res = invocations.get(&l).cloned();
        if res.is_some() {
            println!("[get_current_invocation] Found data for {}", l);
        } else {
            println!("[get_current_invocation] No data for {}", l);
        }
        res
    } else {
        None
    }
}
