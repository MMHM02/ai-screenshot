import { useSettingsStore } from './stores/settingsStore';
import { useChatStore } from './stores/chatStore';
import { appWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState, useRef } from 'react';
import MainWindow from './components/MainWindow';
import FloatBall from './components/FloatBall';
import FloatBallPanel from './components/FloatBallPanel';
import CropOverlay from './components/CropOverlay';

function App() {
  const { themeColor, darkMode, autoStart } = useSettingsStore();
  const { initChats } = useChatStore();
  const [windowLabel, setWindowLabel] = useState<string>('');
  const autoStartHydratedRef = useRef(false);

  useEffect(() => {
    const label = appWindow.label;
    setWindowLabel(label);

    if (label === 'main') {
      document.body.classList.add('bg-white', 'dark:bg-gray-900');
      initChats();
      // Ensure webview gets keyboard focus
      window.focus();
    }
  }, []);

  // Sync auto-start to registry AFTER zustand hydration completes (fix #2)
  useEffect(() => {
    if (windowLabel !== 'main') return;
    const unsub = useSettingsStore.persist.onFinishHydration(() => {
      autoStartHydratedRef.current = true;
      const currentAutoStart = useSettingsStore.getState().autoStart;
      if (window.__TAURI__) {
        window.__TAURI__.invoke('set_auto_start', { enabled: currentAutoStart }).catch(() => {});
      }
    });
    // Also handle case where hydration already finished
    if (useSettingsStore.persist.hasHydrated()) {
      autoStartHydratedRef.current = true;
      if (window.__TAURI__) {
        window.__TAURI__.invoke('set_auto_start', { enabled: autoStart }).catch(() => {});
      }
    }
    return () => { unsub(); };
  }, [windowLabel, autoStart]);

  // Re-focus webview when window becomes focused (e.g. after returning from float ball)
  useEffect(() => {
    if (windowLabel !== 'main') return;
    const unlisten = listen('tauri://focus', () => {
      window.focus();
    });
    return () => { unlisten.then(f => f()); };
  }, [windowLabel]);

  useEffect(() => {
    document.documentElement.style.setProperty('--color-primary', themeColor);
    document.documentElement.classList.toggle('dark', darkMode);
  }, [themeColor, darkMode]);

  // Detect window minimize and show float ball (uses Rust-emitted event, fix #10)
  useEffect(() => {
    if (windowLabel !== 'main') return;

    // Listen for Rust-emitted minimize event (no more polling!)
    const unlistenMinimize = listen('main-window-minimized', () => {
      if (window.__TAURI__) {
        window.__TAURI__.invoke('show_float_ball').catch(() => {});
      }
    });

    // Keep visibilitychange as fallback for other hide scenarios (e.g. Win+D)
    const handleVisibility = async () => {
      if (document.visibilityState === 'hidden' && window.__TAURI__) {
        try {
          const minimized = await appWindow.isMinimized();
          if (minimized) {
            await window.__TAURI__.invoke('show_float_ball');
          }
        } catch (_) {}
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unlistenMinimize.then(f => f());
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [windowLabel]);

  if (windowLabel === 'crop-overlay') return <CropOverlay />;
  if (windowLabel === 'main') return <MainWindow />;
  if (windowLabel === 'float-ball-panel') return <FloatBallPanel />;
  if (windowLabel === 'float-ball') return <FloatBall />;

  return null;
}

export default App;
