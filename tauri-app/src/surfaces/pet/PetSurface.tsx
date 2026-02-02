import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useInvocationStore } from '../../stores/invocationStore';

export function PetSurface() {
  const currentInvocation = useInvocationStore((state) => state.currentInvocation);
  const [isHovered, setIsHovered] = useState(false);

  // Dragging logic
  const handleMouseDown = async (e: React.MouseEvent) => {
      if (e.button === 0) {
          await getCurrentWindow().startDragging();
      }
  };

  // Handle ESC to hide window
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        await getCurrentWindow().hide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div 
        className="w-full h-full flex flex-col items-center justify-center select-none bg-transparent"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleMouseDown}
    >
      {/* Notification Bubble - Moved above the pet (sticky note style) */}
      {currentInvocation && (
          <div className="mb-2 relative w-48 bg-yellow-200 text-yellow-950 p-3 rounded-sm shadow-md text-xs rotate-1 animate-in fade-in slide-in-from-bottom-2 origin-bottom border border-yellow-300/50">
              {(() => {
                  const args = currentInvocation.args as any || {};
                  const title = args.title || 'Notification';
                  const message = args.message || args.text || args.body;
                  
                  // If we have a clear message, show it nicely
                  if (message) {
                      return (
                          <>
                              <p className="font-bold mb-1 opacity-90 border-b border-yellow-900/10 pb-1">{title}</p>
                              <div className="font-sans whitespace-pre-wrap opacity-90 leading-relaxed max-h-24 custom-scrollbar overflow-y-auto">
                                  {message}
                              </div>
                          </>
                      );
                  }

                  // Fallback: Debug view
                  return (
                      <>
                          <p className="font-bold mb-1 opacity-90 border-b border-yellow-900/10 pb-1">{currentInvocation.capabilityId}</p>
                          {currentInvocation.args && (
                            <pre className="mt-1 text-[10px] opacity-80 overflow-hidden text-ellipsis whitespace-pre-wrap max-h-24 custom-scrollbar overflow-y-auto font-mono bg-yellow-100/50 p-1 rounded">
                              {JSON.stringify(currentInvocation.args, null, 2)}
                            </pre>
                          )}
                      </>
                  );
              })()}
              
              {/* Caret pointing down */}
              <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-yellow-200 rotate-45 border-b border-r border-yellow-300/50"></div>
          </div>
      )}

      <div className={`
          relative transition-transform duration-200 
          ${isHovered ? 'scale-105' : 'scale-100'}
          animate-pet-clippy-bounce
      `}>
         {/* SVG Clippy */}
         <svg 
            width="120" 
            height="120" 
            viewBox="0 0 100 100" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            className="filter drop-shadow-md"
         >
            {/* Body */}
            <path 
                d="M30 70 V30 A20 20 0 0 1 70 30 V75 A15 15 0 0 1 40 75 V35 A10 10 0 0 1 60 35 V65" 
                stroke="#d1d5db" 
                strokeWidth="8" 
                strokeLinecap="round" 
                strokeLinejoin="round"
            />
            {/* Highlight/Detail */}
            <path 
                d="M30 70 V30 A20 20 0 0 1 70 30 V75 A15 15 0 0 1 40 75 V35 A10 10 0 0 1 60 35 V65" 
                stroke="white" 
                strokeWidth="2" 
                strokeOpacity="0.4"
                strokeLinecap="round" 
                strokeLinejoin="round"
                className="mix-blend-overlay"
            />
            {/* Eyes (Simple Dots) */}
            <g className="animate-pet-clippy-blink">
                <circle cx="45" cy="25" r="3" fill="#1f2937" />
                <circle cx="65" cy="25" r="3" fill="#1f2937" />
                <circle cx="47" cy="23" r="1" fill="white" fillOpacity="0.8" />
                <circle cx="67" cy="23" r="1" fill="white" fillOpacity="0.8" />
            </g>
            {/* Eyebrows (Expression) */}
            <path d="M42 20 Q45 18 48 20" stroke="#1f2937" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <path d="M62 20 Q65 18 68 20" stroke="#1f2937" strokeWidth="1.5" strokeLinecap="round" fill="none" />
         </svg>
      </div>
    </div>
  );
}
