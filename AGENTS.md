# Agent Guidelines for inFlow

This document provides instructions for agentic coding agents operating in the inFlow repository.

## Project Overview
inFlow is a Windows desktop application for "anywhere-callable capabilities" built with Tauri 2 and React. It features a dual-window design: a persistent **Workspace** (main) and a transient **Overlay** (always-on-top).

## Core Commands

### Frontend (React/Vite)
- **Install dependencies**: `npm install`
- **Dev mode**: `npm run dev` or `npm run tauri dev`
- **Build**: `npm run build` (runs `tsc` and `vite build`)
- **Type check**: `npx tsc`

### Backend (Rust/Tauri)
- **Dev mode**: `npm run tauri dev` (starts both frontend and backend)
- **Build**: `npm run tauri build`
- **Check**: `cargo check` (run in `tauri-app/src-tauri`)
- **Format**: `cargo fmt` (run in `tauri-app/src-tauri`)
- **Lint**: `cargo clippy` (run in `tauri-app/src-tauri`)
- **Test all**: `cargo test` (run in `tauri-app/src-tauri`)
- **Run single test**: `cargo test -- <test_name>` (run in `tauri-app/src-tauri`)

## Code Style & Conventions

### Frontend (TypeScript/React)
- **Indentation**: 2 spaces.
- **Quotes**: Single quotes for strings, except for JSX attributes (double quotes).
- **Semicolons**: Required.
- **Components**: Functional components with TypeScript interfaces for props.
- **State Management**: Use `zustand` stores located in `src/stores/`.
- **Naming**:
  - `camelCase` for variables, functions, and files (except components).
  - `PascalCase` for components, types, and interfaces.
- **Imports**:
  - Group standard libraries, then third-party, then local imports.
  - Prefer explicit relative paths or the project structure conventions.
- **Error Handling**: Use `try/catch` for async operations and `invoke` calls.

### Backend (Rust)
- **Indentation**: 4 spaces (standard Rust).
- **Formatting**: Run `cargo fmt` before committing.
- **Naming**:
  - `snake_case` for functions, variables, and modules.
  - `PascalCase` for Structs, Enums, and Traits.
- **Import Groups**:
  1. Standard library (`std`, `core`)
  2. Third-party crates
  3. Local modules (`crate::`)
- **Error Handling**:
  - Prefer `Result<T, E>` with custom error types.
  - Use `?` operator for propagation.
  - Avoid `unwrap()` on potential errors; use `expect()` with clear messages.
- **Async Patterns**:
  - Use `tokio` async runtime (configured in `Cargo.toml`).
  - Avoid blocking the UI thread: offload heavy work to `tokio::task::spawn_blocking`.
  - Commands are async by default: `async fn command_name(...) -> Result<...>`

## Architecture Guidelines

### Dual-Window Management
- **Workspace (main)**: Persistent window for complex tasks.
- **Overlay (overlay)**: Transient window for quick, context-aware tasks like translation.
- Use `invocation.ui.mode` to determine which window to show or target.

### Tauri Command Workflow
1. **Define command** in `src-tauri/src/commands/<module>.rs`:
   ```rust
   #[tauri::command]
   pub async fn my_command(state: tauri::State<'_, AppState>, arg1: String) -> Result<String, String> {
       // Implementation
   }
   ```
2. **Export** in `src-tauri/src/commands/mod.rs`.
3. **Register** in `src-tauri/src/lib.rs`:
   ```rust
   tauri::generate_handler![my_command, other_command, ...]
   ```

### State Management
- **AppState**: Located in `src-tauri/src/state.rs`, manages global state.
- Use `Mutex` or `RwLock` for thread-safe access: `state.lock().unwrap()`.
- Always release locks quickly to avoid deadlocks.

### Invocation & Registry System
- **Capability**: Defines what the app can do (e.g., `translate.selection`).
- **Invocation**: A specific instance of a capability being executed with context.
- **Registries**:
  - `capabilityRegistry`: Register new capabilities in `src/core/registry/capabilityRegistry.ts`.
  - `viewRegistry`: Register React components for rendering specific views in `src/core/registry/viewRegistry.ts`.
- All views must be registered in `src/app/bootstrap.ts`.

### Communication (Tauri Commands & Events)
- **Frontend -> Backend**: Use `invoke('command_name', { args })`.
- **Backend -> Frontend**: Use `window.emit('event_name', payload)`.
- Global events are listened to in `src/app/bootstrap.ts` and synced to `invocationStore`.

## Directory Structure Highlights
- `tauri-app/src-tauri/src/commands/`:
- `tauri-app/src-tauri/src/llm_tools/`: Built-in tools for LLM interactions.
- `tauri-app/src-tauri/src/state.rs`: Global application state.
- `tauri-app/src-tauri/src/lib.rs`: Command registration and Tauri setup.
- `tauri-app/src/surfaces/`: Top-level window components (Overlay, Workspace, Pet).
- `tauri-app/src/integrations/tauri/api.ts`: Typed wrappers for Tauri `invoke` calls.

## Development Workflow
1. **Understand**: Examine `capabilityRegistry.ts` and `viewRegistry.ts` to see how features are registered.
2. **Implement Backend**: Add Rust commands in `src-tauri/src/commands/` and register them in `lib.rs`.
3. **Implement Frontend**: Add React views in `src/surfaces/` and register them in `bootstrap.ts`.
4. **Verify**: Run `npm run tauri dev` and test the interaction between frontend and backend.

## Testing Strategy
- **Rust**: Add unit tests in the same file using `#[cfg(test)]` modules. Run with `cargo test`.
- **Frontend**: Currently prioritize manual verification via `npm run tauri dev`. Ensure all new components are properly typed and adhere to the established styling.

## Troubleshooting
- **Window not showing**: Check `windowing.rs` and the `ui.mode` in the invocation payload.
- **Invoke failed**: Check if the command is registered in `tauri::generate_handler!` in `lib.rs`.
- **Type errors**: Run `npx tsc` in `tauri-app/` to see all frontend type errors.
- **Rust errors**: Run `cargo check` and check error messages for missing imports or type mismatches.

## Safety Rules
- **NEVER** commit or log secrets (API keys, credentials, etc.).
- **NEVER** use `unwrap()` on potential errors in Rust; use `expect()` with a clear message or return a `Result`.
- **ALWAYS** run `npm run tauri dev` to verify both frontend and backend compilation before finishing a task.
- **NEVER** modify `tauri.conf.json` without understanding the impact on window permissions and security.
- **ALWAYS** sanitize user inputs before executing system commands or file operations.
- **PREFER** blocking tasks to be offloaded to `spawn_blocking` to keep UI responsive.
