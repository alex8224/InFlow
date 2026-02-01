# Chat Overlay + Remote MCP - Implementation Checklist

This document describes the concrete interface contracts and implementation plan for the `chat.overlay` overlay view.

## Capability / View

- Capability ID: `chat.overlay`
- View ID: `chat-overlay-view`
- View component: `tauri-app/src/surfaces/overlay/ChatOverlayView.tsx`
- Registration: `tauri-app/src/app/bootstrap.ts`

## Config (AppConfig)

Path: `tauri-app/src-tauri/src/config.rs`

Added:

- `mcpRemoteServers: McpRemoteServer[]`

`McpRemoteServer`:

- `id: string`
- `name: string`
- `url: string` (Remote MCP JSON-RPC endpoint)
- `enabled: boolean`
- `headers?: Record<string, string>`
- `toolsAllowlist?: string[]`

Notes:

- Remote MCP only (no local stdio).
- If `toolsAllowlist` is set, only those tools are exposed to the model.

## Tauri Commands

Rust: `tauri-app/src-tauri/src/lib.rs`

- `chat_session_create() -> { sessionId }`
- `chat_stream({ sessionId, providerId, userText }) -> void`
- `chat_cancel({ sessionId }) -> void`

## Events

Emitted from Rust, consumed in `ChatOverlayView`.

- `chat-token`: `{ sessionId, delta }`
- `chat-toolcall`: `{ sessionId, callId, name, arguments, status }`
- `chat-toolresult`: `{ sessionId, callId, content }`
- `chat-end`: `{ sessionId }`
- `chat-error`: `{ sessionId, message }` (reserved for fatal errors)

## Tool naming

- Tool names exposed to the LLM are prefixed:
  - `mcp__{serverId}__{toolName}`

This keeps tool names stable and avoids collisions.

## Tool calling loop (high level)

1. Append `user` message to session history.
2. Execute streaming chat with MCP tools (if any).
3. If no tool calls were produced: append assistant text to session history and end.
4. If tool calls were produced:
   - Append assistant tool-use message to history.
   - Execute each tool via Remote MCP `tools/call`.
   - Append a `ToolResponse` per tool call to history.
   - Repeat (model continues after tool results) until no further tool calls.
