import { CapabilityDefinition } from './types';

export const capabilityDefinitions: CapabilityDefinition[] = [
  {
    id: 'translate.selection',
    version: '1.0.0',
    name: 'Translate Selection',
    description: 'Translate selected text.',
    viewId: 'translate-view',
    uiPolicy: {
      defaultMode: 'translate',
      allowedModes: ['translate', 'overlay'],
      defaultFocus: true,
    },
  },
  {
    id: 'translate.text',
    version: '1.0.0',
    name: 'Translate Text',
    description: 'Translate input text.',
    viewId: 'translate-view',
    uiPolicy: {
      defaultMode: 'translate',
      allowedModes: ['translate', 'overlay'],
      defaultFocus: true,
    },
  },
  {
    id: 'chat.overlay',
    version: '1.0.0',
    name: 'Chat Overlay',
    description: 'Open chat in overlay window.',
    viewId: 'chat-overlay-view',
    uiPolicy: {
      defaultMode: 'chat',
      allowedModes: ['chat', 'overlay'],
      defaultFocus: true,
    },
  },
  {
    id: 'action.predict',
    version: '1.0.0',
    name: 'Action Predict',
    description: 'Predict follow-up actions from selected text.',
    viewId: 'action-predict-view',
    uiPolicy: {
      defaultMode: 'action-predict',
      allowedModes: ['action-predict'],
      defaultFocus: true,
    },
  },
  {
    id: 'app.settings',
    version: '1.0.0',
    name: 'App Settings',
    description: 'Open settings workspace view.',
    viewId: 'settings-view',
    uiPolicy: {
      defaultMode: 'main',
      allowedModes: ['main', 'workspace.main'],
      defaultFocus: true,
    },
  },
];

const byId = new Map<string, CapabilityDefinition>(
  capabilityDefinitions.map((item) => [item.id, item]),
);

export function getCapabilityDefinition(
  capabilityId: string,
): CapabilityDefinition | undefined {
  return byId.get(capabilityId);
}

export function getCapabilityIdsByView(viewId: string): string[] {
  return capabilityDefinitions
    .filter((item) => item.viewId === viewId)
    .map((item) => item.id);
}

