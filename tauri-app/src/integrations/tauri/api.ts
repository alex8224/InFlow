import { invoke } from '@tauri-apps/api/core';

export interface LlmProvider {
  id: string;
  name: string;
  kind: string;
  baseUrl?: string | null;
  apiKey: string;
  modelId: string;
}

export interface McpRemoteServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  headers?: Record<string, string> | null;
  toolsAllowlist?: string[] | null;
}

export interface AppConfig {
  googleApiKey: string | null;
  llmProviders: LlmProvider[];
  activeProviderId: string | null;
  preferredService: string;
  mcpRemoteServers?: McpRemoteServer[];
}

export async function chatSessionCreate(): Promise<{ sessionId: string }> {
  return await invoke('chat_session_create');
}

export async function chatStream(sessionId: string, providerId: string, userText: string): Promise<void> {
  await invoke('chat_stream', { sessionId, providerId, userText });
}

export async function chatCancel(sessionId: string): Promise<void> {
  await invoke('chat_cancel', { sessionId });
}

export async function executeCapability(
  capabilityId: string,
  args?: Record<string, unknown>,
  context?: any,
  ui?: { mode?: string; focus?: boolean }
): Promise<void> {
  await invoke('execute_capability', {
    capabilityId,
    args,
    context,
    ui,
  });
}

export async function showOverlay(): Promise<void> {
  await invoke('show_overlay');
}

export async function closeOverlay(): Promise<void> {
  await invoke('close_overlay');
}

export async function openWorkspace(view?: string): Promise<void> {
  await invoke('open_workspace', { view });
}

export async function getClipboardText(): Promise<string> {
  return await invoke('get_clipboard_text');
}

export async function translateText(
  text: string,
  fromLang: string,
  toLang: string
): Promise<{ translatedText: string; detectedSourceLanguage?: string }> {
  return await invoke('translate_text', { text, fromLang, toLang });
}

export async function translateTextAiStream(
  text: string,
  fromLang: string,
  toLang: string
): Promise<void> {
  return await invoke('translate_text_ai_stream', { text, fromLang, toLang });
}

export async function saveApiKey(apiKey: string): Promise<boolean> {
  return await invoke('save_api_key', { apiKey });
}

export async function getApiKeyStatus(): Promise<{ hasKey: boolean; isValid: boolean; preferredService: string }> {
  return await invoke('get_api_key_status');
}

export async function getAppConfig(): Promise<AppConfig> {
  return await invoke('get_app_config');
}

export async function updateAppConfig(config: AppConfig): Promise<void> {
  await invoke('update_app_config', { config });
}
