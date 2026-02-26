use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityUiPolicy {
    pub default_mode: String,
    pub allowed_modes: Vec<String>,
    pub default_focus: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDefinition {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub view_id: Option<String>,
    pub ui_policy: CapabilityUiPolicy,
}

pub fn catalog() -> Vec<CapabilityDefinition> {
    vec![
        CapabilityDefinition {
            id: "translate.selection".to_string(),
            version: "1.0.0".to_string(),
            name: "Translate Selection".to_string(),
            description: "Translate selected text.".to_string(),
            view_id: Some("translate-view".to_string()),
            ui_policy: CapabilityUiPolicy {
                default_mode: "translate".to_string(),
                allowed_modes: vec!["translate".to_string(), "overlay".to_string()],
                default_focus: true,
            },
        },
        CapabilityDefinition {
            id: "translate.text".to_string(),
            version: "1.0.0".to_string(),
            name: "Translate Text".to_string(),
            description: "Translate text input.".to_string(),
            view_id: Some("translate-view".to_string()),
            ui_policy: CapabilityUiPolicy {
                default_mode: "translate".to_string(),
                allowed_modes: vec!["translate".to_string(), "overlay".to_string()],
                default_focus: true,
            },
        },
        CapabilityDefinition {
            id: "chat.overlay".to_string(),
            version: "1.0.0".to_string(),
            name: "Chat Overlay".to_string(),
            description: "Open chat overlay window.".to_string(),
            view_id: Some("chat-overlay-view".to_string()),
            ui_policy: CapabilityUiPolicy {
                default_mode: "chat".to_string(),
                allowed_modes: vec!["chat".to_string(), "overlay".to_string()],
                default_focus: true,
            },
        },
        CapabilityDefinition {
            id: "action.predict".to_string(),
            version: "1.0.0".to_string(),
            name: "Action Predict".to_string(),
            description: "Predict follow-up actions for selected text.".to_string(),
            view_id: Some("action-predict-view".to_string()),
            ui_policy: CapabilityUiPolicy {
                default_mode: "action-predict".to_string(),
                allowed_modes: vec!["action-predict".to_string()],
                default_focus: true,
            },
        },
        CapabilityDefinition {
            id: "app.settings".to_string(),
            version: "1.0.0".to_string(),
            name: "App Settings".to_string(),
            description: "Open app settings.".to_string(),
            view_id: Some("settings-view".to_string()),
            ui_policy: CapabilityUiPolicy {
                default_mode: "main".to_string(),
                allowed_modes: vec!["main".to_string(), "workspace.main".to_string()],
                default_focus: true,
            },
        },
        // Markdown Editor capabilities
        CapabilityDefinition {
            id: "markdown.editor".to_string(),
            version: "1.0.0".to_string(),
            name: "Markdown Editor".to_string(),
            description: "Open markdown editor in overlay window.".to_string(),
            view_id: Some("markdown-overlay-view".to_string()),
            ui_policy: CapabilityUiPolicy {
                default_mode: "overlay".to_string(),
                allowed_modes: vec!["overlay".to_string(), "edit".to_string(), "preview".to_string()],
                default_focus: true,
            },
        },
        CapabilityDefinition {
            id: "markdown.open".to_string(),
            version: "1.0.0".to_string(),
            name: "Open Markdown File".to_string(),
            description: "Open a markdown file in the editor.".to_string(),
            view_id: Some("markdown-overlay-view".to_string()),
            ui_policy: CapabilityUiPolicy {
                default_mode: "overlay".to_string(),
                allowed_modes: vec!["overlay".to_string()],
                default_focus: true,
            },
        },
    ]
}

pub fn get(capability_id: &str) -> Option<CapabilityDefinition> {
    catalog().into_iter().find(|c| c.id == capability_id)
}

