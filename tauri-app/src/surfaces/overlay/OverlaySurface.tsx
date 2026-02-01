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
      if (target.closest('header')) {
        if (target.tagName !== 'BUTTON' && !target.closest('button')) {
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
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/30 gap-4">
          <Globe className="w-12 h-12 opacity-20 animate-pulse" />
          <p className="text-xs font-black tracking-[0.3em] uppercase italic opacity-40">Ready</p>
        </div>
      );
    }

    // Match using capabilityId
    const view = viewRegistry.getAll().find(v => 
      v.capabilityIds.includes(currentInvocation.capabilityId)
    );
    
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
    <div className="w-full h-full bg-background text-foreground flex flex-col font-sans antialiased select-none overflow-hidden">
        {/* Header - Fixed 48px */}
        <header 
          onMouseDown={handleDrag}
          className="flex justify-between items-center px-4 h-12 bg-muted/30 border-b border-border select-none cursor-grab active:cursor-grabbing shrink-0"
        >
          <div className="flex items-center gap-2.5 pointer-events-none">
            <div className="bg-primary/10 p-1.5 rounded-lg text-primary">
              <Globe className="w-4 h-4" />
            </div>
            <div className="flex flex-col text-left">
                <span className="font-black text-xs tracking-widest uppercase opacity-90 leading-none">inFlow</span>
                {currentInvocation && (
                    <span className="text-[8px] font-bold text-muted-foreground/60 uppercase tracking-tighter mt-0.5">
                        {currentInvocation.capabilityId}
                    </span>
                )}
            </div>
          </div>
          <button
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all active:scale-90 z-50 relative"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden min-h-0 bg-gradient-to-b from-transparent to-muted/5">
          {renderContent()}
        </div>
        
        {/* Footer - Fixed 32px */}
        <footer className="px-5 h-8 bg-muted/20 border-t border-border/40 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 text-muted-foreground/60">
            <div className="w-1 h-1 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse" />
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">Ready</span>
          </div>
          <span className="text-[8px] font-bold opacity-20 uppercase tracking-widest">v0.1.0</span>
        </footer>
    </div>
  );
}
