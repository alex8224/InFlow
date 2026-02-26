# Markdown Editor Overlay 实现计划

## 阶段 1: 基础设置 (预计 30 分钟)

### 1.1 依赖安装
- [ ] 安装 vditor 包: `npm install vditor`
- [ ] 安装 @types/vditor (或创建自定义类型)

### 1.2 配置文件扩展
- [ ] 扩展 `AppConfig` 添加 `markdownEditor` 配置项
- [ ] 扩展 `config.rs` 添加后端配置结构

## 阶段 2: 状态管理 (预计 45 分钟)

### 2.1 创建 Markdown Store
- [ ] 创建 `src/stores/markdownStore.ts`
- [ ] 实现标签管理 (打开/关闭/切换)
- [ ] 实现内容状态跟踪 (dirty/clean)

## 阶段 3: 组件开发 (预计 120 分钟)

### 3.1 MarkdownEditor 组件
- [ ] 创建 `MarkdownEditor.tsx` 封装 Vditor
- [ ] 实现主题切换
- [ ] 实现模式切换 (edit/preview/wysiwym)
- [ ] 绑定内容变化事件

### 3.2 工具栏组件
- [ ] 创建 `MarkdownToolbar.tsx`
- [ ] 实现按钮: 打开/保存/新建/模式切换/主题/字体大小

### 3.3 状态栏组件
- [ ] 创建 `MarkdownStatusBar.tsx`
- [ ] 实现统计信息显示

### 3.4 标签栏组件
- [ ] 创建 `MarkdownTabBar.tsx`
- [ ] 实现标签切换/关闭

### 3.5 主视图
- [ ] 创建 `MarkdownOverlayView.tsx`
- [ ] 组装所有子组件

## 阶段 4: DeepLink 支持 (预计 30 分钟)

### 4.1 后端处理
- [ ] 在 `deeplink.rs` 添加 `markdown-editor` capability 处理

### 4.2 前端解析
- [ ] 在 `MarkdownOverlayView` 解析 URL 参数
- [ ] 实现对应行为

## 阶段 5: 文件操作 (预计 45 分钟)

### 5.1 后端命令
- [ ] 添加 `read_markdown_file` 命令
- [ ] 添加 `write_markdown_file` 命令

### 5.2 前端集成
- [ ] 在工具栏绑定文件操作
- [ ] 实现打开/保存对话框

## 阶段 6: 注册与集成 (预计 30 分钟)

### 6.1 注册视图
- [ ] 在 `bootstrap.ts` 注册 `markdown-editor` 视图

### 6.2 注册 Capability
- [ ] 在 capability 注册表添加相关 capability

---

## 进度跟踪

| 阶段 | 任务 | 状态 | 开始时间 | 结束时间 |
|------|------|------|----------|----------|
| 1.1 | 安装 vditor | ⏳ | - | - |
| 1.2 | 扩展配置 | ⏳ | - | - |
| 2.1 | 创建 Store | ⏳ | - | - |
| 3.1 | Editor 组件 | ⏳ | - | - |
| 3.2 | Toolbar | ⏳ | - | - |
| 3.3 | StatusBar | ⏳ | - | - |
| 3.4 | TabBar | ⏳ | - | - |
| 3.5 | 主视图 | ⏳ | - | - |
| 4.1 | DeepLink 后端 | ⏳ | - | - |
| 4.2 | DeepLink 前端 | ⏳ | - | - |
| 5.1 | 文件命令 | ⏳ | - | - |
| 5.2 | 文件集成 | ⏳ | - | - |
| 6.1 | 注册视图 | ⏳ | - | - |
| 6.2 | 注册 Capability | ⏳ | - | - |
