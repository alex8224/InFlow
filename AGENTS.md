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
- **Dev mode**: `npm run tauri dev`
- **Build**: `npm run tauri build`
- **Check**: `cargo check` (run in `tauri-app/src-tauri`)
- **Test all**: `cargo test` (run in `tauri-app/src-tauri`)
- **Run single test**: `cargo test -- <test_name>`

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
- **Naming**:
  - `snake_case` for functions, variables, and modules.
  - `PascalCase` for Structs, Enums, and Traits.
- **Structure**:
  - `AppState` in `src-tauri/src/state.rs` manages global state.
  - Commands should be defined in `src-tauri/src/commands/` and registered in `lib.rs`.
- **Error Handling**: 
  - Prefer `Result<T, E>` with custom error types.
  - Use `?` operator for propagation.
  - Avoid `unwrap()` in production code; use `expect()` or proper error handling.
- **Patterns**: Use `tauri::State` to access global app state in commands.

## Architecture Guidelines

### Dual-Window Management
- **Workspace (main)**: Persistent window for complex tasks.
- **Overlay (overlay)**: Transient window for quick, context-aware tasks like translation.
- Use `invocation.ui.mode` to determine which window to show or target.

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
- `tauri-app/src-tauri/src/commands/`: Rust command implementations.
- `tauri-app/src-tauri/src/llm_tools/`: Built-in tools for LLM interactions.
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

## Safety Rules
- **NEVER** commit or log secrets (API keys, credentials, etc.).
- **NEVER** use `unwrap()` on potential errors in Rust; use `expect()` with a clear message or return a `Result`.
- **ALWAYS** run `npm run tauri dev` to verify both frontend and backend compilation before finishing a task.
- **NEVER** modify `tauri.conf.json` without understanding the impact on window permissions and security.
