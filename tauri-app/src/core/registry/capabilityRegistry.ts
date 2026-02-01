import { Capability } from '../types/capability';

const capabilities = new Map<string, Capability>();

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
