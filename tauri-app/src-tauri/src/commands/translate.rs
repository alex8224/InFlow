use tauri::{AppHandle, Emitter};
use genai::chat::{ChatMessage, ChatRequest, ChatStreamEvent};
use futures::StreamExt;
use crate::config::AppConfig;
use crate::genai_client::{build_genai_client, resolve_genai_model};
use crate::types::TranslateResponse;

#[tauri::command]
pub async fn translate_text(
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
pub async fn translate_text_ai_stream(
    text: String,
    from_lang: String,
    to_lang: String,
    provider_id: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    let config = AppConfig::load();

    // Priority: Explicit provider_id > config.translate_provider_id > config.active_provider_id
    let target_id = provider_id
        .or(config.translate_provider_id)
        .or(config.active_provider_id);

    let provider = config.llm_providers.iter()
        .find(|p| Some(&p.id) == target_id.as_ref())
        .ok_or_else(|| "未找到激活的 AI 提供商".to_string())?;

    if provider.api_key.is_empty() {
        return Err("请先在设置中配置 API Key".to_string());
    }

    // 深度调试日志：Provider 原始信息
    println!("=== AI DEBUG START ===");
    println!("Provider Kind: {}", provider.kind);
    println!("Config Model ID: {}", provider.model_id);
    println!("Config Base URL: {:?}", provider.base_url);

    let client = build_genai_client(provider)?;
    let model = resolve_genai_model(provider);

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
