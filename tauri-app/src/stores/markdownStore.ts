import { create } from 'zustand';

export type EditorMode = 'edit';
export type EditorTheme = 'light' | 'dark';

export interface MarkdownTab {
  id: string;
  title: string;
  filePath: string | null;
  content: string;
  isDirty: boolean;
  cursorPosition: { line: number; col: number };
}

export interface MarkdownStats {
  chars: number;
  words: number;
  lines: number;
}

export interface MarkdownEditorConfig {
  theme: EditorTheme;
  fontSize: number;
  autoSave: boolean;
  recentFiles: string[];
  outlineEnabled: boolean;
  activeTabId: string | null;
}

export type MarkdownLoadingStage = 'reading' | 'rendering';

export interface MarkdownLoadingInfo {
  path: string;
  sizeBytes: number | null;
  stage: MarkdownLoadingStage;
}

const LARGE_DOC_CHAR_THRESHOLD = 200_000;

type MarkdownStore = {
  // Editor config
  config: MarkdownEditorConfig;
  
  // Tabs
  tabs: MarkdownTab[];
  activeTabId: string | null;
  
  // UI state
  isLoading: boolean;
  loadingInfo: MarkdownLoadingInfo | null;
  error: string | null;
  
  // Actions - Config
  setConfig: (config: Partial<MarkdownEditorConfig>) => void;
  setTheme: (theme: EditorTheme) => void;
  setFontSize: (fontSize: number) => void;
  toggleAutoSave: () => void;
  toggleOutline: () => void;
  addRecentFile: (filePath: string) => void;
  
  // Actions - Tabs
  addTab: (tab?: Partial<MarkdownTab>) => string;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<MarkdownTab>) => void;
  getActiveTab: () => MarkdownTab | null;
  
  // Actions - Content
  setContent: (content: string) => void;
  setCursorPosition: (line: number, col: number) => void;
  
  // Actions - File operations
  loadFile: (filePath: string, content: string) => void;
  markSaved: (tabId: string) => void;
  
  // Actions - State
  setLoading: (loading: boolean) => void;
  setLoadingInfo: (info: MarkdownLoadingInfo | null) => void;
  setError: (error: string | null) => void;
};

