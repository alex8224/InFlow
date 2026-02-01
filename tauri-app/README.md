# inFlow - Windows 桌面"随处可调用能力"客户端

基于 Tauri + React 的桌面应用，支持"用之即走"和"工作台"两种界面模式。

## 技术栈

- **后端**: Rust + Tauri 2
- **前端**: React 18 + TypeScript + Vite
- **样式**: Tailwind CSS
- **状态管理**: Zustand
- **构建工具**: Vite

## 项目结构

```
tauri-app/
├── src-tauri/          # Rust 后端
│   ├── src/
│   │   ├── lib.rs      # 主入口和 Tauri 命令
│   │   └── main.rs     # 启动文件
│   ├── Cargo.toml      # Rust 依赖配置
│   └── tauri.conf.json # Tauri 配置文件
├── src/                # React 前端
│   ├── app/            # 应用启动和路由
│   ├── core/           # 核心类型和注册表
│   ├── stores/         # Zustand 状态管理
│   ├── surfaces/       # 界面层（Overlay/Workspace）
│   ├── components/     # 组件库
│   ├── integrations/   # Tauri 集成层
│   ├── App.tsx         # 根组件
│   └── main.tsx        # 入口文件
└── package.json        # Node.js 依赖配置
```

## 已实现功能

### 后端 (Rust)
- Invocation 数据结构定义
- Tauri Commands：
  - `execute_capability`: 执行能力
  - `show_overlay`: 显示 Overlay 窗口
  - `close_overlay`: 隐藏 Overlay 窗口
  - `open_workspace`: 打开/聚焦工作台
  - `get_clipboard_text`: 获取剪贴板文本
- 事件系统：`app://invocation` 事件发送
- 窗口管理：
  - **主窗口 (Workspace)**: 默认打开，1200x800
  - **Overlay 窗口**: 默认隐藏，按需显示，alwaysOnTop

### 前端 (React)
- 核心类型定义：
  - `Invocation`: 统一调用对象
  - `InvocationContext`: 上下文
  - `ContentBlock`: 内容块类型
  - `Capability`: 能力定义
- Zustand Store：
  - `invocationStore`: Invocation 状态管理
- 注册表：
  - `capabilityRegistry`: 能力注册
  - `viewRegistry`: 视图注册
- Surface 组件：
  - `OverlaySurface`: 临时覆盖层
  - `WorkspaceSurface`: 工作台
- 内容块渲染器：
  - `MarkdownBlock`: Markdown 渲染
  - `CodeBlock`: 代码块渲染
  - `ContentBlocks`: 统一渲染器
- 事件监听：`bootstrap.ts` 监听 Tauri 事件
- 窗口切换逻辑：根据 `invocation.ui.mode` 自动显示/隐藏窗口

## 窗口管理逻辑

应用采用双窗口设计：

1. **Workspace 窗口** (main):
   - 默认打开（1200x800）
   - 长驻工作台，用于文档管理、多轮对话、生成物管理等
   - 作为主界面，显示在任务栏中

2. **Overlay 窗口** (overlay):
   - 默认隐藏（visible: false）
   - 按需显示（400x300），alwaysOnTop，skipTaskbar
   - 用于快速任务：翻译、润色、改写等"用之即走"的场景
   - 收到 `ui.mode === 'overlay'` 的 Invocation 时自动显示
   - 执行完成后自动隐藏，不关闭窗口（可重复使用）

**切换逻辑**：
- 执行能力时，根据 `invocation.ui.mode` 自动显示对应窗口
- `overlay` 模式 → 显示 Overlay 窗口
- `workspace` 或其他模式 → 聚焦 Workspace 窗口

**测试 Overlay 窗口**：
1. 启动应用：`npm run tauri dev`
2. Workspace 窗口会显示，overlay 窗口隐藏
3. 点击 Workspace 中的 "Test Overlay Window" 按钮
4. overlay 窗口会弹出，显示翻译选区的测试界面
5. 点击 overlay 窗口的关闭按钮（×）可以隐藏它

**未来的触发方式**：
- 全局快捷键（选中文字后按快捷键）
- 文件右键菜单
- 协议调用（如 `myapp://invoke?capability=translate.selection`）
- PowerToys Run 插件

## 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run tauri dev

# 构建生产版本
npm run tauri build
```

## 待实现功能

### 迭代 1：顺滑闭环
- [ ] `translate.selection` 能力实现
- [ ] 全局快捷键支持
- [ ] 协议/命令行唤醒
- [ ] 剪贴板策略上下文捕获

### 迭代 2：文档总结工作台
- [ ] `summarize.file` 能力实现
- [ ] PDF 预览集成
- [ ] 文档导出功能

### 迭代 3：文档对话 + 生成物
- [ ] `chat.workspace` 能力实现
- [ ] 生成物管理
- [ ] IPC 通信层

## 依赖包

- `@tauri-apps/api`: Tauri 前端 API
- `zustand`: 轻量级状态管理
- `tailwindcss`: CSS 框架
- `autoprefixer`: CSS 前缀处理
- `postcss`: CSS 转换工具

## Rust 依赖

- `tauri`: Tauri 核心
- `serde`: 序列化/反序列化
- `serde_json`: JSON 处理
- `uuid`: UUID 生成
- `chrono`: 时间处理

## 配置文件

- `tailwind.config.js`: Tailwind 配置
- `postcss.config.js`: PostCSS 配置
- `tauri.conf.json`: Tauri 配置（窗口、协议等）
