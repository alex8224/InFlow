# InFlow

一个基于 Tauri 2 和 React 构建的 Windows 桌面应用，提供"随处可调用"的功能，采用双窗口设计以提升生产力。

## 功能特性

- **双窗口设计**：
  - **工作区 (Workspace)**：持久主窗口，用于复杂任务
  - **覆盖层 (Overlay)**：临时置顶窗口，用于快速上下文相关操作
- **MCP (Model Context Protocol) 集成**：内置 LLM 交互工具
- **Markdown 渲染**：完整支持 Markdown，包括数学公式 (KaTeX)、图表 (Mermaid) 和语法高亮 (Prism.js)
- **类型安全**：前端使用 TypeScript，后端使用 Rust
- **现代 UI**：基于 React 19 和 Tailwind CSS 4，使用 Radix UI 组件

## 快速开始

### 前置要求

- **Node.js**: v18+ (前端开发)
- **Rust**: 1.70+ (后端开发)
- **pnpm** 或 **npm** (包管理器)

### 安装

```bash
cd tauri-app
npm install
```

### 开发

```bash
# 开发模式运行（同时启动前端和后端）
npm run tauri dev

# 或仅运行前端
npm run dev
```

### 构建

```bash
# 类型检查并构建前端
npm run build

# 构建完整应用
npm run tauri build
```

## 项目结构

```
inFlow/
├── tauri-app/
│   ├── src/                 # 前端源码 (React/TypeScript)
│   │   ├── surfaces/        # 窗口组件 (Overlay, Workspace)
│   │   ├── stores/          # Zustand 状态管理
│   │   ├── core/            # 核心功能
│   │   │   └── registry/     # 能力和视图注册中心
│   │   └── integrations/    # Tauri API 封装
│   ├── src-tauri/
│   │   ├── src/
│   │   │   ├── commands/    # Tauri 命令 (Rust)
│   │   │   ├── llm_tools/   # 内置 LLM 工具
│   │   │   ├── state.rs     # 全局应用状态
│   │   │   └── lib.rs       # 命令注册
│   │   └── Cargo.toml       # Rust 依赖
│   └── package.json        # Node.js 依赖
├── AGENTS.md                # Agent 开发指南
└── README.md                # 英文文档
```

## 架构

### 能力与调用系统

InFlow 采用基于能力的架构：
- **能力 (Capability)**：定义应用可以做什么（例如 `translate.selection`）
- **调用 (Invocation)**：能力执行的具体实例，带有上下文
- **注册中心**：能力和视图的集中注册

### 通信流程

- **前端 → 后端**：通过 `invoke('command_name', { args })` 调用 Tauri 命令
- **后端 → 前端**：通过 `window.emit('event_name', payload)` 发送事件
- 全局事件在 `bootstrap.ts` 中监听并同步到 `invocationStore`

### 状态管理

- **前端**：`src/stores/` 中的 Zustand stores
- **后端**：`src-tauri/src/state.rs` 中的 `AppState`，使用线程安全的 `Mutex`/`RwLock`

## 开发指南

详细开发指南请参阅 [AGENTS.md](./AGENTS.md)，包括：
- 代码风格和约定
- 架构模式
- 测试策略
- 安全规则

## 技术栈

### 前端
- **框架**: React 19
- **语言**: TypeScript 5.8
- **样式**: Tailwind CSS 4, Radix UI
- **状态管理**: Zustand
- **构建工具**: Vite 7

### 后端
- **框架**: Tauri 2
- **语言**: Rust (edition 2021)
- **异步运行时**: Tokio
- **IPC**: 自定义命令系统

### 其他库
- Markdown: `react-markdown`, `remark-gfm`, `rehype-katex`, `rehype-raw`, `remark-math`
- 图表: Mermaid 11
- 数学公式: KaTeX 0.16
- MCP: rmcp 0.14

## 贡献

1. 遵循 [AGENTS.md](./AGENTS.md) 中约定的开发规范
2. 运行 `npm run tauri dev` 验证更改
3. 确保类型检查通过: `npx tsc`
4. 格式化 Rust 代码: `cargo fmt` (在 `src-tauri/` 中)
5. 运行测试: `cargo test` (在 `src-tauri/` 中)

## 常用命令

### 前端 (React/Vite)
```bash
npm install          # 安装依赖
npm run dev          # 开发模式
npm run build        # 构建前端
npx tsc              # 类型检查
```

### 后端 (Rust/Tauri)
```bash
cd tauri-app/src-tauri
cargo check          # 检查代码
cargo fmt            # 格式化代码
cargo clippy         # 代码检查
cargo test           # 运行测试
```

## 许可证

MIT
