use crate::state::AppState;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn resolve_target_window(
    state: &AppState,
    mode: &str,
    instance_id: Option<&str>,
    reuse: Option<&str>,
) -> Result<(String, String), String> {
    println!(
        "[resolve_target] mode={} instance_id={:?} reuse={:?}",
        mode, instance_id, reuse
    );
    // 1. Resolve Window Type from Mode
    let window_type = if mode.starts_with("window.") {
        mode.strip_prefix("window.").unwrap().to_string()
    } else if mode.starts_with("workspace.") {
        "main".to_string()
    } else if mode.starts_with("pet.") {
        "pet".to_string()
    } else {
        match mode {
            "translate" => "translate".to_string(),
            "chat" => "chat".to_string(),
            "overlay" => "overlay".to_string(),
            "pet" => "pet".to_string(),
            "main" => "main".to_string(),
            "action-predict" => "action-predict".to_string(),
            _ => return Err(format!("Unknown mode: {}", mode)),
        }
    };

    // 2. Resolve Label based on instance_id and reuse strategy
    let reuse_strategy = reuse.unwrap_or("active-or-new");
    let default_instance_id = "default";

    // DEBUG LOG
    println!(
        "[resolve_target] mode={} instance_id={:?} reuse={}",
        mode, instance_id, reuse_strategy
    );

    let label = if reuse_strategy == "new" {
        // Always new, generate ID if not provided
        let id = instance_id
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string().chars().take(8).collect());
        format!("{}-{}", window_type, id)
    } else if reuse_strategy == "active-or-new" {
        if let Some(inst) = instance_id {
            format!("{}-{}", window_type, inst)
        } else {
            // Check last active
            let last_active = state
                .last_active_by_type
                .lock()
                .unwrap()
                .get(&window_type)
                .cloned();
            last_active.unwrap_or_else(|| format!("{}-{}", window_type, default_instance_id))
        }
    } else {
        // "reuse" or default fallback
        let id = instance_id.unwrap_or(default_instance_id);
        format!("{}-{}", window_type, id)
    };

    Ok((window_type, label))
}

pub fn ensure_window(
    app: &AppHandle,
    label: &str,
    window_type: &str,
) -> Result<tauri::WebviewWindow, String> {
    println!(
        "[ensure_window] Checking window: label={} type={}",
        label, window_type
    );
    if let Some(win) = app.get_webview_window(label) {
        println!("[ensure_window] Window exists: {}", label);
        return Ok(win);
    }

    println!("[ensure_window] Creating new window: {}", label);
    // Create new window based on type template
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()));

    // Apply type-specific config
    match window_type {
        "translate" | "chat" => {
            builder = builder
                .title(window_type)
                .inner_size(480.0, 600.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .skip_taskbar(true)
                .visible(false);
        }
        "action-predict" => {
            builder = builder
                .title(window_type)
                .inner_size(520.0, 144.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false);
        }
        "pet" => {
            builder = builder
                .title("Pet")
                .inner_size(300.0, 300.0)
                .decorations(false)
                .resizable(false) // Crucial for removing Windows borders on transparent windows
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false);
        }
        "overlay" => {
            builder = builder
                .inner_size(480.0, 580.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .skip_taskbar(true)
                .visible(false);
        }
        "main" => {
            builder = builder.title("inFlow Workspace").inner_size(1200.0, 800.0);
        }
        _ => {
            builder = builder.title(window_type);
        }
    }

    builder.build().map_err(|e| e.to_string())
}

pub fn show_window_by_label(app: &AppHandle, label: &str, focus: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(label) {
        if win.is_minimized().unwrap_or(false) {
            let _ = win.unminimize();
        }

        // Center action-predict window on screen
        if label.starts_with("action-predict") {
            if let Ok(Some(monitor)) = win.current_monitor() {
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                if let Ok(win_size) = win.outer_size() {
                    let x = screen_pos.x + (screen_size.width as i32 - win_size.width as i32) / 2;
                    let y = screen_pos.y + (screen_size.height as i32 - win_size.height as i32) / 3; // 1/3 from top
                    let _ = win
                        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                }
            }
        }

        let _ = win.show();
        if focus {
            let _ = win.set_focus();
        }

        let state = app.state::<AppState>();
        let parts: Vec<&str> = label.splitn(2, '-').collect();
        if parts.len() == 2 {
            let window_type = parts[0];
            state
                .last_active_by_type
                .lock()
                .unwrap()
                .insert(window_type.to_string(), label.to_string());
        }
    }
    Ok(())
}

pub fn show_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        if main
            .is_minimized()
            .map_err(|e: tauri::Error| e.to_string())?
        {
            main.unminimize().map_err(|e: tauri::Error| e.to_string())?;
        }
        main.show().map_err(|e: tauri::Error| e.to_string())?;
        main.set_focus().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}
