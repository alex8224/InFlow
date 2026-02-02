import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { bootstrap } from './app/bootstrap';
import { OverlaySurface } from './surfaces/overlay/OverlaySurface';
import { WorkspaceSurface } from './surfaces/workspace/WorkspaceSurface';
import { PetSurface } from './surfaces/pet/PetSurface';

function App() {
  const [windowLabel, setWindowLabel] = useState<string>('');
  
  // We no longer rely on frontend to toggle overlay visibility based on invocation mode
  // Rust handles window management. Frontend just renders what it is supposed to.

  useEffect(() => {
    const init = async () => {
      const currentWindow = getCurrentWindow();
      setWindowLabel(currentWindow.label);
      await bootstrap();
    };
    init();

    // Theme detection and synchronization
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = (isDark: boolean) => {
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    
    updateTheme(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => updateTheme(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  if (windowLabel.startsWith('pet')) {
    return <PetSurface />;
  }

  // Reuse OverlaySurface for translate and chat windows
  // OverlaySurface logic decides content based on capabilityId which is already correct 
  // because we filter invocations by window label in bootstrap.
  if (windowLabel.startsWith('translate') || windowLabel.startsWith('chat') || windowLabel === 'overlay') {
    return <OverlaySurface />;
  }

  return (
    <div className="min-h-screen">
      <WorkspaceSurface />
    </div>
  );
}

export default App;
