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

// Vditor mode mapping: 'ir'=edit, 'sv'=preview (readonly)
type VditorMode = 'ir' | 'wysiwyg' | 'sv';

function toVditorMode(mode: string): VditorMode {
  const map: Record<string, VditorMode> = {
    'edit': 'ir',
    'preview': 'sv'
  };
  return map[mode] || 'ir';
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
    
    const vditorMode = toVditorMode(config.mode);
    const isReadonly = config.readonly;
    
    const vditor = new Vditor('vditor', {
      value: content,
      mode: vditorMode,
      theme: config.theme === 'dark' ? 'dark' : 'classic',
      height: '100%',
      placeholder: 'Start typing markdown...',
      input: (value: string) => {
        if (!isReadonly) {
          setContent(value);
        }
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
    
    // Set initial readonly state
    if (isReadonly) {
      vditor.disabled();
    }
    
    vditorRef.current = vditor;
    isVditorReady.current = true;
    
    return () => {
      // Safe destroy: just try-catch
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

  // Update mode/readonly when config changes
  useEffect(() => {
    const vditor = vditorRef.current;
    if (!isVditorReady.current || !vditor) return;
    
    try {
      const vditorMode = toVditorMode(config.mode);
      const isReadonly = config.readonly;
      
      // Recreate editor with new mode
      vditor.destroy();
      vditorRef.current = new Vditor('vditor', {
        value: content,
        mode: vditorMode,
        theme: config.theme === 'dark' ? 'dark' : 'classic',
        height: '100%',
        input: (value: string) => {
          if (!isReadonly) {
            setContent(value);
          }
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
      
      // Apply readonly state
      if (isReadonly) {
        vditorRef.current.disabled();
      }
      isVditorReady.current = true;
    } catch (e) {
      console.warn('Vditor mode change failed:', e);
    }
  }, [config.mode, config.readonly, config.theme, content, setContent]);

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
      const value = vditorRef.current?.getValue() || '';
      const chars = value.length;
      const words = value.trim() ? value.trim().split(/\s+/).length : 0;
      const lines = value.split('\n').length;
      return { chars, words, lines };
    },
  }), []);
  
  return (
    <div 
      ref={containerRef} 
      id="vditor"
      className={`vditor-container ${className}`}
      style={{ height: '100%', minHeight: '300px' }}
    />
  );
});
