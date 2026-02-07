import { Capability } from '../types/capability';
import { capabilityDefinitions } from '../capabilities';

function toUiMode(mode: string): Capability['defaultUiMode'] {
  if (mode === 'main' || mode.startsWith('workspace.')) return 'workspace';
  if (mode === 'overlay' || mode === 'translate' || mode === 'chat' || mode === 'action-predict') {
    return 'overlay';
  }
  if (mode === 'none') return 'none';
  return 'auto';
}

const capabilities = new Map<string, Capability>(
  capabilityDefinitions.map((cap) => [
    cap.id,
    {
      id: cap.id,
      name: cap.name,
      description: cap.description,
      contextRequires: [],
      defaultUiMode: toUiMode(cap.uiPolicy.defaultMode),
      allowPromoteToWorkspace: cap.uiPolicy.defaultMode !== 'overlay',
    },
  ]),
);

export const capabilityRegistry = {
  register(capability: Capability): void {
    capabilities.set(capability.id, capability);
  },

  get(id: string): Capability | undefined {
    return capabilities.get(id);
  },

  getAll(): Capability[] {
    return Array.from(capabilities.values());
  },

  has(id: string): boolean {
    return capabilities.has(id);
  },
};
