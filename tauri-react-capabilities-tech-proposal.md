# Windows 桌面“随处可调用能力”客户端——技术方案（Tauri + React）

> 目标：将 **意图 → 结果** 的路径压缩到 “一次触发 + 最少交互”，尽量避免复制/粘贴与应用切换；支持短任务“用之即走”和长任务“多轮对话/工作台”。

---

## 2. 需求摘要与设计原则

### 2.1 核心场景
- **选中文本** → 一键翻译/改写（无需打开翻译网站/程序，无需手动复制）
- **选中文件**（PDF/DOCX/MD/TXT…）→ 一键总结（文档列表、概要、要点、引用定位）
- **PowerToys Run/脚本/协议唤醒** → 打开对话界面进行多轮对话（围绕统一文档集合）

### 2.2 关键目标
- **能力可在任意位置触发**（入口多样但统一协议）
- **上下文自动带入**（选区/剪贴板/文件/窗口信息等）
- **界面按任务而变**（Chat UI 只是多轮对话的一种 surface；翻译/总结使用专用 UI）
- **短任务极快**（Overlay/Modal/Toast，用完即走；支持一键升级到工作台）
- **易扩展**（能力注册式、视图注册式、渲染器注册式）

### 2.3 非目标（边界）
- 不自研 PowerToys Run 类启动器（只适配其插件或通过 IPC 被调用）
- 不依赖 Dify/LangChain 这类重平台框架作为核心（可通过 MCP/HTTP 工具调用对接）
- 第一阶段不追求对所有 Windows 应用“精准读选区”（通用方案优先：剪贴板策略）

---

## 3. 总体架构（Core + Surfaces）

### 3.1 两层结构
- **Native Core（Rust / Tauri）**
  - 单实例/聚焦、入口适配（Args/Protocol/IPC/Hotkey）、上下文捕获、窗口管理、安全、事件桥接
- **Web UI（React / TS / Vite）**
  - Surface 路由、Views（翻译/总结/对话/生成物）、内容渲染、状态与存储

### 3.2 UI Surface 分层
- **Ephemeral（用之即走）**：Overlay / Small Modal / Toast / No UI  
  适合：翻译、润色、改写、快速问一句  
- **Session（中等时长，可选）**：Panel / Medium Window  
  适合：围绕一组文档短时对话与小产出  
- **Workspace（长驻工作台）**：Main Window  
  适合：文档列表/概要要点/引用定位/多轮对话/生成物管理

> 原则：默认优先使用 Ephemeral（更少打断），必要时一键“Open in Workspace / 打开详情”升级到 Workspace。

---

## 4. 统一能力模型：Capability / Invocation / contentBlocks

### 3.1 Capability（能力定义）
能力是第一公民，描述“做什么”，与“在哪里触发/怎么展示”解耦。

关键字段：
- `id/name/description/tags`
- `contextRequires`：所需上下文（selectedText、filePaths…）
- `defaultUiMode`：推荐界面形态（overlay/workspace/none/auto）
- `argsSchema`：结构化参数（可选 JSON Schema）
- `allowPromoteToWorkspace`：轻界面是否可升级到工作台

### 3.2 Invocation（统一调用对象）
所有入口（右键/热键/协议/PowerToys/IPC）最终归一为：

```json
{
  "id": "uuid",
  "capabilityId": "translate.selection",
  "args": { "targetLang": "en", "tone": "formal" },
  "context": {
    "selectedText": "...",
    "clipboardText": "...",
    "filePaths": ["C:\\a.pdf"],
    "activeWindow": { "title": "...", "processName": "..." },
    "cursor": { "x": 120, "y": 300 }
  },
  "source": "context_menu | powertoys | hotkey | protocol | api",
  "ui": { "mode": "auto | overlay | workspace | none", "focus": true }
}
```

### 3.3 contentBlocks（结构化内容渲染）
不把所有输出塞进 Markdown 字符串；统一用块结构渲染：
- `markdown` / `code` / `mermaid` / `math`
- `diff`（替换/改写确认）
- `citations`（引用卡片：docId + 位置 + snippet）
- `artifact`（生成物：报告/表格/计划等）

好处：
- Chat、总结、翻译可复用同一套渲染器
- 新增输出类型不会污染所有页面逻辑
- Overlay 可只加载轻渲染，Workspace 再加载 pdf.js 等重模块

