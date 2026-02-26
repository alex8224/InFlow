import { useCallback } from 'react';
import { useMarkdownStore, EditorMode } from '../../stores/markdownStore';
import {
  FilePlus,
  FolderOpen,
  Save,
  Sun,
  Moon,
  Edit3,
  Eye,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FileText,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface MarkdownToolbarProps {
  className?: string;
}

export function MarkdownToolbar({ className = '' }: MarkdownToolbarProps) {
  const { 
    config, 
    tabs, 
    activeTabId,
    setMode, 
    setTheme, 
    setFontSize,
    addTab,
    updateTab,
    getActiveTab,
    markSaved,
    loadFile,
  } = useMarkdownStore();
  
  const activeTab = tabs.find(t => t.id === activeTabId);
  
  // Handlers
  const handleNewFile = useCallback(() => {
    addTab({ title: 'Untitled', content: '' });
  }, [addTab]);
  
  const handleOpenFile = useCallback(async () => {
    try {
      // Use Tauri dialog to open file
      const result = await invoke<string | null>('open_markdown_file');
      if (result) {
        // Result format: "path|content"
        const separatorIndex = result.indexOf('|');
        if (separatorIndex > 0) {
          const filePath = result.substring(0, separatorIndex);
          const content = result.substring(separatorIndex + 1);
          loadFile(filePath, content);
        }
      }
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [loadFile]);
  
  const handleSaveFile = useCallback(async () => {
    const tab = getActiveTab();
    if (!tab) return;
    
    try {
      if (tab.filePath) {
        // Save to existing path
        await invoke('save_markdown_file', { 
          path: tab.filePath, 
          content: tab.content 
        });
        markSaved(tab.id);
      } else {
        // Save As - need path first
        const result = await invoke<string | null>('save_markdown_file_as', { 
          content: tab.content 
        });
        if (result) {
          updateTab(tab.id, { 
            filePath: result, 
            title: result.split(/[/\\]/).pop() || 'Untitled',
            isDirty: false 
          });
        }
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [getActiveTab, updateTab, markSaved]);
  
  const handleModeChange = useCallback((mode: EditorMode) => {
    setMode(mode);
  }, [setMode]);
  
  const handleThemeToggle = useCallback(() => {
    setTheme(config.theme === 'dark' ? 'light' : 'dark');
  }, [config.theme, setTheme]);
  
  const handleZoomIn = useCallback(() => {
    setFontSize(Math.min(config.fontSize + 2, 24));
  }, [config.fontSize, setFontSize]);
  
  const handleZoomOut = useCallback(() => {
    setFontSize(Math.max(config.fontSize - 2, 10));
  }, [config.fontSize, setFontSize]);
  
  const handleFullscreen = useCallback(async () => {
    try {
      await invoke('toggle_overlay_fullscreen');
    } catch (err) {
      console.error('Failed to toggle fullscreen:', err);
    }
  }, []);
  
  return (
    <div className={`flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 ${className}`}>
      {/* File operations */}
      <ToolbarButton 
        icon={<FilePlus size={16} />} 
        tooltip="New File (Ctrl+N)"
        onClick={handleNewFile}
      />
      <ToolbarButton 
        icon={<FolderOpen size={16} />} 
        tooltip="Open File (Ctrl+O)"
        onClick={handleOpenFile}
      />
      <ToolbarButton 
        icon={<Save size={16} />} 
        tooltip="Save (Ctrl+S)"
        onClick={handleSaveFile}
        disabled={!activeTab}
      />
      
      <ToolbarDivider />
      
      {/* Mode switch */}
      <ToolbarButton 
        icon={<Edit3 size={16} />} 
        tooltip="Edit Mode"
        active={config.mode === 'edit'}
        onClick={() => handleModeChange('edit')}
      />
      <ToolbarButton 
        icon={<Eye size={16} />} 
        tooltip="WYSIWYG Mode"
        active={config.mode === 'wysiwym'}
        onClick={() => handleModeChange('wysiwym')}
      />
      <ToolbarButton 
        icon={<FileText size={16} />} 
        tooltip="Preview Mode"
        active={config.mode === 'preview'}
        onClick={() => handleModeChange('preview')}
      />
      
      <ToolbarDivider />
      
      {/* Theme */}
      <ToolbarButton 
        icon={config.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        tooltip={`Switch to ${config.theme === 'dark' ? 'Light' : 'Dark'} Theme`}
        onClick={handleThemeToggle}
      />
      
      <ToolbarDivider />
      
      {/* Zoom */}
      <ToolbarButton 
        icon={<ZoomOut size={16} />} 
        tooltip="Zoom Out"
        onClick={handleZoomOut}
      />
      <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[40px] text-center">
        {config.fontSize}px
      </span>
      <ToolbarButton 
        icon={<ZoomIn size={16} />} 
        tooltip="Zoom In"
        onClick={handleZoomIn}
      />
      
      <div className="flex-1" />
      
      {/* Fullscreen */}
      <ToolbarButton 
        icon={<Maximize2 size={16} />} 
        tooltip="Fullscreen"
        onClick={handleFullscreen}
      />
    </div>
  );
}

// Toolbar Button Component
interface ToolbarButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}

function ToolbarButton({ icon, tooltip, onClick, disabled, active }: ToolbarButtonProps) {
  return (
    <button
      className={`
        p-1.5 rounded transition-colors
        ${disabled 
          ? 'opacity-40 cursor-not-allowed' 
          : 'hover:bg-gray-200 dark:hover:bg-gray-700'
        }
        ${active 
          ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' 
          : 'text-gray-600 dark:text-gray-300'
        }
      `}
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
    >
      {icon}
    </button>
  );
}

// Toolbar Divider
function ToolbarDivider() {
  return <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />;
}
