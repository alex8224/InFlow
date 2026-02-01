use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;
use futures::StreamExt;

mod config;
use config::{AppConfig};

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
async fn translate_text_ai_stream(
    text: String,
    from_lang: String,
    to_lang: String,
    app: AppHandle,
) -> Result<(), String> {
    let config = AppConfig::load();
    let provider = config.llm_providers.iter()
        .find(|p| Some(&p.id) == config.active_provider_id.as_ref())
        .ok_or_else(|| "未找到激活的 AI 提供商".to_string())?;

    if provider.api_key.is_empty() {
        return Err("请先在设置中配置 API Key".to_string());
    }

    let client = reqwest::Client::new();
    
    if provider.kind.to_lowercase() == "gemini" {
        // Google Gemini API Style
        let api_url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?key={}",
            provider.model_id, provider.api_key
        );
        
        let payload = serde_json::json!({
            "contents": [{
                "parts": [{
                    "text": format!("Translate to {}: {}", to_lang, text)
                }]
            }]
        });

        let mut response_stream = client
            .post(api_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Gemini 请求失败: {}", e))?
            .bytes_stream();

        while let Some(chunk_result) = response_stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("流读取失败: {}", e))?;
            let text_chunk = String::from_utf8_lossy(&chunk);
            
            // Gemini returns chunks of JSON objects in an array or individual objects
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text_chunk) {
                 if let Some(parts) = json["candidates"][0]["content"]["parts"].as_array() {
                     for part in parts {
                         if let Some(t) = part["text"].as_str() {
                             let _ = app.emit("translation-token", t);
                         }
                     }
                 }
            }
        }
    } else {
        // OpenAI Compatible Style (DeepSeek, SiliconFlow, Volcengine, Minimax, etc.)
        let base_url = provider.base_url.as_ref().ok_or("OpenAI 协议需要配置 Base URL")?;
        let api_url = if base_url.ends_with("/chat/completions") {
            base_url.clone()
        } else {
            format!("{}/chat/completions", base_url.trim_end_matches('/'))
        };

        let payload = serde_json::json!({
            "model": provider.model_id,
            "messages": [
                { "role": "system", "content": "You are a professional translator. Only provide translated text." },
                { "role": "user", "content": format!("Translate from {} to {}: {}", from_lang, to_lang, text) }
            ],
            "stream": true
        });

        let mut response_stream = client
            .post(api_url)
            .header("Authorization", format!("Bearer {}", provider.api_key))
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("AI 请求失败: {}", e))?
            .bytes_stream();

        while let Some(chunk_result) = response_stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("流读取失败: {}", e))?;
            let text_chunk = String::from_utf8_lossy(&chunk);
            
            for line in text_chunk.lines() {
                let line = line.trim();
                if line.is_empty() { continue; }
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" { break; }
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                            let _ = app.emit("translation-token", content);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn get_app_config() -> Result<AppConfig, String> {
    Ok(AppConfig::load())
}

#[tauri::command]
fn update_app_config(config: AppConfig) -> Result<(), String> {
    config.save()
}

#[tauri::command]
fn get_api_key_status(_app: AppHandle) -> Result<serde_json::Value, String> {
    let config = AppConfig::load();
    Ok(serde_json::json!({
        "hasKey": true,
        "isValid": true,
        "preferredService": config.preferred_service
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
        capability_id: capability_id.clone(),
        args,
        context: context.map(|ctx| serde_json::from_value(ctx).unwrap()),
        source: "internal".to_string(),
        ui: invocation_ui,
        created_at: chrono::Utc::now().timestamp(),
    };

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
            translate_text_ai_stream,
            get_app_config,
            update_app_config,
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
