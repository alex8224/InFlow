import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Invocation } from '../core/types';
import { useInvocationStore } from '../stores/invocationStore';
import { viewRegistry } from '../core/registry/viewRegistry';
import { TranslateView } from '../surfaces/overlay/TranslateView';
import { ChatOverlayView } from '../surfaces/overlay/ChatOverlayView';
import { ActionPredictView } from '../surfaces/overlay/ActionPredictView';
import { SettingsView } from '../surfaces/workspace/SettingsView';

export async function setupEventListeners() {
  const currentWindow = getCurrentWindow();
  const label = currentWindow.label;

  console.log(`[bootstrap] Setting up listeners for window: ${label}`);

  // 1. Continuous Listen: Subscribe to future events
  listen<Invocation>('app://invocation', (event) => {
    const payload = event.payload;
    const ui = payload.ui as any;
    const targetLabel = ui?.targetLabel;

    // Filter events: only process if targetLabel matches current window label.
    // If targetLabel is missing (legacy), we might process it if we are 'overlay' or 'main'.
    // But for new windows (translate-*, chat-*, pet-*), we strict check.
    if (targetLabel && targetLabel !== label) {
      return;
    }

    console.log(`[${label}] Received app://invocation event:`, payload);
    useInvocationStore.getState().setCurrentInvocation(payload);
  }).catch(console.error);

  // 2. Initial Pull: Get current state from Rust (after listener is ready)
  try {
    const initialInvocation = await invoke<Invocation | null>('get_current_invocation', { label });
    if (initialInvocation) {
      console.log(`[${label}] Pulled initial invocation:`, initialInvocation);
      useInvocationStore.getState().setCurrentInvocation(initialInvocation);
    }
  } catch (err) {
    console.error(`[${label}] Failed to pull initial invocation:`, err);
  }
}

export async function bootstrap() {
  // Register Views
  if (!viewRegistry.has('translate-view')) {
    viewRegistry.register({
      id: 'translate-view',
      name: 'Translate',
      component: TranslateView,
      capabilityIds: ['translate.selection', 'translate.text'],
    });
  }

  if (!viewRegistry.has('settings-view')) {
    viewRegistry.register({
      id: 'settings-view',
      name: 'Settings',
      component: SettingsView,
      capabilityIds: ['app.settings'],
    });
  }

  if (!viewRegistry.has('chat-overlay-view')) {
    viewRegistry.register({
      id: 'chat-overlay-view',
      name: 'Chat',
      component: ChatOverlayView,
      capabilityIds: ['chat.overlay'],
    });
  }

  if (!viewRegistry.has('action-predict-view')) {
    viewRegistry.register({
      id: 'action-predict-view',
      name: 'Action Predict',
      component: ActionPredictView,
      capabilityIds: ['action.predict'],
    });
  }

  await setupEventListeners();
}
