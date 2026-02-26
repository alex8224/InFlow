import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
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
  
  const { 
    tabs, 
    activeTabId, 
    config,
    setContent,
  } = useMarkdownStore();
  
  const activeTab = tabs.find(t => t.id === activeTabId);
  const content = activeTab?.content || '';

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
  
  // Initialize Vditor
  useEffect(() => {
    if (!containerRef.current) return;
    
    const vditor = new Vditor('vditor', {
      value: content,
      mode: 'ir',
      theme: config.theme === 'dark' ? 'dark' : 'classic',
      height: '100%',
      // @ts-expect-error - bottom is a valid Vditor option not in types
      bottom: 32,
      placeholder: 'Start typing markdown...',
      input: (value: string) => {
        lastEditorValueRef.current = value;
        setContent(value);
      },
      toolbar: [],
      outline: { enable: false, position: 'right' },
      preview: {
        mode: 'editor',
        parse: (element: HTMLElement) => {
          const anyVditor = Vditor as any;
          const fn = anyVditor?.mermaidRender;
          if (typeof fn !== 'function') return;
          try {
            fn(element, undefined, config.theme === 'dark' ? 'dark' : 'classic');
          } catch {
            // ignore
          }
        },
        markdown: {
          toc: true,
        }
      },
    });
    
    vditorRef.current = vditor;
    isVditorReady.current = true;
    lastEditorValueRef.current = content;
    
    return () => {
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
  }, []);
  
  // Update content when tab changes
  useEffect(() => {
    const vditor = vditorRef.current;
    if (!isVditorReady.current || !vditor) return;
    
    try {
      // Avoid calling getValue() here: after a hot-reload or destroy it may throw.
      // Track the last value emitted by the editor and only push content when it
      // differs (e.g. tab/file load).
      if (content === lastEditorValueRef.current) return;
      vditor.setValue(content);
      lastEditorValueRef.current = content;
    } catch (e) {
      console.warn('Vditor getValue failed:', e);
    }
  }, [activeTabId, content]);
  
  // Update theme
  useEffect(() => {
    const vditor = vditorRef.current;
    if (!isVditorReady.current || !vditor) return;
    
    try {
      vditor.setTheme(config.theme === 'dark' ? 'dark' : 'classic');
      renderMermaidInPreview(config.theme);
    } catch (e) {
      console.warn('Vditor theme change failed:', e);
    }
  }, [config.theme]);
  
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
      id="vditor" 
      ref={containerRef}
      className={className}
      style={{ height: '100%', minHeight: 0 }}
    />
  );
});
