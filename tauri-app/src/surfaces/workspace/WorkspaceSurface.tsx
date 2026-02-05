import { useState } from 'react';
import { LayoutDashboard, Settings, Globe, Zap, History, FileText } from 'lucide-react';
import { executeCapability } from '../../integrations/tauri/api';
import { SettingsView } from './SettingsView';
import { cn } from '../../lib/cn';

type ViewType = 'overview' | 'settings' | 'history' | 'documents';

export function WorkspaceSurface() {
  const [activeView, setActiveView] = useState<ViewType>('overview');

  const testOverlay = () => {
    executeCapability('translate.selection', {}, { selectedText: "Hello from Workspace" }, { mode: 'overlay', focus: true });
  };

  const navItems = [
    { id: 'overview', name: '总览', icon: LayoutDashboard },
    { id: 'history', name: '任务历史', icon: History },
    { id: 'documents', name: '文档库', icon: FileText },
    { id: 'settings', name: '系统设置', icon: Settings },
  ];

  const renderContent = () => {
    switch (activeView) {
      case 'settings':
        return <SettingsView />;
      case 'overview':
      default:
        return (
          <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
            <div className="bg-card rounded-xl shadow-sm border p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-yellow-500" />
                  快速操作
              </h2>
              <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
                测试底层的 Invocation 协议和 Deep Link 唤醒机制。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={testOverlay}
                  className="bg-primary text-primary-foreground hover:opacity-90 px-4 py-2 rounded-md transition-all shadow-sm font-medium text-sm"
                >
                  触发翻译 Overlay
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
                <h2 className="text-xl font-semibold mb-4">AI 翻译能力</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>• 支持 OpenAI / Gemini / Anthropic 协议</p>
                  <p>• 流式 Token 实时渲染</p>
                  <p>• Markdown 格式完美还原</p>
                  <p>• 自动感知系统深浅模式</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow-sm border p-6">
              <h2 className="text-xl font-semibold mb-4">场景示例</h2>
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
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-muted/20 flex flex-col shrink-0">
        <div className="p-6 border-b bg-background/50">
          <div className="flex items-center gap-3">
            <div className="bg-primary p-1.5 rounded-lg">
                <Globe className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-black text-lg tracking-tight">inFlow</span>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id as ViewType)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all",
                activeView === item.id 
                  ? "bg-primary text-primary-foreground shadow-md" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.name}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-border/40">
           <div className="px-3 py-4 bg-muted/40 rounded-xl border border-border/50">
              <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">Status</div>
              <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                  <span className="text-xs font-bold">后台服务已就绪</span>
              </div>
           </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b bg-background/50 flex items-center px-8 justify-between backdrop-blur-md z-10">
          <h2 className="font-bold text-lg capitalize">{activeView}</h2>
          <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
            v0.1.0-alpha
          </div>
        </header>
        
        <div className="flex-1 overflow-auto bg-slate-50/50 dark:bg-slate-950/50 p-8">
            {renderContent()}
        </div>
      </main>
    </div>
  );
}
