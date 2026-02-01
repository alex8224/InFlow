use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

mod config;
use config::AppConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindow {
    pub title: Option<String>,
    pub process_name: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvocationContext {
    pub selected_text: Option<String>,
    pub clipboard_text: Option<String>,
    pub file_paths: Option<Vec<String>>,
    pub active_window: Option<ActiveWindow>,
    pub cursor: Option<Cursor>,
    pub url: Option<String>,
    #[serde(flatten)]
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvocationUi {
    pub mode: Option<String>,
    pub focus: Option<bool>,
    pub position: Option<String>,
    pub auto_close: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invocation {
    pub id: String,
    pub capability_id: String,
    pub args: Option<serde_json::Value>,
    pub context: Option<InvocationContext>,
    pub source: String,
    pub ui: Option<InvocationUi>,
    pub created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateResponse {
    pub translated_text: String,
    pub detected_source_language: Option<String>,
}

pub struct AppState {
    pub current_invocation: Mutex<Option<Invocation>>,
}

#[tauri::command]
async fn translate_text(
    text: String,
    from_lang: String,
    to_lang: String,
) -> Result<TranslateResponse, String> {
    let client = reqwest::Client::new();
    let url = "https://translate.googleapis.com/translate_a/single";
    let response = client
        .get(url)
        .query(&[
            ("client", "gtx"),
            ("sl", &from_lang),
            ("tl", &to_lang),
            ("dt", "t"),
            ("q", &text),
        ])
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("翻译接口报错: {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let mut translated_text = String::new();
    if let Some(sentences) = json.get(0).and_then(|v| v.as_array()) {
        for sentence in sentences {
            if let Some(t) = sentence.get(0).and_then(|v| v.as_str()) {
                translated_text.push_str(t);
            }
        }
    }

    if translated_text.is_empty() {
        return Err("翻译结果为空".to_string());
    }

    let detected_lang = json.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());

    Ok(TranslateResponse {
        translated_text,
        detected_source_language: detected_lang,
    })
}

#[tauri::command]
fn save_api_key(api_key: String, _app: AppHandle) -> Result<bool, String> {
    let mut config = AppConfig::load();
    config.set_api_key(api_key);
    config.save().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn get_api_key_status(_app: AppHandle) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "hasKey": true,
        "isValid": true
    }))
}

#[tauri::command]
fn execute_capability(
    capability_id: String,
    args: Option<serde_json::Value>,
    context: Option<serde_json::Value>,
    ui: Option<serde_json::Value>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let invocation_ui: Option<InvocationUi> = ui.map(|u| serde_json::from_value(u).unwrap());
    let invocation = Invocation {
        id: uuid::Uuid::new_v4().to_string(),
        capability_id,
        args,
        context: context.map(|ctx| serde_json::from_value(ctx).unwrap()),
        source: "internal".to_string(),
        ui: invocation_ui,
        created_at: chrono::Utc::now().timestamp(),
    };

    // Store in state
    let mut current = state.current_invocation.lock().unwrap();
    *current = Some(invocation.clone());

    app.emit("app://invocation", invocation)
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_current_invocation(state: State<'_, AppState>) -> Option<Invocation> {
    state.current_invocation.lock().unwrap().clone()
}

#[tauri::command]
fn show_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.show().map_err(|e: tauri::Error| e.to_string())?;
        overlay.set_focus().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_workspace(_view: Option<String>, app: AppHandle) -> Result<(), String> {
    if let Some(workspace) = app.get_webview_window("main") {
        workspace.set_focus().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_clipboard_text() -> Result<String, String> {
    Ok("".to_string())
}

fn handle_deep_link(app: &AppHandle, url: String) {
    if let Ok(parsed_url) = Url::parse(&url) {
        if parsed_url.scheme() == "inflow" && (parsed_url.host_str() == Some("invoke") || parsed_url.path().contains("invoke")) {
            let mut capability_id = "translate.selection".to_string();
            let mut selected_text = None;
            let mut args = serde_json::Map::new();

            for (key, value) in parsed_url.query_pairs() {
                match key.as_ref() {
                    "capabilityId" => capability_id = value.to_string(),
                    "selectedText" | "text" => selected_text = Some(value.to_string()),
                    _ => {
                        args.insert(key.to_string(), serde_json::Value::String(value.to_string()));
                    }
                }
            }

            let invocation = Invocation {
                id: uuid::Uuid::new_v4().to_string(),
                capability_id,
                args: if args.is_empty() { None } else { Some(serde_json::Value::Object(args)) },
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
                    mode: Some("overlay".to_string()),
                    focus: Some(true),
                    position: None,
                    auto_close: None,
                }),
                created_at: chrono::Utc::now().timestamp(),
            };

            // Update state in app handle
            let state = app.state::<AppState>();
            let mut current = state.current_invocation.lock().unwrap();
            *current = Some(invocation.clone());

            let _ = app.emit("app://invocation", invocation);
            
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = show_overlay(app_clone);
            });
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            current_invocation: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.len() > 1 {
                handle_deep_link(app, args[1].clone());
            }
        }))
        .setup(|app| {
            #[cfg(all(desktop, not(test)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("inflow");
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    for url in urls {
                        handle_deep_link(&handle, url.to_string());
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            translate_text,
            save_api_key,
            get_api_key_status,
            execute_capability,
            get_current_invocation,
            show_overlay,
            close_overlay,
            open_workspace,
            get_clipboard_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
