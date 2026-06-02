import { useCallback } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { useSettingsStore } from '@/stores/settingsStore';

export default function FloatBall() {
  const floatBallSize = useSettingsStore(s => s.floatBallSize);
  const handleClick = useCallback(async () => {
    await window.__TAURI__.invoke('show_float_ball_panel');
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="w-full h-full flex items-center justify-center cursor-pointer"
      style={{ background: 'transparent' }}
    >
      <div
        className="rounded-full flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-transform duration-200 select-none"
        style={{
          width: `${floatBallSize}px`,
          height: `${floatBallSize}px`,
          background: 'var(--color-primary)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25), 0 0 0 2px rgba(255,255,255,0.15)',
        }}
        role="button"
        tabIndex={0}
        aria-label="打开AI截屏面板"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        onMouseDown={async (e) => {
          e.preventDefault();
          let moved = false;
          const startX = e.clientX;
          const startY = e.clientY;

          const onMove = (ev: MouseEvent) => {
            if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) {
              moved = true;
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              appWindow.startDragging();
            }
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (!moved) handleClick();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </div>
    </div>
  );
}
