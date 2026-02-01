use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub kind: String, // "OpenAI", "Gemini", "Anthropic", "Ollama"
    pub base_url: Option<String>,
    pub api_key: String,
    pub model_id: String,
}

#[derive(Deserialize, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub google_api_key: Option<String>,
    pub llm_providers: Vec<LlmProvider>,
    pub active_provider_id: Option<String>,
    pub preferred_service: String, // "google" or "ai"
}

impl AppConfig {
    pub fn get_config_path() -> PathBuf {
        let mut path = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "./".to_string()));
        path.push("inFlow");
        fs::create_dir_all(&path).ok();
        path.push("config.json");
        path
    }

    pub fn load() -> Self {
        let path = Self::get_config_path();
        let mut config = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_else(Self::default_internal)
        } else {
            Self::default_internal()
        };

        if config.llm_providers.is_empty() {
            config.llm_providers = Self::get_default_providers();
        }
        if config.active_provider_id.is_none() {
            config.active_provider_id = config.llm_providers.first().map(|p| p.id.clone());
        }
        if config.preferred_service.is_empty() {
            config.preferred_service = "google".to_string();
        }

        config
    }

    fn default_internal() -> Self {
        Self {
            google_api_key: None,
            llm_providers: Self::get_default_providers(),
            active_provider_id: Some("deepseek".to_string()),
            preferred_service: "google".to_string(),
        }
    }

    pub fn get_default_providers() -> Vec<LlmProvider> {
        vec![
            LlmProvider {
                id: "deepseek".to_string(),
                name: "DeepSeek".to_string(),
                kind: "OpenAI".to_string(),
                base_url: Some("https://api.deepseek.com/v1".to_string()),
                api_key: "".to_string(),
                model_id: "deepseek-chat".to_string(),
            },
            LlmProvider {
                id: "siliconflow".to_string(),
                name: "硅基流动".to_string(),
                kind: "OpenAI".to_string(),
                base_url: Some("https://api.siliconflow.cn/v1".to_string()),
                api_key: "".to_string(),
                model_id: "deepseek-ai/DeepSeek-V3".to_string(),
            },
            LlmProvider {
                id: "gemini".to_string(),
                name: "Google Gemini".to_string(),
                kind: "Gemini".to_string(),
                base_url: Some("https://generativelanguage.googleapis.com".to_string()),
                api_key: "".to_string(),
                model_id: "gemini-2.0-flash".to_string(),
            },
            LlmProvider {
                id: "openai".to_string(),
                name: "OpenAI".to_string(),
                kind: "OpenAI".to_string(),
                base_url: Some("https://api.openai.com/v1".to_string()),
                api_key: "".to_string(),
                model_id: "gpt-4o-mini".to_string(),
            },
        ]
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::get_config_path();
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())
    }
}
