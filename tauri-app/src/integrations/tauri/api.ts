import { invoke } from '@tauri-apps/api/core';
import { Invocation } from '../../core/types';

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

export async function saveApiKey(apiKey: string): Promise<boolean> {
  return await invoke('save_api_key', { apiKey });
}

export async function getApiKeyStatus(): Promise<{ hasKey: boolean; isValid: boolean }> {
  return await invoke('get_api_key_status');
}