---

## 4. UI 技术选型与整合库（轻量 + 易扩展）

### 4.1 核心栈（推荐）
- **壳**：Tauri 2（非 Electron；多窗口；系统集成）
- **UI**：React 18 + TypeScript + Vite
- **设计系统**：Tailwind + shadcn/ui（Radix 底座）

理由（与需求强绑定）：
- 多 Surface 工作台 + 富渲染 + 可插拔 Views/Renderers：React 生态成熟、资料最多、实现成本最低  
- shadcn/ui “源码进仓库”，适合做高度个性化的翻译/总结界面  
- Vite + lazy load 容易把“用之即走”窗口做轻快  
- Tauri 将单实例/协议/IPC/窗口置顶等系统能力隔离在 Rust 层，UI 专注展示

### 4.2 UI 侧可集成库（按职责分离）
- **Chat Surface（多轮对话）**：assistant-ui（仅用于 DocChatView）
- **AI UI 积木（非 Chat）**：prompt-kit（按需摘取/复制）
- **流式 Markdown 稳定渲染**：Streamdown（或 react-markdown + 插件链）
- **长列表性能**：TanStack Virtual
- **PDF 预览**：pdf.js（Workspace 才加载）
- **Diff**：react-diff-viewer（或等价替代）
- **代码渲染**：Shiki
- **图表**：Mermaid（code fence renderer）
- **公式**：KaTeX（可选）

使用原则：
- assistant-ui **只做 chat**；翻译/总结/生成物不强行走 chat 范式  
- prompt-kit **只取需要的块**，避免全量依赖带来样式/体积问题  
- shadcn/ui 作为统一基础组件底座，保证交互一致性

---

## 5. Windows 系统入口与上下文捕获（不做 launcher，但随处可用）

### 5.1 入口适配器（Adapters）
- Explorer 右键菜单（对文件/目录）
- PowerToys Run 插件（将命令解析为 Invocation，经 IPC 发给本应用）
- 全局快捷键（任意处唤醒 overlay 或打开 workspace 指定 view）
- 协议唤醒（`myapp://invoke?...`）
- 本地 IPC（HTTP 127.0.0.1 或 Named Pipe；用于脚本/其它应用调用）

### 5.2 上下文捕获策略（MVP 优先通用）
- **选中文本**：优先尝试读取 selection；拿不到时采用通用方案：  
  `Ctrl+C → 读剪贴板 → 恢复剪贴板`（尽量无感）  
- **文件路径**：右键菜单参数直接获取  
- **活动窗口信息**：标题/进程名，用于提示与日志  
- **光标位置**：overlay 定位

---

## 6. 安全与治理（本地 IPC 必须考虑）
- IPC 鉴权：首次运行生成 token，存用户目录；请求需携带 token
- 仅监听本机回环地址 `127.0.0.1`；必要时限制 Origin
- Markdown 渲染启用 sanitize，避免 XSS
- Invocation 日志（来源、能力、耗时、错误），便于诊断

---

## 7. 目录结构（可直接开仓库）

```
repo/
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs                  # 单实例/入口/事件桥接
│  │  ├─ windows.rs               # overlay/workspace 窗口管理
│  │  ├─ context.rs               # 上下文捕获（剪贴板/活动窗口）
│  │  ├─ invoke.rs                # 统一 Invocation 处理并 emit
│  │  └─ local_api.rs             # 可选 IPC：HTTP/pipe
│  └─ tauri.conf.json
│
├─ src/
│  ├─ app/
│  │  ├─ App.tsx
│  │  ├─ routes.tsx
│  │  └─ bootstrap.ts             # 监听 app://invocation
│  ├─ core/
│  │  ├─ types/                   # Invocation/Capability/Blocks/Workspace
│  │  ├─ registry/                # capability/view/renderer registry
│  │  ├─ router/                  # Invocation -> Surface
│  │  └─ services/                # llmClient/docIngest/storage
│  ├─ stores/                     # Zustand
│  ├─ surfaces/
│  │  ├─ overlay/                 # Ephemeral
│  │  └─ workspace/               # Long-lived
│  ├─ components/
│  │  ├─ blocks/                  # contentBlocks renderers
│  │  ├─ doc/
│  │  └─ chat/
│  └─ integrations/tauri/         # events/invoke/window wrappers
└─ vite.config.ts
```

