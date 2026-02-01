use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize, Serialize, Default)]
pub struct AppConfig {
    pub google_api_key: Option<String>,
}

impl AppConfig {
    pub fn get_config_path() -> PathBuf {
        let mut path = PathBuf::from(
            std::env::var("APPDATA").unwrap_or_else(|_| "./".to_string())
        );
        path.push("inFlow");
        fs::create_dir_all(&path).ok();
        path.push("config.json");
        path
    }

    pub fn load() -> Self {
        let path = Self::get_config_path();
        if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::get_config_path();
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())
    }

    pub fn get_api_key(&self) -> Option<&String> {
        self.google_api_key.as_ref()
    }

    pub fn set_api_key(&mut self, api_key: String) {
        self.google_api_key = Some(api_key);
    }

    pub fn clear_api_key(&mut self) {
        self.google_api_key = None;
    }

    pub async fn validate_api_key(&self) -> bool {
        if let Some(api_key) = &self.google_api_key {
            if api_key.is_empty() {
                return false;
            }
            let client = reqwest::Client::new();
            let test_text = "test";
            let response = client
                .post("https://translation.googleapis.com/language/translate/v2")
                .query(&[("key", api_key)])
                .json(&serde_json::json!({
                    "q": [test_text],
                    "source": "en",
                    "target": "zh-CN",
                    "format": "text"
                }))
                .send()
                .await;

            match response {
                Ok(res) => res.status().is_success(),
                Err(_) => false,
            }
        } else {
            false
        }
    }
}
