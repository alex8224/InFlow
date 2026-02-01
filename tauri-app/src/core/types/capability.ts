export type ContextRequirement =
  | "selectedText"
  | "clipboardText"
  | "filePaths"
  | "activeWindow"
  | "cursor";

export type Capability = {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  contextRequires: ContextRequirement[];
  defaultUiMode: "auto" | "overlay" | "workspace" | "panel" | "none";
  argsSchema?: Record<string, any>;
  allowPromoteToWorkspace: boolean;
};
