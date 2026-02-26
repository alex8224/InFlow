# Markdown Editor Overlay 规格文档

## 1. 概述

基于 Vditor 库实现的 Markdown 编辑器 Overlay，提供多标签编辑、预览、工具栏和状态栏功能。

## 2. 功能需求

### 2.1 核心功能
- [ ] 基于 Vditor 的 Markdown 编辑器
- [ ] 实时预览支持
- [ ] WYSIWYM (所见即所得) 编辑模式
- [ ] 多标签页支持
- [ ] 文件打开/保存

### 2.2 工具栏
- [ ] 打开文件
- [ ] 保存文件 (支持 Save/Save As)
- [ ] 切换编辑模式 (Edit/Preview/WYSIWYM)
- [ ] 主题切换 (Light/Dark)
- [ ] 字体大小调整 (放大/缩小)
- [ ] 新建标签

### 2.3 状态栏
- [ ] 字符统计
- [ ] 单词统计
- [ ] 行数统计
- [ ] 当前光标位置
- [ ] 文件修改状态 (dirty indicator)

### 2.4 DeepLink 触发
- [ ] `inflow://editor?action=new` - 新建文档
- [ ] `inflow://editor?file=<path>` - 打开指定文件
- [ ] `inflow://editor?mode=edit` - 默认编辑模式
- [ ] `inflow://editor?mode=preview` - 默认预览模式

### 2.5 配置持久化
- [ ] 默认编辑器模式
- [ ] 主题偏好
- [ ] 字体大小
- [ ] 最近打开文件列表

## 3. 技术方案

### 3.1 依赖
- `vditor` - Markdown 编辑器

### 3.2 数据结构

```typescript
interface MarkdownEditorConfig {
  defaultMode: 'edit' | 'preview' | 'wysiwym';
  theme: 'light' | 'dark';
  fontSize: number;
  autoSave: boolean;
  recentFiles: string[];
}

interface MarkdownTab {
  id: string;
  title: string;
  filePath: string | null;
  content: string;
  isDirty: boolean;
  cursorPosition: { line: number; col: number };
  stats: { chars: number; words: number; lines: number };
}
```

## 4. 文件结构

```
src/
  surfaces/overlay/
    MarkdownOverlayView.tsx    # 主 Overlay 视图
    components/
      MarkdownEditor.tsx       # Vditor 封装组件
      MarkdownToolbar.tsx      # 工具栏
      MarkdownStatusBar.tsx    # 状态栏
      MarkdownTabBar.tsx       # 标签栏
stores/
  markdownStore.ts             # 编辑器状态管理
integrations/tauri/
  api.ts                       # 扩展 API (文件操作)
```

## 5. DeepLink 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| action | string | `new`, `open` |
| file | string | 文件路径 |
| mode | string | `edit`, `preview`, `wysiwym` |
| theme | string | `light`, `dark` |