// Generate unique ID
function generateId(): string {
  return `md_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const useMarkdownStore = create<MarkdownStore>((set, get) => ({
  // Initial state
  config: {
    theme: 'light',
    fontSize: 14,
    autoSave: false,
    recentFiles: [],
    outlineEnabled: false,
    activeTabId: null,
  },
  
  tabs: [],
  activeTabId: null,
  isLoading: false,
  loadingInfo: null,
  error: null,
  
  // Config actions
  setConfig: (newConfig) => set((state) => ({
    config: { ...state.config, ...newConfig }
  })),
  
  setTheme: (theme) => set((state) => ({
    config: { ...state.config, theme }
  })),
  
  setFontSize: (fontSize) => set((state) => ({
    config: { ...state.config, fontSize }
  })),
  
  toggleAutoSave: () => set((state) => ({
    config: { ...state.config, autoSave: !state.config.autoSave }
  })),

  toggleOutline: () => set((state) => ({
    config: { ...state.config, outlineEnabled: !state.config.outlineEnabled }
  })),
  
  addRecentFile: (filePath) => set((state) => {
    const recent = [filePath, ...state.config.recentFiles.filter(f => f !== filePath)].slice(0, 10);
    return { config: { ...state.config, recentFiles: recent } };
  }),
  
  // Tab actions
  addTab: (tabData) => {
    const id = generateId();
    const title = tabData?.title || 'Untitled';
    const filePath = tabData?.filePath || null;
    
    set((state) => ({
      tabs: [...state.tabs, {
        id,
        title,
        filePath,
        content: tabData?.content || '',
        isDirty: false,
        cursorPosition: { line: 1, col: 1 },
      }],
      activeTabId: id,
      config: { ...state.config, activeTabId: id },
    }));
    
    return id;
  },
  
  removeTab: (tabId) => set((state) => {
    const newTabs = state.tabs.filter(t => t.id !== tabId);
    let newActiveId = state.activeTabId;
    
    if (state.activeTabId === tabId) {
      const idx = state.tabs.findIndex(t => t.id === tabId);
      newActiveId = newTabs[Math.max(0, idx - 1)]?.id || null;
    }
    
    return {
      tabs: newTabs,
      activeTabId: newActiveId,
      config: { ...state.config, activeTabId: newActiveId },
    };
  }),
  
  setActiveTab: (tabId) => set((state) => ({
    activeTabId: tabId,
    config: { ...state.config, activeTabId: tabId },
  })),
  
  updateTab: (tabId, updates) => set((state) => ({
    tabs: state.tabs.map(t => 
      t.id === tabId ? { ...t, ...updates } : t
    ),
  })),
  
  getActiveTab: () => {
    const state = get();
    return state.tabs.find(t => t.id === state.activeTabId) || null;
  },
  
  // Content actions
  setContent: (content) => set((state) => {
    const activeId = state.activeTabId;
    if (!activeId) return state;
    
    return {
      tabs: state.tabs.map(t => 
        t.id === activeId 
          ? { ...t, content, isDirty: true }
          : t
      ),
    };
  }),
  
  setCursorPosition: (line, col) => set((state) => {
    const activeId = state.activeTabId;
    if (!activeId) return state;
    
    return {
      tabs: state.tabs.map(t => 
        t.id === activeId 
          ? { ...t, cursorPosition: { line, col } }
          : t
      ),
    };
  }),
  
  // File operations
  loadFile: async (filePath, content) => {
    const trimmedPath = (filePath || '').trim();
    if (!trimmedPath) {
      set({ error: 'Invalid file path.' });
      return;
    }

    // If the file is already open and caller didn't provide new content, just focus the tab.
    // This avoids re-reading and re-rendering large files.
    if (!content) {
      const state0 = get();
      const existing = state0.tabs.find((t) => t.filePath === trimmedPath);
      if (existing) {
        set({
          activeTabId: existing.id,
          config: { ...state0.config, activeTabId: existing.id },
          isLoading: false,
          loadingInfo: null,
          error: null,
        });
        return;
      }
    }

    // Update loading state early so the UI can paint a waiting indicator.
    set({
      isLoading: true,
      loadingInfo: { path: trimmedPath, sizeBytes: null, stage: 'reading' },
      error: null,
    });
    // Yield to allow React to render the loading overlay before heavy work.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    let fileContent = content;
    try {
      const { readMarkdownFile, getFileSize } = await import('../integrations/tauri/api');

      // Best-effort file size for UX.
      try {
        const sizeBytes = await getFileSize(trimmedPath);
        set((state) => ({
          ...state,
          loadingInfo:
            state.loadingInfo?.path === trimmedPath
              ? { ...state.loadingInfo, sizeBytes }
              : state.loadingInfo,
        }));
      } catch {
        // ignore
      }

      if (!fileContent) {
        fileContent = await readMarkdownFile(trimmedPath);
      }
    } catch (err) {
      console.error('Failed to read file:', err);
      fileContent = fileContent || '';
      set({ error: 'Failed to read file.' });
    }

    const isLarge = fileContent.length > LARGE_DOC_CHAR_THRESHOLD;

    // Mark that we're about to render/apply content.
    set((state) => ({
      ...state,
      loadingInfo:
        state.loadingInfo?.path === trimmedPath
          ? { ...state.loadingInfo, stage: 'rendering' }
          : state.loadingInfo,
    }));
    if (isLarge) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    
    set((state) => {
      // Check if file is already open
      const existingTab = state.tabs.find((t) => t.filePath === trimmedPath);
      if (existingTab) {
        return {
          activeTabId: existingTab.id,
          config: { ...state.config, activeTabId: existingTab.id },
        };
      }

      // Extract filename from path
      const title = trimmedPath.split(/[/\\]/).pop() || 'Untitled';
      const id = generateId();

      return {
        tabs: [
          ...state.tabs,
          {
            id,
            title,
            filePath: trimmedPath,
            content: fileContent,
            isDirty: false,
            cursorPosition: { line: 1, col: 1 },
          },
        ],
        activeTabId: id,
        config: {
          ...state.config,
          activeTabId: id,
          recentFiles: [
            trimmedPath,
            ...state.config.recentFiles.filter((f) => f !== trimmedPath),
          ].slice(0, 10),
        },
      };
    });

    // For small/medium documents, we can clear loading immediately.
    // For large documents, Vditor applies content asynchronously (deferred) and will
    // clear loading once the editor is ready.
    if (!isLarge) {
      set({ isLoading: false, loadingInfo: null });
    }
  },
   
  markSaved: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => 
      t.id === tabId ? { ...t, isDirty: false } : t
    ),
  })),
  
  // State actions
  setLoading: (isLoading) => set({ isLoading }),
  setLoadingInfo: (loadingInfo) => set({ loadingInfo }),
  setError: (error) => set({ error }),
}));
