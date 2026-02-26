use std::fs;
use std::path::PathBuf;
use tauri::Manager;
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
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn toggle_overlay_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let is_fullscreen = overlay.is_fullscreen().unwrap_or(false);
        overlay.set_fullscreen(!is_fullscreen).map_err(|e| e.to_string())?;
    }
    Ok(())
}
