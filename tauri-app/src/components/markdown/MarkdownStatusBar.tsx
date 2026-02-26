import { useMemo } from 'react';
import { useMarkdownStore } from '../../stores/markdownStore';
import { FileText, AlertCircle, CheckCircle } from 'lucide-react';

interface MarkdownStatusBarProps {
  className?: string;
}

export function MarkdownStatusBar({ className = '' }: MarkdownStatusBarProps) {
  const { tabs, activeTabId, config } = useMarkdownStore();
  
  const activeTab = tabs.find(t => t.id === activeTabId);
  
  // Calculate stats from content
  const stats = useMemo(() => {
    if (!activeTab) {
      return { chars: 0, words: 0, lines: 0 };
    }
    const content = activeTab.content;
    const chars = content.length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const lines = content.split('\n').length;
    return { chars, words, lines };
  }, [activeTab?.content]);
  
  // Mode display text
  const modeText = {
    edit: 'Edit',
    preview: 'Preview',
  }[config.mode];
  
  return (
    <div className={`flex items-center justify-between px-3 py-1 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 text-xs ${className}`}>
      {/* Left section - File info */}
      <div className="flex items-center gap-3">
        {activeTab ? (
          <>
            <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
              <FileText size={12} />
              {activeTab.title}
              {activeTab.isDirty && (
                <span className="text-amber-500" title="Unsaved changes">•</span>
              )}
            </span>
            {activeTab.filePath && (
              <span className="text-gray-400 dark:text-gray-500 truncate max-w-[200px]" title={activeTab.filePath}>
                {activeTab.filePath}
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-400">No file open</span>
        )}
      </div>
      
      {/* Center section - Save status */}
      <div className="flex items-center gap-1">
        {activeTab && (
          activeTab.isDirty ? (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
              <AlertCircle size={12} />
              Unsaved
            </span>
          ) : (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-500">
              <CheckCircle size={12} />
              Saved
            </span>
          )
        )}
      </div>
      
      {/* Right section - Stats */}
      <div className="flex items-center gap-4 text-gray-500 dark:text-gray-400">
        <span>Ln {activeTab?.cursorPosition.line || 1}, Col {activeTab?.cursorPosition.col || 1}</span>
        <span>{stats.words} words</span>
        <span>{stats.chars} chars</span>
        <span>{stats.lines} lines</span>
        <span className="capitalize">{modeText}</span>
        <span className="uppercase">{config.theme}</span>
      </div>
    </div>
  );
}
