import React, { useState, useEffect } from 'react';
import { Crop, RotateCcw, RotateCw, Check, X, AlertTriangle, RefreshCw } from 'lucide-react';
import type { NormalizedCropBox } from '../types/attendance';
import { clampCropBox, MIN_RECOMMENDED_SHORT_SIDE_PX } from '../services/imagePreprocessing';

interface RegisterImageCropperModalProps {
  isOpen: boolean;
  imageUrl: string;
  rotation: number;
  initialCropBox: NormalizedCropBox | null;
  imageDimensions: { width: number; height: number } | null;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onApplyCrop: (crop: NormalizedCropBox | null) => void;
  onClose: () => void;
}

export const RegisterImageCropperModal: React.FC<RegisterImageCropperModalProps> = ({
  isOpen,
  imageUrl,
  rotation,
  initialCropBox,
  imageDimensions,
  onRotateCw,
  onRotateCcw,
  onApplyCrop,
  onClose
}) => {
  const [topPct, setTopPct] = useState(5);
  const [bottomPct, setBottomPct] = useState(95);
  const [leftPct, setLeftPct] = useState(5);
  const [rightPct, setRightPct] = useState(95);

  useEffect(() => {
    if (!isOpen) return;
    if (initialCropBox) {
      setLeftPct(Math.round(initialCropBox.x * 100));
      setTopPct(Math.round(initialCropBox.y * 100));
      setRightPct(Math.round((initialCropBox.x + initialCropBox.width) * 100));
      setBottomPct(Math.round((initialCropBox.y + initialCropBox.height) * 100));
    } else {
      setTopPct(5);
      setBottomPct(95);
      setLeftPct(5);
      setRightPct(95);
    }
  }, [isOpen, initialCropBox]);

  if (!isOpen) return null;

  const widthPct = Math.max(10, rightPct - leftPct);
  const heightPct = Math.max(10, bottomPct - topPct);

  const rotSwap = rotation === 90 || rotation === 270;
  const effW = imageDimensions ? (rotSwap ? imageDimensions.height : imageDimensions.width) : 1200;
  const effH = imageDimensions ? (rotSwap ? imageDimensions.width : imageDimensions.height) : 800;

  const estOutW = Math.round((widthPct / 100) * effW);
  const estOutH = Math.round((heightPct / 100) * effH);
  const isTooSmall = Math.min(estOutW, estOutH) < MIN_RECOMMENDED_SHORT_SIDE_PX;

  const handleApply = () => {
    const normalized = clampCropBox({
      x: leftPct / 100,
      y: topPct / 100,
      width: widthPct / 100,
      height: heightPct / 100
    });
    onApplyCrop(normalized);
    onClose();
  };

  const handleResetFull = () => {
    setTopPct(0);
    setBottomPct(100);
    setLeftPct(0);
    setRightPct(100);
    onApplyCrop(null);
    onClose();
  };

  const applyPreset = (preset: 'full' | 'table-center' | 'right-grid') => {
    if (preset === 'full') {
      setTopPct(0);
      setBottomPct(100);
      setLeftPct(0);
      setRightPct(100);
    } else if (preset === 'table-center') {
      setTopPct(10);
      setBottomPct(92);
      setLeftPct(5);
      setRightPct(95);
    } else {
      setTopPct(12);
      setBottomPct(92);
      setLeftPct(30);
      setRightPct(98);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cropper-title"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Crop className="w-4 h-4 text-emerald-400" />
            <div>
              <h3 id="cropper-title" className="text-sm font-bold">
                Crop to Attendance Table Region
              </h3>
              <p className="text-[11px] text-slate-300">
                Trim desk background and unused margins. Manual crop &amp; 90° rotation only (no perspective warp).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
            aria-label="Close cropper"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Visual Crop Preview + Edge Controls */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-50">
          {/* Preview Frame */}
          <div className="lg:col-span-8 bg-slate-950 rounded-lg border border-slate-800 p-3 flex items-center justify-center relative min-h-[260px]">
            <div className="relative inline-block max-h-[55vh] overflow-hidden">
              <img
                src={imageUrl}
                alt="Register crop preview"
                className="max-h-[52vh] w-auto max-w-full object-contain block"
                style={{
                  transform: `rotate(${rotation}deg)`
                }}
              />
              {/* Active Crop Overlay */}
              <div
                className="absolute border-2 border-emerald-400 bg-emerald-400/10 shadow-[0_0_0_9999px_rgba(2,6,23,0.62)] pointer-events-none"
                style={{
                  top: `${topPct}%`,
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`
                }}
              >
                <div className="absolute -top-5 left-0 bg-emerald-700 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap">
                  Selected Attendance Area ({estOutW}×{estOutH}px)
                </div>
              </div>
            </div>
          </div>

          {/* Sliders & Orientation Controls */}
          <div className="lg:col-span-4 space-y-4 bg-white p-4 rounded-lg border border-slate-200 text-xs">
            <div>
              <div className="font-bold text-slate-800 mb-2">1. Quick Presets &amp; Rotation</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => applyPreset('table-center')}
                  className="px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-900 font-semibold hover:bg-emerald-100 cursor-pointer"
                >
                  Focus Register Sheet
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('full')}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Full Frame
                </button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={onRotateCcw}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>-90°</span>
                </button>
                <button
                  type="button"
                  onClick={onRotateCw}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>+90°</span>
                </button>
              </div>
            </div>

            <div className="space-y-2.5 border-t border-slate-100 pt-3">
              <div className="font-bold text-slate-800">2. Adjust Attendance Region Edges</div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                  <span>Top Edge</span>
                  <span className="font-mono">{topPct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={bottomPct - 15}
                  value={topPct}
                  onChange={(e) => setTopPct(Number(e.target.value))}
                  className="w-full accent-emerald-700"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                  <span>Bottom Edge</span>
                  <span className="font-mono">{bottomPct}%</span>
                </div>
                <input
                  type="range"
                  min={topPct + 15}
                  max={100}
                  value={bottomPct}
                  onChange={(e) => setBottomPct(Number(e.target.value))}
                  className="w-full accent-emerald-700"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                  <span>Left Edge</span>
                  <span className="font-mono">{leftPct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={rightPct - 15}
                  value={leftPct}
                  onChange={(e) => setLeftPct(Number(e.target.value))}
                  className="w-full accent-emerald-700"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                  <span>Right Edge</span>
                  <span className="font-mono">{rightPct}%</span>
                </div>
                <input
                  type="range"
                  min={leftPct + 15}
                  max={100}
                  value={rightPct}
                  onChange={(e) => setRightPct(Number(e.target.value))}
                  className="w-full accent-emerald-700"
                />
              </div>
            </div>

            {isTooSmall && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  Cropped region is under {MIN_RECOMMENDED_SHORT_SIDE_PX}px ({estOutW}×{estOutH}px). Keep enough margin so handwriting stays legible.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleResetFull}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset to Full Image</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Apply Crop</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
