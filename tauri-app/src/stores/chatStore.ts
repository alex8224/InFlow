import { create } from "zustand";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatToolCallStatus = "started" | "done" | "error";

export type ChatMessagePart =
  | { type: "markdown"; content: string }
  | { type: "thought"; content: string }
  | { type: "image"; content: string }
  | { type: "file"; mime: string; data: string; name?: string } // data is base64
  | { type: "toolCall"; callId: string }
  | { type: "toolResult"; callId: string }
  | { type: "error"; message: string };

export type ChatMessage = {
  id: string;
  role: ChatRole;
  parts: ChatMessagePart[];
  createdAt: number;
};

export type ToolCallRecord = {
  callId: string;
  name: string;
  arguments: unknown;
  status: ChatToolCallStatus;
  result?: unknown;
  error?: string;
};

type ChatStore = {
  sessionId: string | null;
  sessionTitle: string | null;
  sessionProviderId: string | null;
  isStreaming: boolean;
  messages: ChatMessage[];
  toolCalls: Record<string, ToolCallRecord>;
  selectedTools: string[];
  input: string;
  pendingImages: string[];
  pendingFiles: { mime: string; data: string; name?: string }[];

  setSession: (sessionId: string) => void;
  setSessionTitle: (title: string) => void;
  setSessionProviderId: (providerId: string) => void;
  setInput: (value: string) => void;
  addPendingImage: (base64: string) => void;
  addPendingFile: (mime: string, data: string, name?: string) => void;
  removePendingImage: (index: number) => void;
  removePendingFile: (index: number) => void;
  clearPendingImages: () => void;
  clearPendingFiles: () => void;
  resetSession: () => void;
  clearConversation: () => void;

  toggleTool: (fnName: string) => void;
  setSelectedTools: (tools: string[]) => void;

  appendUserMessage: (parts: ChatMessagePart[]) => string;
  startAssistantMessage: () => string;
  appendAssistantToken: (
    messageId: string,
    delta?: string,
    reasoningDelta?: string,
  ) => void;
  setStreaming: (value: boolean) => void;

  upsertToolCall: (call: {
    callId: string;
    name: string;
    arguments: unknown;
    status: ChatToolCallStatus;
  }) => void;
  setToolResult: (callId: string, result: unknown) => void;
  setToolError: (callId: string, message: string) => void;
};

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessionId: null,
  sessionTitle: null,
  sessionProviderId: null,
  isStreaming: false,
  messages: [],
  toolCalls: {},
  selectedTools: [
    "inflow__get_current_datetime",
    "inflow__webfetch",
    "mcp__exa__web_search_exa",
  ],
  input: "",
  pendingImages: [],
  pendingFiles: [],

  setSession: (sessionId) => set({ sessionId }),
  setSessionTitle: (title) => set({ sessionTitle: title }),
  setSessionProviderId: (providerId) => set({ sessionProviderId: providerId }),
  setInput: (value) => set({ input: value }),
  addPendingImage: (base64) =>
    set({ pendingImages: [...get().pendingImages, base64] }),
  addPendingFile: (mime, data, name) =>
    set({ pendingFiles: [...get().pendingFiles, { mime, data, name }] }),
  removePendingImage: (index) =>
    set({ pendingImages: get().pendingImages.filter((_, i) => i !== index) }),
  removePendingFile: (index) =>
    set({ pendingFiles: get().pendingFiles.filter((_, i) => i !== index) }),
  clearPendingImages: () => set({ pendingImages: [] }),
  clearPendingFiles: () => set({ pendingFiles: [] }),

  resetSession: () => {
    set({
      sessionId: null,
      sessionTitle: null,
      isStreaming: false,
      messages: [],
      toolCalls: {},
      selectedTools: [],
      input: "",
      pendingImages: [],
      pendingFiles: [],
    });
  },

  clearConversation: () => {
    set({
      isStreaming: false,
      messages: [],
      toolCalls: {},
      input: "",
      pendingImages: [],
      pendingFiles: [],
    });
  },

  toggleTool: (fnName) => {
    const cur = get().selectedTools;
    if (cur.includes(fnName)) {
      set({ selectedTools: cur.filter((x) => x !== fnName) });
    } else {
      set({ selectedTools: [...cur, fnName] });
    }
  },

  setSelectedTools: (tools) => {
    const next = Array.from(
      new Set(tools.map((t) => t.trim()).filter(Boolean)),
    );
    set({ selectedTools: next });
  },

  appendUserMessage: (parts) => {
    const id = makeId("msg_user");
    const msg: ChatMessage = {
      id,
      role: "user",
      parts,
      createdAt: Date.now(),
    };
    set({ messages: [...get().messages, msg] });
    return id;
  },

  startAssistantMessage: () => {
    const id = makeId("msg_assistant");
    const msg: ChatMessage = {
      id,
      role: "assistant",
      parts: [{ type: "markdown", content: "" }],
      createdAt: Date.now(),
    };
    set({ messages: [...get().messages, msg] });
    return id;
  },

  appendAssistantToken: (messageId, delta, reasoningDelta) => {
    set({
      messages: get().messages.map((m) => {
        if (m.id !== messageId) return m;
        let parts = [...m.parts];

        if (reasoningDelta) {
          const thoughtIdx = parts.findIndex((p) => p.type === "thought");
          if (thoughtIdx > -1) {
            const p = parts[thoughtIdx];
            if (p.type === "thought") {
              parts[thoughtIdx] = { ...p, content: p.content + reasoningDelta };
            }
          } else {
            // Insert thought at the beginning or before markdown
            parts.unshift({ type: "thought", content: reasoningDelta });
          }
        }

        if (delta) {
          const markdownIdx = parts.findIndex((p) => p.type === "markdown");
          if (markdownIdx > -1) {
            const p = parts[markdownIdx];
            if (p.type === "markdown") {
              parts[markdownIdx] = { ...p, content: p.content + delta };
            }
          } else {
            parts.push({ type: "markdown", content: delta });
          }
        }

        return { ...m, parts };
      }),
    });
  },

  setStreaming: (value) => set({ isStreaming: value }),

  upsertToolCall: ({ callId, name, arguments: args, status }) => {
    const existing = get().toolCalls[callId];
    set({
      toolCalls: {
        ...get().toolCalls,
        [callId]: {
          callId,
          name,
          arguments: args,
          status,
          result: existing?.result,
          error: existing?.error,
        },
      },
    });
  },

  setToolResult: (callId, result) => {
    const existing = get().toolCalls[callId];
    if (!existing) return;
    set({
      toolCalls: {
        ...get().toolCalls,
        [callId]: { ...existing, status: "done", result },
      },
    });
  },

  setToolError: (callId, message) => {
    const existing = get().toolCalls[callId];
    if (!existing) return;
    set({
      toolCalls: {
        ...get().toolCalls,
        [callId]: { ...existing, status: "error", error: message },
      },
    });
  },
}));
