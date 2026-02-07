import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Send, Loader2 } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { buildV2DeepLink } from '../../integrations/tauri/api';
import { useInvocationStore } from '../../stores/invocationStore';
import { cn } from '../../lib/cn';
import './ActionPredictView.css';

interface PredictedAction {
  label: string;
  prompt: string;
}

export function ActionPredictView() {
  const currentInvocation = useInvocationStore((s) => s.currentInvocation);
  const [inputText, setInputText] = useState('');
  const [predictions, setPredictions] = useState<PredictedAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastInvocationIdRef = useRef<string | null>(null);

  // 初始化：填入传入的文本并获取预测
  useEffect(() => {
    if (currentInvocation?.capabilityId !== 'action.predict') return;
    if (!currentInvocation.id) return;
    if (lastInvocationIdRef.current === currentInvocation.id) return;

    const text =
      currentInvocation?.context?.selectedText ||
      (currentInvocation?.args as Record<string, unknown>)?.text as string ||
      '';

    if (text && text.trim()) {
      setInputText(text);
      fetchPredictions(text);
    }

    lastInvocationIdRef.current = currentInvocation.id;

    // 聚焦输入框
    queueMicrotask(() => inputRef.current?.focus());
  }, [currentInvocation]);

  // LLM 预测动作
  const fetchPredictions = useCallback(async (text: string) => {
    if (!text.trim()) return;

    setIsLoading(true);

    try {
      const actions = await invoke<PredictedAction[]>('predict_actions', { text });
      setPredictions(actions);
    } catch (err: unknown) {
      console.error('Failed to predict actions:', err);
      // 提供默认预测
      setPredictions([
        { label: '翻译成中文', prompt: '请将以下内容翻译成中文：\n\n{text}' },
        { label: '总结要点', prompt: '请总结以下内容的要点：\n\n{text}' },
        { label: '解释说明', prompt: '请解释以下内容：\n\n{text}' },
        { label: '改写润色', prompt: '请帮我改写润色以下内容：\n\n{text}' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 发送到 Chat Overlay
  const handleSend = useCallback(async (promptTemplate: string) => {
    const finalPrompt = promptTemplate.replace('{text}', inputText);
    const url = buildV2DeepLink({
      requestVersion: 'v2',
      capabilityId: 'chat.overlay',
      context: {
        selectedText: finalPrompt,
      },
      ui: {
        mode: 'chat',
        autoSend: true,
      },
      source: 'internal',
    });

    try {
      // 通过后端命令直接处理深度链接，绕过 opener 插件的权限限制
      await invoke('handle_deep_link_from_frontend', { url });

      // 自动隐藏当前窗口
      await getCurrentWindow().hide();
    } catch (err) {
      console.error('Failed to open chat overlay:', err);
    }
  }, [inputText]);

  // 直接发送输入文本
  const handleDirectSend = useCallback(() => {
    if (inputText.trim()) {
      handleSend(inputText);
    }
  }, [inputText, handleSend]);

  const handleClose = async () => {
    await getCurrentWindow().hide();
  };

  const handleDrag = async (e: React.MouseEvent) => {
    if (e.detail > 1) return;
    if (e.button === 0) {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'BUTTON' && !target.closest('button') && !target.closest('textarea')) {
        try {
          await getCurrentWindow().startDragging();
        } catch (err) {
          console.error('Failed to start dragging:', err);
        }
      }
    }
  };

  return (
    <div className="action-predict-container" onMouseDown={handleDrag}>
      {/* 主内容区域 */}
      <div className="action-predict-content">
        {/* 输入区域 */}
        <div className="input-container">
          <Textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="输入文本内容..."
            className="input-textarea"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleClose();
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleDirectSend();
              }
            }}
          />
          <Button
            onClick={handleDirectSend}
            disabled={!inputText.trim()}
            className={cn(
              'floating-send-btn',
              inputText.trim() ? 'floating-send-btn-active' : 'floating-send-btn-disabled'
            )}
            title="发送 (Ctrl+Enter)"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        {/* 预测动作按钮 */}
        <div className="predictions-list">
          {isLoading ? (
            <div className="predictions-loading">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            predictions.map((action, index) => (
              <button
                key={index}
                className="prediction-chip"
                onClick={() => handleSend(action.prompt)}
                disabled={!inputText.trim()}
              >
                {action.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
