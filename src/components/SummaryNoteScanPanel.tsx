import React, { useState, useRef } from 'react';
import {
  Camera,
  UploadCloud,
  Crop,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Plus,
  NotebookPen,
  Maximize2,
  X
} from 'lucide-react';
import {
  AttendanceSession,
  ClassItem,
  NormalizedCropBox,
  SchoolInfo,
  Student,
  SummaryNoteExtractedClass,
  SummaryNoteExtractionResult
} from '../types/attendance';
import {
  preprocessRegisterImage,
  PreprocessedImageResult
} from '../services/imagePreprocessing';
import { RegisterImageCropperModal } from './RegisterImageCropperModal';
import { LiveCameraViewfinderModal } from './LiveCameraViewfinderModal';

interface EditableSummaryRow extends SummaryNoteExtractedClass {
  localId: string;
}

interface SummaryNoteScanPanelProps {
  school?: SchoolInfo;
  classes: ClassItem[];
  students: Student[];
  selectedClassId: string;
  selectedClassName: string;
  selectedDate: string;
  onSelectClassId: (classId: string) => void;
  onSaveSummarySessions: (
    sessionsToSave: AttendanceSession[],
    confirmedClassIds: string[]
  ) => Promise<void>;
}

const MAX_DIMENSION = 1800;