---

## 8. TS 核心接口（节选）

> 说明：以下为关键类型摘要，完整定义建议放置于 `src/core/types/*`。

### 8.1 Invocation / Context
```ts
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
  ui?: { mode?: UiMode; focus?: boolean; position?: "cursor" | "center" | "last"; autoClose?: boolean };
  createdAt: number;
};
```

### 8.2 contentBlocks
```ts
export type ContentBlock =
  | { type: "markdown"; markdown: string }
  | { type: "code"; language?: string; code: string }
  | { type: "mermaid"; code: string }
  | { type: "diff"; before: string; after: string; format?: "unified" | "split" }
  | { type: "citations"; citations: { docId: string; snippet?: string; location?: any }[] }
  | { type: "artifact"; artifactId: string; title: string; kind: string; content: string };
```

---

## 9. 整体架构图（Mermaid）

### 9.1 技术栈层次图
```mermaid
flowchart TB
  subgraph PLATFORM[Platform Layer]
    direction LR
    P1[Windows OS]
    P2[Tauri 2 Runtime]
    P3[Rust Backend]
  end

  subgraph NATIVE[Native Capabilities - Rust]
    direction LR
    N1[single-instance]
    N2[windows-api]
    N3[clipboard-rs]
    N4[tauri-plugin-shell]
    N5[tokio]
  end

  subgraph FRAMEWORK[Frontend Framework]
    direction LR
    F1[React 18]
    F2[TypeScript]
    F3[Vite]
  end

  subgraph DESIGN[Design System]
    direction LR
    D1[Tailwind CSS]
    D2["shadcn/ui (Radix)"]
  end

  subgraph STATE[State & Routing]
    direction LR
    ST1[Zustand]
    ST2[React Router]
  end

  subgraph AIUI[AI UI Components]
    direction LR
    A1["assistant-ui<br/>(Chat)"]
    A2["prompt-kit<br/>(AI Blocks)"]
    A3["Streamdown<br/>(Streaming MD)"]
  end

  subgraph RENDER[Content Renderers]
    direction LR
    R1["Shiki<br/>(Code)"]
    R2["Mermaid<br/>(Diagrams)"]
    R3["KaTeX<br/>(Math)"]
    R4["react-diff-viewer<br/>(Diff)"]
    R5["pdf.js<br/>(PDF Preview)"]
  end

  subgraph PERF[Performance]
    direction LR
    PF1[TanStack Virtual]
    PF2[React.lazy]
    PF3[Dynamic Import]
  end

  PLATFORM --> NATIVE
  NATIVE --> FRAMEWORK
  FRAMEWORK --> DESIGN
  DESIGN --> STATE
  STATE --> AIUI
  STATE --> RENDER
  AIUI --> PERF
  RENDER --> PERF
```

### 9.2 模块架构图
```mermaid
flowchart TB
  subgraph EXT[External Entrypoints / Triggers]
    E1["Explorer Context Menu<br/>(file/folder)"]
    E2["PowerToys Run Plugin<br/>(command)"]
    E3["Global Hotkey<br/>(anywhere)"]
    E4["Protocol URL<br/>myapp://invoke"]
    E5["Local API / IPC<br/>HTTP or Named Pipe"]
    E6["CLI Args<br/>yourapp.exe --invoke ..."]
  end

  subgraph APP[Desktop App - Tauri 2]
    direction TB

    subgraph NATIVE[Rust Native Core]
      A1[Single Instance & Focus]
      A2["Entrypoint Adapters<br/>(parse args/url/ipc)"]
      A3["Context Capture<br/>(selection/clipboard/files/window)"]
      A4["Invocation Router<br/>(capability + context + uiMode)"]
      A5["Window Manager<br/>(overlay/workspace/panel)"]
      A6["Security<br/>(token/origin/whitelist)"]
      A7["Event Bridge<br/>emit app://invocation"]
    end

    subgraph UI[Web UI - React + TS + Vite]
      U1[Bootstrap Listener]
      U2[Surface Router]

      subgraph SURF[Surfaces]
        S1["Ephemeral<br/>Overlay/Modal/Toast"]
        S2["Session<br/>Panel (optional)"]
        S3["Workspace<br/>Main Window"]
      end

      subgraph VIEWS[Views]
        V1[Translate View]
        V2[Doc Summary View]
        V3[Doc Chat View]
        V4[Artifacts View]
      end

      subgraph RENDER[Content Rendering]
        R1[contentBlocks]
        R2[Streamdown/Markdown]
        R3["Code Renderer (Shiki)"]
        R4[Mermaid Renderer]
        R5["PDF Preview (pdf.js)"]
      end

      subgraph STATE[State & Storage]
        ST1[Zustand Stores]
        ST2[Local Storage/DB]
      end
    end
  end

  subgraph EXEC[Execution Layer]
    X1[LLM Provider Adapters]
    X2["Tool Executors<br/>HTTP/MCP/Local"]
    X3["Doc Ingest<br/>extract/chunk/index"]
  end

  EXT --> A2
  A2 --> A1
  A2 --> A3
  A3 --> A4
  A4 --> A5
  A6 --- A5
  A4 --> A7
  A7 --> U1
  U1 --> U2
  U2 --> SURF
  SURF --> VIEWS
  VIEWS --> RENDER
  VIEWS --> STATE
  VIEWS --> EXEC
  EXEC --> STATE
  EXEC --> RENDER
```

