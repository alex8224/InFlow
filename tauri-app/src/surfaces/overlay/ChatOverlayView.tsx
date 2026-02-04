import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Bot,
  Check,
  Copy,
  Image as ImageIcon,
  MessageSquare,
  Send,
  X,
} from "lucide-react";

import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/cn";
import {
  chatInferTitle,
  chatSessionCreate,
  chatStream,
  getClipboardText,
} from "../../integrations/tauri/api";
import { useChatStore } from "../../stores/chatStore";
import { useInvocationStore } from "../../stores/invocationStore";
import { RichMarkdown } from "../../components/blocks/RichMarkdown";

type ChatTokenEvent = { sessionId: string; delta: string };
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

export function ChatOverlayView() {
  const currentInvocation = useInvocationStore((s) => s.currentInvocation);
  const {
    sessionId,
    sessionProviderId,
    isStreaming,
    messages,
    toolCalls,
    selectedTools,
    input,
    pendingImages,
    setSession,
    setInput,
    addPendingImage,
    removePendingImage,
    clearPendingImages,
    appendUserMessage,
    startAssistantMessage,
    appendAssistantToken,
    setStreaming,
    upsertToolCall,
    setToolResult,
    sessionTitle,
    setSessionTitle,
  } = useChatStore();
  const activeAssistantMessageId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const frozenScrollTopRef = useRef(0);
  const frozenOffsetFromBottomRef = useRef(0);
  const typingUnfreezeTimerRef = useRef<number | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [isInputVisible, setIsInputVisible] = useState(true);

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

  useEffect(() => {
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
      if (!sessionId || event.payload.sessionId !== sessionId) return;
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

      const safeDelta = filterLeak(event.payload.delta);
      if (safeDelta) appendAssistantToken(msgId, safeDelta);

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
      if (!sessionId || event.payload.sessionId !== sessionId) return;

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
    });

    const onToolResult = listen<ChatToolResultEvent>(
      "chat-toolresult",
      (event) => {
        if (!sessionId || event.payload.sessionId !== sessionId) return;

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
      if (!sessionId || event.payload.sessionId !== sessionId) return;
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
      if (!sessionId || event.payload.sessionId !== sessionId) return;
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
  }, [sessionId]);

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

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text && pendingImages.length === 0) return;

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
    for (const img of pendingImages) {
      parts.push({ type: "image", content: img });
    }

    setInput("");
    clearPendingImages();
    setIsInputVisible(false);
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
    if (autoScrollRef.current) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const target =
        el.scrollHeight - el.clientHeight - frozenOffsetFromBottomRef.current;
      el.scrollTop = Math.max(0, target);
    });
  }, [input]);

  const toolCallEntries = Object.values(toolCalls);

  const runningTool = useMemo(() => {
    return toolCallEntries.find((t) => t.status === "started");
  }, [toolCallEntries]);

  const TypingIndicator = () => {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground select-none">
        <div className="font-bold">{runningTool ? runningTool.name : "正在生成"}</div>
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

  const copyMessageMarkdown = useCallback(
    async (msgId: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedMsgId(msgId);
        setTimeout(
          () => setCopiedMsgId((cur) => (cur === msgId ? null : cur)),
          900,
        );
      } catch {
        // ignore
      }
    },
    [setCopiedMsgId],
  );

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
            m.role === "user" ? "flex-row-reverse max-w-[85%]" : "w-full",
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
                ? "rounded-2xl rounded-tr-sm border px-4 py-3 shadow-sm bg-primary text-primary-foreground border-primary/20"
                : "flex-1 pt-1.5",
            )}
          >
            {m.role === "user" ? (
              <div className="flex flex-col gap-3">
                {m.parts.map((p, i) => (
                  <div key={i}>
                    {p.type === "markdown" && (
                      <div className="text-sm font-medium leading-relaxed whitespace-pre-wrap break-words select-text">
                        {p.content}
                      </div>
                    )}
                    {p.type === "image" && (
                      <div className="rounded-xl overflow-hidden border border-white/20 shadow-md">
                        <img
                          src={p.content}
                          alt="User upload"
                          className="max-w-full h-auto object-contain max-h-[400px]"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="relative group">
                {(() => {
                  const raw =
                    m.parts.find((p) => p.type === "markdown")?.type ===
                    "markdown"
                      ? (m.parts.find((p) => p.type === "markdown") as any)
                          .content
                      : "";
                  const isActive = activeAssistantMessageId.current === m.id;
                  const showTyping = isStreaming && isActive && raw.trim() === "";
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => copyMessageMarkdown(m.id, raw)}
                        disabled={!raw || !raw.trim()}
                        className={cn(
                          "absolute -right-2 top-0 h-8 w-8 rounded-xl border border-border/60 bg-background/80 backdrop-blur-sm shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-muted active:scale-90",
                          (!raw || !raw.trim()) &&
                            "opacity-0 pointer-events-none",
                        )}
                        title="复制 Markdown"
                      >
                        {copiedMsgId === m.id ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      {showTyping ? (
                        <div className="py-2">
                          <TypingIndicator />
                        </div>
                      ) : (
                        <RichMarkdown
                          className="leading-relaxed selection:bg-primary/20 select-text"
                          markdown={raw}
                        />
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
  }, [
    messages,
    isStreaming,
    copiedMsgId,
    copyMessageMarkdown,
    runningTool,
  ]);

  const suggestions = [
    "用Python实现斐波拉契数列的计算",
    "用 mermaid 画一个流程图描述TCP三步握手",
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-200">
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
          {/* Wake Button */}
          <div className={cn(
            "absolute right-0 bottom-0 transition-all duration-300 transform origin-bottom-right",
            !isInputVisible ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"
          )}>
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
              isInputVisible ? "scale-100 opacity-100" : "scale-50 opacity-0 pointer-events-none absolute w-full"
            )}
          >
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-1">
                {pendingImages.map((img, idx) => (
                  <div
                    key={idx}
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
              </div>
            )}

            <div className="rounded-2xl border border-border/60 bg-muted/10 p-2 shadow-sm transition-all focus-within:shadow-md focus-within:border-primary/20">
              <div className="relative flex flex-col">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*"
                  multiple
                  className="hidden"
                />
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    freezeAutoScrollWhileTyping();
                    setInput(e.target.value);
                  }}
                  onPaste={handlePaste}
                  placeholder="Message inFlow..."
                  className="min-h-[52px] max-h-[200px] resize-none bg-transparent border-none shadow-none focus-visible:ring-0 rounded-xl pl-4 pr-24 py-3 text-sm font-medium leading-relaxed select-text placeholder:text-muted-foreground/50"
                  onKeyDown={(e) => {
                    freezeAutoScrollWhileTyping();
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

                <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-9 w-9 rounded-xl text-muted-foreground/60 hover:text-primary hover:bg-primary/5 transition-all"
                    title="Upload Image"
                  >
                    <ImageIcon className="w-5 h-5" />
                  </Button>
                  <Button
                    onClick={() => handleSend()}
                    disabled={
                      !currentProviderId ||
                      isStreaming ||
                      (!input.trim() && pendingImages.length === 0)
                    }
                    className={cn(
                      "h-9 w-9 rounded-xl transition-all shadow-md",
                      input.trim() || pendingImages.length > 0
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
