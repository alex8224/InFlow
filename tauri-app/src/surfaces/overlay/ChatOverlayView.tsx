import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Bot, Check, ChevronDown, ChevronRight, Copy, Send, Wrench } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../lib/cn';
import { chatSessionCreate, chatStream, getClipboardText } from '../../integrations/tauri/api';
import { useChatStore } from '../../stores/chatStore';
import { useInvocationStore } from '../../stores/invocationStore';
import { RichMarkdown } from '../../components/blocks/RichMarkdown';

type ChatTokenEvent = { sessionId: string; delta: string };
type ChatEndEvent = { sessionId: string };
type ChatErrorEvent = { sessionId: string; message: string };
type ChatToolCallEvent = { sessionId: string; callId: string; name: string; arguments: unknown; status: 'started' | 'done' | 'error' };
type ChatToolResultEvent = { sessionId: string; callId: string; content: unknown };

export function ChatOverlayView() {
  const currentInvocation = useInvocationStore((s) => s.currentInvocation);
  const {
    sessionId,
    sessionProviderId,
    isStreaming,
    messages,
    toolCalls,
    input,
    setSession,
    setInput,
    appendUserMessage,
    startAssistantMessage,
    appendAssistantToken,
    setStreaming,
    upsertToolCall,
    setToolResult,
  } = useChatStore();
  const activeAssistantMessageId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoScrollRef = useRef(true);
  const [toolPanelOpen, setToolPanelOpen] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const lastPrefillInvocationIdRef = useRef<string | null>(null);

  const leakModeRef = useRef(false);
  const leakPendingRef = useRef('');

  // Debug: log streamed deltas in the webview console.
  // Enable by running in devtools: localStorage.setItem('inflow.debug.chatStream','1')
  // Optional verbose mode: localStorage.setItem('inflow.debug.chatStreamVerbose','1')
  const debugStreamRef = useRef(false);
  const debugVerboseRef = useRef(false);
  const debugBufRef = useRef('');
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
      debugStreamRef.current = localStorage.getItem('inflow.debug.chatStream') === '1';
      debugVerboseRef.current = localStorage.getItem('inflow.debug.chatStreamVerbose') === '1';
    } catch {
      debugStreamRef.current = false;
      debugVerboseRef.current = false;
    }

    const flushDebug = (force = false) => {
      if (!debugStreamRef.current) return;
      const buf = debugBufRef.current;
      if (!buf) return;
      const now = Date.now();
      if (!force && now - debugLastFlushRef.current < 200 && buf.length < 200) return;
      debugLastFlushRef.current = now;
      debugBufRef.current = '';

      const run = debugRunRef.current;
      const t = run ? Math.round(performance.now() - run.startPerfMs) : null;
      if (run && t !== null) {
        console.log(`[chat][token][${run.runId}] +${t}ms`, buf);
      } else {
        console.log('[chat-token]', buf);
      }
    };

    const onToken = listen<ChatTokenEvent>('chat-token', (event) => {
      if (!sessionId || event.payload.sessionId !== sessionId) return;
      const msgId = activeAssistantMessageId.current;
      if (!msgId) return;

      const startTag = '<system-reminder>';
      const endTag = '</system-reminder>';

      const keepTail = (text: string, tag: string) => {
        const max = Math.min(text.length, tag.length - 1);
        for (let len = max; len > 0; len--) {
          if (tag.startsWith(text.slice(-len))) return text.slice(-len);
        }
        return '';
      };

      const filterLeak = (delta: string) => {
        let text = leakPendingRef.current + delta;
        leakPendingRef.current = '';
        let out = '';
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
            console.log(`[chat][first-token][${run.runId}] delay=${delay}ms at=${new Date().toISOString()}`);
          }
        }

        debugBufRef.current += safeDelta;
        flushDebug(false);

        if (debugVerboseRef.current) {
          const runId = debugRunRef.current?.runId ?? 'unknown';
          const t = debugRunRef.current ? Math.round(performance.now() - debugRunRef.current.startPerfMs) : null;
          console.log(`[chat][delta][${runId}] +${t ?? '?'}ms`, safeDelta);
        }
      }

      if (autoScrollRef.current && listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });

    const onToolCall = listen<ChatToolCallEvent>('chat-toolcall', (event) => {
      if (!sessionId || event.payload.sessionId !== sessionId) return;

      if (debugStreamRef.current) {
        const run = debugRunRef.current;
        if (run && run.toolFirstPerfMs === null && event.payload.status === 'started') {
          run.toolFirstPerfMs = performance.now();
          const delay = Math.round(run.toolFirstPerfMs - run.startPerfMs);
          console.log(
            `[chat][first-tool][${run.runId}] delay=${delay}ms name=${event.payload.name} callId=${event.payload.callId}`
          );
        }
        if (debugVerboseRef.current) {
          const runId = run?.runId ?? 'unknown';
          const t = run ? Math.round(performance.now() - run.startPerfMs) : null;
          console.log(
            `[chat][toolcall][${runId}] +${t ?? '?'}ms status=${event.payload.status} name=${event.payload.name} callId=${event.payload.callId}`,
            event.payload.arguments
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

    const onToolResult = listen<ChatToolResultEvent>('chat-toolresult', (event) => {
      if (!sessionId || event.payload.sessionId !== sessionId) return;

      if (debugStreamRef.current && debugVerboseRef.current) {
        const run = debugRunRef.current;
        const runId = run?.runId ?? 'unknown';
        const t = run ? Math.round(performance.now() - run.startPerfMs) : null;
        console.log(`[chat][toolresult][${runId}] +${t ?? '?'}ms callId=${event.payload.callId}`, event.payload.content);
      }
      setToolResult(event.payload.callId, event.payload.content);
    });

    const onEnd = listen<ChatEndEvent>('chat-end', (event) => {
      if (!sessionId || event.payload.sessionId !== sessionId) return;
      setStreaming(false);
      activeAssistantMessageId.current = null;
      flushDebug(true);
      if (debugStreamRef.current) {
        const run = debugRunRef.current;
        if (run) {
          const endedAtIso = new Date().toISOString();
          const total = Math.round(performance.now() - run.startPerfMs);
          const first = run.firstTokenPerfMs === null ? null : Math.round(run.firstTokenPerfMs - run.startPerfMs);
          const firstTool = run.toolFirstPerfMs === null ? null : Math.round(run.toolFirstPerfMs - run.startPerfMs);
          console.log(
            `[chat][end][${run.runId}] total=${total}ms firstToken=${first ?? 'n/a'}ms firstTool=${firstTool ?? 'n/a'}ms tokens=${run.tokenEvents} chars=${run.charCount} startedAt=${run.startedAtIso} endedAt=${endedAtIso}`
          );
        } else {
          console.log('[chat-end]');
        }
      }
    });

    const onError = listen<ChatErrorEvent>('chat-error', (event) => {
      if (!sessionId || event.payload.sessionId !== sessionId) return;
      setStreaming(false);
      activeAssistantMessageId.current = null;
      flushDebug(true);
      if (debugStreamRef.current) {
        const run = debugRunRef.current;
        const endedAtIso = new Date().toISOString();
        const total = run ? Math.round(performance.now() - run.startPerfMs) : null;
        console.log(
          `[chat][error][${run?.runId ?? 'unknown'}] total=${total ?? 'n/a'}ms startedAt=${run?.startedAtIso ?? 'n/a'} endedAt=${endedAtIso}`,
          event.payload.message
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
    const prefillFromClipboard = async () => {
      if (currentInvocation?.capabilityId !== 'chat.overlay') return;
      if (!currentInvocation.id) return;
      if (lastPrefillInvocationIdRef.current === currentInvocation.id) return;

      // Only prefill when the composer is empty to avoid overwriting user input.
      if (input.trim()) return;

      let text = currentInvocation.context?.selectedText ?? currentInvocation.context?.clipboardText;
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
    leakPendingRef.current = '';
  }, [sessionId]);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text) return;

    if (!currentProviderId) {
      const msgId = startAssistantMessage();
      appendAssistantToken(msgId, '请先在顶部选择模型。');
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
        appendAssistantToken(msgId, `\n\n[error] ${err?.message || String(err)}`);
        return;
      }
    }

    setInput('');
    appendUserMessage(text);
    const assistantId = startAssistantMessage();
    activeAssistantMessageId.current = assistantId;
    setStreaming(true);

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

      const base = { runId, at: startedAtIso, sessionId: sid, providerId: currentProviderId, chars: text.length };
      if (debugVerboseRef.current) {
        console.log('[chat][start]', { ...base, text });
      } else {
        console.log('[chat][start]', base);
      }
    }

    try {
      await chatStream(sid, currentProviderId, text);
    } catch (err: any) {
      setStreaming(false);
      activeAssistantMessageId.current = null;
      const msgId = startAssistantMessage();
      appendAssistantToken(msgId, `\n\n[error] ${err?.message || String(err)}`);
    }
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    autoScrollRef.current = isAtBottom;
  };

  const toolCallEntries = Object.values(toolCalls);

  const isAnyToolRunning = toolCallEntries.some((t) => t.status === 'started');

  const TypingIndicator = () => {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground select-none">
        <div className="font-bold">正在生成</div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: '0ms' }} />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: '160ms' }} />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: '320ms' }} />
        </div>
        {isAnyToolRunning && <div className="text-[10px] font-black uppercase tracking-widest opacity-70">tools</div>}
      </div>
    );
  };

  const copyMessageMarkdown = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId((cur) => (cur === msgId ? null : cur)), 900);
    } catch {
      // ignore
    }
  };

  const suggestions = [
    '把这个需求拆成开发任务清单，并给出优先级。',
    '把我的输入总结成 5 条要点。',
    '用 mermaid 画一个流程图描述这个过程。',
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-200">
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-auto rounded-2xl border border-border/50 bg-background/80 p-4 custom-scrollbar select-text"
        >
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center text-muted-foreground/40 gap-3 py-10">
                <div className="p-4 bg-muted/30 rounded-full shadow-inner">
                  <Bot className="w-8 h-8" />
                </div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em]">Start a conversation</div>
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

            {messages.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[min(720px,90%)] rounded-2xl border px-4 py-3 shadow-sm select-text',
                    m.role === 'user'
                      ? 'bg-foreground text-background border-foreground/10'
                      : 'bg-background/70 text-foreground border-border/60'
                  )}
                >
                  {m.role === 'user' ? (
                    <div className="text-sm font-semibold leading-relaxed whitespace-pre-wrap break-words text-background/95 select-text">
                      {m.parts.find((p) => p.type === 'markdown')?.type === 'markdown'
                        ? (m.parts.find((p) => p.type === 'markdown') as any).content
                        : ''}
                    </div>
                  ) : (
                    <div className="group relative">
                      {(() => {
                        const raw =
                          m.parts.find((p) => p.type === 'markdown')?.type === 'markdown'
                            ? (m.parts.find((p) => p.type === 'markdown') as any).content
                            : '';
                        const isActive = activeAssistantMessageId.current === m.id;
                        const showTyping = isStreaming && isActive && raw.trim() === '';
                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => copyMessageMarkdown(m.id, raw)}
                              disabled={!raw || !raw.trim()}
                              className={cn(
                                'absolute right-0 top-0 -translate-y-1/2 translate-x-1/2 h-8 w-8 rounded-xl border border-border/60 bg-background/80 backdrop-blur-sm shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity',
                                (!raw || !raw.trim()) && 'opacity-0 pointer-events-none'
                              )}
                              title="复制 Markdown"
                            >
                              {copiedMsgId === m.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                            {showTyping ? (
                              <div className="py-2">
                                <TypingIndicator />
                              </div>
                            ) : (
                              <RichMarkdown className="leading-relaxed selection:bg-primary/20 select-text" markdown={raw} />
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {toolCallEntries.length > 0 && (
          <div className="shrink-0 rounded-2xl border border-border/50 bg-muted/10">
            <button
              type="button"
              onClick={() => setToolPanelOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-muted-foreground" />
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Tool Calls ({toolCallEntries.length})
                </div>
              </div>
              {toolPanelOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {toolPanelOpen && (
              <div className="px-3 pb-3">
                <div className="space-y-2 max-h-[160px] overflow-auto custom-scrollbar pr-1">
                  {toolCallEntries.map((c) => (
                    <div key={c.callId} className="rounded-xl border border-border/50 bg-background/60 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-xs truncate">{c.name}</div>
                        <div
                          className={cn(
                            'text-[9px] font-black uppercase tracking-widest',
                            c.status === 'started'
                              ? 'text-amber-600'
                              : c.status === 'done'
                                ? 'text-green-600'
                                : 'text-destructive'
                          )}
                        >
                          {c.status}
                        </div>
                      </div>
                      <pre className="mt-2 text-[10px] leading-relaxed bg-muted/30 rounded-lg p-2 overflow-auto">
                        <code>{JSON.stringify(c.arguments, null, 2)}</code>
                      </pre>
                      {c.result !== undefined && (
                        <pre className="mt-2 text-[10px] leading-relaxed bg-muted/30 rounded-lg p-2 overflow-auto">
                          <code>{typeof c.result === 'string' ? c.result : JSON.stringify(c.result, null, 2)}</code>
                        </pre>
                      )}
                      {c.error && (
                        <div className="mt-2 text-[10px] font-bold text-destructive">{c.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="shrink-0 rounded-2xl border border-border/50 bg-muted/20 p-2">
          <div className="relative">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入消息…"
              className="min-h-[52px] max-h-[180px] resize-none bg-background border-border/50 rounded-xl pl-4 pr-14 py-3 text-sm leading-relaxed select-text"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />

            <Button
              onClick={() => handleSend()}
              disabled={!currentProviderId || isStreaming || !input.trim()}
              className="absolute right-2 bottom-2 h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
              title="发送 (Enter)\n换行 (Ctrl+Enter)"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
