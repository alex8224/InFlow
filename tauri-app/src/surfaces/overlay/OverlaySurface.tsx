import { useMemo, useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  X,
  Globe,
  Bot,
  Plus,
  Trash2,
  Square,
  Minus,
  Pin,
  PinOff,
  Wrench,
  Share2,
  Check,
  Settings,
} from "lucide-react";
import {
  chatCancel,
  chatSessionCreate,
  getAppConfig,
  AppConfig,
  chatToolsCatalog,
  ToolCatalogItem,
  chatShareCreate,
  SharedMessage,
  updateAppConfig,
} from "../../integrations/tauri/api";
import { cn } from "../../lib/cn";
import { useInvocationStore } from "../../stores/invocationStore";
import { useChatStore } from "../../stores/chatStore";
import { viewRegistry } from "../../core/registry/viewRegistry";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

export function OverlaySurface() {
  const currentInvocation = useInvocationStore(
    (state) => state.currentInvocation,
  );
  const activeService = useInvocationStore((state) => state.activeService);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  const chatSessionId = useChatStore((s) => s.sessionId);
  const chatSessionProviderId = useChatStore((s) => s.sessionProviderId);
  const chatIsStreaming = useChatStore((s) => s.isStreaming);
  const chatSelectedTools = useChatStore((s) => s.selectedTools);
  const chatToggleTool = useChatStore((s) => s.toggleTool);
  const chatSetSelectedTools = useChatStore((s) => s.setSelectedTools);
  const chatSetSessionProviderId = useChatStore((s) => s.setSessionProviderId);
  const chatResetSession = useChatStore((s) => s.resetSession);
  const chatClearConversation = useChatStore((s) => s.clearConversation);
  const chatSetSession = useChatStore((s) => s.setSession);
  const chatMessages = useChatStore((s) => s.messages);
  const chatSessionTitle = useChatStore((s) => s.sessionTitle);
  const chatToolCalls = useChatStore((s) => s.toolCalls);

  const runningTool = useMemo(() => {
    return Object.values(chatToolCalls).find((t) => t.status === "started");
  }, [chatToolCalls]);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsCatalog, setToolsCatalog] = useState<ToolCatalogItem[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showTranslateSettings, setShowTranslateSettings] = useState(false);

  const toolsFetchedAtRef = useRef<number>(0);
  const toolsFetchInFlightRef = useRef<Promise<void> | null>(null);
  const TOOLS_CACHE_MS = 5 * 60 * 1000;

  const fetchToolsCatalog = async (opts?: {
    force?: boolean;
    showLoadingIfEmpty?: boolean;
  }) => {
    const force = opts?.force ?? false;
    const showLoadingIfEmpty = opts?.showLoadingIfEmpty ?? false;

    const now = Date.now();
    const isFresh =
      toolsCatalog.length > 0 &&
      now - toolsFetchedAtRef.current < TOOLS_CACHE_MS;
    if (!force && isFresh) return;

    if (toolsFetchInFlightRef.current) return;

    if (showLoadingIfEmpty && toolsCatalog.length === 0) {
      setToolsLoading(true);
    }

    toolsFetchInFlightRef.current = (async () => {
      try {
        const list = await chatToolsCatalog();
        setToolsCatalog(list);
        toolsFetchedAtRef.current = Date.now();
      } catch (err) {
        console.error("Failed to load tools catalog:", err);
        // Keep any previously loaded list; only empty state if we never had one.
        if (toolsCatalog.length === 0) setToolsCatalog([]);
      } finally {
        setToolsLoading(false);
        toolsFetchInFlightRef.current = null;
      }
    })();
  };

  useEffect(() => {
    loadConfig();

    const win = getCurrentWindow();
    let resizeTimer: number | null = null;

    // Cache maximized state for styling.
    win
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => setIsMaximized(false));

    // Cache pinned state for styling.
    win
      .isAlwaysOnTop()
      .then(setIsPinned)
      .catch(() => setIsPinned(false));

    // Keep window state in sync even when user uses OS snap/maximize.
    const unlistenResizedP = win.onResized(() => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        win
          .isMaximized()
          .then(setIsMaximized)
          .catch(() => {});
      }, 80);
    });
    const unlistenMovedP = win.onMoved(() => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        win
          .isMaximized()
          .then(setIsMaximized)
          .catch(() => {});
      }, 80);
    });

    // Listen for config changes
    const unlistenConfig = listen<AppConfig>("app-config-changed", (event) => {
      setConfig(event.payload);
    });

    // Global ESC key listener to close overlay
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await getCurrentWindow().hide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlistenConfig.then((f) => f());
      unlistenResizedP.then((f) => f()).catch(() => {});
      unlistenMovedP.then((f) => f()).catch(() => {});
      if (resizeTimer) window.clearTimeout(resizeTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!toolsOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest("[data-tools-panel]") || el.closest("[data-tools-button]"))
        return;
      setToolsOpen(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [toolsOpen]);

  const toggleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      const max = await win.isMaximized();
      if (max) {
        await win.unmaximize();
        setIsMaximized(false);
      } else {
        await win.maximize();
        setIsMaximized(true);
      }
    } catch (err) {
      console.error("Failed to toggle maximize:", err);
    }
  };

  const loadConfig = async () => {
    try {
      const data = await getAppConfig();
      setConfig(data);
    } catch (err) {
      console.error("Failed to load config in overlay:", err);
    }
  };

  const handleDrag = async (e: React.MouseEvent) => {
    // Avoid starting a drag on double-click (Windows titlebar behavior is maximize/restore).
    if (e.detail > 1) return;
    if (e.button === 0) {
      const target = e.target as HTMLElement;
      // Precision dragging: only on header or designated areas
      if (
        target.closest("header") ||
        target.classList.contains("drag-region")
      ) {
        if (
          target.tagName !== "BUTTON" &&
          !target.closest("button") &&
          !target.closest('[role="combobox"]')
        ) {
          try {
            await getCurrentWindow().startDragging();
          } catch (err) {
            console.error("Failed to start dragging:", err);
          }
        }
      }
    }
  };

  const handleHeaderDoubleClick = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "BUTTON" ||
      target.closest("button") ||
      target.closest('[role="combobox"]')
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    await toggleMaximize();
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await getCurrentWindow().hide();
  };

  const handleMinimize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.error("Failed to minimize window:", err);
    }
  };

  const handlePin = async () => {
    try {
      const win = getCurrentWindow();
      const current = await win.isAlwaysOnTop();
      const newStatus = !current;
      await win.setAlwaysOnTop(newStatus);
      setIsPinned(newStatus);
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  const renderContent = () => {
    if (!currentInvocation) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
          <Globe className="w-12 h-12 opacity-10 animate-pulse" />
          <p className="text-sm font-medium animate-pulse tracking-widest uppercase italic">
            Waiting for Command
          </p>
        </div>
      );
    }

    const view = viewRegistry
      .getAll()
      .find((v) => v.capabilityIds.includes(currentInvocation.capabilityId));

    if (view) {
      const Component = view.component;
      return (
        <div className="flex-1 flex flex-col min-h-0 relative">
          <Component />
          {isTranslate && showTranslateSettings && config && (
            <div className="absolute inset-0 bg-background/95 backdrop-blur-md z-[100] p-4 flex flex-col gap-4 animate-in fade-in slide-in-from-left-2 duration-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5" />
                  翻译设置
                </h3>
                <button
                  onClick={() => setShowTranslateSettings(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 flex flex-col gap-2 overflow-hidden">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">
                  AI 翻译系统提示词 (System Prompt)
                </label>
                <textarea
                  className="flex-1 w-full p-3 rounded-xl bg-muted/20 border border-border/50 text-xs font-medium resize-none focus:outline-none focus:ring-1 focus:ring-primary/20 custom-scrollbar"
                  placeholder="例如: 你是一个资深翻译家，请将以下内容翻译成地道的中文..."
                  value={config.translateSystemPrompt || ""}
                  onChange={(e) => {
                    const newConfig = {
                      ...config,
                      translateSystemPrompt: e.target.value,
                    };
                    setConfig(newConfig);
                    updateAppConfig(newConfig);
                  }}
                />
                <p className="text-[10px] text-muted-foreground italic">
                  * 留空将使用系统默认提示词
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setShowTranslateSettings(false)}
                  className="px-6 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-xl shadow-lg shadow-primary/20 active:scale-95 transition-all"
                >
                  完成
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center text-destructive p-8 text-center gap-4 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
          <X className="w-8 h-8" />
        </div>
        <div>
          <p className="font-black text-lg uppercase tracking-tight">
            Unsupported
          </p>
          <p className="text-[10px] opacity-60 mt-1 font-mono">
            {currentInvocation.capabilityId}
          </p>
        </div>
      </div>
    );
  };

  const capabilityId = currentInvocation?.capabilityId;
  const isChat = capabilityId === "chat.overlay";
  const isTranslate = capabilityId?.startsWith("translate.") ?? false;
  const isActionPredict = capabilityId === "action.predict";

  useEffect(() => {
    if (!isChat) return;
    if (!config) return;

    // Ensure provider is set for chat session (used by composer).
    if (!chatSessionProviderId) {
      const fallback =
        config.activeProviderId ?? config.llmProviders[0]?.id ?? null;
      if (fallback) chatSetSessionProviderId(fallback);
    }

    // Ensure session exists (chat can auto-create on send, but this keeps UI ready).
    if (!chatSessionId) {
      chatSessionCreate()
        .then((res) => chatSetSession(res.sessionId))
        .catch((err) => console.error("Failed to create chat session:", err));
    }

    // Prefetch tools list in the background to avoid a long wait on first click.
    if (toolsCatalog.length === 0) {
      const t = window.setTimeout(() => {
        fetchToolsCatalog();
      }, 250);
      return () => window.clearTimeout(t);
    }
  }, [isChat, config, chatSessionId, chatSessionProviderId]);

  const chatProviderId = useMemo(() => {
    if (chatSessionProviderId) return chatSessionProviderId;
    return config?.activeProviderId ?? config?.llmProviders[0]?.id ?? null;
  }, [chatSessionProviderId, config]);

  const currentProvider = useMemo(() => {
    const id = config?.translateProviderId || config?.activeProviderId;
    return config?.llmProviders.find((p) => p.id === id);
  }, [config]);

  const currentChatProvider = useMemo(() => {
    return config?.llmProviders.find((p) => p.id === chatProviderId);
  }, [config, chatProviderId]);

  const mcpCatalogByServer = useMemo(() => {
    const m = new Map<
      string,
      { serverId: string; serverName: string; items: ToolCatalogItem[] }
    >();
    for (const t of toolsCatalog) {
      if (t.source !== "mcp") continue;
      const sid = t.serverId ?? "unknown";
      const sname = t.serverName ?? t.serverId ?? "MCP";
      const key = `${sid}::${sname}`;
      const cur = m.get(key) ?? { serverId: sid, serverName: sname, items: [] };
      cur.items.push(t);
      m.set(key, cur);
    }
    return Array.from(m.values()).map((g) => ({
      ...g,
      items: g.items.sort((a, b) => a.title.localeCompare(b.title)),
    }));
  }, [toolsCatalog]);

  const builtinCatalog = useMemo(() => {
    return toolsCatalog
      .filter((t) => t.source === "builtin")
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [toolsCatalog]);

  const handleChatNew = async () => {
    // Keep the currently enabled tools across sessions.
    const keepTools = [...chatSelectedTools];
    chatResetSession();
    if (keepTools.length) chatSetSelectedTools(keepTools);
    const res = await chatSessionCreate();
    chatSetSession(res.sessionId);
    const fallback =
      config?.activeProviderId ?? config?.llmProviders[0]?.id ?? null;
    if (fallback) chatSetSessionProviderId(fallback);
  };

  const handleChatClear = () => {
    chatClearConversation();
  };

  const handleChatStop = async () => {
    if (!chatSessionId) return;
    useChatStore.getState().setStreaming(false);
    try {
      await chatCancel(chatSessionId);
    } catch (err) {
      console.error("Failed to cancel chat:", err);
    }
  };

  const handleChatShare = async () => {
    if (!chatSessionId || chatMessages.length === 0) return;

    setShareLoading(true);
    try {
      // Convert chat messages to shared format
      const sharedMessages: SharedMessage[] = chatMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          const content = m.parts
            .filter((p) => p.type === "markdown")
            .map((p) => (p as { type: "markdown"; content: string }).content)
            .join("\n");
          return {
            id: m.id,
            role: m.role,
            content,
            created_at: m.createdAt,
          };
        })
        .filter((m) => m.content.trim() !== "");

      if (sharedMessages.length === 0) {
        console.warn("No messages to share");
        return;
      }

      const providerName = currentChatProvider?.name ?? undefined;
      const result = await chatShareCreate(
        chatSessionId,
        sharedMessages,
        providerName,
      );

      // Copy URL to clipboard
      await navigator.clipboard.writeText(result.url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);

      console.log("[share] Created share:", result.url);
    } catch (err) {
      console.error("Failed to create share:", err);
    } finally {
      setShareLoading(false);
    }
  };

  return (
    <div className="w-full h-full bg-transparent font-sans antialiased select-none">
      <div
        className={cn(
          "w-full h-full bg-background text-foreground flex flex-col overflow-hidden transition-all duration-200",
          isMaximized
            ? "rounded-none border-0 shadow-none ring-0"
            : "rounded-2xl border border-border/60 app-window-frame",
        )}
      >
        <header
          onMouseDown={handleDrag}
          onDoubleClick={handleHeaderDoubleClick}
          data-tauri-drag-region
          className={cn(
            "flex items-center px-3 h-11 bg-muted/20 border-b border-border/30 select-none cursor-grab active:cursor-grabbing shrink-0 relative gap-2",
            isActionPredict && "hidden"
          )}
        >
          <div className="flex items-center gap-2 text-left shrink-0">
            <button
              onClick={() =>
                isTranslate && setShowTranslateSettings(!showTranslateSettings)
              }
              className={cn(
                "bg-primary/5 p-1.5 rounded-lg text-primary shadow-sm border border-primary/10 transition-all active:scale-95",
                isTranslate && "hover:bg-primary/10 cursor-pointer",
              )}
            >
              {isTranslate && showTranslateSettings ? (
                <Settings className="w-4 h-4" />
              ) : isChat ? (
                <Bot className="w-4 h-4" />
              ) : (
                <Globe className="w-4 h-4" />
              )}
            </button>
            <span className="font-black text-[11px] tracking-widest uppercase opacity-80 hidden sm:block">
              inFlow
            </span>
          </div>

          <div className="flex-1 min-w-0 flex justify-center pointer-events-none px-4">
            {isTranslate && (
              <div className="flex items-center gap-2 scale-90 origin-center shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/70">
                    Smart Translator
                  </span>
                </div>
              </div>
            )}

            {isChat && (
              <div className="flex items-center gap-2 max-w-[60%]">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/80 truncate">
                  {runningTool ? (
                    <span className="text-primary animate-pulse">
                      Calling {runningTool.name}...
                    </span>
                  ) : (
                    chatSessionTitle || "新会话"
                  )}
                </span>
              </div>
            )}

            {!isChat && !isTranslate && currentInvocation && (
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/50 truncate">
                {currentInvocation.capabilityId}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 z-50 shrink-0">
            <button
              onClick={handlePin}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                "h-7 w-7 flex items-center justify-center rounded-lg transition-all active:scale-90 border border-transparent shadow-sm",
                isPinned
                  ? "text-primary bg-primary/10 border-primary/20"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground hover:border-border/40",
              )}
              title={isPinned ? "Unpin" : "Pin"}
            >
              {isPinned ? (
                <Pin className="w-3.5 h-3.5 fill-current" />
              ) : (
                <PinOff className="w-3.5 h-3.5" />
              )}
            </button>

            {isChat && (
              <>
                <div className="w-px h-4 bg-border/40 mx-0.5" />

                <div className="flex items-center gap-1">
                  <Select
                    value={chatProviderId || ""}
                    onValueChange={(v) => chatSetSessionProviderId(v)}
                  >
                    <SelectTrigger className="h-7 w-auto min-w-[32px] max-w-[140px] border-none bg-transparent shadow-none hover:bg-muted/40 text-[10px] font-bold px-2 gap-1 focus:ring-0 transition-colors">
                      <SelectValue placeholder="Model" />
                    </SelectTrigger>
                    <SelectContent>
                      {(config?.llmProviders ?? []).map((p) => (
                        <SelectItem
                          key={p.id}
                          value={p.id}
                          className="text-[11px] font-medium"
                        >
                          <div className="flex flex-col">
                            <span className="font-bold">{p.name}</span>
                            <span className="text-[9px] opacity-60 font-mono tracking-tighter">
                              {p.modelId}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <button
                    onClick={async () => {
                      const next = !toolsOpen;
                      setToolsOpen(next);
                      if (!next) return;
                      fetchToolsCatalog({ showLoadingIfEmpty: true });
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    data-tools-button
                    className={cn(
                      "h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-all active:scale-90 border border-transparent hover:border-border/40",
                      toolsOpen &&
                        "bg-primary/10 text-primary border-primary/20 shadow-sm",
                    )}
                    title="Tools"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={handleChatNew}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-all active:scale-90 border border-transparent hover:border-border/40"
                    title="New chat"
                  >
                    <Plus className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleChatShare}
                      onMouseDown={(e) => e.stopPropagation()}
                      disabled={shareLoading || chatMessages.length === 0}
                      className={cn(
                        "h-7 w-7 flex items-center justify-center rounded-lg transition-all active:scale-90 border border-transparent hover:border-border/40",
                        shareLoading || chatMessages.length === 0
                          ? "text-muted-foreground/30 cursor-not-allowed"
                          : shareCopied
                            ? "text-green-500 bg-green-500/10 border-green-500/20 shadow-sm"
                            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      )}
                      title={shareCopied ? "Link copied!" : "Share chat"}
                    >
                      {shareCopied ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Share2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={handleChatClear}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all active:scale-90 border border-transparent hover:border-destructive/20"
                      title="Clear"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleChatStop}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={!chatIsStreaming}
                  className={cn(
                    "h-7 w-7 flex items-center justify-center rounded-lg transition-all active:scale-90 border border-transparent hover:border-destructive/20",
                    chatIsStreaming
                      ? "text-destructive bg-destructive/5 animate-pulse"
                      : "text-muted-foreground/40 cursor-not-allowed hidden",
                  )}
                  title="Stop"
                >
                  <Square className="w-3 h-3 fill-current" />
                </button>

                {toolsOpen && (
                  <div
                    data-tools-panel
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute right-3 top-[calc(100%+8px)] w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-border/60 bg-background/95 backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.25)] p-3 animate-in zoom-in-95 duration-150"
                  >
                    <div className="flex items-center justify-between gap-2 px-1 pb-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Capabilities Registry
                      </div>
                      <button
                        type="button"
                        className="text-[10px] font-bold text-primary hover:opacity-80 transition-opacity"
                        onClick={() => chatSetSelectedTools([])}
                      >
                        Reset
                      </button>
                    </div>

                    {toolsLoading ? (
                      <div className="px-2 py-8 flex flex-col items-center gap-3">
                        <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                        <div className="text-[10px] font-bold text-muted-foreground uppercase animate-pulse">
                          Synchronizing...
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-[320px] overflow-auto custom-scrollbar pr-1 space-y-3">
                        {builtinCatalog.length > 0 && (
                          <div className="rounded-xl border border-border/50 bg-muted/10 p-2">
                            <div className="px-1 pb-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">
                              Native Modules
                            </div>
                            <div className="space-y-1">
                              {builtinCatalog.map((t) => {
                                const checked = chatSelectedTools.includes(
                                  t.fnName,
                                );
                                return (
                                  <label
                                    key={t.fnName}
                                    className={cn(
                                      "flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer",
                                      checked
                                        ? "bg-primary/5"
                                        : "hover:bg-muted/30",
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => chatToggleTool(t.fnName)}
                                      className="mt-1"
                                    />
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-bold text-foreground truncate">
                                        {t.title}
                                      </div>
                                      {t.description && (
                                        <div className="text-[10px] text-muted-foreground/80 leading-snug line-clamp-2">
                                          {t.description}
                                        </div>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {mcpCatalogByServer.length > 0 && (
                          <div className="space-y-2">
                            {mcpCatalogByServer.map((g) => (
                              <div
                                key={`${g.serverId}:${g.serverName}`}
                                className="rounded-xl border border-border/50 bg-muted/10 p-2"
                              >
                                <div className="px-1 pb-1 flex items-center justify-between gap-2">
                                  <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70 truncate">
                                    MCP Provider • {g.serverName}
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  {g.items.map((t) => {
                                    const checked = chatSelectedTools.includes(
                                      t.fnName,
                                    );
                                    return (
                                      <label
                                        key={t.fnName}
                                        className={cn(
                                          "flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer",
                                          checked
                                            ? "bg-primary/5"
                                            : "hover:bg-muted/30",
                                        )}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() =>
                                            chatToggleTool(t.fnName)
                                          }
                                          className="mt-1"
                                        />
                                        <div className="min-w-0">
                                          <div className="text-[11px] font-bold text-foreground truncate">
                                            {t.title}
                                          </div>
                                          {t.description && (
                                            <div className="text-[10px] text-muted-foreground/80 leading-snug line-clamp-2">
                                              {t.description}
                                            </div>
                                          )}
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {builtinCatalog.length === 0 &&
                          mcpCatalogByServer.length === 0 && (
                            <div className="px-4 py-8 text-center">
                              <Wrench className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                              <div className="text-[10px] font-bold text-muted-foreground uppercase">
                                No modules detected
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="w-px h-4 bg-border/40 mx-0.5" />

            <button
              onClick={handleMinimize}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-all active:scale-90 border border-transparent hover:border-border/40"
              title="Minimize"
            >
              <Minus className="w-4 h-4" />
            </button>

            <button
              onClick={handleClose}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all active:scale-90 border border-transparent hover:border-destructive/20"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 flex flex-col p-5 overflow-hidden min-h-0 bg-gradient-to-b from-transparent to-muted/5">
          {renderContent()}
        </div>

        <footer className={cn(
          "px-6 h-10 bg-muted/30 border-t border-border/40 flex justify-between items-center shrink-0 select-none",
          (isChat || isActionPredict) && "hidden"
        )}>
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.8)] animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground/60">
              System Ready
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isChat && currentChatProvider && (
              <span className="text-[9px] font-bold text-primary/40 uppercase tracking-widest">
                {currentChatProvider.name}
              </span>
            )}
            {!isChat && activeService === "ai" && currentProvider && (
              <span className="text-[9px] font-bold text-primary/40 uppercase tracking-widest">
                {currentProvider.name}
              </span>
            )}
            <span className="text-[9px] uppercase tracking-widest italic opacity-20 text-muted-foreground font-black">
              v0.1.0
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
