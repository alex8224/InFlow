export type UiMode = "auto" | "overlay" | "workspace" | "panel" | "none";

export type InvocationContext = {
  selectedText?: string;
  clipboardText?: string;
  filePaths?: string[];
  activeWindow?: { title?: string; processName?: string; processId?: number };
  cursor?: { x: number; y: number };
  url?: string;
  extra?: Record<string, unknown>;
};

export type Invocation = {
  id: string;
  capabilityId: string;
  args?: Record<string, unknown>;
  context?: InvocationContext;
  source: "context_menu" | "powertoys" | "hotkey" | "protocol" | "api" | "internal";
  ui?: { mode?: UiMode; focus?: boolean; position?: "cursor" | "center" | "last"; autoClose?: boolean; autoSend?: boolean };
  createdAt: number;
};
