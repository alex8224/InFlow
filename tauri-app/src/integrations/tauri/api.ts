import { invoke } from '@tauri-apps/api/core';

export interface LlmProvider {
  id: string;
  name: string;
  kind: string;
  baseUrl?: string | null;
  apiKey: string;
  modelId: string;
  reasoningEffort?: string | null;
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
  translateProviderId: string | null;
  translateSystemPrompt: string | null;
  preferredService: string;
  mcpRemoteServers?: McpRemoteServer[];
  agentBrowserCliPath?: string | null;
  agentBrowserExecutablePath?: string | null;
  // Markdown Editor config
  markdownEditorTheme?: string | null;
  markdownEditorFontSize?: number | null;
  markdownEditorAutoSave?: boolean | null;
  markdownEditorRecentFiles?: string[] | null;
}

export type ToolCatalogItem = {
  fnName: string;
  source: 'builtin' | 'mcp' | string;
  title: string;
  category?: string | null;
  description?: string | null;
  serverId?: string | null;
  serverName?: string | null;
  toolName?: string | null;
};

export type ChatPart = 
  | { type: 'text'; content: string }
  | { type: 'image'; content: string } // base64, usually with data: prefix
  | { type: 'file'; content: { mime: string; data: string } }; // data is base64

export interface CapabilityInvocationUi {
  mode?: string;
  instanceId?: string;
  reuse?: string;
  focus?: boolean;
  position?: string;
  autoClose?: boolean;
  autoSend?: boolean;
  targetLabel?: string;
}

export interface CapabilityRequestV2 {
  requestVersion?: 'v2' | 'legacy';
  capabilityId: string;
  args?: Record<string, unknown>;
  context?: Record<string, unknown>;
  ui?: CapabilityInvocationUi;
  source?: string;
}

export interface CapabilityCatalogItem {
  id: string;
  version: string;
  name: string;
  description: string;
  viewId?: string | null;
  uiPolicy: {
    defaultMode: string;
    allowedModes: string[];
    defaultFocus: boolean;
  };
}

export function buildV2DeepLink(
  request: CapabilityRequestV2,
): string {
  const params = new URLSearchParams();
  params.set('v', '2');
  params.set('capability', request.capabilityId);
  if (request.args && Object.keys(request.args).length > 0) {
    params.set('args', JSON.stringify(request.args));
  }
  if (request.context && Object.keys(request.context).length > 0) {
    params.set('context', JSON.stringify(request.context));
  }
  if (request.ui && Object.keys(request.ui).length > 0) {
    params.set('ui', JSON.stringify(request.ui));
  }
  return `inflow://invoke?${params.toString()}`;
}

export function buildLegacyDeepLink(params: {
  capabilityId: string;
  mode?: string;
  text?: string;
  autoSend?: boolean;
}): string {
  const query = new URLSearchParams();
  query.set('capabilityId', params.capabilityId);
  if (params.mode) query.set('mode', params.mode);
  if (params.text) query.set('text', params.text);
  if (params.autoSend !== undefined) {
    query.set('autoSend', String(params.autoSend));
  }
  return `inflow://invoke?${query.toString()}`;
}

export async function chatSessionCreate(): Promise<{ sessionId: string }> {
  return await invoke('chat_session_create');
}

export async function chatStream(
  sessionId: string,
  providerId: string,
  userParts: ChatPart[],
  selectedTools?: string[]
): Promise<void> {
  await invoke('chat_stream', { sessionId, providerId, userParts, selectedTools });
}

export async function chatToolsCatalog(): Promise<ToolCatalogItem[]> {
  return await invoke('chat_tools_catalog');
}

export async function chatCancel(sessionId: string): Promise<void> {
  await invoke('chat_cancel', { sessionId });
}

export async function chatInferTitle(sessionId: string, providerId: string): Promise<string> {
  return await invoke('chat_infer_title', { sessionId, providerId });
}

export async function executeCapability(
  capabilityId: string,
  args?: Record<string, unknown>,
  context?: any,
  ui?: { mode?: string; focus?: boolean }
): Promise<void> {
  await executeCapabilityV2({
    requestVersion: 'legacy',
    capabilityId,
    args,
    context,
    ui,
  });
}

export async function executeCapabilityV2(
  request: CapabilityRequestV2,
): Promise<void> {
  await invoke('execute_capability_v2', { request });
}

export async function getCapabilityCatalog(): Promise<CapabilityCatalogItem[]> {
  return await invoke('get_capability_catalog');
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

export async function getClipboardImage(): Promise<string | null> {
  return await invoke('get_clipboard_image');
}

export async function readLocalFileDataUrl(path: string): Promise<string | null> {
  return await invoke('read_local_file_data_url', { path });
}

export async function readMarkdownFile(path: string): Promise<string> {
  return await invoke('read_markdown_file', { path });
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
  toLang: string,
  providerId?: string
): Promise<void> {
  return await invoke('translate_text_ai_stream', { text, fromLang, toLang, providerId });
}

export async function translateCancel(): Promise<void> {
  return await invoke('translate_cancel');
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

// Share API types
export interface SharedMessage {
  id: string;
  role: string;
  content: string;
  created_at: number;
}

export interface ShareCreateResponse {
  share_id: string;
  url: string;
}

// Create a share for the current chat session
export async function chatShareCreate(
  sessionId: string,
  messages: SharedMessage[],
  providerName?: string
): Promise<ShareCreateResponse> {
  const messagesJson = JSON.stringify(messages);
  return await invoke('chat_share_create', {
    sessionId,
    messagesJson,
    providerName,
  });
}

// Get the share server port
export async function getShareServerPort(): Promise<number | null> {
  return await invoke('get_share_server_port');
}

export async function handleDeepLinkFromFrontend(url: string): Promise<void> {
  await invoke('handle_deep_link_from_frontend', { url });
}

// Action Predict API
export interface PredictedAction {
  label: string;
  prompt: string;
}

export async function predictActions(text: string): Promise<PredictedAction[]> {
  return await invoke('predict_actions', { text });
}
