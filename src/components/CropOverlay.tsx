import { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';

export default function CropOverlay() {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const cropRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Listen for crop-image event from Rust backend
  useEffect(() => {
    const unlisten = listen('crop-image', (event) => {
      const base64 = event.payload as string;
      setImageBase64(base64);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!cropRef.current) return;
    e.preventDefault();
    isDraggingRef.current = true;
    const rect = cropRef.current.getBoundingClientRect();
    setCropStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setCropEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !cropRef.current) return;
      const rect = cropRef.current.getBoundingClientRect();
      setCropEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const handleMouseUp = async () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;

      if (!cropStart || !cropEnd || !imageBase64) return;

      const img = new Image();
      img.src = `data:image/png;base64,${imageBase64}`;
      await new Promise<void>((resolve) => { img.onload = () => resolve(); });

      const canvas = document.createElement('canvas');
      const containerWidth = cropRef.current?.clientWidth || img.width;
      const containerHeight = cropRef.current?.clientHeight || img.height;
      const scaleX = img.naturalWidth / containerWidth;
      const scaleY = img.naturalHeight / containerHeight;

      const x = Math.min(cropStart.x, cropEnd.x) * scaleX;
      const y = Math.min(cropStart.y, cropEnd.y) * scaleY;
      const w = Math.abs(cropEnd.x - cropStart.x) * scaleX;
      const h = Math.abs(cropEnd.y - cropStart.y) * scaleY;

      if (w < 10 || h < 10) {
        // Too small, cancel
        setCropStart(null);
        setCropEnd(null);
        await window.__TAURI__.invoke('hide_crop_overlay');
        return;
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

      const croppedBase64 = canvas.toDataURL('image/png').replace(/^data:image\/\w+;base64,/, '');
      setCropStart(null);
      setCropEnd(null);

      await window.__TAURI__.invoke('complete_crop', { croppedBase64 });
    };

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        isDraggingRef.current = false;
        setCropStart(null);
        setCropEnd(null);
        await window.__TAURI__.invoke('hide_crop_overlay');
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [cropStart, cropEnd, imageBase64]);

  if (!imageBase64) {
    return null;
  }

  const hasSelection = cropStart && cropEnd && (cropStart.x !== cropEnd.x || cropStart.y !== cropEnd.y);
  const selectionWidth = hasSelection ? Math.abs(cropEnd.x - cropStart.x) : 0;
  const selectionHeight = hasSelection ? Math.abs(cropEnd.y - cropStart.y) : 0;

  return (
    <div
      ref={cropRef}
      className="fixed inset-0 bg-black/60 cursor-crosshair select-none"
      onMouseDown={handleMouseDown}
    >
      <img
        src={`data:image/png;base64,${imageBase64}`}
        alt="select area"
        className="w-full h-full object-contain pointer-events-none"
        draggable={false}
      />
      {hasSelection && (
        <>
          <div
            className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              left: Math.min(cropStart.x, cropEnd.x),
              top: Math.min(cropStart.y, cropEnd.y),
              width: selectionWidth,
              height: selectionHeight,
            }}
          />
          {/* Dimension indicator */}
          <div
            className="absolute bg-black/70 text-white text-xs px-2 py-1 rounded pointer-events-none"
            style={{
              left: Math.min(cropStart.x, cropEnd.x) + selectionWidth / 2 - 30,
              top: Math.min(cropStart.y, cropEnd.y) + selectionHeight + 8,
            }}
          >
            {Math.round(selectionWidth)} × {Math.round(selectionHeight)}
          </div>
        </>
      )}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/60 px-4 py-2 rounded-full">
        拖动选择截图区域，按 Esc 取消
      </div>
    </div>
  );
}