export const SummaryNoteScanPanel: React.FC<SummaryNoteScanPanelProps> = ({
  school,
  classes,
  students,
  selectedClassId,
  selectedClassName,
  selectedDate,
  onSaveSummarySessions
}) => {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);

  const [rawSourceUrl, setRawSourceUrl] = useState<string | null>(null);
  const [rawDimensions, setRawDimensions] = useState<{ width: number; height: number } | null>(null);
  const [cropBox, setCropBox] = useState<NormalizedCropBox | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preprocessMeta, setPreprocessMeta] = useState<PreprocessedImageResult | null>(null);

  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [isLiveCameraOpen, setIsLiveCameraOpen] = useState(false);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aiMetaNote, setAiMetaNote] = useState<string | null>(null);
  const [rows, setRows] = useState<EditableSummaryRow[]>([]);
  const [hasExtracted, setHasExtracted] = useState(false);

  const resetCapture = () => {
    setRawSourceUrl(null);
    setRawDimensions(null);
    setCropBox(null);
    setPreviewUrl(null);
    setPreprocessMeta(null);
    setRows([]);
    setHasExtracted(false);
    setErrorMsg(null);
    setAiMetaNote(null);
  };

  const applyPreprocess = async (
    sourceDataUrl: string,
    targetCrop: NormalizedCropBox | null
  ): Promise<PreprocessedImageResult> => {
    const processed = await preprocessRegisterImage({
      source: sourceDataUrl,
      rotation: 0,
      cropBox: targetCrop,
      maxDimension: MAX_DIMENSION
    });
    setPreviewUrl(processed.dataUrl);
    setPreprocessMeta(processed);
    setRawDimensions({ width: processed.originalWidth, height: processed.originalHeight });
    return processed;
  };

  const handleImageDataUrl = async (dataUrl: string) => {
    setErrorMsg(null);
    setRows([]);
    setHasExtracted(false);
    setAiMetaNote(null);
    setRawSourceUrl(dataUrl);
    setCropBox(null);
    try {
      await applyPreprocess(dataUrl, null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not process the selected notebook photo.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a JPEG, PNG, or WebP photograph of your summary notebook.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void handleImageDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const runSummaryAnalysis = async (overrideDataUrl?: string) => {
    const targetDataUrl = overrideDataUrl || previewUrl;
    if (!targetDataUrl) {
      setErrorMsg('Capture or upload a handwritten summary page first.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setAiMetaNote(null);

    try {
      const classRefs = classes.map((c) => ({
        id: c.id,
        name: c.name,
        enrolledCount: students.filter((s) => s.classId === c.id && s.active).length
      }));

      const resp = await fetch('/api/analyze-summary-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: targetDataUrl,
          classes: classRefs,
          selectedClassName,
          date: selectedDate
        })
      });

      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok) {
        throw new Error(
          payload?.error || 'Could not analyze the handwritten summary notebook page.'
        );
      }

      const data = payload.data as SummaryNoteExtractionResult;
      setAiMetaNote(
        data.aiNote || `Processed via ${data.modelUsed}`
      );

      const extractedRows: EditableSummaryRow[] = (data.items || []).map((item, idx) => {
        // If only 1 item was extracted without a matched class, default to the currently selected class
        const fallbackClassId =
          item.matchedClassId ||
          (data.items.length === 1 && selectedClassId ? selectedClassId : null);
        return {
          ...item,
          matchedClassId: fallbackClassId,
          localId: `sum-${Date.now()}-${idx}`
        };
      });

      if (extractedRows.length === 0) {
        // Provide a quick editable row prefilled with the active class so admin isn't blocked
        const activeEnrolled = students.filter(
          (s) => s.classId === selectedClassId && s.active
        ).length;
        setRows([
          {
            localId: `sum-manual-${Date.now()}`,
            classNameDetected: selectedClassName || 'Selected Class',
            matchedClassId: selectedClassId || null,
            presentCount: 0,
            absentCount: 0,
            totalCount: activeEnrolled,
            hasMathMismatch: activeEnrolled > 0,
            notes: 'No numbers read clearly from photo — enter counts below or retake a sharper crop.'
          }
        ]);
      } else {
        setRows(extractedRows);
      }

      setHasExtracted(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to read handwritten summary note.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyCrop = async (nextCrop: NormalizedCropBox | null) => {
    setIsCropperOpen(false);
    setCropBox(nextCrop);
    if (!rawSourceUrl) return;
    try {
      const processed = await applyPreprocess(rawSourceUrl, nextCrop);
      if (hasExtracted) {
        await runSummaryAnalysis(processed.dataUrl);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not apply crop to notebook photo.');
    }
  };

  const updateRowField = (
    localId: string,
    patch: Partial<Pick<EditableSummaryRow, 'matchedClassId' | 'presentCount' | 'absentCount' | 'totalCount'>>
  ) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.localId !== localId) return row;
        const nextPresent =
          typeof patch.presentCount === 'number'
            ? Math.max(0, patch.presentCount)
            : row.presentCount;
        const nextAbsent =
          typeof patch.absentCount === 'number'
            ? Math.max(0, patch.absentCount)
            : row.absentCount;
        const nextTotal =
          typeof patch.totalCount === 'number'
            ? Math.max(0, patch.totalCount)
            : typeof patch.presentCount === 'number' || typeof patch.absentCount === 'number'
            ? nextPresent + nextAbsent
            : row.totalCount;
        const nextClassId =
          patch.matchedClassId !== undefined ? patch.matchedClassId : row.matchedClassId;
        const matchedCls = classes.find((c) => c.id === nextClassId);

        return {
          ...row,
          matchedClassId: nextClassId,
          classNameDetected: matchedCls ? matchedCls.name : row.classNameDetected,
          presentCount: nextPresent,
          absentCount: nextAbsent,
          totalCount: nextTotal,
          hasMathMismatch: nextTotal > 0 && nextPresent + nextAbsent !== nextTotal
        };
      })
    );
  };

  const handleAddRow = () => {
    const usedIds = new Set(rows.map((r) => r.matchedClassId).filter(Boolean));
    const nextUnassigned = classes.find((c) => !usedIds.has(c.id)) || classes[0];
    const enrolled = nextUnassigned
      ? students.filter((s) => s.classId === nextUnassigned.id && s.active).length
      : 0;
    setRows((prev) => [
      ...prev,
      {
        localId: `sum-add-${Date.now()}`,
        classNameDetected: nextUnassigned?.name || 'Class',
        matchedClassId: nextUnassigned?.id || null,
        presentCount: 0,
        absentCount: 0,
        totalCount: enrolled,
        hasMathMismatch: enrolled > 0,
        notes: null
      }
    ]);
  };

  const handleRemoveRow = (localId: string) => {
    setRows((prev) => prev.filter((r) => r.localId !== localId));
  };

  const handleConfirmAll = async () => {
    setErrorMsg(null);
    const validRows = rows.filter((r) => r.matchedClassId);
    if (validRows.length === 0) {
      setErrorMsg('Assign at least one matched class before saving.');
      return;
    }

    const unmatched = rows.filter((r) => !r.matchedClassId);
    if (unmatched.length > 0) {
      setErrorMsg(
        `Please select a matching class for "${unmatched[0].classNameDetected}" or remove the row before saving.`
      );
      return;
    }

    setIsSaving(true);
    try {
      const sessionsToSave: AttendanceSession[] = [];
      const confirmedClassIds: string[] = [];

      for (const row of validRows) {
        const cls = classes.find((c) => c.id === row.matchedClassId);
        if (!cls) continue;
        const total = row.totalCount > 0 ? row.totalCount : row.presentCount + row.absentCount;
        confirmedClassIds.push(cls.id);
        sessionsToSave.push({
          id: `ses-summary-${cls.id.slice(0, 8)}-${selectedDate}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          date: selectedDate,
          classId: cls.id,
          classGrade: cls.name,
          term: school?.currentTerm || 'First Term',
          sessionYear: school?.academicSession || '2025/2026 Academic Session',
          totalEnrolled: total,
          presentCount: row.presentCount,
          absentCount: row.absentCount,
          blankCount: 0,
          uncertainCount: 0,
          unmappedCount: 0,
          reviewStatus: 'Confirmed',
          captureMode: 'summary',
          recordedBy: school?.administratorName || 'School Administrator',
          verifiedBy: `${school?.administratorName || 'School Administrator'} (Written Summary Scan)`,
          notes: `Scanned from handwritten summary note (${row.presentCount} Present, ${row.absentCount} Absent, Total ${total}).`,
          sourceDraftId: `summary-${cls.id.slice(0, 8)}-${selectedDate}-${Date.now()}`
        });
      }

      await onSaveSummarySessions(sessionsToSave, confirmedClassIds);
      resetCapture();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save written summary attendance.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 flex items-start gap-2.5">
        <NotebookPen className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Written Summary Mode</span> — captures class-level totals
          (Present, Absent, Total) from your handwritten notebook. Individual pupil metrics (starred
          pupils and punctuality ratings) apply only to dates scanned directly from the register.
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs text-rose-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Capture / Preview Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Capture Handwritten Summary Note
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Snap a single class entry or a full notebook page listing multiple classes — crop tightly for best accuracy.
            </p>
          </div>
        </div>

        {!previewUrl ? (
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center space-y-4 bg-slate-50/70">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
              <NotebookPen className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Photograph or upload your written summary page
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Example: &ldquo;{selectedClassName || 'Primary 3A'}: Present 26, Absent 4, Total 30&rdquo;
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 max-w-md mx-auto">
              <button
                type="button"
                onClick={() => setIsLiveCameraOpen(true)}
                className="min-h-[44px] flex-1 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Take Photo</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="min-h-[44px] flex-1 px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Upload from Gallery</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-950 max-w-xs mx-auto aspect-[9/16]">
              <img
                src={previewUrl}
                alt="Handwritten summary notebook preview"
                className="w-full h-full object-contain"
              />
              <button
                type="button"
                onClick={() => setIsFullscreenPreview(true)}
                className="absolute top-2.5 right-2.5 min-h-[36px] min-w-[36px] rounded-lg bg-slate-900/80 text-white inline-flex items-center justify-center hover:bg-slate-900 cursor-pointer"
                aria-label="Inspect summary photo fullscreen"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            {preprocessMeta && (
              <div className="text-center text-[11px] text-slate-500 tabular-nums">
                {preprocessMeta.outputWidth} × {preprocessMeta.outputHeight}px
                {cropBox ? ' · Cropped region active' : ''}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setIsCropperOpen(true)}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Crop className="w-4 h-4" />
                <span>{cropBox ? 'Edit Crop' : 'Crop'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsLiveCameraOpen(true)}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Retake</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Gallery</span>
              </button>
              <button
                type="button"
                onClick={resetCapture}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            </div>

            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => void runSummaryAnalysis()}
              className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Reading Handwritten Summary...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>{hasExtracted ? 'Re-Scan Summary Note' : 'Extract Class Totals'}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Verification & Batch Save Card */}
      {hasExtracted && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3.5 sm:px-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Verify Extracted Class Totals
              </h3>
              {aiMetaNote && (
                <p className="text-xs text-slate-500 mt-0.5">{aiMetaNote}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleAddRow}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Class Row</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {rows.map((row) => (
              <div key={row.localId} className="p-4 sm:px-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-500">
                      Matched Class (Written: &ldquo;{row.classNameDetected}&rdquo;)
                    </label>
                    <select
                      value={row.matchedClassId || ''}
                      onChange={(e) =>
                        updateRowField(row.localId, {
                          matchedClassId: e.target.value || null
                        })
                      }
                      className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">— Select matching class —</option>
                      {classes.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.localId)}
                      className="min-h-[40px] min-w-[40px] mt-5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer"
                      aria-label="Remove extracted class row"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-emerald-700 mb-1">
                      Present
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={row.presentCount}
                      onChange={(e) =>
                        updateRowField(row.localId, {
                          presentCount: parseInt(e.target.value || '0', 10)
                        })
                      }
                      className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold font-mono tabular-nums text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-rose-700 mb-1">
                      Absent
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={row.absentCount}
                      onChange={(e) =>
                        updateRowField(row.localId, {
                          absentCount: parseInt(e.target.value || '0', 10)
                        })
                      }
                      className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold font-mono tabular-nums text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Total
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={row.totalCount}
                      onChange={(e) =>
                        updateRowField(row.localId, {
                          totalCount: parseInt(e.target.value || '0', 10)
                        })
                      }
                      className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold font-mono tabular-nums text-slate-900"
                    />
                  </div>
                </div>

                {(row.hasMathMismatch || row.notes) && (
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      {row.hasMathMismatch
                        ? `Check totals: Present (${row.presentCount}) + Absent (${row.absentCount}) = ${row.presentCount + row.absentCount}, but Total is ${row.totalCount}.`
                        : row.notes}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="p-4 sm:px-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-600 tabular-nums">
              Ready to save <span className="font-bold text-slate-900">{rows.length}</span>{' '}
              {rows.length === 1 ? 'class summary' : 'class summaries'} for{' '}
              <span className="font-semibold text-slate-900">{selectedDate}</span>
            </div>
            <button
              type="button"
              disabled={isSaving || rows.length === 0}
              onClick={() => void handleConfirmAll()}
              className="min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Summary...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {rows.length === 1 ? 'Confirm & Move to Next Class' : `Confirm All ${rows.length} Classes`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen Edge-Drag Cropper */}
      {rawSourceUrl && (
        <RegisterImageCropperModal
          isOpen={isCropperOpen}
          imageUrl={rawSourceUrl}
          initialCropBox={cropBox}
          imageDimensions={rawDimensions}
          onApplyCrop={(next) => void handleApplyCrop(next)}
          onClose={() => setIsCropperOpen(false)}
        />
      )}

      {/* Live Camera Viewfinder */}
      <LiveCameraViewfinderModal
        isOpen={isLiveCameraOpen}
        title="Summary Notebook Camera"
        frameHintTop="Frame handwritten class totals clearly"
        frameHintBottom="Hold steady in good light"
        onCaptureDataUrl={(dataUrl) => {
          setIsLiveCameraOpen(false);
          void handleImageDataUrl(dataUrl);
        }}
        onFallbackToNativeCamera={() => {
          setIsLiveCameraOpen(false);
          nativeCameraInputRef.current?.click();
        }}
        onClose={() => setIsLiveCameraOpen(false)}
      />

      {/* Fullscreen Photo Preview */}
      {isFullscreenPreview && previewUrl && (
        <div
          className="fixed inset-0 z-[80] bg-black/95 flex flex-col items-center justify-center p-4"
          onClick={() => setIsFullscreenPreview(false)}
        >
          <button
            type="button"
            onClick={() => setIsFullscreenPreview(false)}
            className="absolute top-4 right-4 min-h-[44px] min-w-[44px] rounded-full bg-white/15 text-white inline-flex items-center justify-center cursor-pointer"
            aria-label="Close fullscreen preview"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={previewUrl}
            alt="Full handwritten summary preview"
            className="max-w-full max-h-[88dvh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
