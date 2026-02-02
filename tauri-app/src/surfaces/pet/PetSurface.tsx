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
        className="w-full h-full flex items-center justify-center select-none bg-transparent"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleMouseDown}
    >
      <div className={`
          relative transition-transform duration-200 
          ${isHovered ? 'scale-105' : 'scale-100'}
      `}>
         {/* Pet Circle - Removed heavy shadows and border to avoid "box" effect on transparent window */}
         <div className="w-32 h-32 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full flex items-center justify-center text-white font-bold cursor-grab active:cursor-grabbing shadow-md">
            Pet
         </div>
         
         {/* Notification Bubble */}
         {currentInvocation && (
             <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-white/90 backdrop-blur text-black p-3 rounded-xl shadow-xl text-xs border border-gray-200 animate-in fade-in slide-in-from-bottom-2">
                 <p className="font-bold mb-1">Notification</p>
                 <p>{currentInvocation.capabilityId}</p>
                 {currentInvocation.args && (
                   <pre className="mt-1 text-[10px] opacity-70 overflow-hidden text-ellipsis">
                     {JSON.stringify(currentInvocation.args, null, 2)}
                   </pre>
                 )}
             </div>
         )}
      </div>
    </div>
  );
}
