use crate::capability_catalog::{self, CapabilityDefinition};
use crate::state::AppState;
use crate::types::{CapabilityRequestV2, Invocation, InvocationContext, InvocationUi};
use crate::windowing::{ensure_window, resolve_target_window, show_window_by_label};
use tauri::{AppHandle, Emitter, State};

fn parse_context_legacy(raw: Option<serde_json::Value>) -> Option<InvocationContext> {
    raw.and_then(|ctx| serde_json::from_value(ctx).ok())
}

fn resolve_mode(
    capability: Option<&CapabilityDefinition>,
    ui: &InvocationUi,
    request_version: &str,
) -> Result<String, String> {
    if let Some(capability) = capability {
        let mode = ui
            .mode
            .clone()
            .unwrap_or_else(|| capability.ui_policy.default_mode.clone());

        if capability.ui_policy.allowed_modes.contains(&mode) {
            // Normalize mode: map edit/preview to overlay for windowing
            let normalized = match mode.as_str() {
                "edit" | "preview" => "overlay".to_string(),
                _ => mode,
            };
            return Ok(normalized);
        }

        if request_version == "legacy" && mode.is_empty() {
            return Ok(capability.ui_policy.default_mode.clone());
        }

        return Err(format!(
            "Mode '{}' is not allowed for capability '{}'",
            mode, capability.id
        ));
    }

    let mode = ui.mode.clone().unwrap_or_default();
    if mode.is_empty() {
        return Err("ui.mode is required for unregistered capability".to_string());
    }
    Ok(mode)
}

fn default_focus(window_type: &str) -> bool {
    match window_type {
        "pet" => false,
        _ => true,
    }
}

pub fn execute_capability_request(
    request: CapabilityRequestV2,
    app: &AppHandle,
    state: &AppState,
) -> Result<(), String> {
    let capability = capability_catalog::get(&request.capability_id);
    if capability.is_none() {
        println!(
            "[capability][compat] Unregistered capability '{}', using mode-based fallback",
            request.capability_id
        );
    }

    let request_version = request
        .request_version
        .clone()
        .unwrap_or_else(|| "v2".to_string());

    let mut invocation_ui = request.ui.clone().unwrap_or_default();
    let mode = resolve_mode(capability.as_ref(), &invocation_ui, &request_version)?;
    invocation_ui.mode = Some(mode.clone());
    let requested_focus = invocation_ui.focus;

    let instance_id = invocation_ui.instance_id.as_deref();
    let reuse = invocation_ui.reuse.as_deref();
    let (window_type, label) = resolve_target_window(state, &mode, instance_id, reuse)?;

    let focus = requested_focus.unwrap_or_else(|| {
        capability
            .as_ref()
            .map(|c| c.ui_policy.default_focus)
            .unwrap_or_else(|| default_focus(&window_type))
    });
    invocation_ui.focus = Some(focus);

    invocation_ui.target_label = Some(label.clone());

    let invocation = Invocation {
        id: uuid::Uuid::new_v4().to_string(),
        capability_id: request.capability_id.clone(),
        capability_version: capability.as_ref().map(|c| c.version.clone()),
        request_version: Some(request_version),
        args: request.args.clone(),
        context: request.context.clone(),
        source: request
            .source
            .clone()
            .unwrap_or_else(|| "internal".to_string()),
        ui: Some(invocation_ui.clone()),
        created_at: chrono::Utc::now().timestamp(),
    };

    {
        let mut invocations = state.invocations_by_label.lock().unwrap();
        invocations.insert(label.clone(), invocation.clone());
    }

    app.emit("app://invocation", invocation)
        .map_err(|e| e.to_string())?;

    let _ = ensure_window(app, &label, &window_type)?;
    show_window_by_label(app, &label, focus)?;
    Ok(())
}

#[tauri::command]
pub fn execute_capability_v2(
    request: CapabilityRequestV2,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    execute_capability_request(request, &app, &state)
}

#[tauri::command]
pub fn execute_capability(
    capability_id: String,
    args: Option<serde_json::Value>,
    context: Option<serde_json::Value>,
    ui: Option<serde_json::Value>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let invocation_ui: Option<InvocationUi> = match ui {
        Some(u) => Some(serde_json::from_value(u).map_err(|e| format!("UI parsing failed: {}", e))?),
        None => None,
    };

    let request = CapabilityRequestV2 {
        request_version: Some("legacy".to_string()),
        capability_id,
        args,
        context: parse_context_legacy(context),
        ui: invocation_ui,
        source: Some("internal".to_string()),
    };

    execute_capability_request(request, &app, &state)
}

#[tauri::command]
pub fn get_capability_catalog() -> Vec<CapabilityDefinition> {
    capability_catalog::catalog()
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
