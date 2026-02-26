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
  
  const { 
    tabs, 
    activeTabId, 
    config,
    setContent,
  } = useMarkdownStore();
  
  const activeTab = tabs.find(t => t.id === activeTabId);
  const content = activeTab?.content || '';
  
  // Initialize Vditor
  useEffect(() => {
    if (!containerRef.current) return;
    
    const vditor = new Vditor('vditor', {
      value: content,
      mode: 'ir',
      theme: config.theme === 'dark' ? 'dark' : 'classic',
      height: '100%',
      placeholder: 'Start typing markdown...',
      input: (value: string) => {
        setContent(value);
      },
      toolbar: [],
      outline: { enable: false, position: 'right' },
      preview: {
        mode: 'editor',
        markdown: {
          toc: true,
        }
      },
    });
    
    vditorRef.current = vditor;
    isVditorReady.current = true;
    
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
      const currentValue = vditor.getValue();
      if (currentValue !== content) {
        vditor.setValue(content);
      }
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
      return vditorRef.current?.getValue() || '';
    },
    setValue: (value: string) => {
      vditorRef.current?.setValue(value);
    },
    insertValue: (value: string) => {
      vditorRef.current?.insertValue(value);
    },
    getStats: () => {
      const vditor = vditorRef.current;
      if (!vditor) return { chars: 0, words: 0, lines: 0 };
      
      try {
        const text = vditor.getValue();
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
      style={{ height: '100%' }}
    />
  );
});
