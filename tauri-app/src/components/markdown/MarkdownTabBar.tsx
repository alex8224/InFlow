import { useCallback } from 'react';
import { useMarkdownStore } from '../../stores/markdownStore';
import { X, FileText, Plus } from 'lucide-react';

interface MarkdownTabBarProps {
  className?: string;
}

export function MarkdownTabBar({ className = '' }: MarkdownTabBarProps) {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab } = useMarkdownStore();
  
  const handleNewTab = useCallback(() => {
    addTab({ title: 'Untitled', content: '' });
  }, [addTab]);
  
  const handleCloseTab = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    removeTab(tabId);
  }, [removeTab]);
  
  if (tabs.length === 0) {
    return (
      <div className={`flex items-center justify-between px-2 py-1 bg-gray-200 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 ${className}`}>
        <span className="text-xs text-gray-500 dark:text-gray-400">No tabs open</span>
        <button
          className="p-1 hover:bg-gray-300 dark:hover:bg-gray-700 rounded"
          onClick={handleNewTab}
          title="New Tab"
        >
          <Plus size={14} />
        </button>
      </div>
    );
  }
  
  return (
    <div className={`flex items-center bg-gray-200 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 overflow-x-auto ${className}`}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`
            flex items-center gap-1 px-3 py-1.5 cursor-pointer border-r border-gray-300 dark:border-gray-600
            min-w-[100px] max-w-[180px] group
            ${tab.id === activeTabId 
              ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100' 
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750'
            }
          `}
          onClick={() => setActiveTab(tab.id)}
        >
          <FileText size={12} className="flex-shrink-0" />
          <span className="flex-1 truncate text-sm">
            {tab.title}
            {tab.isDirty && <span className="text-amber-500 ml-1">•</span>}
          </span>
          <button
            className={`
              p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-300 dark:hover:bg-gray-600
              ${tab.id === activeTabId ? 'opacity-100' : ''}
            `}
            onClick={(e) => handleCloseTab(e, tab.id)}
            title="Close tab"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      
      <button
        className="p-1.5 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
        onClick={handleNewTab}
        title="New Tab"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
