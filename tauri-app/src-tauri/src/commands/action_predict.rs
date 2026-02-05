use crate::config::AppConfig;
use crate::genai_client::{build_genai_client, resolve_genai_model};
use genai::chat::{ChatMessage, ChatRequest};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PredictedAction {
    pub label: String,
    pub prompt: String,
}

#[tauri::command]
pub async fn predict_actions(text: String) -> Result<Vec<PredictedAction>, String> {
    if text.trim().is_empty() {
        return Ok(vec![]);
    }

    // 1. 加载配置，获取 LLM 提供商
    let config = AppConfig::load();
    let default_llm_id = config.active_provider_id.unwrap();
    let provider = &config
        .llm_providers
        .into_iter()
        .find(|llm| llm.id == default_llm_id)
        .ok_or("未找到默认 LLM 提供商")?;

    // 2. 构建 GenAI 客户端
    let client = build_genai_client(provider)?;
    let model_id = resolve_genai_model(provider);

    // 3. 构建预测 prompt
    let system_prompt = r#"你是一个动作预测助手。根据用户输入的文本，预测用户最可能想要执行的 3-4 个动作。
每个动作应该简洁明了，prompt 中用 {text} 作为原文占位符。
只返回 JSON 数组，不要其他内容，不要 markdown 代码块。

示例输出：
[{"label": "翻译成中文", "prompt": "请将以下内容翻译成中文：\n\n{text}"}, {"label": "总结要点", "prompt": "请总结以下内容的要点：\n\n{text}"}, {"label": "解释含义", "prompt": "请解释以下内容的含义：\n\n{text}"}]"#;

    let user_prompt = format!("用户输入的文本：\n\n{}", text);

    // 4. 调用 LLM
    let chat_req = ChatRequest::default()
        .with_system(system_prompt)
        .append_message(ChatMessage::user(user_prompt));

    let response = client
        .exec_chat(&model_id, chat_req, None)
        .await
        .map_err(|e| format!("LLM 请求失败: {}", e))?;

    let content = response.first_text().ok_or("LLM 返回内容为空")?;

    // 5. 解析 JSON 响应
    // 尝试提取 JSON 数组（处理可能的 markdown 代码块）
    let json_str = extract_json_array(content);

    let actions: Vec<PredictedAction> = serde_json::from_str(&json_str).map_err(|e| {
        format!(
            "解析 LLM 响应失败: {} - 原始内容: {}",
            e,
            content.chars().take(200).collect::<String>()
        )
    })?;

    Ok(actions)
}

fn extract_json_array(content: &str) -> String {
    let trimmed = content.trim();

    // 如果包含 markdown 代码块，提取其中内容
    if trimmed.contains("```") {
        if let Some(start) = trimmed.find("```") {
            let after_start = &trimmed[start + 3..];
            // 跳过可能的语言标识符（如 json）
            let content_start = after_start.find('\n').map(|i| i + 1).unwrap_or(0);
            let inner = &after_start[content_start..];
            if let Some(end) = inner.find("```") {
                return inner[..end].trim().to_string();
            }
        }
    }

    // 尝试找到 JSON 数组的开始和结束
    if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            if end > start {
                return trimmed[start..=end].to_string();
            }
        }
    }

    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_array_plain() {
        let input = r#"[{"label": "test", "prompt": "test prompt"}]"#;
        let result = extract_json_array(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_extract_json_array_with_markdown() {
        let input = r#"```json
[{"label": "test", "prompt": "test prompt"}]
```"#;
        let result = extract_json_array(input);
        assert_eq!(result, r#"[{"label": "test", "prompt": "test prompt"}]"#);
    }

    #[test]
    fn test_extract_json_array_with_prefix() {
        let input = r#"Here is the result: [{"label": "test", "prompt": "test prompt"}]"#;
        let result = extract_json_array(input);
        assert_eq!(result, r#"[{"label": "test", "prompt": "test prompt"}]"#);
    }
}
