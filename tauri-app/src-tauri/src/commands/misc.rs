use arboard::Clipboard;
use tauri::Manager;

#[tauri::command]
pub fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    // Backward compatibility or legacy overlay
    if let Some(overlay) = app.get_webview_window("overlay") {
        if overlay
            .is_minimized()
            .map_err(|e: tauri::Error| e.to_string())?
        {
            overlay
                .unminimize()
                .map_err(|e: tauri::Error| e.to_string())?;
        }
        overlay.show().map_err(|e: tauri::Error| e.to_string())?;
        overlay
            .set_focus()
            .map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn close_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_workspace(_view: Option<String>, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(workspace) = app.get_webview_window("main") {
        workspace
            .set_focus()
            .map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_clipboard_text() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("无法初始化剪贴板: {}", e))?;

    clipboard
        .get_text()
        .map_err(|e| format!("读取剪贴板失败: {}", e))
}
