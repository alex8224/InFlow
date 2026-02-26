import { create } from 'zustand';

export type EditorMode = 'edit' | 'preview' | 'wysiwym';
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
  mode: EditorMode;
  theme: EditorTheme;
  fontSize: number;
  autoSave: boolean;
  recentFiles: string[];
  activeTabId: string | null;
}

type MarkdownStore = {
  // Editor config
  config: MarkdownEditorConfig;
  
  // Tabs
  tabs: MarkdownTab[];
  activeTabId: string | null;
  
  // UI state
  isLoading: boolean;
  error: string | null;
  
  // Actions - Config
  setConfig: (config: Partial<MarkdownEditorConfig>) => void;
  setMode: (mode: EditorMode) => void;
  setTheme: (theme: EditorTheme) => void;
  setFontSize: (fontSize: number) => void;
  toggleAutoSave: () => void;
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
  setError: (error: string | null) => void;
};

// Generate unique ID
function generateId(): string {
  return `md_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const useMarkdownStore = create<MarkdownStore>((set, get) => ({
  // Initial state
  config: {
    mode: 'edit',
    theme: 'light',
    fontSize: 14,
    autoSave: false,
    recentFiles: [],
    activeTabId: null,
  },
  
  tabs: [],
  activeTabId: null,
  isLoading: false,
  error: null,
  
  // Config actions
  setConfig: (newConfig) => set((state) => ({
    config: { ...state.config, ...newConfig }
  })),
  
  setMode: (mode) => set((state) => ({
    config: { ...state.config, mode }
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
  loadFile: (filePath, content) => set((state) => {
    // Check if file is already open
    const existingTab = state.tabs.find(t => t.filePath === filePath);
    if (existingTab) {
      return {
        activeTabId: existingTab.id,
        config: { ...state.config, activeTabId: existingTab.id },
      };
    }
    
    // Extract filename from path
    const title = filePath.split(/[/\\]/).pop() || 'Untitled';
    const id = generateId();
    
    return {
      tabs: [...state.tabs, {
        id,
        title,
        filePath,
        content,
        isDirty: false,
        cursorPosition: { line: 1, col: 1 },
      }],
      activeTabId: id,
      config: { 
        ...state.config, 
        activeTabId: id,
        recentFiles: [filePath, ...state.config.recentFiles.filter(f => f !== filePath)].slice(0, 10),
      },
    };
  }),
  
  markSaved: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => 
      t.id === tabId ? { ...t, isDirty: false } : t
    ),
  })),
  
  // State actions
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
