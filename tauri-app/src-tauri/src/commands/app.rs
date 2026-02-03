use crate::config::AppConfig;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn get_app_config() -> Result<AppConfig, String> {
    Ok(AppConfig::load())
}

#[tauri::command]
pub fn update_app_config(config: AppConfig, app: AppHandle) -> Result<(), String> {
    config.save()?;
    let _ = app.emit("app-config-changed", config);
    Ok(())
}

#[tauri::command]
pub fn get_api_key_status(_app: AppHandle) -> Result<serde_json::Value, String> {
    let config = AppConfig::load();
    Ok(serde_json::json!({
        "hasKey": true,
        "isValid": true,
        "preferredService": config.preferred_service
    }))
}