### 9.3 端到端时序图
```mermaid
sequenceDiagram
  autonumber
  participant EXT as External Trigger
  participant N as Tauri Native Core
  participant W as Window Manager
  participant UI as React UI
  participant S as Stores/Local DB
  participant EX as Executors
  participant P as Provider

  EXT->>N: Invoke (args/url/command/api)
  N->>N: Single-instance ensure + focus
  N->>N: Context capture (selection/clipboard/files/window)
  N->>N: Build Invocation
  N->>W: Decide surface (auto -> overlay/workspace)
  N->>UI: Emit app://invocation(inv)

  UI->>UI: Route to Surface/View
  UI->>S: Ensure workspace/doc entities
  UI->>EX: Execute capability (stream/tool)

  alt LLM needed
    EX->>P: Stream request (with tools schema)
    P-->>EX: Tokens / tool call request
  end

  alt Tool call needed
    EX->>EX: HTTP/MCP/Local tool execution
    EX-->>P: Tool results
    P-->>EX: Final stream
  end

  EX-->>UI: contentBlocks stream
  UI->>S: Persist messages/summaries/artifacts
  UI-->>EXT: Copy/replace/insert/export + autoClose
```

### 9.4 UI 包/模块依赖图（工程化补全）
```mermaid
flowchart LR
  subgraph UI[React UI]
    direction TB
    A["src/app<br/>(App, routes, bootstrap)"]
    B[src/core/types]
    C[src/core/registry]
    D[src/core/router]
    E[src/core/services]
    F[src/stores]
    G[src/surfaces/overlay]
    H[src/surfaces/workspace]
    I[src/components/blocks]
    J[src/components/doc]
    K[src/components/chat]
    L[src/integrations/tauri]
  end

  A --> B
  A --> C
  A --> D
  A --> L
  D --> C
  D --> B
  C --> B
  E --> B
  F --> B

  G --> F
  H --> F
  G --> I
  H --> I
  H --> J
  H --> K

  K --> I
  I --> B
  J --> B
  L --> B
  L --> D
```

---

## 10. MVP（3 个迭代建议）

### Iteration 1：顺滑闭环（立刻感知价值）
- `translate.selection`：Overlay 翻译（复制/替换/插入，自动关闭）
- 入口：全局快捷键 + 协议/命令行
- 上下文：剪贴板策略 + 活动窗口信息
- 渲染：markdown + code（流式）

### Iteration 2：文档总结工作台成立
- `summarize.file`：Workspace（文档列表 + 概要/要点）
- PDF 预览（pdf.js）延迟加载
- 导出：复制 markdown / 保存文件

### Iteration 3：文档对话 + 生成物
- `chat.workspace`：DocChatView（assistant-ui）
- `artifact.from_chat`：固化生成物（版本/导出）
- IPC：Local API/pipe（给 PowerToys 插件/脚本调用）

---

## 11. 结论
本方案以 **Invocation 统一协议** + **Capability 注册式扩展** + **Surfaces 分层** 为核心，使“短任务用之即走、长任务多轮对话、工作台文档管理”能够在一个 Tauri 桌面客户端中顺滑共存，并且 UI 侧保持轻量与可扩展。

