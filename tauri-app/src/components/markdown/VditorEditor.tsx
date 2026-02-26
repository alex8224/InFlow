import { useEffect, useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { useMarkdownStore } from '../../stores/markdownStore';

export interface VditorEditorRef {
  focus: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  insertValue: (value: string) => void;
  getStats: () => { chars: number; words: number; lines: number };
}

interface VditorEditorProps {
  className?: string;
}

export const VditorEditor = forwardRef<VditorEditorRef, VditorEditorProps>(function VditorEditor(props, ref) {
  const { className = '' } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const vditorRef = useRef<Vditor | null>(null);
  const isVditorReady = useRef(false);
  const lastEditorValueRef = useRef<string>('');
  const currentModeRef = useRef<'ir' | 'sv'>('ir');
  const currentLargeRef = useRef(false);
  const currentOutlineRef = useRef(false);

  // Large markdown optimization: Vditor's IR/WYSIWYG modes maintain a large editable DOM,
  // which becomes very slow for big documents. We downgrade to `sv` (source mode) and
  // disable the heaviest preview features when the document is large.
  const LARGE_DOC_CHAR_THRESHOLD = 200_000;
  
  const activeTabId = useMarkdownStore((state) => state.activeTabId);
  const theme = useMarkdownStore((state) => state.config.theme);
  const outlineEnabled = useMarkdownStore((state) => state.config.outlineEnabled);
  const setContent = useMarkdownStore((state) => state.setContent);

  const activeContent = useMemo(() => {
    const state = useMarkdownStore.getState();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return tab?.content || '';
  }, [activeTabId]);

  const isLargeDoc = activeContent.length > LARGE_DOC_CHAR_THRESHOLD;

  const getVditorValueSafe = (): string => {
    const v = vditorRef.current;
    if (!v) return '';
    try {
      return v.getValue() || '';
    } catch {
      return '';
    }
  };

  const renderMermaidInPreview = (theme: 'light' | 'dark') => {
    const host = containerRef.current;
    if (!host) return;

    // Only render inside the preview container.
    // Rendering mermaid over the whole Vditor host can touch editable DOM and
    // make the editor hard to focus/edit.
    const previewEl =
      (host.querySelector('.vditor-preview') as HTMLElement | null) ||
      (host.querySelector('.vditor-preview__content') as HTMLElement | null);
    if (!previewEl) return;

    const anyVditor = Vditor as any;
    const fn = anyVditor?.mermaidRender;
    if (typeof fn !== 'function') return;

    try {
      fn(previewEl, undefined, theme === 'dark' ? 'dark' : 'classic');
    } catch {
      // ignore
    }
  };
  
  const destroyVditor = () => {
    try {
      if (vditorRef.current) {
        vditorRef.current.destroy();
      }
    } catch (e) {
      console.warn('Vditor destroy failed:', e);
    }
    vditorRef.current = null;
    isVditorReady.current = false;
  };

  const createVditor = (value: string, mode: 'ir' | 'sv', largeDoc: boolean, enableOutline: boolean) => {
    const host = containerRef.current;
    if (!host) return;

    // Vditor accepts either an element id or the element itself.
    const vditor = new Vditor(host, {
      value,
      mode,
      theme: theme === 'dark' ? 'dark' : 'classic',
      height: '100%',
      // @ts-expect-error - bottom is a valid Vditor option not in types
      bottom: 32,
      placeholder: 'Start typing markdown...',
      toolbar: [],
      outline: { enable: enableOutline, position: 'right' },
      // Avoid localStorage cache: it can restore stale content and adds overhead.
      cache: { enable: false },
      input: (nextValue: string) => {
        lastEditorValueRef.current = nextValue;
        setContent(nextValue);
      },
      preview: largeDoc
        ? {
            // Keep the editor responsive.
            mode: 'editor',
            delay: 2500,
            hljs: { enable: false },
            render: { media: { enable: false } },
            markdown: {
              toc: false,
              codeBlockPreview: false,
              mathBlockPreview: false,
            },
          }
        : {
            mode: 'editor',
            // Mermaid rendering can be heavy; keep it only for small docs.
            parse: (element: HTMLElement) => {
              const anyVditor = Vditor as any;
              const fn = anyVditor?.mermaidRender;
              if (typeof fn !== 'function') return;
              try {
                fn(element, undefined, theme === 'dark' ? 'dark' : 'classic');
              } catch {
                // ignore
              }
            },
            markdown: {
              toc: true,
            },
          },
    });

    vditorRef.current = vditor;
    isVditorReady.current = true;
    lastEditorValueRef.current = value;
    currentModeRef.current = mode;
    currentLargeRef.current = largeDoc;
    currentOutlineRef.current = enableOutline;
  };

  // (Re)create Vditor when switching between small/large docs.
  useEffect(() => {
    if (!containerRef.current) return;

    const desiredMode: 'ir' | 'sv' = isLargeDoc ? 'sv' : 'ir';
    const desiredOutlineEnabled = outlineEnabled && !isLargeDoc;
    const needsRecreate =
      !vditorRef.current ||
      !isVditorReady.current ||
      desiredMode !== currentModeRef.current ||
      isLargeDoc !== currentLargeRef.current ||
      desiredOutlineEnabled !== currentOutlineRef.current;

    if (needsRecreate) {
      destroyVditor();
      const initialValue = isLargeDoc ? '' : activeContent;
      createVditor(initialValue, desiredMode, isLargeDoc, desiredOutlineEnabled);

      // Applying a very large document can block the UI thread. Defer it so the
      // loading overlay can paint first.
      if (isLargeDoc && activeContent) {
        const state = useMarkdownStore.getState();
        if (!state.isLoading) {
          state.setLoading(true);
        }
        if (state.loadingInfo?.stage !== 'rendering') {
          // Preserve any sizeBytes already collected.
          const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
          const path = activeTab?.filePath || state.loadingInfo?.path || 'large document';
          state.setLoadingInfo({
            path,
            sizeBytes: state.loadingInfo?.sizeBytes ?? null,
            stage: 'rendering',
          });
        }

        requestAnimationFrame(() => {
          setTimeout(() => {
            try {
              vditorRef.current?.setValue(activeContent);
              lastEditorValueRef.current = activeContent;
            } catch (e) {
              console.warn('Vditor setValue failed:', e);
            }
            const s = useMarkdownStore.getState();
            s.setLoading(false);
            s.setLoadingInfo(null);
          }, 0);
        });
      }
      return;
    }

    // When only the tab changes, push the new content once.
    try {
      if (activeContent !== lastEditorValueRef.current) {
        vditorRef.current?.setValue(activeContent);
        lastEditorValueRef.current = activeContent;
      }
    } catch (e) {
      console.warn('Vditor setValue failed:', e);
    }
  }, [activeTabId, isLargeDoc, outlineEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyVditor();
    };
  }, []);
  
  // Update theme
  useEffect(() => {
    const vditor = vditorRef.current;
    if (!isVditorReady.current || !vditor) return;
    
    try {
      vditor.setTheme(theme === 'dark' ? 'dark' : 'classic');
      if (!currentLargeRef.current) {
        renderMermaidInPreview(theme);
      }
    } catch (e) {
      console.warn('Vditor theme change failed:', e);
    }
  }, [theme]);
  
  // Expose methods for external control via ref
  useImperativeHandle(ref, () => ({
    focus: () => {
      vditorRef.current?.focus();
    },
    getValue: () => {
      return getVditorValueSafe();
    },
    setValue: (value: string) => {
      lastEditorValueRef.current = value;
      vditorRef.current?.setValue(value);
    },
    insertValue: (value: string) => {
      vditorRef.current?.insertValue(value);
    },
    getStats: () => {
      const vditor = vditorRef.current;
      if (!vditor) return { chars: 0, words: 0, lines: 0 };
      
      try {
        const text = getVditorValueSafe();
        const chars = text.length;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const lines = text.split('\n').length;
        return { chars, words, lines };
      } catch (e) {
        return { chars: 0, words: 0, lines: 0 };
      }
    },
  }), []);
  
  return (
    <div 
      ref={containerRef}
      className={className}
      style={{ height: '100%', minHeight: 0 }}
    />
  );
});
