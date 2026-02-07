export interface CapabilityUiPolicy {
  defaultMode: string;
  allowedModes: string[];
  defaultFocus: boolean;
}

export interface CapabilityDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  viewId?: string;
  uiPolicy: CapabilityUiPolicy;
  deprecated?: {
    message: string;
  };
}

