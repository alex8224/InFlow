import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Invocation } from '../core/types';
import { useInvocationStore } from '../stores/invocationStore';
import { viewRegistry } from '../core/registry/viewRegistry';
import { TranslateView } from '../surfaces/overlay/TranslateView';

export async function setupEventListeners() {
  const currentWindow = getCurrentWindow();
  const label = currentWindow.label;

  console.log(`[bootstrap] Setting up listeners for window: ${label}`);

  // 1. Initial Pull: Get current state from Rust in case we missed the event
  try {
    const initialInvocation = await invoke<Invocation | null>('get_current_invocation');
    if (initialInvocation) {
      console.log(`[${label}] Pulled initial invocation:`, initialInvocation);
      useInvocationStore.getState().setCurrentInvocation(initialInvocation);
    }
  } catch (err) {
    console.error(`[${label}] Failed to pull initial invocation:`, err);
  }

  // 2. Continuous Listen: Subscribe to future events
  listen<Invocation>('app://invocation', (event) => {
    console.log(`[${label}] Received app://invocation event:`, event.payload);
    useInvocationStore.getState().setCurrentInvocation(event.payload);
  }).catch(console.error);
}

export function bootstrap() {
  // Register Views
  if (!viewRegistry.has('translate-view')) {
    viewRegistry.register({
    id: 'translate-view',
    name: 'Translate',
    component: TranslateView,
    capabilityIds: ['translate.selection', 'translate.text'],
  });
  }

  setupEventListeners();
}
