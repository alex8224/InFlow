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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRemoteServer {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub headers: Option<std::collections::BTreeMap<String, String>>,
    pub tools_allowlist: Option<Vec<String>>,
}

#[derive(Deserialize, Serialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    pub google_api_key: Option<String>,
    pub llm_providers: Vec<LlmProvider>,
    pub active_provider_id: Option<String>,
    pub preferred_service: String, // "google" or "ai"
    pub mcp_remote_servers: Vec<McpRemoteServer>,

    // Chat system prompt customization.
    // - chat_system_prompt: inline prompt text stored in config.json (supports \n).
    // - chat_system_prompt_path: path to a text file containing the prompt (easier to edit).
    pub chat_system_prompt: Option<String>,
    pub chat_system_prompt_path: Option<String>,

    // WebFetch tool proxy settings.
    // - webfetch_use_system_proxy: if true (default), use OS proxy settings.
    // - webfetch_proxy: optional explicit proxy URL (overrides system proxy).
    //   Example: "http://127.0.0.1:7890"
    pub webfetch_use_system_proxy: Option<bool>,
    pub webfetch_proxy: Option<String>,
}

impl AppConfig {
    pub fn config_path() -> PathBuf {
        Self::get_config_path()
    }

    fn get_appdata_config_path() -> PathBuf {
        let mut path = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "./".to_string()));
        path.push("inFlow");
        fs::create_dir_all(&path).ok();
        path.push("config.json");
        path
    }

    fn get_project_config_path_candidates() -> Vec<PathBuf> {
        // NOTE:
        // - In dev, this resolves to the local workspace path.
        // - In release, this points to a build-time path and likely won't exist.
        //   That's OK: we fall back to %APPDATA%.
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

        // Prefer repo-root config.json if present: <repo>/config.json
        // src-tauri is typically: <repo>/tauri-app/src-tauri
        let repo_root = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());
        let repo_config = repo_root.map(|p| p.join("config.json"));

        // Secondary: <repo>/tauri-app/config.json
        let tauri_app_config = manifest_dir
            .parent()
            .map(|p| p.to_path_buf())
            .map(|p| p.join("config.json"));

        [repo_config, tauri_app_config]
            .into_iter()
            .flatten()
            .collect()
    }

    pub fn get_config_path() -> PathBuf {
        for p in Self::get_project_config_path_candidates() {
            if p.exists() {
                return p;
            }
        }
        Self::get_appdata_config_path()
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

        if std::env::var("INFLOW_DEBUG_CONFIG").ok().as_deref() == Some("1") {
            println!(
                "[config][debug] loaded path={} providers={} mcp_servers={}",
                path.display(),
                config.llm_providers.len(),
                config.mcp_remote_servers.len()
            );
            for s in &config.mcp_remote_servers {
                println!(
                    "[config][debug] mcp_server id={} name={} enabled={} url={} allowlist={}",
                    s.id,
                    s.name,
                    s.enabled,
                    s.url,
                    s.tools_allowlist.as_ref().map(|v| v.len()).unwrap_or(0)
                );
            }
        }

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
            mcp_remote_servers: Vec::new(),
            chat_system_prompt: None,
            chat_system_prompt_path: None,
            webfetch_use_system_proxy: Some(true),
            webfetch_proxy: None,
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
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())
    }
}
