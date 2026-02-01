import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useInvocationStore } from './stores/invocationStore';
import { bootstrap } from './app/bootstrap';
import { OverlaySurface } from './surfaces/overlay/OverlaySurface';
import { WorkspaceSurface } from './surfaces/workspace/WorkspaceSurface';
import { showOverlay, closeOverlay } from './integrations/tauri/api';

function App() {
  const [windowLabel, setWindowLabel] = useState<string>('');
  const currentInvocation = useInvocationStore((state) => state.currentInvocation);

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

  useEffect(() => {
    if (windowLabel === 'main' && currentInvocation) {
      if (currentInvocation.ui?.mode === 'overlay') {
        showOverlay();
      } else {
        closeOverlay();
      }
    }
  }, [currentInvocation, windowLabel]);

  if (windowLabel === 'overlay') {
    return <OverlaySurface />;
  }

  return (
    <div className="min-h-screen">
      <WorkspaceSurface />
    </div>
  );
}

export default App;
