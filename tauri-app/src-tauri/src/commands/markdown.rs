use std::fs;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn open_markdown_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let handle = app.clone();
    
    // Use blocking spawn for file dialog
    let result = tokio::task::spawn_blocking(move || {
        let file_path = handle
            .dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown", "txt"])
            .blocking_pick_file();
        
        match file_path {
            Some(path) => {
                let path_str = path.to_string();
                match fs::read_to_string(&path_str) {
                    Ok(content) => Ok(Some(format!("{}|{}", path_str, content))),
                    Err(e) => Err(format!("Failed to read file: {}", e)),
                }
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;
    
    result
}

#[tauri::command]
pub async fn save_markdown_file_as(app: tauri::AppHandle, content: String) -> Result<Option<String>, String> {
    let handle = app.clone();
    
    let result = tokio::task::spawn_blocking(move || {
        let file_path = handle
            .dialog()
            .file()
            .set_file_name("untitled.md")
            .add_filter("Markdown", &["md"])
            .add_filter("Text", &["txt"])
            .blocking_save_file();
        
        match file_path {
            Some(path) => {
                let path_str = path.to_string();
                match fs::write(&path_str, content) {
                    Ok(_) => Ok(Some(path_str)),
                    Err(e) => Err(format!("Failed to save file: {}", e)),
                }
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;
    
    result
}

#[tauri::command]
pub async fn save_markdown_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to save file: {}", e))
}

#[tauri::command]
pub async fn read_markdown_file(path: String) -> Result<String, String> {
    let path_clone = path.clone();
    tokio::task::spawn_blocking(move || fs::read_to_string(&path_clone))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Failed to stat file: {}", e))?;
    Ok(meta.len())
}

#[tauri::command]
pub fn toggle_overlay_fullscreen(window: tauri::WebviewWindow) -> Result<(), String> {
    // Despite the legacy name, toggle for the *calling* window.
    // NOTE: On Windows, `set_fullscreen` may be a no-op for frameless/transparent windows.
    // For UX, treat this as a "fill screen" toggle: prefer maximize, but also allow
    // exiting true fullscreen if it is currently enabled.

    // If we're in true fullscreen, always exit fullscreen first.
    let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    if is_fullscreen {
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Otherwise toggle maximized state.
    let is_maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if is_maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    Ok(())
}
