use arboard::Clipboard;
use base64::{engine::general_purpose, Engine as _};
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub async fn handle_deep_link_from_frontend(
    url: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    println!("[command] handle_deep_link_from_frontend: {}", url);
    // 使用 spawn 避免阻塞当前命令线程，确保命令能立即返回
    tauri::async_runtime::spawn(async move {
        crate::deeplink::handle_deep_link(&app, url);
    });
    Ok(())
}

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

#[tauri::command]
pub fn get_clipboard_image() -> Result<Option<String>, String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("无法初始化剪贴板: {}", e))?;

    match clipboard.get_image() {
        Ok(image) => {
            let mut buf = Vec::new();
            {
                let img = image::RgbaImage::from_raw(
                    image.width as u32,
                    image.height as u32,
                    image.bytes.to_vec(),
                )
                .ok_or_else(|| "图像转换失败".to_string())?;
                let mut cursor = std::io::Cursor::new(&mut buf);
                img.write_to(&mut cursor, image::ImageFormat::Png)
                    .map_err(|e| format!("编码 PNG 失败: {}", e))?;
            }

            let b64 = general_purpose::STANDARD.encode(buf);
            Ok(Some(format!("data:image/png;base64,{}", b64)))
        }
        Err(e) => {
            let s = e.to_string();
            if s.contains("not present") || s.contains("No such file") || s.contains("not found") {
                Ok(None)
            } else {
                Err(format!("读取剪贴板图像失败: {}", e))
            }
        }
    }
}

#[tauri::command]
pub fn read_local_file_data_url(path: String) -> Result<Option<String>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let p = match resolve_local_file_path(trimmed) {
        Some(v) => v,
        None => return Ok(None),
    };

    if !p.exists() || !p.is_file() {
        return Ok(None);
    }

    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("mp4") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    };

    let data = std::fs::read(&p).map_err(|e| format!("读取文件失败: {}", e))?;
    let b64 = general_purpose::STANDARD.encode(data);
    Ok(Some(format!("data:{};base64,{}", mime, b64)))
}

fn resolve_local_file_path(input: &str) -> Option<PathBuf> {
    let p = PathBuf::from(input);
    if p.is_absolute() {
        return Some(p);
    }

    let cwd = std::env::current_dir().ok()?;
    let mut candidates: Vec<PathBuf> = vec![cwd.join(input)];
    if let Some(parent) = cwd.parent() {
        candidates.push(parent.join(input));
    }
    candidates.push(cwd.join("src-tauri").join(input));

    candidates
        .into_iter()
        .find(|candidate| candidate.exists() && candidate.is_file())
}
