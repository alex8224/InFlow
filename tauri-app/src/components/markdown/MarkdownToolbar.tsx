import React, { useCallback } from 'react';
import { useMarkdownStore } from '../../stores/markdownStore';
import {
  FilePlus,
  FolderOpen,
  Save,
  Sun,
  Moon,
  Edit3,
  Eye,
  Maximize2,
  Heading1,
  Heading2,
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Link,
  Quote,
  Table,
  Minus,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface MarkdownToolbarProps {
  className?: string;
  onInsertValue?: (value: string) => void;
}

export function MarkdownToolbar({ className = '', onInsertValue }: MarkdownToolbarProps) {
  const { 
    config, 
    tabs, 
    activeTabId,
    toggleReadonly,
    setTheme, 
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
  
  const handleToggleReadonly = useCallback(() => {
    toggleReadonly();
  }, [toggleReadonly]);
  
  const handleThemeToggle = useCallback(() => {
    setTheme(config.theme === 'dark' ? 'light' : 'dark');
  }, [config.theme, setTheme]);
  
  const handleFullscreen = useCallback(async () => {
    try {
      await invoke('toggle_overlay_fullscreen');
    } catch (err) {
      console.error('Failed to toggle fullscreen:', err);
    }
  }, []);

  // Insert value handler for formatting buttons
  const handleInsertValue = useCallback((value: string) => {
    if (onInsertValue) {
      onInsertValue(value);
    }
  }, [onInsertValue]);

  const hasActiveTab = !!activeTab;
  
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
        disabled={!hasActiveTab}
      />
      
      <ToolbarDivider />
      
      {/* Format operations */}
      <ToolbarButton 
        icon={<Heading1 size={16} />} 
        tooltip="Heading 1"
        onClick={() => handleInsertValue('# ')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<Heading2 size={16} />} 
        tooltip="Heading 2"
        onClick={() => handleInsertValue('## ')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<Bold size={16} />} 
        tooltip="Bold"
        onClick={() => handleInsertValue('**bold**')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<Italic size={16} />} 
        tooltip="Italic"
        onClick={() => handleInsertValue('*italic*')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<List size={16} />} 
        tooltip="Bullet List"
        onClick={() => handleInsertValue('- ')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<ListOrdered size={16} />} 
        tooltip="Numbered List"
        onClick={() => handleInsertValue('1. ')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<Code size={16} />} 
        tooltip="Code Block"
        onClick={() => handleInsertValue('```\n\n```')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<Link size={16} />} 
        tooltip="Link"
        onClick={() => handleInsertValue('[text](url)')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<Quote size={16} />} 
        tooltip="Quote"
        onClick={() => handleInsertValue('> ')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<Table size={16} />} 
        tooltip="Table"
        onClick={() => handleInsertValue('| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |')}
        disabled={!hasActiveTab}
      />
      <ToolbarButton 
        icon={<Minus size={16} />} 
        tooltip="Horizontal Rule"
        onClick={() => handleInsertValue('\n---\n')}
        disabled={!hasActiveTab}
      />
      
      <ToolbarDivider />
      
      {/* Mode switch */}
      <ToolbarButton 
        icon={config.readonly ? <Eye size={16} /> : <Edit3 size={16} />} 
        tooltip={config.readonly ? 'Read-only (Click to edit)' : 'Editing (Click to read-only)'}
        active={config.readonly}
        onClick={handleToggleReadonly}
      />
      
      <ToolbarDivider />
      
      {/* Theme */}
      <ToolbarButton 
        icon={config.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        tooltip={`Switch to ${config.theme === 'dark' ? 'Light' : 'Dark'} Theme`}
        onClick={handleThemeToggle}
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
