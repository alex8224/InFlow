import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  File,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  MessageSquare,
  RotateCcw,
  Send,
  Wrench,
  X,
} from "lucide-react";

import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/cn";
import {
  chatInferTitle,
  chatCancel,
  chatSessionCreate,
  chatStream,
  chatToolsCatalog,
  getAppConfig,
  getClipboardText,
  readLocalFileDataUrl,
  type AppConfig,
  type ToolCatalogItem,
} from "../../integrations/tauri/api";

import { type ChatMessagePart, useChatStore } from "../../stores/chatStore";
import { useInvocationStore } from "../../stores/invocationStore";
import { RichMarkdown } from "../../components/blocks/RichMarkdown";

type ChatTokenEvent = {
  sessionId: string;
  delta?: string;
  reasoningDelta?: string;
};
type ChatEndEvent = { sessionId: string };
type ChatErrorEvent = { sessionId: string; message: string };
type ChatToolCallEvent = {
  sessionId: string;
  callId: string;
  name: string;
  arguments: unknown;
  status: "started" | "done" | "error";
};
type ChatToolResultEvent = {
  sessionId: string;
  callId: string;
  content: unknown;
};

type SendOverride =
  | string
  | {
      text?: string;
      images?: string[];
      files?: { mime: string; data: string }[];
      preserveComposer?: boolean;
    };

function FloatingCopyButton({
  text,
  title,
  className,
  iconClassName,
  copiedIconClassName,
  hideWhenDisabled = false,
}: {
  text: string;
  title: string;
  className: string;
  iconClassName?: string;
  copiedIconClassName?: string;
  hideWhenDisabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const canCopy = Boolean(text && text.trim());

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 900);
    } catch {
      // ignore
    }
  }, [canCopy, text]);

  if (!canCopy && hideWhenDisabled) return null;

  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={!canCopy}
      className={cn(className, !canCopy && "opacity-0 pointer-events-none")}
      title={title}
    >
      {copied ? (
        <Check className={cn("w-4 h-4 text-green-500", copiedIconClassName)} />
      ) : (
        <Copy className={cn("w-4 h-4", iconClassName)} />
      )}
    </button>
  );
}

