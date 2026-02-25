# InFlow

A Windows desktop application for "anywhere-callable capabilities" built with Tauri 2 and React, featuring a dual-window design for enhanced productivity.

## Features

- **Dual-Window Design**: 
  - **Workspace**: Persistent main window for complex tasks
  - **Overlay**: Transient always-on-top window for quick, context-aware operations
- **MCP (Model Context Protocol)** Integration: Built-in tools for LLM interactions
- **Markdown Rendering**: Full support for markdown with math (KaTeX), diagrams (Mermaid), and syntax highlighting (Prism.js)
- **Type Safety**: Full TypeScript support on frontend with Rust backend
- **Modern UI**: Built with React 19 and Tailwind CSS 4 with Radix UI components

## Quick Start

### Prerequisites

- **Node.js**: v18+ (for frontend)
- **Rust**: 1.70+ (for backend)
- **pnpm** or **npm** (package manager)

### Installation

```bash
cd tauri-app
npm install
```

### Development

```bash
# Run in dev mode (starts both frontend and backend)
npm run tauri dev

# Or run frontend only
npm run dev
```

### Building

```bash
# Type check and build frontend
npm run build

# Build complete application
npm run tauri build
```

## Project Structure

```
inFlow/
├── tauri-app/
│   ├── src/                 # Frontend source (React/TypeScript)
│   │   ├── surfaces/        # Window components (Overlay, Workspace)
│   │   ├── stores/          # Zustand state management
│   │   ├── core/            # Core functionality
│   │   │   └── registry/     # Capability and view registries
│   │   └── integrations/    # Tauri API wrappers
│   ├── src-tauri/
│   │   ├── src/
│   │   │   ├── commands/    # Tauri commands (Rust)
│   │   │   ├── llm_tools/   # Built-in LLM tools
│   │   │   ├── state.rs     # Global application state
│   │   │   └── lib.rs       # Command registration
│   │   └── Cargo.toml       # Rust dependencies
│   └── package.json        # Node.js dependencies
├── AGENTS.md                # Agent development guidelines
└── README.md                # This file
```

## Architecture

### Capability & Invocation System

InFlow uses a capability-based architecture where:
- **Capability**: Defines what the app can do (e.g., `translate.selection`)
- **Invocation**: A specific instance of a capability being executed with context
- **Registries**: Centralized registration of capabilities and views

### Communication Flow

- **Frontend → Backend**: Tauri commands via `invoke('command_name', { args })`
- **Backend → Frontend**: Events via `window.emit('event_name', payload)`
- Global events are synced to `invocationStore` in `bootstrap.ts`

### State Management

- **Frontend**: Zustand stores in `src/stores/`
- **Backend**: `AppState` in `src-tauri/src/state.rs` with thread-safe `Mutex`/`RwLock`

## Development Guidelines

See [AGENTS.md](./AGENTS.md) for detailed development guidelines including:
- Code style and conventions
- Architecture patterns
- Testing strategies
- Safety rules

## Technology Stack

### Frontend
- **Framework**: React 19
- **Language**: TypeScript 5.8
- **Styling**: Tailwind CSS 4, Radix UI
- **State**: Zustand
- **Build Tool**: Vite 7

### Backend
- **Framework**: Tauri 2
- **Language**: Rust (edition 2021)
- **Async Runtime**: Tokio
- **IPC**: Custom command system

### Additional Libraries
- Markdown: `react-markdown`, `remark-gfm`, `rehype-katex`, `rehype-raw`, `remark-math`
- Diagrams: Mermaid 11
- Math: KaTeX 0.16
- MCP: rmcp 0.14

## Contributing

1. Follow the conventions outlined in [AGENTS.md](./AGENTS.md)
2. Run `npm run tauri dev` to verify changes
3. Ensure type checking passes: `npx tsc`
4. Format Rust code: `cargo fmt` (in `src-tauri/`)
5. Run tests: `cargo test` (in `src-tauri/`)

## License

MIT

---

**中文文档**: [README_CN.md](./README_CN.md) (Chinese Documentation)
