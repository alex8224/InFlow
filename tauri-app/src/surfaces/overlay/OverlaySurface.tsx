import { useMemo, useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { X, Globe, Zap, Sparkles, Bot, Plus, Trash2, Square } from 'lucide-react';
import { chatCancel, chatSessionCreate, closeOverlay, getAppConfig, AppConfig } from '../../integrations/tauri/api';
import { cn } from '../../lib/cn';
import { useInvocationStore } from '../../stores/invocationStore';
import { useChatStore } from '../../stores/chatStore';
import { viewRegistry } from '../../core/registry/viewRegistry';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

export function OverlaySurface() {
  const currentInvocation = useInvocationStore((state) => state.currentInvocation);
  const activeService = useInvocationStore((state) => state.activeService);
  const setActiveService = useInvocationStore((state) => state.setActiveService);
  const [config, setConfig] = useState<AppConfig | null>(null);

  const chatSessionId = useChatStore((s) => s.sessionId);
  const chatSessionProviderId = useChatStore((s) => s.sessionProviderId);
  const chatIsStreaming = useChatStore((s) => s.isStreaming);
  const chatSetSessionProviderId = useChatStore((s) => s.setSessionProviderId);
  const chatResetSession = useChatStore((s) => s.resetSession);
  const chatClearConversation = useChatStore((s) => s.clearConversation);
  const chatSetSession = useChatStore((s) => s.setSession);

  useEffect(() => {
    loadConfig();
    
    // Listen for config changes
    const unlistenConfig = listen<AppConfig>('app-config-changed', (event) => {
      setConfig(event.payload);
    });

    // Global ESC key listener to close overlay
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeOverlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unlistenConfig.then(f => f());
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const loadConfig = async () => {
    try {
      const data = await getAppConfig();
      setConfig(data);
    } catch (err) {
      console.error('Failed to load config in overlay:', err);
    }
  };

  const handleDrag = async (e: React.MouseEvent) => {
    if (e.button === 0) {
      const target = e.target as HTMLElement;
      // Precision dragging: only on header or designated areas
      if (target.closest('header') || target.classList.contains('drag-region')) {
        if (target.tagName !== 'BUTTON' && !target.closest('button') && !target.closest('[role="combobox"]')) {
          try {
            await getCurrentWindow().startDragging();
          } catch (err) {
            console.error('Failed to start dragging:', err);
          }
        }
      }
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await closeOverlay();
  };

  const renderContent = () => {
    if (!currentInvocation) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
          <Globe className="w-12 h-12 opacity-10 animate-pulse" />
          <p className="text-sm font-medium animate-pulse tracking-widest uppercase italic">Waiting for Command</p>
        </div>
      );
    }

    const view = viewRegistry.getAll().find(v => v.capabilityIds.includes(currentInvocation.capabilityId));
    
    if (view) {
      const Component = view.component;
      return <Component />;
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center text-destructive p-8 text-center gap-4 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
          <X className="w-8 h-8" />
        </div>
        <div>
          <p className="font-black text-lg uppercase tracking-tight">Unsupported</p>
          <p className="text-[10px] opacity-60 mt-1 font-mono">{currentInvocation.capabilityId}</p>
        </div>
      </div>
    );
  };

  const capabilityId = currentInvocation?.capabilityId;
  const isChat = capabilityId === 'chat.overlay';
  const isTranslate = capabilityId?.startsWith('translate.') ?? false;

  useEffect(() => {
    if (!isChat) return;
    if (!config) return;

    // Ensure provider is set for chat session (used by composer).
    if (!chatSessionProviderId) {
      const fallback = config.activeProviderId ?? config.llmProviders[0]?.id ?? null;
      if (fallback) chatSetSessionProviderId(fallback);
    }

    // Ensure session exists (chat can auto-create on send, but this keeps UI ready).
    if (!chatSessionId) {
      chatSessionCreate()
        .then((res) => chatSetSession(res.sessionId))
        .catch((err) => console.error('Failed to create chat session:', err));
    }
  }, [isChat, config, chatSessionId, chatSessionProviderId]);

  const chatProviderId = useMemo(() => {
    if (chatSessionProviderId) return chatSessionProviderId;
    return config?.activeProviderId ?? config?.llmProviders[0]?.id ?? null;
  }, [chatSessionProviderId, config]);

  const currentProvider = config?.llmProviders.find((p) => p.id === config.activeProviderId);
  const currentChatProvider = config?.llmProviders.find((p) => p.id === chatProviderId);

  const mcpEnabledCount = (config?.mcpRemoteServers ?? []).filter((s) => s.enabled).length;

  const handleChatNew = async () => {
    chatResetSession();
    const res = await chatSessionCreate();
    chatSetSession(res.sessionId);
    const fallback = config?.activeProviderId ?? config?.llmProviders[0]?.id ?? null;
    if (fallback) chatSetSessionProviderId(fallback);
  };

  const handleChatClear = () => {
    chatClearConversation();
  };

  const handleChatStop = async () => {
    if (!chatSessionId) return;
    await chatCancel(chatSessionId);
  };

  return (
    /* Outermost container - Clean edge alignment for native window handling */
    <div className="w-full h-full bg-transparent font-sans antialiased select-none">
      
      {/* The actual Card-like window - Removed large shadows to avoid clipping and allow native resizing at edges */}
      <div className="w-full h-full bg-background text-foreground flex flex-col rounded-2xl overflow-hidden border border-border/50">
        
        {/* Header - Shared Shell */}
        <header 
          onMouseDown={handleDrag}
          data-tauri-drag-region
          className="flex justify-between items-center px-4 h-14 bg-muted/40 border-b border-border/40 select-none cursor-grab active:cursor-grabbing shrink-0 relative"
        >
          <div className="flex items-center gap-3 pointer-events-none text-left">
            <div className="bg-primary/10 p-2 rounded-xl text-primary shadow-sm border border-primary/10">
              {isChat ? <Bot className="w-4.5 h-4.5" /> : <Globe className="w-4.5 h-4.5" />}
            </div>
            <div className="flex flex-col">
                <span className="font-black text-xs tracking-widest uppercase opacity-90">inFlow</span>
                <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-tighter -mt-0.5 truncate max-w-[100px]">
                    {currentInvocation?.capabilityId || 'System'}
                </span>
            </div>
          </div>

          {/* Center controls */}
          {isTranslate && (
            <div className="absolute left-1/2 -translate-x-1/2 flex bg-background/50 backdrop-blur-sm p-1 rounded-xl border border-border/50 scale-90 origin-center">
              <button
                onClick={() => setActiveService('google')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold transition-all",
                  activeService === 'google' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Zap className={cn("w-3 h-3", activeService === 'google' ? "text-yellow-500 fill-yellow-500" : "")} />
                极速
              </button>
              <button
                onClick={() => setActiveService('ai')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold transition-all",
                  activeService === 'ai' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Sparkles className={cn("w-3 h-3", activeService === 'ai' ? "text-blue-500 fill-blue-500" : "")} />
                AI
              </button>
            </div>
          )}

          {isChat && (
            <div
              className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/50 backdrop-blur-sm p-1.5 rounded-xl border border-border/50"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Select value={chatProviderId || ''} onValueChange={(v) => chatSetSessionProviderId(v)}>
                <SelectTrigger className="h-8 w-[320px] max-w-[46vw] min-w-[220px] rounded-lg bg-background border-border/50 shadow-sm text-[11px] font-bold">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {(config?.llmProviders ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} • {p.modelId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="px-2 py-1 rounded-lg border border-border/50 bg-background/60 text-[10px] font-bold text-muted-foreground flex items-center gap-2">
                <span className={cn('w-1.5 h-1.5 rounded-full', mcpEnabledCount > 0 ? 'bg-green-500' : 'bg-muted-foreground/40')} />
                MCP {mcpEnabledCount}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 z-50 relative">
            {isChat && (
              <>
                <button
                  onClick={handleChatNew}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-all active:scale-90 border border-transparent hover:border-border/40"
                  title="New chat"
                >
                  <Plus className="w-4.5 h-4.5" />
                </button>
                <button
                  onClick={handleChatClear}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-all active:scale-90 border border-transparent hover:border-border/40"
                  title="Clear"
                >
                  <Trash2 className="w-4.5 h-4.5" />
                </button>
                <button
                  onClick={handleChatStop}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={!chatIsStreaming}
                  className={cn(
                    'h-9 w-9 flex items-center justify-center rounded-xl transition-all active:scale-90 border border-transparent hover:border-destructive/20',
                    chatIsStreaming
                      ? 'text-destructive hover:bg-destructive/10'
                      : 'text-muted-foreground/40 cursor-not-allowed'
                  )}
                  title="Stop"
                >
                  <Square className="w-4.5 h-4.5" />
                </button>
              </>
            )}

            <button
              onClick={handleClose}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all active:scale-90 relative border border-transparent hover:border-destructive/20"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>
        
        {/* Content Area */}
        <div className="flex-1 flex flex-col p-5 overflow-hidden min-h-0 bg-gradient-to-b from-transparent to-muted/5">
          {renderContent()}
        </div>
        
        {/* Shared Footer */}
        <footer className="px-6 h-10 bg-muted/30 border-t border-border/40 flex justify-between items-center shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.8)] animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground/60">System Ready</span>
          </div>
           <div className="flex items-center gap-3">
              {isChat && currentChatProvider && (
                <span className="text-[9px] font-bold text-primary/40 uppercase tracking-widest">{currentChatProvider.name}</span>
              )}
              {!isChat && activeService === 'ai' && currentProvider && (
                <span className="text-[9px] font-bold text-primary/40 uppercase tracking-widest">{currentProvider.name}</span>
              )}
              <span className="text-[9px] uppercase tracking-widest italic opacity-20 text-muted-foreground font-black">v0.1.0</span>
           </div>
         </footer>
      </div>
    </div>
  );
}
