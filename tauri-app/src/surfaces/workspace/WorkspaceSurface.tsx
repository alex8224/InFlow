import { executeCapability } from '../../integrations/tauri/api';

export function WorkspaceSurface() {
  const testOverlay = () => {
    executeCapability('translate.selection', {}, { selectedText: "Hello from Workspace" }, { mode: 'overlay', focus: true });
  };

  const testDeepLink = () => {
    const url = "inflow://invoke?capabilityId=translate.selection&selectedText=This+is+a+deep+link+test";
    // 使用 tauri-plugin-opener 的 open 功能来触发，这会更接近真实点击
    import('@tauri-apps/plugin-opener').then(m => m.open(url)).catch(() => {
        // Fallback to window.location
        window.location.href = url;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="bg-card border-b px-6 py-4">
        <h1 className="text-2xl font-bold">inFlow Workspace</h1>
      </header>
      <main className="flex-1 overflow-auto p-6 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
          <div className="bg-card rounded-xl shadow-sm border p-6">
            <h2 className="text-xl font-semibold mb-4">Window Management</h2>
            <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
              测试底层的 Invocation 协议和 Deep Link 唤醒机制。
            </p>
            <div className="flex gap-3">
              <button
                onClick={testOverlay}
                className="bg-primary text-primary-foreground hover:opacity-90 px-4 py-2 rounded-md transition-all shadow-sm font-medium text-sm"
              >
                直接触发翻译 (Internal)
              </button>
              <button
                onClick={testDeepLink}
                className="bg-outline border border-primary text-primary hover:bg-primary/5 px-4 py-2 rounded-md transition-all font-medium text-sm"
              >
                模拟深度链接 (Deep Link)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card rounded-lg shadow-sm border p-6">
              <h2 className="text-xl font-semibold mb-4">Overlay Window</h2>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p><span className="font-bold text-foreground">用途：</span>翻译、改写、润色等快速任务</p>
                <p><span className="font-bold text-foreground">触发方式：</span>全局快捷键、右键菜单、协议调用</p>
                <p><span className="font-bold text-foreground">特点：</span>无边框圆角、置顶、任务栏隐藏、用完即走</p>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow-sm border p-6">
              <h2 className="text-xl font-semibold mb-4">Core Principles</h2>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>• 意图 → 结果 的路径压缩到最短</p>
                <p>• 上下文自动带入（选区/剪贴板）</p>
                <p>• 界面按任务自适应</p>
                <p>• 能力注册式扩展</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-lg shadow-sm border p-6">
            <h2 className="text-xl font-semibold mb-4">Usage Scenarios</h2>
            <div className="space-y-4 text-muted-foreground text-sm">
              <div className="flex items-start gap-4 p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors">
                <span className="text-2xl bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg">📝</span>
                <div>
                  <div className="font-bold text-foreground text-base">翻译选区</div>
                  <div className="mt-1">选中文字 → 快捷键 → Overlay 窗口即刻显示翻译结果。</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors">
                <span className="text-2xl bg-green-100 dark:bg-green-900/30 p-2 rounded-lg">📄</span>
                <div>
                  <div className="font-bold text-foreground text-base">文档总结</div>
                  <div className="mt-1">右键文件 → 总结 → Workspace 工作台显示文档大纲。</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors">
                <span className="text-2xl bg-purple-100 dark:bg-purple-900/30 p-2 rounded-lg">💬</span>
                <div>
                  <div className="font-bold text-foreground text-base">多轮对话</div>
                  <div className="mt-1">围绕选中文件进行智能对话，生成最终文档。</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
