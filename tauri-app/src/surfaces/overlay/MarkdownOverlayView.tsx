import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getAppConfig, AppConfig, updateAppConfig } from '../../integrations/tauri/api';
import { useInvocationStore } from '../../stores/invocationStore';
import { useMarkdownStore } from '../../stores/markdownStore';
import { VditorEditor, VditorEditorRef } from '../../components/markdown/VditorEditor';
import { MarkdownToolbar } from '../../components/markdown/MarkdownToolbar';
import { MarkdownTabBar } from '../../components/markdown/MarkdownTabBar';
import { MarkdownStatusBar } from '../../components/markdown/MarkdownStatusBar';

export function MarkdownOverlayView() {
  const currentInvocation = useInvocationStore((state) => state.currentInvocation);
  
  const configRef = useRef<AppConfig | null>(null);
  const vditorRef = useRef<VditorEditorRef>(null);
  
  const { tabs, addTab, loadFile, setConfig: setMarkdownConfig } = useMarkdownStore();
  
  // Load initial config
  useEffect(() => {
    loadConfig();
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
      const file = args.file as string | undefined;
      const content = args.content as string | undefined;
      const action = args.action as string | undefined;
      
      if (action === 'new') {
        addTab({ title: 'Untitled', content: '' });
      } else if (file && content) {
        loadFile(file, content);
      }
    }
  }, [currentInvocation, addTab, loadFile]);
  
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
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Tab bar */}
      <MarkdownTabBar className="shrink-0" />
      
      {/* Toolbar */}
      <MarkdownToolbar
        className="shrink-0"
        onInsertValue={(value) => vditorRef.current?.insertValue(value)}
      />
      
      {/* Editor area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {hasOpenTabs ? (
          <VditorEditor ref={vditorRef} className="min-h-0" />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <p className="mb-4">No file open</p>
            <p className="text-sm">Use the toolbar to create a new file or open an existing one</p>
          </div>
        )}
      </div>
      
      {/* Status bar */}
      <MarkdownStatusBar className="shrink-0" />
    </div>
  );
}
