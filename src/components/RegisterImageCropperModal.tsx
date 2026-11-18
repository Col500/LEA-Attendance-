import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X, RotateCcw, AlertTriangle } from 'lucide-react';
import type { NormalizedCropBox } from '../types/attendance';
import { clampCropBox, MIN_RECOMMENDED_SHORT_SIDE_PX } from '../services/imagePreprocessing';

interface RegisterImageCropperModalProps {
  isOpen: boolean;
  imageUrl: string;
  initialCropBox: NormalizedCropBox | null;
  imageDimensions: { width: number; height: number } | null;
  onApplyCrop: (crop: NormalizedCropBox | null) => void;
  onClose: () => void;
}

type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

interface CropBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const DEFAULT_BOUNDS: CropBounds = {
  left: 0.04,
  top: 0.04,
  right: 0.96,
  bottom: 0.96
};

const FULL_BOUNDS: CropBounds = {
  left: 0,
  top: 0,
  right: 1,
  bottom: 1
};

const MIN_SPAN = 0.08;

function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

export const RegisterImageCropperModal: React.FC<RegisterImageCropperModalProps> = ({
  isOpen,
  imageUrl,
  initialCropBox,
  imageDimensions,
  onApplyCrop,
  onClose
}) => {
  const [bounds, setBounds] = useState<CropBounds>(DEFAULT_BOUNDS);
  const stageRef = useRef<HTMLDivElement>(null);

  const dragSessionRef = useRef<{
    handle: DragHandle;
    startClientX: number;
    startClientY: number;
    startBounds: CropBounds;
    stageWidth: number;
    stageHeight: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (initialCropBox) {
      setBounds({
        left: clamp01(initialCropBox.x),
        top: clamp01(initialCropBox.y),
        right: clamp01(initialCropBox.x + initialCropBox.width),
        bottom: clamp01(initialCropBox.y + initialCropBox.height)
      });
    } else {
      setBounds(DEFAULT_BOUNDS);
    }
  }, [isOpen, initialCropBox]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const session = dragSessionRef.current;
    if (!session) return;

    e.preventDefault();
    const dx = (e.clientX - session.startClientX) / Math.max(1, session.stageWidth);
    const dy = (e.clientY - session.startClientY) / Math.max(1, session.stageHeight);
    const s = session.startBounds;

    let next: CropBounds = { ...s };

    if (session.handle === 'move') {
      const w = s.right - s.left;
      const h = s.bottom - s.top;
      const clampedLeft = Math.max(0, Math.min(1 - w, s.left + dx));
      const clampedTop = Math.max(0, Math.min(1 - h, s.top + dy));
      next = {
        left: clampedLeft,
        top: clampedTop,
        right: clampedLeft + w,
        bottom: clampedTop + h
      };
    } else {
      if (session.handle.includes('w')) {
        next.left = Math.max(0, Math.min(s.right - MIN_SPAN, s.left + dx));
      }
      if (session.handle.includes('e')) {
        next.right = Math.min(1, Math.max(s.left + MIN_SPAN, s.right + dx));
      }
      if (session.handle.includes('n')) {
        next.top = Math.max(0, Math.min(s.bottom - MIN_SPAN, s.top + dy));
      }
      if (session.handle.includes('s')) {
        next.bottom = Math.min(1, Math.max(s.top + MIN_SPAN, s.bottom + dy));
      }
    }

    setBounds(next);
  }, []);

  const endDrag = useCallback(() => {
    dragSessionRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [isOpen, handlePointerMove, endDrag]);

  if (!isOpen) return null;

  const startDrag = (handle: DragHandle) => (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 10 || rect.height < 10) return;

    dragSessionRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBounds: { ...bounds },
      stageWidth: rect.width,
      stageHeight: rect.height
    };
  };

  const widthFrac = Math.max(MIN_SPAN, bounds.right - bounds.left);
  const heightFrac = Math.max(MIN_SPAN, bounds.bottom - bounds.top);

  const effW = imageDimensions?.width || 1080;
  const effH = imageDimensions?.height || 1920;
  const estOutW = Math.round(widthFrac * effW);
  const estOutH = Math.round(heightFrac * effH);
  const isTooSmall = Math.min(estOutW, estOutH) < MIN_RECOMMENDED_SHORT_SIDE_PX;

  const isFullFrame =
    bounds.left <= 0.005 &&
    bounds.top <= 0.005 &&
    bounds.right >= 0.995 &&
    bounds.bottom >= 0.995;

  const handleApply = () => {
    if (isFullFrame) {
      onApplyCrop(null);
      onClose();
      return;
    }
    const normalized = clampCropBox({
      x: bounds.left,
      y: bounds.top,
      width: widthFrac,
      height: heightFrac
    });
    onApplyCrop(normalized);
    onClose();
  };

  const handleReset = () => {
    setBounds(FULL_BOUNDS);
  };

  const leftPct = `${bounds.left * 100}%`;
  const topPct = `${bounds.top * 100}%`;
  const rightPct = `${(1 - bounds.right) * 100}%`;
  const bottomPct = `${(1 - bounds.bottom) * 100}%`;
  const widthPct = `${widthFrac * 100}%`;
  const heightPct = `${heightFrac * 100}%`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black text-white flex flex-col select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Image cropper"
    >
      {/* Minimal Top Bar */}
      <div className="px-3 sm:px-5 py-2.5 bg-zinc-950/90 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center w-10 h-10 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer"
          aria-label="Cancel crop"
        >
          <X className="w-5 h-5" />
        </button>

        {isTooSmall ? (
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-300 px-2.5 py-1 rounded bg-amber-950/70 border border-amber-700/60 tabular-nums">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{estOutW}×{estOutH}px (too tight)</span>
          </div>
        ) : (
          <div className="text-[11px] font-mono text-zinc-400 tabular-nums">
            {estOutW}×{estOutH}px
          </div>
        )}

        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-zinc-200 hover:text-white hover:bg-zinc-800 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>

      {/* Fullscreen Touch Drag Stage */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
        <div
          ref={stageRef}
          className="relative inline-block max-w-full max-h-full touch-none select-none"
        >
          <img
            src={imageUrl}
            alt="Register photograph"
            draggable={false}
            className="block max-h-[calc(100dvh-136px)] max-w-full w-auto h-auto object-contain pointer-events-none select-none"
          />

          {/* 4 Dark Scrim Masks outside active crop box */}
          <div
            className="absolute inset-x-0 top-0 bg-black/65 pointer-events-none"
            style={{ height: topPct }}
          />
          <div
            className="absolute inset-x-0 bottom-0 bg-black/65 pointer-events-none"
            style={{ height: bottomPct }}
          />
          <div
            className="absolute left-0 bg-black/65 pointer-events-none"
            style={{ top: topPct, height: heightPct, width: leftPct }}
          />
          <div
            className="absolute right-0 bg-black/65 pointer-events-none"
            style={{ top: topPct, height: heightPct, width: rightPct }}
          />

          {/* Interactive Crop Selection Box */}
          <div
            onPointerDown={startDrag('move')}
            className="absolute border-2 border-white touch-none cursor-move"
            style={{
              left: leftPct,
              top: topPct,
              width: widthPct,
              height: heightPct
            }}
          >
            {/* Rule-of-thirds gridlines */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
            </div>

            {/* Edge Drag Handles (Top, Bottom, Left, Right) */}
            <div
              onPointerDown={startDrag('n')}
              className="absolute -top-4 left-6 right-6 h-8 flex items-center justify-center cursor-ns-resize touch-none"
              aria-label="Drag top edge"
            >
              <div className="w-10 h-1 rounded-full bg-white shadow-md" />
            </div>
            <div
              onPointerDown={startDrag('s')}
              className="absolute -bottom-4 left-6 right-6 h-8 flex items-center justify-center cursor-ns-resize touch-none"
              aria-label="Drag bottom edge"
            >
              <div className="w-10 h-1 rounded-full bg-white shadow-md" />
            </div>
            <div
              onPointerDown={startDrag('w')}
              className="absolute -left-4 top-6 bottom-6 w-8 flex items-center justify-center cursor-ew-resize touch-none"
              aria-label="Drag left edge"
            >
              <div className="h-10 w-1 rounded-full bg-white shadow-md" />
            </div>
            <div
              onPointerDown={startDrag('e')}
              className="absolute -right-4 top-6 bottom-6 w-8 flex items-center justify-center cursor-ew-resize touch-none"
              aria-label="Drag right edge"
            >
              <div className="h-10 w-1 rounded-full bg-white shadow-md" />
            </div>

            {/* Corner Drag Handles (NW, NE, SW, SE) with generous Android touch targets */}
            <div
              onPointerDown={startDrag('nw')}
              className="absolute -top-5 -left-5 w-11 h-11 flex items-center justify-center cursor-nwse-resize touch-none"
              aria-label="Drag top left corner"
            >
              <div className="w-5 h-5 border-t-4 border-l-4 border-emerald-400" />
            </div>
            <div
              onPointerDown={startDrag('ne')}
              className="absolute -top-5 -right-5 w-11 h-11 flex items-center justify-center cursor-nesw-resize touch-none"
              aria-label="Drag top right corner"
            >
              <div className="w-5 h-5 border-t-4 border-r-4 border-emerald-400" />
            </div>
            <div
              onPointerDown={startDrag('sw')}
              className="absolute -bottom-5 -left-5 w-11 h-11 flex items-center justify-center cursor-nesw-resize touch-none"
              aria-label="Drag bottom left corner"
            >
              <div className="w-5 h-5 border-b-4 border-l-4 border-emerald-400" />
            </div>
            <div
              onPointerDown={startDrag('se')}
              className="absolute -bottom-5 -right-5 w-11 h-11 flex items-center justify-center cursor-nwse-resize touch-none"
              aria-label="Drag bottom right corner"
            >
              <div className="w-5 h-5 border-b-4 border-r-4 border-emerald-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="px-4 py-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={handleApply}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold shadow-sm cursor-pointer"
        >
          <Check className="w-4 h-4" />
          <span>Apply Crop</span>
        </button>
      </div>
    </div>
  );
};