export function ChatOverlayView() {
  const currentInvocation = useInvocationStore((s) => s.currentInvocation);
  const {
    sessionId,
    sessionProviderId,
    isStreaming,
    messages,
    selectedTools,
    toggleTool,
    setSelectedTools,
    setSessionProviderId,
    input,
    pendingImages,
    pendingFiles,
    setSession,
    setInput,
    addPendingImage,
    addPendingFile,
    removePendingImage,
    removePendingFile,
    clearPendingImages,
    clearPendingFiles,
    appendUserMessage,
    startAssistantMessage,
    appendAssistantToken,
    setStreaming,
    upsertToolCall,
    setToolResult,
    sessionTitle,
    setSessionTitle,
    resetSession,
  } = useChatStore();
  const toolHintTimerRef = useRef<number | null>(null);
  const [toolHint, setToolHint] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);
  const toolHintToneTextClasses: Record<"info" | "success" | "error", string> =
    {
      info: "text-muted-foreground/70",
      success: "text-emerald-300",
      error: "text-rose-300",
    };
  const activeAssistantMessageId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const frozenScrollTopRef = useRef(0);
  const frozenOffsetFromBottomRef = useRef(0);
  const typingUnfreezeTimerRef = useRef<number | null>(null);
  const handleSendRef = useRef<((override?: SendOverride) => Promise<void>) | null>(
    null,
  );
  const [isInputVisible, setIsInputVisible] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelAnchor, setModelAnchor] = useState<
    | { left: number; top: number; openAbove: boolean }
    | null
  >(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const modelRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [modelActiveIndex, setModelActiveIndex] = useState(0);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsCatalog, setToolsCatalog] = useState<ToolCatalogItem[]>([]);
  const toolsPanelRef = useRef<HTMLDivElement>(null);
  const toolRowRefs = useRef<Record<string, HTMLLabelElement | null>>({});
  const [toolsActiveIndex, setToolsActiveIndex] = useState(0);
  const toolsFetchedAtRef = useRef<number>(0);
  const toolsFetchInFlightRef = useRef<Promise<void> | null>(null);
  const TOOLS_CACHE_MS = 5 * 60 * 1000;

  const [toolsAnchor, setToolsAnchor] = useState<
    | { left: number; top: number; openAbove: boolean }
    | null
  >(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAppConfig();
        setConfig(data);
      } catch {
        // ignore
      }
    };

    load();
    const unlistenConfig = listen<AppConfig>('app-config-changed', (event) => {
      setConfig(event.payload);
    });
    return () => {
      unlistenConfig.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (toolsOpen) return;
      if (isInputVisible) return;
      if (e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable)
        return;

      // Quick open composer when minimized.
      // - Enter: open + focus input
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();

      setIsInputVisible(true);
      window.setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        try {
          const end = el.value.length;
          el.setSelectionRange(end, end);
        } catch {
          // ignore
        }
      }, 0);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isInputVisible, toolsOpen]);

  const fetchToolsCatalog = useCallback(
    async (opts?: { force?: boolean; showLoadingIfEmpty?: boolean }) => {
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
          console.error('Failed to load tools catalog:', err);
          if (toolsCatalog.length === 0) setToolsCatalog([]);
        } finally {
          setToolsLoading(false);
          toolsFetchInFlightRef.current = null;
        }
      })();
    },
    [toolsCatalog],
  );

  const getTextareaCaretPoint = useCallback(
    (textarea: HTMLTextAreaElement, position: number) => {
      const computed = window.getComputedStyle(textarea);
      const div = document.createElement('div');
      const span = document.createElement('span');

      div.style.position = 'absolute';
      div.style.visibility = 'hidden';
      div.style.whiteSpace = 'pre-wrap';
      div.style.wordBreak = 'break-word';
      div.style.overflowWrap = 'break-word';
      div.style.boxSizing = computed.boxSizing;
      div.style.width = computed.width;
      div.style.padding = computed.padding;
      div.style.border = computed.border;
      div.style.fontFamily = computed.fontFamily;
      div.style.fontSize = computed.fontSize;
      div.style.fontWeight = computed.fontWeight;
      div.style.fontStyle = computed.fontStyle;
      div.style.letterSpacing = computed.letterSpacing;
      div.style.lineHeight = computed.lineHeight;
      div.style.textTransform = computed.textTransform;

      const before = textarea.value.slice(0, position);
      div.textContent = before;
      span.textContent = '\u200b';
      div.appendChild(span);

      document.body.appendChild(div);
      const left = span.offsetLeft - textarea.scrollLeft;
      const top = span.offsetTop - textarea.scrollTop;
      const height = span.getBoundingClientRect().height;
      document.body.removeChild(div);

      return { left, top, height };
    },
    [],
  );

  const openToolsPickerAtCaret = useCallback(() => {
    const textarea = inputRef.current;
    const composer = composerRef.current;
    if (!textarea || !composer) {
      setToolsOpen(true);
      void fetchToolsCatalog({ showLoadingIfEmpty: true });
      return;
    }

    const pos = textarea.selectionStart ?? textarea.value.length;
    const caret = getTextareaCaretPoint(textarea, pos);

    const taRect = textarea.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();

    const rawLeft = taRect.left - composerRect.left + caret.left;
    const caretTop = taRect.top - composerRect.top + caret.top;
    const caretBottom = caretTop + caret.height;

    const panelW = 340;
    const pad = 8;
    const left = Math.max(
      pad,
      Math.min(rawLeft, Math.max(pad, composerRect.width - panelW - pad)),
    );

    const maxPanelH = 360;
    const openAbove = caretBottom + maxPanelH + pad > composerRect.height;
    const top = openAbove ? Math.max(pad, caretTop) : caretBottom + 8;

    setToolsAnchor({ left, top, openAbove });
    setToolsOpen(true);
    setToolsActiveIndex(0);
    void fetchToolsCatalog({ showLoadingIfEmpty: true });
  }, [fetchToolsCatalog, getTextareaCaretPoint]);

  const openToolsPickerAtElement = useCallback(
    (el: HTMLElement) => {
      const composer = composerRef.current;
      if (!composer) {
        setToolsOpen(true);
        void fetchToolsCatalog({ showLoadingIfEmpty: true });
        return;
      }
      const r = el.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const panelW = 340;
      const pad = 8;
      const rawLeft = r.left - composerRect.left;
      const left = Math.max(
        pad,
        Math.min(rawLeft, Math.max(pad, composerRect.width - panelW - pad)),
      );
      const top = r.bottom - composerRect.top + 8;
      setToolsAnchor({ left, top, openAbove: false });
      setToolsOpen(true);
      setToolsActiveIndex(0);
      void fetchToolsCatalog({ showLoadingIfEmpty: true });
    },
    [fetchToolsCatalog],
  );

  useEffect(() => {
    if (!toolsOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (
        el.closest('[data-chat-tools-panel]') ||
        el.closest('[data-chat-tools-button]')
      )
        return;
      setToolsOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [toolsOpen]);

  const mcpCatalogByServer = useMemo(() => {
    const m = new Map<
      string,
      { serverId: string; serverName: string; items: ToolCatalogItem[] }
    >();
    for (const t of toolsCatalog) {
      if (t.source !== 'mcp') continue;
      const sid = t.serverId ?? 'unknown';
      const sname = t.serverName ?? t.serverId ?? 'MCP';
      const key = `${sid}::${sname}`;
      const cur = m.get(key) ?? { serverId: sid, serverName: sname, items: [] };
      cur.items.push(t);
      m.set(key, cur);
    }
    return Array.from(m.values()).map((g) => ({
      ...g,
      items: g.items.slice().sort((a, b) => a.title.localeCompare(b.title)),
    }));
  }, [toolsCatalog]);

  const builtinCatalog = useMemo(() => {
    return toolsCatalog
      .filter((t) => t.source === 'builtin')
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [toolsCatalog]);

  const toolsFlatList = useMemo(() => {
    const out: ToolCatalogItem[] = [];
    for (const t of builtinCatalog) out.push(t);
    for (const g of mcpCatalogByServer) {
      for (const t of g.items) out.push(t);
    }
    return out;
  }, [builtinCatalog, mcpCatalogByServer]);

  useEffect(() => {
    if (!toolsOpen) return;
    const t = window.setTimeout(() => {
      toolsPanelRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [toolsOpen]);

  useEffect(() => {
    if (!toolsOpen) return;
    const cur = toolsFlatList[toolsActiveIndex];
    if (!cur) return;
    const el = toolRowRefs.current[cur.fnName];
    el?.scrollIntoView({ block: 'nearest' });
  }, [toolsOpen, toolsActiveIndex, toolsFlatList]);

  const closeToolsPicker = useCallback(() => {
    setToolsOpen(false);
    setToolsAnchor(null);
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  const moveToolsActive = useCallback(
    (delta: number) => {
      if (toolsFlatList.length === 0) return;
      setToolsActiveIndex((idx) => {
        const next = Math.max(0, Math.min(toolsFlatList.length - 1, idx + delta));
        return next;
      });
    },
    [toolsFlatList.length],
  );

  const handleToolsKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!toolsOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeToolsPicker();
        return;
      }

      if (e.key === 'Tab') {
        // Avoid trapping focus inside the floating panel.
        closeToolsPicker();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveToolsActive(1);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveToolsActive(-1);
        return;
      }

      if (e.key === 'PageDown') {
        e.preventDefault();
        moveToolsActive(8);
        return;
      }

      if (e.key === 'PageUp') {
        e.preventDefault();
        moveToolsActive(-8);
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        setToolsActiveIndex(0);
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        setToolsActiveIndex(Math.max(0, toolsFlatList.length - 1));
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        const cur = toolsFlatList[toolsActiveIndex];
        if (!cur) return;
        e.preventDefault();
        toggleTool(cur.fnName);
        return;
      }
    },
    [
      closeToolsPicker,
      moveToolsActive,
      toggleTool,
      toolsActiveIndex,
      toolsFlatList,
      toolsOpen,
    ],
  );

  const lastPrefillInvocationIdRef = useRef<string | null>(null);

  const leakModeRef = useRef(false);
  const leakPendingRef = useRef("");

  // Debug: log streamed deltas in the webview console.
  // Enable by running in devtools: localStorage.setItem('inflow.debug.chatStream','1')
  // Optional verbose mode: localStorage.setItem('inflow.debug.chatStreamVerbose','1')
  const debugStreamRef = useRef(false);
  const debugVerboseRef = useRef(false);
  const debugBufRef = useRef("");
  const debugLastFlushRef = useRef(0);

  type DebugRun = {
    runId: string;
    sessionId: string;
    providerId: string;
    startedAtIso: string;
    startPerfMs: number;
    firstTokenPerfMs: number | null;
    toolFirstPerfMs: number | null;
    tokenEvents: number;
    charCount: number;
  };
  const debugRunRef = useRef<DebugRun | null>(null);

  const currentProviderId = useMemo(() => {
    return sessionProviderId ?? null;
  }, [sessionProviderId]);

  const llmProviders = useMemo(() => {
    return config?.llmProviders ?? [];
  }, [config]);

  const currentProvider = useMemo(() => {
    if (!currentProviderId) return null;
    return llmProviders.find((p) => p.id === currentProviderId) ?? null;
  }, [llmProviders, currentProviderId]);

  const currentProviderName = currentProvider?.name ?? '未选择';

  const openModelPickerAtElement = useCallback(
    (el: HTMLElement) => {
      const composer = composerRef.current;
      if (!composer) {
        setModelOpen(true);
        setModelAnchor({ left: 8, top: 8, openAbove: false });
        setModelActiveIndex(0);
        return;
      }

      const r = el.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const panelW = 360;
      const pad = 8;
      const rawLeft = r.left - composerRect.left;
      const left = Math.max(
        pad,
        Math.min(rawLeft, Math.max(pad, composerRect.width - panelW - pad)),
      );
      const belowTop = r.bottom - composerRect.top + 8;
      const maxPanelH = 360;
      const openAbove = belowTop + maxPanelH + pad > composerRect.height;
      const top = openAbove
        ? Math.max(pad, r.top - composerRect.top)
        : belowTop;

      setModelAnchor({ left, top, openAbove });
      setModelOpen(true);
      const idx = currentProviderId
        ? llmProviders.findIndex((p) => p.id === currentProviderId)
        : -1;
      setModelActiveIndex(idx >= 0 ? idx : 0);
    },
    [currentProviderId, llmProviders],
  );

  const closeModelPicker = useCallback(() => {
    setModelOpen(false);
    setModelAnchor(null);
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  const moveModelActive = useCallback(
    (delta: number) => {
      if (llmProviders.length === 0) return;
      setModelActiveIndex((idx) => {
        const next = Math.max(0, Math.min(llmProviders.length - 1, idx + delta));
        return next;
      });
    },
    [llmProviders.length],
  );

  const selectModelByIndex = useCallback(
    (idx: number) => {
      const p = llmProviders[idx];
      if (!p) return;
      setSessionProviderId(p.id);
      closeModelPicker();
    },
    [closeModelPicker, llmProviders, setSessionProviderId],
  );

  const handleModelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!modelOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModelPicker();
        return;
      }

      if (e.key === 'Tab') {
        closeModelPicker();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveModelActive(1);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveModelActive(-1);
        return;
      }

      if (e.key === 'PageDown') {
        e.preventDefault();
        moveModelActive(8);
        return;
      }

      if (e.key === 'PageUp') {
        e.preventDefault();
        moveModelActive(-8);
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        setModelActiveIndex(0);
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        setModelActiveIndex(Math.max(0, llmProviders.length - 1));
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectModelByIndex(modelActiveIndex);
      }
    },
    [
      closeModelPicker,
      llmProviders.length,
      modelActiveIndex,
      modelOpen,
      moveModelActive,
      selectModelByIndex,
    ],
  );

  const openModelPicker = useCallback(() => {
    if (toolsOpen) {
      setToolsOpen(false);
      setToolsAnchor(null);
    }
    if (modelOpen) {
      closeModelPicker();
      return;
    }
    const btn = modelButtonRef.current;
    if (btn) {
      openModelPickerAtElement(btn);
      return;
    }
    setModelAnchor({ left: 8, top: 8, openAbove: false });
    setModelOpen(true);
    setModelActiveIndex(0);
  }, [closeModelPicker, modelOpen, openModelPickerAtElement, toolsOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Model picker: Ctrl+M (macOS: Cmd+M)
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === 'm' || e.key === 'M')
      ) {
        e.preventDefault();
        e.stopPropagation();

        if (!isInputVisible) {
          setIsInputVisible(true);
          window.setTimeout(() => openModelPicker(), 0);
          return;
        }

        openModelPicker();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isInputVisible, openModelPicker]);

  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (
        el.closest('[data-chat-model-panel]') ||
        el.closest('[data-chat-model-button]')
      )
        return;
      setModelOpen(false);
      setModelAnchor(null);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [modelOpen]);

  useEffect(() => {
    if (!modelOpen) return;
    const t = window.setTimeout(() => {
      modelPanelRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [modelOpen]);

  useEffect(() => {
    if (!modelOpen) return;
    const cur = llmProviders[modelActiveIndex];
    if (!cur) return;
    const el = modelRowRefs.current[cur.id];
    el?.scrollIntoView({ block: 'nearest' });
  }, [modelOpen, modelActiveIndex, llmProviders]);

  const handleNewSession = useCallback(async () => {
    const keepTools = [...selectedTools];
    const keepProviderId = currentProviderId;

    if (toolsOpen) {
      setToolsOpen(false);
      setToolsAnchor(null);
    }

    if (isStreaming && sessionId) {
      try {
        setStreaming(false);
        await chatCancel(sessionId);
      } catch {
        // ignore
      }
    }

    resetSession();
    if (keepTools.length) setSelectedTools(keepTools);
    if (keepProviderId) setSessionProviderId(keepProviderId);

    try {
      const res = await chatSessionCreate();
      setSession(res.sessionId);
    } catch (err: any) {
      const msgId = startAssistantMessage();
      appendAssistantToken(msgId, `\n\n[error] ${err?.message || String(err)}`);
    }

    setIsInputVisible(true);
    window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      try {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      } catch {
        // ignore
      }
    }, 0);
  }, [
    appendAssistantToken,
    currentProviderId,
    isStreaming,
    resetSession,
    selectedTools,
    sessionId,
    setSelectedTools,
    setSession,
    setSessionProviderId,
    setStreaming,
    startAssistantMessage,
    toolsOpen,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // New session shortcut: Ctrl+Shift+N
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        !e.altKey &&
        (e.key === 'n' || e.key === 'N')
      ) {
        e.preventDefault();
        e.stopPropagation();
        void handleNewSession();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleNewSession]);

  const showToolHint = useCallback(
    (message: string, tone: "info" | "success" | "error" = "info") => {
      setToolHint({ message, tone });
      if (toolHintTimerRef.current) {
        window.clearTimeout(toolHintTimerRef.current);
      }
      toolHintTimerRef.current = window.setTimeout(() => {
        setToolHint(null);
        toolHintTimerRef.current = null;
      }, 2800);
    },
    [],
  );

  const formatToolArguments = useCallback((args: unknown) => {
    if (args == null) return "";
    if (typeof args === "string") {
      const s = args.trim();
      if (!s) return "";
      return s.length > 140 ? `${s.slice(0, 137)}...` : s;
    }
    try {
      const json = JSON.stringify(args);
      if (!json) return "";
      return json.length > 140 ? `${json.slice(0, 137)}...` : json;
    } catch {
      const fallback = String(args);
      return fallback.length > 140 ? `${fallback.slice(0, 137)}...` : fallback;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (toolHintTimerRef.current) {
        window.clearTimeout(toolHintTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const getActiveSessionId = () => useChatStore.getState().sessionId;

    try {
      debugStreamRef.current =
        localStorage.getItem("inflow.debug.chatStream") === "1";
      debugVerboseRef.current =
        localStorage.getItem("inflow.debug.chatStreamVerbose") === "1";
    } catch {
      debugStreamRef.current = false;
      debugVerboseRef.current = false;
    }

    const flushDebug = (force = false) => {
      if (!debugStreamRef.current) return;
      const buf = debugBufRef.current;
      if (!buf) return;
      const now = Date.now();
      if (!force && now - debugLastFlushRef.current < 200 && buf.length < 200)
        return;
      debugLastFlushRef.current = now;
      debugBufRef.current = "";

      const run = debugRunRef.current;
      const t = run ? Math.round(performance.now() - run.startPerfMs) : null;
      if (run && t !== null) {
        console.log(`[chat][token][${run.runId}] +${t}ms`, buf);
      } else {
        console.log("[chat-token]", buf);
      }
    };

    const onToken = listen<ChatTokenEvent>("chat-token", (event) => {
      const activeSessionId = getActiveSessionId();
      if (!activeSessionId || event.payload.sessionId !== activeSessionId) return;
      const msgId = activeAssistantMessageId.current;
      if (!msgId) return;

      const startTag = "<system-reminder>";
      const endTag = "</system-reminder>";

      const keepTail = (text: string, tag: string) => {
        const max = Math.min(text.length, tag.length - 1);
        for (let len = max; len > 0; len--) {
          if (tag.startsWith(text.slice(-len))) return text.slice(-len);
        }
        return "";
      };

      const filterLeak = (delta: string) => {
        let text = leakPendingRef.current + delta;
        leakPendingRef.current = "";
        let out = "";
        while (text.length > 0) {
          if (!leakModeRef.current) {
            const idx = text.indexOf(startTag);
            if (idx === -1) {
              const tail = keepTail(text, startTag);
              out += text.slice(0, text.length - tail.length);
              leakPendingRef.current = tail;
              break;
            }
            out += text.slice(0, idx);
            text = text.slice(idx + startTag.length);
            leakModeRef.current = true;
            continue;
          }

          const idx = text.indexOf(endTag);
          if (idx === -1) {
            leakPendingRef.current = keepTail(text, endTag);
            break;
          }
          text = text.slice(idx + endTag.length);
          leakModeRef.current = false;
        }
        return out;
      };

      const safeDelta = event.payload.delta
        ? filterLeak(event.payload.delta)
        : undefined;
      const reasoningDelta = event.payload.reasoningDelta;

      if (safeDelta || reasoningDelta) {
        appendAssistantToken(msgId, safeDelta, reasoningDelta);
      }

      if (debugStreamRef.current && safeDelta) {
        const run = debugRunRef.current;
        if (run) {
          run.tokenEvents += 1;
          run.charCount += safeDelta.length;
          if (run.firstTokenPerfMs === null) {
            run.firstTokenPerfMs = performance.now();
            const delay = Math.round(run.firstTokenPerfMs - run.startPerfMs);
            console.log(
              `[chat][first-token][${run.runId}] delay=${delay}ms at=${new Date().toISOString()}`,
            );
          }
        }

        debugBufRef.current += safeDelta;
        flushDebug(false);

        if (debugVerboseRef.current) {
          const runId = debugRunRef.current?.runId ?? "unknown";
          const t = debugRunRef.current
            ? Math.round(performance.now() - debugRunRef.current.startPerfMs)
            : null;
          console.log(`[chat][delta][${runId}] +${t ?? "?"}ms`, safeDelta);
        }
      }

      if (autoScrollRef.current && listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });

    const onToolCall = listen<ChatToolCallEvent>("chat-toolcall", (event) => {
      const activeSessionId = getActiveSessionId();
      if (!activeSessionId || event.payload.sessionId !== activeSessionId) return;

      if (debugStreamRef.current) {
        const run = debugRunRef.current;
        if (
          run &&
          run.toolFirstPerfMs === null &&
          event.payload.status === "started"
        ) {
          run.toolFirstPerfMs = performance.now();
          const delay = Math.round(run.toolFirstPerfMs - run.startPerfMs);
          console.log(
            `[chat][first-tool][${run.runId}] delay=${delay}ms name=${event.payload.name} callId=${event.payload.callId}`,
          );
        }
        if (debugVerboseRef.current) {
          const runId = run?.runId ?? "unknown";
          const t = run
            ? Math.round(performance.now() - run.startPerfMs)
            : null;
          console.log(
            `[chat][toolcall][${runId}] +${t ?? "?"}ms status=${event.payload.status} name=${event.payload.name} callId=${event.payload.callId}`,
            event.payload.arguments,
          );
        }
      }

      upsertToolCall({
        callId: event.payload.callId,
        name: event.payload.name,
        arguments: event.payload.arguments,
        status: event.payload.status,
      });
      const argsText = formatToolArguments(event.payload.arguments);
      const argsSuffix = argsText ? ` | 参数: ${argsText}` : "";
      if (event.payload.status === "started") {
        showToolHint(`${event.payload.name}${argsSuffix}`, "info");
      } else if (event.payload.status === "done") {
        showToolHint(`${event.payload.name} 完成${argsSuffix}`, "success");
      } else if (event.payload.status === "error") {
        showToolHint(`${event.payload.name} 失败${argsSuffix}`, "error");
      }
    });

    const onToolResult = listen<ChatToolResultEvent>(
      "chat-toolresult",
      (event) => {
        const activeSessionId = getActiveSessionId();
        if (!activeSessionId || event.payload.sessionId !== activeSessionId) return;

        if (debugStreamRef.current && debugVerboseRef.current) {
          const run = debugRunRef.current;
          const runId = run?.runId ?? "unknown";
          const t = run
            ? Math.round(performance.now() - run.startPerfMs)
            : null;
          console.log(
            `[chat][toolresult][${runId}] +${t ?? "?"}ms callId=${event.payload.callId}`,
            event.payload.content,
          );
        }
        setToolResult(event.payload.callId, event.payload.content);
      },
    );

    const onEnd = listen<ChatEndEvent>("chat-end", (event) => {
      const activeSessionId = getActiveSessionId();
      if (!activeSessionId || event.payload.sessionId !== activeSessionId) return;
      setStreaming(false);
      activeAssistantMessageId.current = null;
      flushDebug(true);
      if (debugStreamRef.current) {
        const run = debugRunRef.current;
        if (run) {
          const endedAtIso = new Date().toISOString();
          const total = Math.round(performance.now() - run.startPerfMs);
          const first =
            run.firstTokenPerfMs === null
              ? null
              : Math.round(run.firstTokenPerfMs - run.startPerfMs);
          const firstTool =
            run.toolFirstPerfMs === null
              ? null
              : Math.round(run.toolFirstPerfMs - run.startPerfMs);
          console.log(
            `[chat][end][${run.runId}] total=${total}ms firstToken=${first ?? "n/a"}ms firstTool=${firstTool ?? "n/a"}ms tokens=${run.tokenEvents} chars=${run.charCount} startedAt=${run.startedAtIso} endedAt=${endedAtIso}`,
          );
        } else {
          console.log("[chat-end]");
        }
      }
    });

    const onError = listen<ChatErrorEvent>("chat-error", (event) => {
      const activeSessionId = getActiveSessionId();
      if (!activeSessionId || event.payload.sessionId !== activeSessionId) return;
      setStreaming(false);
      activeAssistantMessageId.current = null;
      flushDebug(true);
      if (debugStreamRef.current) {
        const run = debugRunRef.current;
        const endedAtIso = new Date().toISOString();
        const total = run
          ? Math.round(performance.now() - run.startPerfMs)
          : null;
        console.log(
          `[chat][error][${run?.runId ?? "unknown"}] total=${total ?? "n/a"}ms startedAt=${run?.startedAtIso ?? "n/a"} endedAt=${endedAtIso}`,
          event.payload.message,
        );
      }
      const msgId = startAssistantMessage();
      appendAssistantToken(msgId, `\n\n[error] ${event.payload.message}`);
    });

    return () => {
      flushDebug(true);
      onToken.then((f) => f());
      onToolCall.then((f) => f());
      onToolResult.then((f) => f());
      onEnd.then((f) => f());
      onError.then((f) => f());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (typingUnfreezeTimerRef.current) {
        window.clearTimeout(typingUnfreezeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const prefillFromClipboard = async () => {
      if (currentInvocation?.capabilityId !== "chat.overlay") return;
      if (!currentInvocation.id) return;
      if (lastPrefillInvocationIdRef.current === currentInvocation.id) return;

      // Only prefill when the composer is empty to avoid overwriting user input.
      if (input.trim()) return;

      let text =
        currentInvocation.context?.selectedText ??
        currentInvocation.context?.clipboardText;
      if (!text || !text.trim()) {
        try {
          text = await getClipboardText();
        } catch {
          // Ignore clipboard errors silently.
        }
      }

      if (text && text.trim()) {
        setInput(text);
        queueMicrotask(() => inputRef.current?.focus());

        // Auto-send if requested via deeplink
        if (currentInvocation.ui?.autoSend) {
          // Use setTimeout to ensure input state is updated before sending
          setTimeout(() => {
            handleSend(text);
          }, 100);
        }
      }

      lastPrefillInvocationIdRef.current = currentInvocation.id;
    };

    prefillFromClipboard();
  }, [currentInvocation, input, setInput]);

  useEffect(() => {
    if (!sessionId) return;
    // If a session is created later, clear any stale streaming state.
    setStreaming(false);
    activeAssistantMessageId.current = null;
    leakModeRef.current = false;
    leakPendingRef.current = "";
  }, [sessionId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isInputVisible &&
        inputAreaRef.current &&
        !inputAreaRef.current.contains(event.target as Node)
      ) {
        setIsInputVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isInputVisible]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = async (override?: SendOverride) => {
    const overrideText = typeof override === "string" ? override : override?.text;
    const overrideImages =
      typeof override === "object" ? override.images : undefined;
    const overrideFiles =
      typeof override === "object" ? override.files : undefined;
    const preserveComposer =
      typeof override === "object" && Boolean(override?.preserveComposer);

    const text = (overrideText ?? input).trim();
    const images = overrideImages ?? pendingImages;
    const files = overrideFiles ?? pendingFiles;
    if (!text && images.length === 0 && files.length === 0) return;

    if (!currentProviderId) {
      const msgId = startAssistantMessage();
      appendAssistantToken(msgId, "请先在顶部选择模型。");
      return;
    }

    let sid = sessionId;
    if (!sid) {
      try {
        const res = await chatSessionCreate();
        sid = res.sessionId;
        setSession(sid);
      } catch (err: any) {
        const msgId = startAssistantMessage();
        appendAssistantToken(
          msgId,
          `\n\n[error] ${err?.message || String(err)}`,
        );
        return;
      }
    }

    const parts: any[] = [];
    if (text) parts.push({ type: "markdown", content: text });
    for (const img of images) {
      parts.push({ type: "image", content: img });
    }
    for (const f of files) {
      parts.push({ type: "file", ...f });
    }

    if (!preserveComposer) {
      setInput("");
      clearPendingImages();
      clearPendingFiles();
      setIsInputVisible(false);
    }
    appendUserMessage(parts as any);
    const assistantId = startAssistantMessage();
    activeAssistantMessageId.current = assistantId;
    setStreaming(true);

    autoScrollRef.current = true;
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }

    if (debugStreamRef.current) {
      const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const startedAtIso = new Date().toISOString();
      debugRunRef.current = {
        runId,
        sessionId: sid,
        providerId: currentProviderId,
        startedAtIso,
        startPerfMs: performance.now(),
        firstTokenPerfMs: null,
        toolFirstPerfMs: null,
        tokenEvents: 0,
        charCount: 0,
      };

      const base = {
        runId,
        at: startedAtIso,
        sessionId: sid,
        providerId: currentProviderId,
        chars: text.length,
      };
      if (debugVerboseRef.current) {
        console.log("[chat][start]", { ...base, text });
      } else {
        console.log("[chat][start]", base);
      }
    }

    try {
      const streamParts = parts.map((p) => {
        if (p.type === "markdown") return { type: "text", content: p.content };
        if (p.type === "image") return { type: "image", content: p.content };
        if (p.type === "file") return { type: "file", content: { mime: p.mime, data: p.data } };
        return p;
      });
      await chatStream(
        sid,
        currentProviderId,
        streamParts as any,
        selectedTools,
      );

      // Infer title if not set yet (after first message)
      if (!sessionTitle && sid) {
        chatInferTitle(sid, currentProviderId)
          .then((title) => setSessionTitle(title))
          .catch((err) => console.error("Failed to infer title:", err));
      }
    } catch (err: any) {
      setStreaming(false);
      activeAssistantMessageId.current = null;
      const msgId = startAssistantMessage();
      appendAssistantToken(msgId, `\n\n[error] ${err?.message || String(err)}`);
    }
  };

  handleSendRef.current = handleSend;

  const handleResend = useCallback(
    (parts: ChatMessagePart[]) => {
      if (isStreaming) return;
      const text = parts
        .filter((p): p is { type: "markdown"; content: string } => p.type === "markdown")
        .map((p) => p.content)
        .join("\n\n")
        .trim();
      const images = parts
        .filter((p): p is { type: "image"; content: string } => p.type === "image")
        .map((p) => p.content);
      const files = parts
        .filter((p): p is { type: "file"; mime: string; data: string } => p.type === "file")
        .map((p) => ({ mime: p.mime, data: p.data }));
      const send = handleSendRef.current;
      if (!send) return;
      void send({ text, images, files, preserveComposer: true });
    },
    [isStreaming],
  );

  const isInputVisibleRef = useRef(isInputVisible);
  useEffect(() => {
    isInputVisibleRef.current = isInputVisible;
  }, [isInputVisible]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const setup = async () => {
      const win = getCurrentWebviewWindow();
      const unsubscribe = await win.onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "enter") {
          if (payload.paths && payload.paths.length > 0) {
            setIsDragging(true);
          }
        } else if (payload.type === "drop") {
          setIsDragging(false);
          
          if (payload.paths && payload.paths.length > 0) {
            void (async () => {
              for (const path of payload.paths) {
                try {
                  const dataUrl = await readLocalFileDataUrl(path);
                  if (!dataUrl) continue;

                  const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
                  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
                  const base64Data = dataUrl.split(",")[1];

                  if (mime.startsWith("image/")) {
                    addPendingImage(dataUrl);
                  } else {
                    addPendingFile(mime, base64Data);
                  }
                } catch (err) {
                  console.error("Failed to process dropped file:", err);
                }
              }

              if (!isInputVisibleRef.current) {
                setIsInputVisible(true);
                setTimeout(() => inputRef.current?.focus(), 100);
              }
            })();
          }
        } else if (payload.type === "leave") {
          setIsDragging(false);
        }
      });

      if (cancelled) {
        unsubscribe();
      } else {
        unlisten = unsubscribe;
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [addPendingFile, addPendingImage]);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (prev) => {
            const base64 = prev.target?.result as string;
            addPendingImage(base64);
          };
          reader.readAsDataURL(file);
        }
      } else {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (prev) => {
            const result = prev.target?.result as string;
            const commaIdx = result.indexOf(",");
            const data = commaIdx > -1 ? result.slice(commaIdx + 1) : result;
            addPendingFile(file.type, data);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (prev) => {
          const base64 = prev.target?.result as string;
          addPendingImage(base64);
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = (prev) => {
          const result = prev.target?.result as string;
          const commaIdx = result.indexOf(",");
          const data = commaIdx > -1 ? result.slice(commaIdx + 1) : result;
          addPendingFile(file.type, data);
        };
        reader.readAsDataURL(file);
      }
    }
    e.target.value = ""; // Reset for next selection
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const offsetFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isAtBottom = offsetFromBottom < 24;
    autoScrollRef.current = isAtBottom;
    frozenScrollTopRef.current = el.scrollTop;
    frozenOffsetFromBottomRef.current = offsetFromBottom;
  };

  const freezeAutoScrollWhileTyping = () => {
    if (!isStreaming) return;
    autoScrollRef.current = false;
    if (listRef.current) {
      frozenScrollTopRef.current = listRef.current.scrollTop;
      frozenOffsetFromBottomRef.current =
        listRef.current.scrollHeight -
        listRef.current.scrollTop -
        listRef.current.clientHeight;
    }
    if (typingUnfreezeTimerRef.current) {
      window.clearTimeout(typingUnfreezeTimerRef.current);
    }
    typingUnfreezeTimerRef.current = window.setTimeout(() => {
      const el = listRef.current;
      if (!el) {
        autoScrollRef.current = true;
        return;
      }
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      autoScrollRef.current = isAtBottom;
    }, 1200);
  };

  useLayoutEffect(() => {
    if (!isStreaming) return;
    if (autoScrollRef.current) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const target =
        el.scrollHeight - el.clientHeight - frozenOffsetFromBottomRef.current;
      el.scrollTop = Math.max(0, target);
    });
  }, [input, isStreaming, pendingImages.length, pendingFiles.length]);

  const TypingIndicator = () => {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground select-none">
        <div className="font-bold">正在生成</div>
        <div className="flex items-center gap-1">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse"
            style={{ animationDelay: "160ms" }}
          />
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse"
            style={{ animationDelay: "320ms" }}
          />
        </div>
      </div>
    );
  };

  const renderedMessages = useMemo(() => {
    return messages.map((m) => (
      <div
        key={m.id}
        className={cn(
          "flex w-full mb-6",
          m.role === "user" ? "justify-end" : "justify-start",
        )}
      >
        <div
          className={cn(
            "relative group flex gap-3",
            m.role === "user"
              ? "flex-row-reverse max-w-[92%] sm:max-w-[78%]"
              : "w-full",
          )}
        >
          {/* Avatar/Icon for AI */}
          {m.role === "assistant" && (
            <div className="shrink-0 mt-1">
              <div className="w-8 h-8 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center text-primary shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
            </div>
          )}

          <div
            className={cn(
              "select-text transition-all duration-200",
              m.role === "user"
                ? "relative rounded-[1.6rem] border pl-4 pr-20 py-3 shadow-[0_18px_40px_-26px_rgba(0,0,0,0.75)] bg-gradient-to-br from-[#1b2140] to-[#0f1226] text-slate-50 border-white/10 ring-1 ring-white/5 selection:bg-white/20 selection:text-white"
                : "flex-1",
            )}
          >
            {m.role === "user" ? (
              <div className="flex flex-col gap-3">
                {(() => {
                  const text = m.parts
                    .filter(
                      (p): p is { type: "markdown"; content: string } =>
                        p.type === "markdown",
                    )
                    .map((p) => p.content)
                    .join("\n\n")
                    .trim();
                  const images = m.parts
                    .filter(
                      (p): p is { type: "image"; content: string } =>
                        p.type === "image",
                    )
                    .map((p) => p.content);
                  const rawImageText = images.join("\n").trim();
                  const raw = [text, rawImageText]
                    .filter((s) => Boolean(s && s.trim()))
                    .join("\n\n")
                    .trim();
                  const canResend = Boolean(text || images.length > 0);
                  return (
                    <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all">
                      <FloatingCopyButton
                        text={raw}
                        title="复制"
                        className="h-8 w-8 rounded-xl border border-white/15 bg-black/20 backdrop-blur-sm shadow-sm flex items-center justify-center hover:bg-black/30 active:scale-90"
                        iconClassName="text-white/85"
                        copiedIconClassName="text-green-400"
                      />
                      <button
                        type="button"
                        onClick={() => handleResend(m.parts)}
                        disabled={!canResend || isStreaming || !currentProviderId}
                        className={cn(
                          "h-8 w-8 rounded-xl border border-white/15 bg-black/20 backdrop-blur-sm shadow-sm flex items-center justify-center transition-all hover:bg-black/30 active:scale-90",
                          (!canResend || isStreaming || !currentProviderId) &&
                            "opacity-50 cursor-not-allowed",
                        )}
                        title="重新发送"
                      >
                        <RotateCcw className="w-4 h-4 text-white/85" />
                      </button>
                    </div>
                  );
                })()}
                {m.parts.map((p, i) => (
                  <div key={i}>
                    {p.type === "markdown" && (
                      <div className="text-sm leading-relaxed whitespace-pre-wrap break-words select-text">
                        {p.content}
                      </div>
                    )}
                    {p.type === "image" && (
                      <div className="rounded-xl overflow-hidden border border-white/15 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.7)]">
                        <img
                          src={p.content}
                          alt="User upload"
                          className="max-w-full h-auto object-contain max-h-[400px]"
                        />
                      </div>
                    )}
                    {p.type === "file" && (
                      <div className="rounded-xl border border-white/15 bg-white/5 p-3 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                          {p.mime.includes("pdf") ? (
                            <FileText className="w-6 h-6 text-rose-300" />
                          ) : p.mime.startsWith("audio/") ? (
                            <FileAudio className="w-6 h-6 text-amber-300" />
                          ) : p.mime.startsWith("video/") ? (
                            <FileVideo className="w-6 h-6 text-indigo-300" />
                          ) : (
                            <File className="w-6 h-6 text-white/60" />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">
                            Attached File
                          </div>
                          <div className="text-xs font-bold opacity-80 truncate">
                            {p.mime}
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 min-w-0 relative rounded-[1.6rem] border border-border/60 bg-background/75 backdrop-blur-sm px-4 py-3 shadow-sm overflow-hidden">
                {(() => {
                  const raw =
                    m.parts.find((p) => p.type === "markdown")?.type ===
                    "markdown"
                      ? (m.parts.find((p) => p.type === "markdown") as any)
                          .content
                      : "";
                  const thought =
                    m.parts.find((p) => p.type === "thought")?.type ===
                    "thought"
                      ? (m.parts.find((p) => p.type === "thought") as any)
                          .content
                      : "";

                  const isActive = activeAssistantMessageId.current === m.id;
                  // 只有当正文和思考内容都为空时，才显示“正在生成”
                  const showTyping =
                    isStreaming &&
                    isActive &&
                    raw.trim() === "" &&
                    thought.trim() === "";
                  return (
                    <>
                      <FloatingCopyButton
                        text={String(raw ?? "")}
                        title="复制 Markdown"
                        hideWhenDisabled
                        className="absolute right-2 top-2 h-8 w-8 rounded-xl border border-border/60 bg-background/70 backdrop-blur-sm shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-muted active:scale-90"
                      />
                      {showTyping && (
                        <div className="py-1">
                          <TypingIndicator />
                        </div>
                      )}
                      {!showTyping && (
                        <div className="flex flex-col gap-3 w-full max-w-full overflow-hidden">
                          {m.parts.map((p, i) => {
                            if (p.type === "thought") {
                              return (
                                <details
                                  key={i}
                                  className="group/thought w-full max-w-full overflow-hidden"
                                  open
                                >
                                  <summary className="text-[11px] font-bold text-muted-foreground/60 cursor-pointer list-none flex items-center gap-1.5 hover:text-muted-foreground transition-colors select-none [&::-webkit-details-marker]:hidden">
                                    <MessageSquare className="w-3 h-3" />
                                    <span>思考过程</span>
                                    <div className="h-px flex-1 bg-border/30" />
                                  </summary>
                                  <div className="mt-2 text-[12px] text-muted-foreground/80 leading-relaxed pl-4 border-l-2 border-muted/30 italic whitespace-pre-wrap break-all overflow-x-auto selection:bg-primary/10">
                                    {p.content}
                                  </div>
                                </details>
                              );
                            }
                            if (p.type === "markdown") {
                              return (
                                <div
                                  key={i}
                                  className="w-full max-w-full overflow-hidden"
                                >
                                  <RichMarkdown
                                    className="leading-relaxed selection:bg-primary/20 select-text"
                                    markdown={p.content}
                                  />
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    ));
  }, [messages, isStreaming, currentProviderId, handleResend]);

  const toolProgressText = useMemo(() => {
    if (toolHint) return `...${toolHint.message}`;
    if (isStreaming) return "正在生成...";
    return "";
  }, [isStreaming, toolHint]);

  const toolProgressTone = toolHint?.tone ?? "info";

  const suggestions = [
    "用Python实现斐波拉契数列的计算",
    "用 mermaid 画一个流程图描述TCP三步握手",
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-200 relative">
      {isDragging && (
        <div className="fixed inset-0 z-[9999] bg-primary/10 backdrop-blur-[2px] border-2 border-dashed border-primary/40 rounded-3xl m-2 flex flex-col items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-background/80 p-6 rounded-2xl shadow-xl flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary">
              <ImageIcon className="w-6 h-6" />
            </div>
            <div className="text-sm font-bold">释放文件以添加到聊天</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">
              支持图片、PDF、音频、视频
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-auto p-4 custom-scrollbar select-text"
          style={{ overflowAnchor: "none" }}
        >
          <div className="space-y-6 max-w-4xl mx-auto w-full">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center text-muted-foreground/40 gap-3 py-10">
                <div className="p-4 bg-muted/30 rounded-full shadow-inner">
                  <Bot className="w-8 h-8" />
                </div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em]">
                  Start a conversation
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2 max-w-[520px]">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSend(s)}
                      className="px-3 py-1.5 rounded-full border border-border/60 bg-background/60 hover:bg-background text-[11px] font-bold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {renderedMessages}
          </div>
        </div>

        <div className="shrink-0 flex flex-col gap-2 mx-4 mb-4 relative min-h-[56px] justify-end">
          <div className="h-6 pointer-events-none flex items-center">
            <div
              className={cn(
                "h-full inline-flex w-fit max-w-[260px] sm:max-w-[340px] rounded-lg border px-2.5 text-[11px] items-center gap-2 transition-opacity duration-200",
                toolProgressText
                  ? "opacity-100 bg-background/70 border-border/60"
                  : "opacity-0 bg-transparent border-transparent",
              )}
            >
              <span
                className={cn(
                  "truncate",
                  toolHintToneTextClasses[toolProgressTone],
                )}
              >
                {toolProgressText || "\u00a0"}
              </span>
            </div>
          </div>

          {/* Wake Button */}
          <div
            className={cn(
              "absolute right-0 bottom-0 transition-all duration-300 transform origin-bottom-right",
              !isInputVisible
                ? "scale-100 opacity-100"
                : "scale-0 opacity-0 pointer-events-none",
            )}
          >
            <Button
              onClick={() => {
                setIsInputVisible(true);
                setTimeout(() => inputRef.current?.focus(), 100);
              }}
              className="h-12 w-12 rounded-2xl shadow-xl bg-primary text-primary-foreground hover:scale-110 transition-transform flex items-center justify-center"
              title="Show Input"
            >
              <MessageSquare className="w-6 h-6" />
            </Button>
          </div>

          {/* Input Area */}
          <div
            ref={inputAreaRef}
            className={cn(
              "flex flex-col gap-2 transition-all duration-300 transform origin-bottom-right",
              isInputVisible
                ? "scale-100 opacity-100"
                : "scale-50 opacity-0 pointer-events-none absolute w-full",
            )}
          >
            {(pendingImages.length > 0 || pendingFiles.length > 0) && (
              <div className="flex flex-wrap gap-2 mb-1">
                {pendingImages.map((img, idx) => (
                  <div
                    key={`img-${idx}`}
                    className="relative group rounded-xl overflow-hidden border border-border shadow-sm bg-background"
                  >
                    <img
                      src={img}
                      alt="Pending"
                      className="w-20 h-20 object-cover"
                    />
                    <button
                      onClick={() => removePendingImage(idx)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-background/80 backdrop-blur-sm text-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {pendingFiles.map((file, idx) => {
                  const isPdf = file.mime === "application/pdf";
                  const isAudio = file.mime.startsWith("audio/");
                  const isVideo = file.mime.startsWith("video/");
                  const isText = file.mime.startsWith("text/");

                  return (
                    <div
                      key={`file-${idx}`}
                      className="relative group rounded-xl w-20 h-20 flex flex-col items-center justify-center border border-border shadow-sm bg-muted/30 p-2"
                    >
                      {isPdf ? (
                        <FileText className="w-8 h-8 text-rose-400" />
                      ) : isAudio ? (
                        <FileAudio className="w-8 h-8 text-amber-400" />
                      ) : isVideo ? (
                        <FileVideo className="w-8 h-8 text-indigo-400" />
                      ) : isText ? (
                        <FileText className="w-8 h-8 text-emerald-400" />
                      ) : (
                        <File className="w-8 h-8 text-muted-foreground" />
                      )}
                      <div className="text-[8px] font-bold mt-1 truncate w-full text-center opacity-60">
                        {file.mime.split("/")[1] || "FILE"}
                      </div>
                      <button
                        onClick={() => removePendingFile(idx)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-background/80 backdrop-blur-sm text-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              ref={composerRef}
              className="relative rounded-2xl border border-border/60 bg-muted/10 p-2 shadow-sm transition-all focus-within:shadow-md focus-within:border-primary/20"
            >
              <div className="flex flex-col">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*,application/pdf,audio/*,video/*,text/plain"
                  multiple
                  className="hidden"
                />

                <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
                  <button
                    ref={modelButtonRef}
                    type="button"
                    onClick={openModelPicker}
                    data-chat-model-button
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-border/50 bg-background/40 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/80 hover:bg-muted/30 hover:text-foreground transition-colors"
                    title="选择模型 (Ctrl+M)"
                  >
                    <span>Model</span>
                    <span className="max-w-[140px] truncate text-foreground/80 font-bold normal-case tracking-normal">
                      {currentProviderName}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) =>
                      openToolsPickerAtElement(e.currentTarget as HTMLElement)
                    }
                    data-chat-tools-button
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-border/50 bg-background/40 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/80 hover:bg-muted/30 hover:text-foreground transition-colors"
                    title="选择工具 (@)"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Tools</span>
                    {selectedTools.length > 0 && (
                      <span className="ml-0.5 text-[10px] font-black tracking-tight text-primary">
                        {selectedTools.length}
                      </span>
                    )}
                  </button>

                  {selectedTools.length === 0 && (
                    <div className="text-[10px] text-muted-foreground/60 font-medium truncate">
                      按 @ 打开工具选择
                    </div>
                  )}

                  {selectedTools.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTools([])}
                      className="shrink-0 text-[10px] font-bold text-muted-foreground/70 hover:text-foreground transition-colors"
                      title="清空已选工具"
                    >
                      清空
                    </button>
                  )}
                </div>

                <Textarea
                  ref={inputRef}
                  value={input}
                  onBeforeInput={(e) => {
                    // More reliable than keydown across keyboard layouts/IME.
                    const ne = e.nativeEvent as InputEvent;
                    if (ne?.data === "@") {
                      e.preventDefault();
                      openToolsPickerAtCaret();
                    }
                  }}
                  onChange={(e) => {
                    freezeAutoScrollWhileTyping();
                    setInput(e.target.value);
                  }}
                  onPaste={handlePaste}
                  placeholder="输入问题，得到答案..."
                  className="min-h-[52px] max-h-[200px] resize-none bg-transparent border-none shadow-none focus-visible:ring-0 rounded-xl pl-4 pr-24 py-3 text-sm font-medium leading-relaxed select-text placeholder:text-muted-foreground/50"
                  onKeyDown={(e) => {
                    freezeAutoScrollWhileTyping();

                    if (modelOpen) {
                      handleModelKeyDown(e);
                      if (e.defaultPrevented) return;
                    }

                    if (toolsOpen) {
                      handleToolsKeyDown(e);
                      if (e.defaultPrevented) return;
                    }

                    if (
                      (e.key === "@" ||
                        (e.code === "Digit2" && e.shiftKey) ||
                        (e.key === "2" && e.shiftKey)) &&
                      !e.altKey &&
                      !e.ctrlKey &&
                      !e.metaKey
                    ) {
                      e.preventDefault();
                      openToolsPickerAtCaret();
                      return;
                    }

                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !(e.ctrlKey || e.metaKey)
                    ) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />

                {modelOpen && modelAnchor && (
                  <div
                    ref={modelPanelRef}
                    data-chat-model-panel
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={handleModelKeyDown}
                    tabIndex={0}
                    role="listbox"
                    aria-label="Models"
                    className={cn(
                      "absolute z-50 pointer-events-auto w-[360px] max-w-[calc(100vw-24px)] rounded-2xl border border-border/60 bg-background/95 backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.25)] p-3 animate-in zoom-in-95 duration-150",
                      modelAnchor.openAbove && "origin-bottom",
                    )}
                    style={{
                      left: modelAnchor.left,
                      top: modelAnchor.top,
                      transform: modelAnchor.openAbove
                        ? "translateY(calc(-100% - 8px))"
                        : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 px-1 pb-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Models
                      </div>
                      <div className="text-[10px] font-bold text-muted-foreground/70">
                        Ctrl+M
                      </div>
                    </div>

                    <div className="max-h-[320px] overflow-auto custom-scrollbar pr-1 space-y-1">
                      {llmProviders.length === 0 ? (
                        <div className="px-3 py-8 text-center">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase">
                            No models configured
                          </div>
                        </div>
                      ) : (
                        llmProviders.map((p, idx) => {
                          const active = idx === modelActiveIndex;
                          const selected = p.id === currentProviderId;
                          return (
                            <button
                              key={p.id}
                              ref={(el) => {
                                modelRowRefs.current[p.id] = el;
                              }}
                              type="button"
                              className={cn(
                                "w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors",
                                active
                                  ? "bg-primary/10 ring-1 ring-primary/20"
                                  : "hover:bg-muted/30",
                              )}
                              onMouseEnter={() => setModelActiveIndex(idx)}
                              onClick={() => {
                                setSessionProviderId(p.id);
                                closeModelPicker();
                              }}
                            >
                              <div className="mt-0.5 w-4 h-4 flex items-center justify-center">
                                {selected ? (
                                  <Check className="w-4 h-4 text-primary" />
                                ) : (
                                  <span className="w-2 h-2 rounded-full bg-muted-foreground/20" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-foreground truncate">
                                  {p.name}
                                </div>
                                <div className="text-[9px] opacity-60 font-mono tracking-tighter truncate">
                                  {p.modelId}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {toolsOpen && toolsAnchor && (
                  <div
                    ref={toolsPanelRef}
                    data-chat-tools-panel
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={handleToolsKeyDown}
                    tabIndex={0}
                    role="listbox"
                    aria-label="Tools"
                    className={cn(
                      "absolute z-50 pointer-events-auto w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-border/60 bg-background/95 backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.25)] p-3 animate-in zoom-in-95 duration-150",
                      toolsAnchor.openAbove && "origin-bottom",
                    )}
                    style={{
                      left: toolsAnchor.left,
                      top: toolsAnchor.top,
                      transform: toolsAnchor.openAbove
                        ? "translateY(calc(-100% - 8px))"
                        : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 px-1 pb-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Capabilities Registry
                      </div>
                      <button
                        type="button"
                        className="text-[10px] font-bold text-primary hover:opacity-80 transition-opacity"
                        onClick={() => setSelectedTools([])}
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
                                const checked = selectedTools.includes(t.fnName);
                                const active =
                                  toolsFlatList[toolsActiveIndex]?.fnName === t.fnName;
                                return (
                                  <label
                                    key={t.fnName}
                                    className={cn(
                                      "flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer",
                                      active
                                        ? "bg-primary/10 ring-1 ring-primary/20"
                                        : checked
                                          ? "bg-primary/5"
                                          : "hover:bg-muted/30",
                                    )}
                                    ref={(el) => {
                                      toolRowRefs.current[t.fnName] = el;
                                    }}
                                    onMouseEnter={() => {
                                      const idx = toolsFlatList.findIndex(
                                        (x) => x.fnName === t.fnName,
                                      );
                                      if (idx >= 0) setToolsActiveIndex(idx);
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleTool(t.fnName)}
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
                                    const checked = selectedTools.includes(t.fnName);
                                    const active =
                                      toolsFlatList[toolsActiveIndex]?.fnName ===
                                      t.fnName;
                                    return (
                                      <label
                                        key={t.fnName}
                                        className={cn(
                                          "flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer",
                                          active
                                            ? "bg-primary/10 ring-1 ring-primary/20"
                                            : checked
                                              ? "bg-primary/5"
                                              : "hover:bg-muted/30",
                                        )}
                                        ref={(el) => {
                                          toolRowRefs.current[t.fnName] = el;
                                        }}
                                        onMouseEnter={() => {
                                          const idx = toolsFlatList.findIndex(
                                            (x) => x.fnName === t.fnName,
                                          );
                                          if (idx >= 0) setToolsActiveIndex(idx);
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => toggleTool(t.fnName)}
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
                              <div className="text-[10px] font-bold text-muted-foreground uppercase">
                                No modules detected
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                )}

                <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-9 w-9 rounded-xl text-muted-foreground/60 hover:text-primary hover:bg-primary/5 transition-all"
                    title="Upload File"
                  >
                    <ImageIcon className="w-5 h-5" />
                  </Button>
                  <Button
                    onClick={() => handleSend()}
                    disabled={
                      !currentProviderId ||
                      isStreaming ||
                      (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0)
                    }
                    className={cn(
                      "h-9 w-9 rounded-xl transition-all shadow-md",
                      input.trim() || pendingImages.length > 0 || pendingFiles.length > 0
                        ? "bg-primary text-primary-foreground shadow-primary/20 hover:scale-105"
                        : "bg-muted text-muted-foreground/40",
                    )}
                    title="Send (Enter)"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
