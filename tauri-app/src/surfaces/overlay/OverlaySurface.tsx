import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Globe } from 'lucide-react';
import { closeOverlay } from '../../integrations/tauri/api';
import { cn } from '../../lib/cn';
import { useInvocationStore } from '../../stores/invocationStore';
import { viewRegistry } from '../../core/registry/viewRegistry';

export function OverlaySurface() {
  const currentInvocation = useInvocationStore((state) => state.currentInvocation);

  const handleDrag = async (e: React.MouseEvent) => {
    if (e.button === 0) {
      const target = e.target as HTMLElement;
      // Precision dragging: only on header or designated areas
      if (target.closest('header') || target.classList.contains('drag-region')) {
        if (target.tagName !== 'BUTTON' && !target.closest('button') && !target.closest('[role="combobox"]')) {
          try {
            await getCurrentWindow().startDragging();
          } catch (err) {
            console.error('Failed to start dragging:', err);
          }
        }
      }
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await closeOverlay();
  };

  const renderContent = () => {
    if (!currentInvocation) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
          <Globe className="w-12 h-12 opacity-10 animate-pulse" />
          <p className="text-xs font-black tracking-[0.3em] uppercase italic opacity-40">Waiting for Command</p>
        </div>
      );
    }

    const view = viewRegistry.getAll().find(v => v.capabilityIds.includes(currentInvocation.capabilityId));
    
    if (view) {
      const Component = view.component;
      return <Component />;
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center text-destructive p-8 text-center gap-4 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
          <X className="w-8 h-8" />
        </div>
        <div>
          <p className="font-black text-lg uppercase tracking-tight">Unsupported</p>
          <p className="text-[10px] opacity-60 mt-1 font-mono">{currentInvocation.capabilityId}</p>
        </div>
      </div>
    );
  };

  return (
    /* Outermost container - No padding to avoid transparent frame */
    <div className="w-full h-full bg-transparent font-sans antialiased select-none overflow-hidden flex flex-col">
      
      {/* Main Container - Rounded edges without gap */}
      <div className="w-full h-full bg-background text-foreground flex flex-col transition-all border-inherit">
        
        {/* Header - Shared Shell */}
        <header 
          onMouseDown={handleDrag}
          className="flex justify-between items-center px-5 h-14 bg-muted/40 border-b border-border/40 select-none cursor-grab active:cursor-grabbing shrink-0"
        >
          <div className="flex items-center gap-3 pointer-events-none">
            <div className="bg-primary/10 p-2 rounded-xl text-primary shadow-sm border border-primary/10">
              <Globe className="w-4.5 h-4.5" />
            </div>
            <div className="flex flex-col text-left">
                <span className="font-black text-xs tracking-widest uppercase opacity-90">inFlow</span>
                <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-tighter -mt-0.5">
                    {currentInvocation?.capabilityId || 'System'}
                </span>
            </div>
          </div>
          <button
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all active:scale-90 z-50 relative border border-transparent hover:border-destructive/20"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        
        {/* Content Area */}
        <div className="flex-1 flex flex-col p-5 overflow-hidden min-h-0 bg-gradient-to-b from-transparent to-muted/5">
          {renderContent()}
        </div>
        
        {/* Shared Footer */}
        <footer className="px-6 h-10 bg-muted/30 border-t border-border/40 flex justify-between items-center shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.8)] animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground/60">System Ready</span>
          </div>
          <div className="flex items-center gap-1 opacity-20 text-muted-foreground font-black">
            <span className="text-[9px] uppercase tracking-widest italic">v0.1.0</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
