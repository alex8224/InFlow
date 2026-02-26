import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getAppConfig, AppConfig, updateAppConfig } from '../../integrations/tauri/api';
import { useInvocationStore } from '../../stores/invocationStore';
import { useMarkdownStore } from '../../stores/markdownStore';
import { VditorEditor, VditorEditorRef } from '../../components/markdown/VditorEditor';
import { MarkdownToolbar } from '../../components/markdown/MarkdownToolbar';
import { MarkdownTabBar } from '../../components/markdown/MarkdownTabBar';
import { MarkdownStatusBar } from '../../components/markdown/MarkdownStatusBar';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  const digits = u === 0 ? 0 : u === 1 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[u]}`;
}

export function MarkdownOverlayView() {
  const currentInvocation = useInvocationStore((state) => state.currentInvocation);
  
  const configRef = useRef<AppConfig | null>(null);
  const vditorRef = useRef<VditorEditorRef>(null);
  
  const tabsCount = useMarkdownStore((state) => state.tabs.length);
  const addTab = useMarkdownStore((state) => state.addTab);
  const loadFile = useMarkdownStore((state) => state.loadFile);
  const setMarkdownConfig = useMarkdownStore((state) => state.setConfig);
  const markdownConfig = useMarkdownStore((state) => state.config);
  const isLoading = useMarkdownStore((state) => state.isLoading);
  const loadingInfo = useMarkdownStore((state) => state.loadingInfo);
  
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
      } else if (file) {
        loadFile(file, content || '');
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
  }, [markdownConfig]);
  
  const hasOpenTabs = tabsCount > 0;
  
  return (
    <div className="relative flex flex-col h-full min-h-0 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <div className="w-[360px] max-w-[90vw] rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl px-4 py-4">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Loading file…</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 break-all">
              {loadingInfo?.path || 'Preparing editor'}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-4 w-4 rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-gray-900 dark:border-t-gray-100 animate-spin" />
              <div className="text-xs text-gray-700 dark:text-gray-300">
                {loadingInfo?.stage === 'rendering' ? 'Rendering…' : 'Reading…'}
                {typeof loadingInfo?.sizeBytes === 'number' ? ` (${formatBytes(loadingInfo.sizeBytes)})` : ''}
              </div>
            </div>
            <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-500">
              Large files may take a moment to open.
            </div>
          </div>
        </div>
      )}
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
