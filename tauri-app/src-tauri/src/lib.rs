use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;
use futures::StreamExt;

mod config;
use config::{AppConfig};
use genai::chat::{ChatMessage, ChatRequest, ChatStreamEvent};
use genai::Client;

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

    // 深度调试日志：Provider 原始信息
    println!("=== AI DEBUG START ===");
    println!("Provider Kind: {}", provider.kind);
    println!("Config Model ID: {}", provider.model_id);
    println!("Config Base URL: {:?}", provider.base_url);

    // 准备 API Key 和 Base URL
    let api_key = provider.api_key.clone();
    let base_url = provider.base_url.clone();
    
    let auth_resolver = genai::resolver::AuthResolver::from_resolver_fn(move |_| {
        Ok(Some(genai::resolver::AuthData::from_single(api_key.clone())))
    });

    let mut builder = Client::builder()
        .with_auth_resolver(auth_resolver);

    if let Some(url) = base_url {
        if !url.trim().is_empty() {
            let api_key_for_service = provider.api_key.clone();
            
            // 修正：genai 库在拼接 Gemini 路径时直接采用 {base_url}models/...
            // 必须确保以 / 结尾，否则会产生 "builder error"
            let mut final_url = url.trim().to_string();
            if !final_url.ends_with('/') {
                final_url.push('/');
            }

            println!("Resolved Endpoint (Base URL): {}", final_url);

            builder = builder.with_service_target_resolver_fn(move |mut target: genai::ServiceTarget| {
                target.endpoint = genai::resolver::Endpoint::from_owned(final_url.clone());
                target.auth = genai::resolver::AuthData::from_single(api_key_for_service.clone());
                Ok(target)
            });
        }
    }

    let client = builder.build();
    
    // 模型 ID 识别逻辑
    let kind_lower = provider.kind.to_lowercase();
    let model = if provider.model_id.starts_with('/') {
        provider.model_id[1..].to_string()
    } else if provider.model_id.contains('/') {
        provider.model_id.clone()
    } else {
        format!("{}/{}", kind_lower, provider.model_id)
    };

    println!("Final genai Model String: {}", model);

    let chat_req = ChatRequest::new(vec![
        ChatMessage::system("You are a professional translator. Only provide translated text."),
        ChatMessage::user(format!("Translate from {} to {}: {}", from_lang, to_lang, text)),
    ]);

    let stream_res = match client.exec_chat_stream(&model, chat_req, None).await {
        Ok(res) => {
            println!("DEBUG: exec_chat_stream SUCCESS");
            res
        },
        Err(e) => {
            println!("!!! AI DEBUG: exec_chat_stream FAILED !!!");
            println!("Error Detail: {:?}", e);
            return Err(format!("AI 请求失败: {}", e));
        }
    };

    let mut actual_stream = stream_res.stream;

    println!("--- AI Debug: Response Stream Started ---");
    while let Some(event_res) = actual_stream.next().await {
        let event = event_res.map_err(|e| format!("流读取失败: {}", e))?;
        match &event {
            ChatStreamEvent::Chunk(chunk) => {
                let _ = app.emit("translation-token", chunk.content.clone());
            }
            ChatStreamEvent::End(end) => {
                println!("--- AI Debug: Stream Ended ---");
                if let Some(usage) = &end.captured_usage {
                    println!("Usage: {:?}", usage);
                }
            }
            _ => {}
        }
    }

    Ok(())
}

#[tauri::command]
fn get_app_config() -> Result<AppConfig, String> {
    Ok(AppConfig::load())
}

#[tauri::command]
fn update_app_config(config: AppConfig, app: AppHandle) -> Result<(), String> {
    config.save()?;
    let _ = app.emit("app-config-changed", config);
    Ok(())
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
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("无法初始化剪贴板: {}", e))?;
    
    clipboard.get_text()
        .map_err(|e| format!("读取剪贴板失败: {}", e))
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
