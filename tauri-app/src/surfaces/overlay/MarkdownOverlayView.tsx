import { useEffect, useState, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { X, Minus, Square, Maximize2, Pin, PinOff } from 'lucide-react';
import { getAppConfig, AppConfig, updateAppConfig } from '../../integrations/tauri/api';
import { useInvocationStore } from '../../stores/invocationStore';
import { useMarkdownStore } from '../../stores/markdownStore';
import { VditorEditor } from '../../components/markdown/VditorEditor';
import { MarkdownToolbar } from '../../components/markdown/MarkdownToolbar';
import { MarkdownTabBar } from '../../components/markdown/MarkdownTabBar';
import { MarkdownStatusBar } from '../../components/markdown/MarkdownStatusBar';

export function MarkdownOverlayView() {
  const currentInvocation = useInvocationStore((state) => state.currentInvocation);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  
  const configRef = useRef<AppConfig | null>(null);
  
  const { tabs, addTab, loadFile, setConfig: setMarkdownConfig } = useMarkdownStore();
  
  // Load initial config
  useEffect(() => {
    loadConfig();
    initWindowState();
  }, []);
  
  // Listen for config changes from other windows
  useEffect(() => {
    const unlistenConfig = listen<AppConfig>('app-config-changed', (event) => {
      configRef.current = event.payload;
    });
    
    return () => {
      unlistenConfig.then(f => f());
    };
  }, []);
  
  // Listen for deep link or external file open
  useEffect(() => {
    const unlistenFile = listen<{ path: string; content: string }>('markdown-file-open', (event) => {
      const { path, content } = event.payload;
      loadFile(path, content);
    });
    
    return () => {
      unlistenFile.then(f => f());
    };
  }, [loadFile]);
  
  // Process invocation args
  useEffect(() => {
    if (currentInvocation?.args) {
      const args = currentInvocation.args;
      const mode = args.mode as string | undefined;
      const file = args.file as string | undefined;
      const content = args.content as string | undefined;
      const action = args.action as string | undefined;
      
      if (action === 'new') {
        addTab({ title: 'Untitled', content: '' });
      } else if (file && content) {
        loadFile(file, content);
      }
      
      if (mode) {
        setMarkdownConfig({ mode: mode as 'edit' | 'preview' | 'wysiwym' });
      }
    }
  }, [currentInvocation, addTab, loadFile, setMarkdownConfig]);
  
  const loadConfig = async () => {
    try {
      const data = await getAppConfig();
      configRef.current = data;
      
      // Load markdown config if exists
      if (data.markdownEditorTheme) {
        setMarkdownConfig({ theme: data.markdownEditorTheme as 'light' | 'dark' });
      }
      if (data.markdownEditorFontSize) {
        setMarkdownConfig({ fontSize: data.markdownEditorFontSize });
      }
      if (data.markdownEditorAutoSave !== undefined && data.markdownEditorAutoSave !== null) {
        setMarkdownConfig({ autoSave: data.markdownEditorAutoSave });
      }
      if (data.markdownEditorRecentFiles) {
        setMarkdownConfig({ recentFiles: data.markdownEditorRecentFiles });
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };
  
  const initWindowState = async () => {
    const win = getCurrentWindow();
    try {
      const maximized = await win.isMaximized();
      setIsMaximized(maximized);
      const pinned = await win.isAlwaysOnTop();
      setIsPinned(pinned);
    } catch (err) {
      console.error('Failed to get window state:', err);
    }
  };
  
  const handleMinimize = async () => {
    const win = getCurrentWindow();
    await win.minimize();
  };
  
  const handleMaximize = async () => {
    const win = getCurrentWindow();
    await win.toggleMaximize();
    const maximized = await win.isMaximized();
    setIsMaximized(maximized);
  };
  
  const handleClose = async () => {
    const win = getCurrentWindow();
    await win.close();
  };
  
  const handleTogglePin = async () => {
    const win = getCurrentWindow();
    const newPinned = !isPinned;
    await win.setAlwaysOnTop(newPinned);
    setIsPinned(newPinned);
  };
  
  // Save only markdown config when tabs change - debounced
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const saveMarkdownConfig = async () => {
    const markdownConfig = useMarkdownStore.getState().config;
    try {
      // Get current full config and only update markdown fields
      const currentConfig = await getAppConfig();
      await updateAppConfig({
        ...currentConfig,
        markdownEditorTheme: markdownConfig.theme,
        markdownEditorFontSize: markdownConfig.fontSize,
        markdownEditorAutoSave: markdownConfig.autoSave,
        markdownEditorRecentFiles: markdownConfig.recentFiles,
      });
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };
  
  // Watch for tab content changes and debounce save
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveMarkdownConfig();
    }, 2000);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [tabs]); // Only trigger on tab changes, not on config changes
  
  const hasOpenTabs = tabs.length > 0;
  
  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Custom title bar for Overlay */}
      <div 
        data-tauri-drag-region
        className="flex items-center justify-between h-8 px-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <span className="text-sm font-medium" data-tauri-drag-region>Markdown Editor</span>
        </div>
        
        <div className="flex items-center">
          {/* Pin toggle */}
          <button
            className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${isPinned ? 'text-blue-500' : 'text-gray-500'}`}
            onClick={handleTogglePin}
            title={isPinned ? 'Unpin window' : 'Pin window always on top'}
          >
            {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          
          {/* Window controls */}
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
            onClick={handleMinimize}
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
            onClick={handleMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Square size={12} /> : <Maximize2 size={14} />}
          </button>
          <button
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-gray-500 hover:text-red-500"
            onClick={handleClose}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      
      {/* Tab bar */}
      <MarkdownTabBar />
      
      {/* Toolbar */}
      <MarkdownToolbar />
      
      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {hasOpenTabs ? (
          <VditorEditor />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <p className="mb-4">No file open</p>
            <p className="text-sm">Use the toolbar to create a new file or open an existing one</p>
          </div>
        )}
      </div>
      
      {/* Status bar */}
      <MarkdownStatusBar />
    </div>
  );
}
