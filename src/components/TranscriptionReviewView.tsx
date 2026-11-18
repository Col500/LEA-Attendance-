import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Maximize2,
  X,
  Search,
  Eye,
  Calendar,
  ShieldCheck,
  HelpCircle,
  Check,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Code2,
  UserCheck,
  UserX,
  Save,
  Minus,
  ArrowRight,
  History,
  SlidersHorizontal,
  Users,
  Crop,
  Layers,
  Loader2,
  WifiOff,
  ExternalLink,
  Trash2
} from 'lucide-react';
import {
  AttendanceCell,
  AttendanceSession,
  AttendanceSessionDraft,
  DayOfWeek,
  GeminiExtractionResult,
  RegisterFormatMode,
  RowStudentMapping,
  SchoolInfo,
  SessionStudentEntry,
  Student,
  ValidatedAttendanceStatus
} from '../types/attendance';
import {
  getReviewQueueStats,
  markDraftCellReviewed,
  reassignDraftCellSchedule,
  SCHOOL_WEEKDAYS,
  updateDraftCellStatus,
  updateDraftRowMapping,
  validateAndBuildSessionDraft
} from '../services/attendanceValidation';
import { isDeveloperDiagnosticsEnabled } from '../services/rosterStorage';
import { DuplicateSessionMatch } from '../services/duplicateSession';
import { isNetworkOrOfflineError, useOnlineStatus } from '../hooks/useOnlineStatus';

interface TranscriptionReviewViewProps {
  imageUri: string;
  rotation: number;
  className: string;
  selectedDate: string;
  attendancePeriod: string;
  formatMode: RegisterFormatMode;
  geminiResult: GeminiExtractionResult;
  initialDraft?: AttendanceSessionDraft;
  modelUsed: string;
  classStudents?: Student[];
  school?: SchoolInfo;
  isSupabaseLive?: boolean;
  isStagedVerifying?: boolean;
  onReAnalyze: () => void;
  onCropOrRetake?: () => void;
  onRetakeOrDelete?: () => void;
  onRunStagedVerification?: () => Promise<void>;
  onSaveDraftOnly?: (draft: AttendanceSessionDraft) => void;
  onCheckDuplicateSessions?: (params: {
    classId: string;
    className: string;
    date: string;
    period: string;
    draftId: string;
  }) => Promise<DuplicateSessionMatch[]>;
  onInspectExistingSession?: (session: AttendanceSession) => void;
  onConfirmAttendance: (
    confirmedSession: AttendanceSession,
    draft: AttendanceSessionDraft
  ) => void | Promise<void>;
  onCancel: () => void;
}

const STATUS_BADGE_CONFIG: Record<
  ValidatedAttendanceStatus,
  {
    label: string;
    short: string;
    buttonClass: string;
    activeClass: string;
    ringClass: string;
  }
> = {
  PRESENT: {
    label: 'PRESENT',
    short: '/',
    buttonClass: 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100',
    activeClass: 'bg-emerald-700 text-white border-emerald-800',
    ringClass: 'ring-emerald-600'
  },
  ABSENT: {
    label: 'ABSENT',
    short: '0',
    buttonClass: 'bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100',
    activeClass: 'bg-rose-700 text-white border-rose-800',
    ringClass: 'ring-rose-600'
  },
  BLANK: {
    label: 'BLANK',
    short: '—',
    buttonClass: 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200',
    activeClass: 'bg-slate-700 text-white border-slate-800',
    ringClass: 'ring-slate-600'
  },
  UNCERTAIN: {
    label: 'UNCERTAIN',
    short: '?',
    buttonClass: 'bg-amber-50 text-amber-950 border-amber-400 hover:bg-amber-100',
    activeClass: 'bg-amber-600 text-white border-amber-700',
    ringClass: 'ring-amber-600'
  }
};

export const TranscriptionReviewView: React.FC<TranscriptionReviewViewProps> = ({
  imageUri,
  rotation,
  className,
  selectedDate,
  attendancePeriod,
  geminiResult,
  initialDraft,
  modelUsed,
  classStudents = [],
  school,
  isSupabaseLive = false,
  isStagedVerifying = false,
  onReAnalyze,
  onCropOrRetake,
  onRetakeOrDelete,
  onRunStagedVerification,
  onSaveDraftOnly,
  onCheckDuplicateSessions,
  onInspectExistingSession,
  onConfirmAttendance,
  onCancel
}) => {
  const isOnline = useOnlineStatus();
  // Validated AttendanceSessionDraft state (never marks UNCERTAIN cells reviewed on mount)
  const [draft, setDraft] = useState<AttendanceSessionDraft>(() => {
    if (initialDraft) return initialDraft;
    return validateAndBuildSessionDraft(geminiResult, {
      classId: classStudents[0]?.classId || 'cls-unassigned',
      className,
      attendancePeriod: attendancePeriod || selectedDate,
      sourceImageMetadata: {
        fileName: 'register-scan',
        rotation,
        capturedAt: new Date().toISOString(),
        modelUsed
      },
      sourceImageReference: 'register-scan',
      classStudents
    });
  });

  // Sync draft if Stage 2 staged cell verification or re-analysis yields a new draft
  useEffect(() => {
    if (initialDraft && initialDraft.id !== draft.id) {
      setDraft(initialDraft);
      setActiveCellId(null);
      setSelectedWeek((prev) =>
        initialDraft.weeksDetected.includes(prev)
          ? prev
          : initialDraft.weeksDetected[0] || 'Week 1'
      );
    }
  }, [initialDraft, draft.id]);

  const [selectedWeek, setSelectedWeek] = useState<string>(
    () => draft.weeksDetected[0] || 'Week 1'
  );
  const [filterMode, setFilterMode] = useState<'all' | 'review' | 'unmapped'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [acknowledgeUnresolved, setAcknowledgeUnresolved] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateSessionMatch[]>([]);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);
  const [isFullscreenImage, setIsFullscreenImage] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<'table' | 'image'>('table');
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [showDeveloperDiagnostics, setShowDeveloperDiagnostics] = useState(false);
  const [draftSavedNotice, setDraftSavedNotice] = useState(false);
  const [isConfirmSubmitting, setIsConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmedDraftIds, setConfirmedDraftIds] = useState<string[]>([]);

  const devModeEnabled = isDeveloperDiagnosticsEnabled();
  const cellRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Highlighted structural/uncertainty warnings for admin visibility
  const highlightedAlerts = useMemo(() => {
    const relevantCodes = new Set([
      'MISSING_ROW',
      'UNCERTAIN_HEADING',
      'OVERWRITTEN_MARK',
      'CONFLICTING_DETECTION'
    ]);
    const seen = new Set<string>();
    return draft.validationIssues.filter((issue) => {
      if (!relevantCodes.has(issue.code)) return false;
      const key = `${issue.code}:${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [draft.validationIssues]);

  // Auto-persist updated draft edits locally as unconfirmed draft whenever draft changes
  useEffect(() => {
    if (onSaveDraftOnly && draft.editHistory.length > 0) {
      onSaveDraftOnly(draft);
    }
  }, [draft, onSaveDraftOnly]);

  // Quick student lookup
  const studentById = useMemo(() => {
    const map = new Map<string, Student>();
    classStudents.forEach((s) => map.set(s.id, s));
    return map;
  }, [classStudents]);

  // Roster students not yet mapped to any physical row
  const unmappedClassStudents = useMemo(() => {
    const mappedIds = new Set(
      draft.rowMappings.map((m) => m.studentId).filter(Boolean) as string[]
    );
    return classStudents.filter((s) => !mappedIds.has(s.id));
  }, [classStudents, draft.rowMappings]);

  // Review Queue Metrics across the entire draft
  const reviewQueue = useMemo(() => getReviewQueueStats(draft), [draft]);

  // Cells for currently selected week indexed by rowNumber + dayOfWeek
  const weekCellsByRow = useMemo(() => {
    const map = new Map<number, Partial<Record<DayOfWeek, AttendanceCell[]>>>();
    draft.cells
      .filter((c) => c.weekIdentifier === selectedWeek)
      .forEach((cell) => {
        if (!map.has(cell.rowNumber)) map.set(cell.rowNumber, {});
        const rowMap = map.get(cell.rowNumber)!;
        if (!rowMap[cell.dayOfWeek]) rowMap[cell.dayOfWeek] = [];
        rowMap[cell.dayOfWeek]!.push(cell);
      });
    return map;
  }, [draft.cells, selectedWeek]);

  // Active cell being edited inside accessible Cell Editor
  const activeCell = useMemo(
    () => (activeCellId ? draft.cells.find((c) => c.id === activeCellId) || null : null),
    [activeCellId, draft.cells]
  );

  const activeCellRowMapping = useMemo(
    () =>
      activeCell
        ? draft.rowMappings.find((m) => m.rowNumber === activeCell.rowNumber) || null
        : null,
    [activeCell, draft.rowMappings]
  );

  // Statistics for the currently viewed week
  const weekStats = useMemo(() => {
    const weekCells = draft.cells.filter((c) => c.weekIdentifier === selectedWeek);
    return {
      present: weekCells.filter((c) => c.status === 'PRESENT').length,
      absent: weekCells.filter((c) => c.status === 'ABSENT').length,
      blank: weekCells.filter((c) => c.status === 'BLANK').length,
      uncertain: weekCells.filter((c) => c.status === 'UNCERTAIN').length,
      unmappedRows: draft.rowMappings.filter((m) => !m.studentId).length
    };
  }, [draft, selectedWeek]);

  // Filter rows for inspection
  const displayedMappings = useMemo(() => {
    return draft.rowMappings.filter((mapping) => {
      const rowDays = weekCellsByRow.get(mapping.rowNumber) || {};
      const rowCells = Object.values(rowDays).flat().filter(Boolean) as AttendanceCell[];

      if (filterMode === 'unmapped' && mapping.studentId) {
        return false;
      }
      if (filterMode === 'review') {
        const hasReviewCell = rowCells.some(
          (c) => !c.reviewedByAdmin && (c.reviewRequired || c.status === 'UNCERTAIN')
        );
        if (!mapping.reviewRequired && mapping.studentId && !hasReviewCell) {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mappedStudent = mapping.studentId ? studentById.get(mapping.studentId) : undefined;
        const matchMappedName = mappedStudent?.fullName.toLowerCase().includes(q);
        const matchDetected = (mapping.detectedName || '').toLowerCase().includes(q);
        const matchAdm = (
          mappedStudent?.admissionNumber ||
          mapping.detectedAdmissionNumber ||
          ''
        )
          .toLowerCase()
          .includes(q);
        const matchRow = String(mapping.rowNumber).includes(q);
        if (!matchMappedName && !matchDetected && !matchAdm && !matchRow) return false;
      }

      return true;
    });
  }, [draft.rowMappings, weekCellsByRow, filterMode, searchQuery, studentById]);

  const handleCellStatusChange = (cellId: string, newStatus: ValidatedAttendanceStatus) => {
    setDraftSavedNotice(false);
    setDraft((prev) => updateDraftCellStatus(prev, cellId, newStatus));
  };

  const handleMarkReviewedOnly = (cellId: string) => {
    setDraftSavedNotice(false);
    setDraft((prev) => markDraftCellReviewed(prev, cellId));
  };

  const handleCellScheduleChange = (
    cellId: string,
    newWeek: string,
    newDay: DayOfWeek
  ) => {
    setDraftSavedNotice(false);
    setDraft((prev) => reassignDraftCellSchedule(prev, cellId, newWeek, newDay));
    setSelectedWeek(newWeek);
  };

  const handleRowStudentChange = (
    rowNumber: number,
    studentId: string,
    confidence: RowStudentMapping['mappingConfidence'] = 'MANUAL'
  ) => {
    setDraftSavedNotice(false);
    setDraft((prev) => updateDraftRowMapping(prev, rowNumber, studentId || null, confidence));
  };

  const jumpToCell = (targetCell: AttendanceCell) => {
    if (targetCell.weekIdentifier !== selectedWeek) {
      setSelectedWeek(targetCell.weekIdentifier);
    }
    setFilterMode('all');
    setActiveMobileTab('table');
    setActiveCellId(targetCell.id);

    setTimeout(() => {
      const btn = cellRefs.current[targetCell.id];
      if (btn) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        btn.focus();
      }
    }, 60);
  };

  const handleJumpToNextUnresolved = () => {
    if (reviewQueue.nextUnresolvedCell) {
      jumpToCell(reviewQueue.nextUnresolvedCell);
    }
  };

  const handleSaveAndNextUnresolved = () => {
    if (activeCell && !activeCell.reviewedByAdmin) {
      const updated = markDraftCellReviewed(draft, activeCell.id);
      setDraft(updated);
      const nextQueue = getReviewQueueStats(updated);
      if (nextQueue.nextUnresolvedCell) {
        jumpToCell(nextQueue.nextUnresolvedCell);
      } else {
        setActiveCellId(null);
      }
    } else if (reviewQueue.nextUnresolvedCell) {
      jumpToCell(reviewQueue.nextUnresolvedCell);
    } else {
      setActiveCellId(null);
    }
  };

  // Keyboard shortcuts while accessible cell editor is open
  useEffect(() => {
    if (!activeCellId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') setActiveCellId(null);
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'escape') {
        e.preventDefault();
        setActiveCellId(null);
      } else if (key === 'p') {
        e.preventDefault();
        handleCellStatusChange(activeCellId, 'PRESENT');
      } else if (key === 'a') {
        e.preventDefault();
        handleCellStatusChange(activeCellId, 'ABSENT');
      } else if (key === 'b') {
        e.preventDefault();
        handleCellStatusChange(activeCellId, 'BLANK');
      } else if (key === 'u') {
        e.preventDefault();
        handleCellStatusChange(activeCellId, 'UNCERTAIN');
      } else if (key === 'n') {
        e.preventDefault();
        handleSaveAndNextUnresolved();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleSaveDraft = () => {
    if (onSaveDraftOnly) {
      onSaveDraftOnly(draft);
    }
    setDraftSavedNotice(true);
  };

  const hasUnresolvedIssues =
    reviewQueue.uncertainCells > 0 ||
    reviewQueue.mappingIssueCells > 0 ||
    reviewQueue.awaitingReview > 0 ||
    draft.quarantinedItems.length > 0;

  const hasDuplicateMatches = duplicateMatches.length > 0;

  const handleOpenConfirmModal = async () => {
    setAcknowledgeUnresolved(false);
    setAcknowledgeDuplicate(false);
    setConfirmError(null);
    setDuplicateMatches([]);
    setShowConfirmModal(true);

    if (onSaveDraftOnly) {
      onSaveDraftOnly(draft);
    }

    if (onCheckDuplicateSessions) {
      setIsCheckingDuplicates(true);
      try {
        const matches = await onCheckDuplicateSessions({
          classId: draft.classId,
          className,
          date: selectedDate,
          period: draft.attendancePeriod,
          draftId: draft.id
        });
        setDuplicateMatches(matches);
      } catch {
        // Non-fatal check failure; let user proceed or retry when saving
      } finally {
        setIsCheckingDuplicates(false);
      }
    }
  };

  // Explicit confirmation (never silently converts UNCERTAIN -> PRESENT or ABSENT)
  // Prevents duplicate draft submission and preserves draft on remote failure
  const executeConfirmation = async () => {
    if (isConfirmSubmitting) return;
    if (hasUnresolvedIssues && !acknowledgeUnresolved) return;
    if (hasDuplicateMatches && !acknowledgeDuplicate) return;

    if (isSupabaseLive && !isOnline) {
      if (onSaveDraftOnly) {
        onSaveDraftOnly(draft);
      }
      setConfirmError(
        'Internet connectivity lost. Cannot confirm to Supabase while offline—your unsaved review draft has been preserved locally. Reconnect and click Retry Confirmation.'
      );
      return;
    }

    if (confirmedDraftIds.includes(draft.id)) {
      setConfirmError(
        'This draft has already been confirmed in this session. Duplicate confirmation was blocked.'
      );
      return;
    }

    const confirmedDraft: AttendanceSessionDraft = {
      ...draft,
      confirmationAcknowledgedUnresolved: hasUnresolvedIssues ? acknowledgeUnresolved : true
    };
    if (onSaveDraftOnly) {
      onSaveDraftOnly(confirmedDraft);
    }

    const entries: SessionStudentEntry[] = confirmedDraft.rowMappings.map((mapping, idx) => {
      const mappedStudent = mapping.studentId ? studentById.get(mapping.studentId) : undefined;
      const rowCells = confirmedDraft.cells.filter(
        (c) => c.rowNumber === mapping.rowNumber && c.weekIdentifier === selectedWeek
      );
      const presentDays = rowCells.filter((c) => c.status === 'PRESENT').length;
      const absentDays = rowCells.filter((c) => c.status === 'ABSENT').length;
      const uncertainDays = rowCells.filter((c) => c.status === 'UNCERTAIN').length;
      const blankDays = rowCells.filter((c) => c.status === 'BLANK').length;

      // Preserve unresolved/blank integrity — never silently claim UNCERTAIN is PRESENT or ABSENT
      let sessionStatus: SessionStudentEntry['status'] = 'Excused';
      if (presentDays > 0 && presentDays >= absentDays) {
        sessionStatus = 'Present';
      } else if (absentDays > presentDays) {
        sessionStatus = 'Absent';
      }

      return {
        studentId: mapping.studentId || `unresolved-row-${mapping.rowNumber}-${idx}`,
        rollNumber: mapping.rowNumber,
        studentName:
          mappedStudent?.fullName ||
          mapping.detectedName ||
          `Unresolved Row #${mapping.rowNumber}`,
        status: sessionStatus,
        remarks: `${selectedWeek}: ${presentDays} Present, ${absentDays} Absent, ${blankDays} Blank, ${uncertainDays} Uncertain${
          mapping.studentId ? '' : ' · Unmapped Row'
        }`
      };
    });

    const presentRowCount = entries.filter((e) => e.status === 'Present').length;
    const absentRowCount = entries.filter((e) => e.status === 'Absent').length;

    const session: AttendanceSession = {
      id: `ses-${Date.now()}`,
      date: selectedDate,
      classId: confirmedDraft.classId,
      classGrade: className,
      term: school?.currentTerm || 'First Term',
      sessionYear: school?.academicSession || '2026/2027',
      totalEnrolled: confirmedDraft.rowMappings.length,
      presentCount: presentRowCount,
      absentCount: absentRowCount,
      reviewStatus: hasUnresolvedIssues ? 'Flagged' : 'Confirmed',
      recordedBy: school?.administratorName || 'School Administrator',
      verifiedBy: isSupabaseLive
        ? `${school?.administratorName || 'School Administrator'} (Confirmed · Supabase PostgreSQL)`
        : `${school?.administratorName || 'School Administrator'} (Local Demonstration Confirmation)`,
      notes: `Session draft ${confirmedDraft.id} (${selectedWeek}). Corrections logged: ${confirmedDraft.editHistory.length}. Uncertain cells preserved: ${reviewQueue.uncertainCells}.`,
      sourceDraftId: confirmedDraft.id,
      persistenceTarget: isSupabaseLive ? 'supabase' : 'local-demo',
      entries
    };

    setIsConfirmSubmitting(true);
    setConfirmError(null);
    try {
      await onConfirmAttendance(session, confirmedDraft);
      setConfirmedDraftIds((prev) => [...prev, confirmedDraft.id]);
      setShowConfirmModal(false);
    } catch (err: any) {
      // Preserve draft & modal on failure with actionable error (no false success state)
      if (onSaveDraftOnly) {
        onSaveDraftOnly(confirmedDraft);
      }
      setConfirmError(
        isNetworkOrOfflineError(err)
          ? 'Network connection lost while saving attendance. Your review draft and corrections are safely preserved locally—check connectivity and retry.'
          : err?.message ||
              'Database confirmation failed. Your review draft and corrections have been preserved.'
      );
    } finally {
      setIsConfirmSubmitting(false);
    }
  };

  const renderStatusIcon = (status: ValidatedAttendanceStatus) => {
    if (status === 'PRESENT') return <Check className="w-3.5 h-3.5 shrink-0" />;
    if (status === 'ABSENT') return <X className="w-3.5 h-3.5 shrink-0" />;
    if (status === 'BLANK') return <Minus className="w-3.5 h-3.5 shrink-0" />;
    return <HelpCircle className="w-3.5 h-3.5 shrink-0" />;
  };

  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-5 max-w-7xl mx-auto pb-28 md:pb-6">
      {/* Offline Banner (Only shown when browser loses connectivity) */}
      {!isOnline && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 text-xs flex items-start gap-2.5">
          <WifiOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-amber-900">Network Connectivity Lost</div>
            <p className="text-amber-900">
              Your unsaved review draft and corrections are preserved locally in this browser. Full offline sync is not supported—save draft locally and confirm once connectivity returns.
            </p>
          </div>
        </div>
      )}
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Setup</span>
            </button>
            {onRetakeOrDelete && (
              <button
                type="button"
                onClick={onRetakeOrDelete}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete &amp; Retake</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight">
              Human Review: Extracted Attendance
            </h2>
            <span
              className={`text-[11px] font-bold px-2.5 py-0.5 rounded border ${
                reviewQueue.awaitingReview === 0 && reviewQueue.mappingIssueCells === 0
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}
            >
              {reviewQueue.awaitingReview === 0 && reviewQueue.mappingIssueCells === 0
                ? 'Ready to Confirm'
                : `${reviewQueue.awaitingReview} Awaiting Review`}
            </span>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                geminiResult.processingStageUsed === 'staged-cell-verification'
                  ? 'bg-blue-50 text-blue-900 border-blue-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {geminiResult.processingStageUsed === 'staged-cell-verification'
                ? 'Stage 2: Staged Cell Check'
                : 'Stage 1: Whole-Page'}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
            Class: <strong className="text-slate-900">{className}</strong> · Period:{' '}
            <strong className="text-slate-900">{draft.attendancePeriod}</strong> · Draft Mode (Local Browser Storage)
          </p>
        </div>

        {/* Desktop Header Actions */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          {onRunStagedVerification && (
            <button
              type="button"
              disabled={isStagedVerifying}
              onClick={() => void onRunStagedVerification()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-lg cursor-pointer disabled:opacity-50"
              title="Re-inspect zoomed row strips for uncertain or missing marks"
            >
              {isStagedVerifying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
              ) : (
                <Layers className="w-3.5 h-3.5 text-blue-700" />
              )}
              <span>{isStagedVerifying ? 'Checking Cells...' : 'Staged Cell Check'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onReAnalyze}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
          >
            Re-Analyze
          </button>

          <button
            type="button"
            onClick={handleSaveDraft}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-emerald-700" />
            <span>{draftSavedNotice ? 'Draft Saved' : 'Save Draft'}</span>
          </button>

          <button
            type="button"
            disabled={draft.processingStatus === 'REJECTED'}
            onClick={handleOpenConfirmModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg shadow-xs cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Confirm Attendance</span>
          </button>
        </div>
      </div>

      {/* Distorted / Clipped Photo Guidance Banner */}
      {geminiResult.layoutQuality?.layoutTooDistorted && (
        <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-xl text-rose-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold text-rose-900">
                Register Layout May Be Too Distorted or Clipped
              </div>
              <p className="text-rose-800 leading-relaxed">
                {geminiResult.layoutQuality.retakeOrCropAdvice ||
                  'Row or column alignment may be unreliable because the ledger edges, shadows, or tilt obscure the grid. Crop tightly to the attendance table or retake a flat overhead photo.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCropOrRetake || onCancel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold text-xs shrink-0 cursor-pointer"
          >
            <Crop className="w-3.5 h-3.5" />
            <span>Crop or Retake Photo</span>
          </button>
        </div>
      )}

      {/* Structural & Uncertainty Alerts Strip (Missing Rows, Uncertain Headings, Overwritten Marks, Conflicts) */}
      {highlightedAlerts.length > 0 && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 text-xs space-y-1.5">
          <div className="font-bold flex items-center gap-1.5 text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Layout &amp; Uncertainty Flags Detected ({highlightedAlerts.length})</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-900">
            {highlightedAlerts.slice(0, 6).map((alert, idx) => (
              <li key={`${alert.code}-${idx}`}>{alert.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Draft Saved Notice */}
      {draftSavedNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-900 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              <strong>Session draft and edit history saved locally</strong> ({draft.editHistory.length} edits logged).
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDraftSavedNotice(false)}
            className="text-emerald-800 font-semibold hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* REVIEW QUEUE SUMMARY CARD */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-emerald-700" />
              <span>Review Queue Summary</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Uncertain and unmapped entries stay queued until you explicitly inspect, correct, or mark them reviewed.
            </p>
          </div>

          <button
            type="button"
            disabled={!reviewQueue.nextUnresolvedCell}
            onClick={handleJumpToNextUnresolved}
            className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors shrink-0 ${
              reviewQueue.nextUnresolvedCell
                ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer'
                : 'bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default'
            }`}
          >
            {reviewQueue.nextUnresolvedCell ? (
              <>
                <span>
                  Next Unresolved Cell (Row #{reviewQueue.nextUnresolvedCell.rowNumber} ·{' '}
                  {reviewQueue.nextUnresolvedCell.dayOfWeek})
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>All Flagged Cells Reviewed</span>
              </>
            )}
          </button>
        </div>

        {/* 5 Review Queue Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Total Cells Extracted
            </div>
            <div className="text-lg font-bold text-slate-900 mt-0.5">{reviewQueue.totalCells}</div>
          </div>

          <div
            className={`p-2.5 rounded-lg border ${
              reviewQueue.awaitingReview > 0
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">
              Awaiting Review
            </div>
            <div className="text-lg font-bold mt-0.5">{reviewQueue.awaitingReview}</div>
          </div>

          <div
            className={`p-2.5 rounded-lg border ${
              reviewQueue.uncertainCells > 0
                ? 'bg-amber-50/70 border-amber-300 text-amber-900'
                : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">
              Marked Uncertain
            </div>
            <div className="text-lg font-bold mt-0.5">{reviewQueue.uncertainCells}</div>
          </div>

          <div
            className={`p-2.5 rounded-lg border ${
              reviewQueue.mappingIssueCells > 0
                ? 'bg-rose-50 border-rose-300 text-rose-900'
                : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">
              Missing / Invalid Map
            </div>
            <div className="text-lg font-bold mt-0.5">{reviewQueue.mappingIssueCells}</div>
          </div>

          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 col-span-2 sm:col-span-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
              Reviewed by Admin
            </div>
            <div className="text-lg font-bold mt-0.5">{reviewQueue.reviewedCells}</div>
          </div>
        </div>
      </div>

      {/* Selected Class Roster Reconciliation Strip */}
      {classStudents.length > 0 ? (
        <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-700">
            <Users className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              Class Roster Coverage ({className}):{' '}
              <strong className="text-slate-900">
                {classStudents.length - unmappedClassStudents.length} of {classStudents.length}
              </strong>{' '}
              enrolled pupils mapped to register rows.
            </span>
          </div>
          {unmappedClassStudents.length > 0 && (
            <div className="text-[11px] text-slate-500 truncate max-w-md">
              Unassigned roster pupils:{' '}
              <span className="text-slate-700 font-medium">
                {unmappedClassStudents.slice(0, 3).map((s) => s.fullName).join(', ')}
                {unmappedClassStudents.length > 3 ? ` +${unmappedClassStudents.length - 3} more` : ''}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-amber-50 rounded-lg border border-amber-300 p-3 text-xs flex items-start gap-2.5 text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Empty Class Roster ({className}):</span>{' '}
            <span>
              No active enrolled pupils are currently listed for this class, so extracted rows remain unmapped until students are added in <strong>Students &amp; Classes</strong>.
            </span>
          </div>
        </div>
      )}

      {/* Mobile View Switcher */}
      <div className="lg:hidden flex border border-slate-200 bg-white rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setActiveMobileTab('table')}
          className={`flex-1 py-2.5 text-xs font-bold text-center transition-colors ${
            activeMobileTab === 'table'
              ? 'bg-emerald-700 text-white'
              : 'bg-white text-slate-600'
          }`}
        >
          Review Table ({draft.rowMappings.length} Rows)
        </button>
        <button
          type="button"
          onClick={() => setActiveMobileTab('image')}
          className={`flex-1 py-2.5 text-xs font-bold text-center transition-colors ${
            activeMobileTab === 'image'
              ? 'bg-emerald-700 text-white'
              : 'bg-white text-slate-600'
          }`}
        >
          Inspect Register Photo
        </button>
      </div>

      {/* Split Layout: Source Image + Human Review Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Photograph Inspection Viewer */}
        <div
          className={`lg:col-span-4 bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden lg:sticky lg:top-4 ${
            activeMobileTab === 'image' ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <Eye className="w-4 h-4 text-slate-600" />
              <span>Source Register Photo</span>
            </div>
            <div className="flex items-center gap-1">
              {onRetakeOrDelete && (
                <button
                  type="button"
                  onClick={onRetakeOrDelete}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-rose-100 text-rose-700 text-[11px] font-semibold cursor-pointer"
                  title="Delete scan and retake photo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsFullscreenImage(true)}
                className="p-1.5 rounded hover:bg-slate-200 text-slate-600 cursor-pointer"
                title="Fullscreen view"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-3 bg-slate-950 flex items-center justify-center">
            <div className="w-full max-w-[280px] aspect-9/16 max-h-[65vh] mx-auto flex items-center justify-center overflow-hidden rounded border border-slate-800 bg-slate-900">
              <img
                src={imageUri}
                alt="Physical Attendance Register"
                className="w-full h-full object-contain"
                style={{ transform: `rotate(${rotation}deg)` }}
              />
            </div>
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-2 text-[11px]">
            <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
              Visual Status Key
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 font-semibold">
                <Check className="w-3 h-3" />
                <span>PRESENT (/)</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-rose-100 text-rose-900 border border-rose-300 font-semibold">
                <X className="w-3 h-3" />
                <span>ABSENT (0)</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-100 text-slate-800 border border-slate-300 font-semibold">
                <Minus className="w-3 h-3" />
                <span>BLANK (—)</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-100 text-amber-950 border border-amber-400 font-semibold">
                <HelpCircle className="w-3 h-3" />
                <span>UNCERTAIN (?)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Human Review Table & Controls */}
        <div
          className={`lg:col-span-8 bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden ${
            activeMobileTab === 'table' ? 'block' : 'hidden lg:block'
          }`}
        >
          {/* Controls Bar */}
          <div className="p-3.5 border-b border-slate-200 space-y-3 bg-slate-50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-700" />
                <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                  Class Roster vs. Extracted Attendance ({displayedMappings.length} rows)
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Select week to view"
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                  className="py-1.5 px-2.5 text-xs font-bold border border-emerald-300 rounded-md bg-emerald-50 text-emerald-900"
                >
                  {(draft.weeksDetected.length > 0 ? draft.weeksDetected : ['Week 1']).map((wk) => (
                    <option key={wk} value={wk}>
                      {wk}
                    </option>
                  ))}
                </select>

                <div className="relative flex-1 sm:flex-initial">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filter student..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-7 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white w-full sm:w-40 focus:outline-hidden focus:ring-1 focus:ring-emerald-700"
                  />
                </div>
              </div>
            </div>

            {/* Filter Pills + Week Summary */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80 text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                    filterMode === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-300 text-slate-700'
                  }`}
                >
                  All ({draft.rowMappings.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode(filterMode === 'review' ? 'all' : 'review')}
                  className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                    filterMode === 'review'
                      ? 'bg-amber-700 text-white'
                      : 'bg-amber-50 border border-amber-300 text-amber-900'
                  }`}
                >
                  Needs Review
                </button>
                {weekStats.unmappedRows > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilterMode(filterMode === 'unmapped' ? 'all' : 'unmapped')}
                    className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                      filterMode === 'unmapped'
                        ? 'bg-rose-700 text-white'
                        : 'bg-rose-50 border border-rose-300 text-rose-900'
                    }`}
                  >
                    Unmapped ({weekStats.unmappedRows})
                  </button>
                )}
              </div>

              <div className="text-slate-500">
                Tap any day cell to edit status, mapping, or weekday.
              </div>
            </div>
          </div>

          {draft.rowMappings.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
              <div className="text-sm font-bold text-slate-900">
                No Valid Attendance Rows Extracted
              </div>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                The extracted data could not be validated safely. Please take a clearer photograph and re-analyze.
              </p>
            </div>
          ) : displayedMappings.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <Search className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="text-sm font-bold text-slate-900">
                No Student Rows Match Filter
              </div>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                No extracted rows match the active filter or search term in {selectedWeek}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilterMode('all');
                  setSearchQuery('');
                }}
                className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
              >
                Show All {draft.rowMappings.length} Rows
              </button>
            </div>
          ) : (
            <>
              {/* ANDROID PHONE CARD VIEW (< md) */}
              <div className="md:hidden divide-y divide-slate-200">
                {displayedMappings.map((mapping) => {
                  const mappedStudent = mapping.studentId
                    ? studentById.get(mapping.studentId)
                    : undefined;
                  const rowDayMap = weekCellsByRow.get(mapping.rowNumber) || {};

                  return (
                    <div
                      key={mapping.rowNumber}
                      className={`p-3.5 space-y-3 ${
                        !mapping.studentId ? 'bg-amber-50/40' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[10px] font-bold">
                              Row #{mapping.rowNumber}
                            </span>
                            {mappedStudent ? (
                              <span className="font-bold text-slate-900 text-sm">
                                {mappedStudent.fullName}
                              </span>
                            ) : (
                              <span className="font-bold text-rose-800 text-sm">
                                Unresolved Row #{mapping.rowNumber}
                              </span>
                            )}
                          </div>
                          {mapping.detectedName && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Detected: "{mapping.detectedName}"
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {selectedWeek}
                        </span>
                      </div>

                      {/* Quick Roster Mapping on Mobile */}
                      <select
                        aria-label={`Assign student to row ${mapping.rowNumber}`}
                        value={mapping.studentId || ''}
                        onChange={(e) =>
                          handleRowStudentChange(mapping.rowNumber, e.target.value, 'MANUAL')
                        }
                        className={`w-full text-xs rounded-md border px-2.5 py-2 ${
                          mapping.studentId
                            ? 'border-slate-300 bg-white text-slate-800'
                            : 'border-amber-400 bg-amber-50 text-amber-950 font-semibold'
                        }`}
                      >
                        <option value="">-- Select Enrolled Student --</option>
                        {classStudents.map((s) => (
                          <option key={s.id} value={s.id}>
                            #{s.studentNumber} · {s.fullName}
                          </option>
                        ))}
                      </select>

                      {/* 5 Touch-Friendly Weekday Tiles */}
                      <div className="grid grid-cols-5 gap-1.5">
                        {SCHOOL_WEEKDAYS.map((day) => {
                          const dayCells = rowDayMap[day] || [];
                          const cell = dayCells[0];
                          if (!cell) {
                            return (
                              <div
                                key={day}
                                className="p-2 rounded-lg border border-amber-300 bg-amber-50 text-center text-[10px] text-amber-900"
                              >
                                <div className="font-bold">{day.slice(0, 3)}</div>
                                <div>Missing</div>
                              </div>
                            );
                          }
                          const cfg = STATUS_BADGE_CONFIG[cell.status];
                          const isSelected = activeCellId === cell.id;

                          return (
                            <button
                              key={cell.id}
                              ref={(el) => {
                                cellRefs.current[cell.id] = el;
                              }}
                              type="button"
                              onClick={() => setActiveCellId(cell.id)}
                              className={`min-h-[54px] p-1.5 rounded-lg border flex flex-col items-center justify-center gap-0.5 text-center transition-all cursor-pointer ${
                                cfg.buttonClass
                              } ${isSelected ? `ring-2 ${cfg.ringClass} ring-offset-1` : ''}`}
                            >
                              <span className="text-[10px] font-bold uppercase opacity-75">
                                {day.slice(0, 3)}
                              </span>
                              <span className="text-sm font-extrabold leading-none">{cfg.short}</span>
                              {cell.hasConflictingDetection ? (
                                <span className="text-[8px] font-bold text-rose-800">
                                  Conflict
                                </span>
                              ) : cell.isCorrectionOrOverwritten ? (
                                <span className="text-[8px] font-bold text-amber-800">
                                  Overwr.
                                </span>
                              ) : cell.reviewedByAdmin ? (
                                <span className="text-[9px] font-semibold text-emerald-800">
                                  ✓ Rev
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* DESKTOP & TABLET STRUCTURED TABLE (>= md) */}
              <div className="hidden md:block overflow-x-auto max-h-[620px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10">
                    <tr>
                      <th scope="col" className="py-2.5 px-3 min-w-[230px]">
                        Student Identity & Mapping
                      </th>
                      <th scope="col" className="py-2.5 px-2 text-center whitespace-nowrap">
                        Week
                      </th>
                      {SCHOOL_WEEKDAYS.map((day) => (
                        <th key={day} scope="col" className="py-2.5 px-2 text-center min-w-[105px]">
                          {day}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {displayedMappings.map((mapping) => {
                      const mappedStudent = mapping.studentId
                        ? studentById.get(mapping.studentId)
                        : undefined;
                      const suggestedStudent = mapping.suggestedStudentId
                        ? studentById.get(mapping.suggestedStudentId)
                        : undefined;
                      const rowDayMap = weekCellsByRow.get(mapping.rowNumber) || {};

                      return (
                        <tr
                          key={mapping.rowNumber}
                          className={!mapping.studentId ? 'bg-amber-50/40' : 'hover:bg-slate-50/60'}
                        >
                          <td className="py-2.5 px-3 align-top">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[10px] font-bold">
                                  Row #{mapping.rowNumber}
                                </span>
                                {mappedStudent ? (
                                  <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                                    <UserCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                    <span>{mappedStudent.fullName}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 font-bold text-rose-800">
                                    <UserX className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                    <span>Unresolved Row #{mapping.rowNumber}</span>
                                  </span>
                                )}
                              </div>

                              {mapping.detectedName && (
                                <div className="text-[11px] text-slate-500">
                                  AI Detected: <span className="italic">"{mapping.detectedName}"</span>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <select
                                  aria-label={`Map student for row ${mapping.rowNumber}`}
                                  value={mapping.studentId || ''}
                                  onChange={(e) =>
                                    handleRowStudentChange(mapping.rowNumber, e.target.value, 'MANUAL')
                                  }
                                  className={`text-[11px] rounded px-1.5 py-1 border max-w-[205px] truncate ${
                                    mapping.studentId
                                      ? 'border-slate-300 bg-white text-slate-700'
                                      : 'border-amber-400 bg-amber-50 text-amber-950 font-semibold'
                                  }`}
                                >
                                  <option value="">-- Select Student --</option>
                                  {classStudents.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      #{s.studentNumber} · {s.fullName}
                                    </option>
                                  ))}
                                </select>

                                {!mapping.studentId && suggestedStudent && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRowStudentChange(
                                        mapping.rowNumber,
                                        suggestedStudent.id,
                                        'MANUAL'
                                      )
                                    }
                                    className="text-[10px] font-semibold px-2 py-1 rounded bg-amber-200 hover:bg-amber-300 text-amber-950 cursor-pointer"
                                  >
                                    Confirm "{suggestedStudent.fullName.split(' ')[0]}"
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-2 text-center align-top">
                            <span className="inline-block px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-semibold text-[11px] text-slate-700">
                              {selectedWeek}
                            </span>
                          </td>

                          {SCHOOL_WEEKDAYS.map((day) => {
                            const dayCells = rowDayMap[day] || [];
                            const cell = dayCells[0];

                            if (!cell) {
                              return (
                                <td key={day} className="py-2.5 px-1.5 text-center align-top">
                                  <span className="inline-block px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-900 text-[10px] font-semibold">
                                    Missing
                                  </span>
                                </td>
                              );
                            }

                            const cfg = STATUS_BADGE_CONFIG[cell.status];
                            const isSelected = activeCellId === cell.id;

                            return (
                              <td key={day} className="py-2 px-1.5 align-top">
                                <button
                                  ref={(el) => {
                                    cellRefs.current[cell.id] = el;
                                  }}
                                  type="button"
                                  onClick={() => setActiveCellId(cell.id)}
                                  aria-label={`Edit Row ${mapping.rowNumber} ${selectedWeek} ${day} (${cell.status})`}
                                  className={`w-full p-2 rounded-lg border text-center transition-all cursor-pointer flex flex-col items-center gap-1 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 ${
                                    cfg.buttonClass
                                  } ${isSelected ? `ring-2 ${cfg.ringClass} ring-offset-1 shadow-xs` : ''}`}
                                >
                                  <div className="flex items-center justify-center gap-1 font-bold text-[11px]">
                                    {renderStatusIcon(cell.status)}
                                    <span>{cfg.label}</span>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-center gap-1 text-[9px]">
                                    {cell.reviewedByAdmin ? (
                                      <span className="px-1.5 py-0.2 rounded bg-white/80 text-emerald-800 font-bold border border-emerald-200">
                                        Reviewed
                                      </span>
                                    ) : cell.reviewRequired ? (
                                      <span className="px-1.5 py-0.2 rounded bg-amber-200/80 text-amber-950 font-bold">
                                        {cell.isMissingFromAI ? 'AI Missing' : 'Review'}
                                      </span>
                                    ) : null}
                                    {cell.isDuplicate && (
                                      <span className="px-1 py-0.2 rounded bg-rose-200 text-rose-950 font-bold">
                                        Duplicate
                                      </span>
                                    )}
                                    {cell.hasConflictingDetection && (
                                      <span className="px-1 py-0.2 rounded bg-rose-200 text-rose-950 font-bold">
                                        Conflict
                                      </span>
                                    )}
                                    {cell.isCorrectionOrOverwritten && (
                                      <span className="px-1 py-0.2 rounded bg-amber-200 text-amber-950 font-bold">
                                        Overwritten
                                      </span>
                                    )}
                                  </div>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* SESSION EDIT HISTORY (Plain-English Audit Trail) */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs">
        <button
          type="button"
          onClick={() => setShowEditHistory((prev) => !prev)}
          className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-700" />
            <span>Session Corrections & Review Audit Trail ({draft.editHistory.length})</span>
          </div>
          {showEditHistory ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showEditHistory && (
          <div className="p-4 border-t border-slate-200 text-xs">
            {draft.editHistory.length === 0 ? (
              <p className="text-slate-500">
                No corrections recorded in this session yet. Any status changes, mapping updates, or weekday reassignments appear here.
              </p>
            ) : (
              <ul className="space-y-2 max-h-56 overflow-y-auto">
                {draft.editHistory.map((item) => (
                  <li
                    key={item.id}
                    className="p-2.5 rounded-md bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                  >
                    <div>
                      <span className="font-bold text-slate-900">
                        Row #{item.rowNumber}
                        {item.weekIdentifier ? ` · ${item.weekIdentifier} ${item.dayOfWeek || ''}` : ''}
                      </span>{' '}
                      <span className="text-slate-600">
                        ({item.field === 'status'
                          ? 'Status'
                          : item.field === 'studentId'
                          ? 'Student Mapping'
                          : item.field === 'schedule'
                          ? 'Week/Weekday'
                          : 'Review Check'}):
                      </span>{' '}
                      <span className="text-slate-500">AI suggested</span>{' '}
                      <code className="px-1 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[11px]">
                        {item.originalAiSuggestion}
                      </code>{' '}
                      <span className="text-slate-500">&rarr;</span>{' '}
                      <strong className="text-emerald-800">{item.newValue}</strong>
                    </div>
                    <div className="text-[11px] text-slate-400 shrink-0">
                      {new Date(item.timestamp).toLocaleTimeString()} · {item.reviewedByAdmin ? 'Reviewed' : 'Pending'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* OPT-IN DEVELOPER DIAGNOSTICS (Hidden from ordinary users unless enabled in Settings) */}
      {devModeEnabled && (
        <div className="bg-slate-900 text-slate-100 rounded-lg border border-slate-800 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDeveloperDiagnostics((prev) => !prev)}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-mono hover:bg-slate-800/70 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-slate-200">
                Developer Diagnostics (Opt-In Mode Active)
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                {draft.validationIssues.length} issues · {draft.quarantinedItems.length} quarantined
              </span>
            </div>
            {showDeveloperDiagnostics ? (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showDeveloperDiagnostics && (
            <div className="p-4 border-t border-slate-800 space-y-3 text-xs font-mono">
              <pre className="p-3 rounded bg-black/60 border border-slate-800 text-emerald-300 text-[11px] overflow-x-auto max-h-64 overflow-y-auto">
                {JSON.stringify(
                  {
                    processingStatus: draft.processingStatus,
                    validationIssues: draft.validationIssues,
                    quarantinedItems: draft.quarantinedItems,
                    rawAiResponse: draft.rawAiResponse
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* STICKY MOBILE ACTION BAR FOR ANDROID PHONES */}
      <div className="md:hidden fixed bottom-16 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2.5 flex items-center gap-2 shadow-lg">
        {onRunStagedVerification && (
          <button
            type="button"
            disabled={isStagedVerifying}
            onClick={() => void onRunStagedVerification()}
            className="px-2.5 py-2.5 text-xs font-semibold text-blue-900 bg-blue-50 border border-blue-300 rounded-lg cursor-pointer disabled:opacity-50"
            title="Run staged cell-level verification"
          >
            {isStagedVerifying ? 'Checking...' : 'Cell Check'}
          </button>
        )}
        <button
          type="button"
          onClick={handleSaveDraft}
          className="px-3 py-2.5 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-300 rounded-lg cursor-pointer"
        >
          Save Draft
        </button>
        <button
          type="button"
          disabled={draft.processingStatus === 'REJECTED'}
          onClick={handleOpenConfirmModal}
          className="flex-1 py-2.5 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-lg shadow-xs cursor-pointer"
        >
          Confirm Attendance
        </button>
      </div>

      {/* ACCESSIBLE CELL EDITOR (Bottom sheet on Android phone / Dialog on Desktop) */}
      {activeCell && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Attendance Cell Editor"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
        >
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* Editor Header */}
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                  Cell Editor · Row #{activeCell.rowNumber}
                </div>
                <h4 className="text-base font-bold text-slate-900">
                  {activeCellRowMapping?.studentId
                    ? studentById.get(activeCellRowMapping.studentId)?.fullName
                    : activeCellRowMapping?.detectedName || `Unresolved Row #${activeCell.rowNumber}`}
                </h4>
                <p className="text-xs text-slate-500">
                  {activeCell.weekIdentifier} · {activeCell.dayOfWeek} · AI Original:{' '}
                  <strong>{activeCell.originalAiStatus}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveCellId(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer"
                aria-label="Close cell editor"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Editor Body */}
            <div className="p-5 space-y-4 overflow-y-auto text-xs">
              {/* Review / AI reason banner */}
              {(activeCell.reviewReason || activeCell.notes) && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                  <strong>Note:</strong> {activeCell.reviewReason || activeCell.notes}
                </div>
              )}

              {/* 1. Status Selector Buttons (4 clear options, keyboard shortcuts P/A/B/U) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800">1. Attendance Status</label>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">
                    Keys: P, A, B, U · N = Next
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['PRESENT', 'ABSENT', 'BLANK', 'UNCERTAIN'] as ValidatedAttendanceStatus[]).map(
                    (statusOpt) => {
                      const cfg = STATUS_BADGE_CONFIG[statusOpt];
                      const isCurrent = activeCell.status === statusOpt;
                      return (
                        <button
                          key={statusOpt}
                          type="button"
                          onClick={() => handleCellStatusChange(activeCell.id, statusOpt)}
                          className={`min-h-[46px] px-3 py-2.5 rounded-lg border font-bold text-xs flex items-center justify-between transition-all cursor-pointer ${
                            isCurrent ? cfg.activeClass : cfg.buttonClass
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {renderStatusIcon(statusOpt)}
                            <span>{cfg.label}</span>
                          </span>
                          <span className="font-mono text-sm opacity-80">{cfg.short}</span>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              {/* 2. Correct Student-Row Mapping */}
              <div className="space-y-1.5">
                <label
                  htmlFor="editor-student-map"
                  className="block font-bold text-slate-800"
                >
                  2. Student Mapping (Row #{activeCell.rowNumber})
                </label>
                <select
                  id="editor-student-map"
                  value={activeCellRowMapping?.studentId || ''}
                  onChange={(e) =>
                    handleRowStudentChange(activeCell.rowNumber, e.target.value, 'MANUAL')
                  }
                  className="w-full py-2.5 px-3 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="">-- Unmapped (Select Enrolled Student) --</option>
                  {classStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.studentNumber} · {s.fullName}
                      {s.admissionNumber ? ` (${s.admissionNumber})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Correct Week & Weekday Assignment */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="editor-week" className="block font-bold text-slate-800">
                    3. Week Assignment
                  </label>
                  <select
                    id="editor-week"
                    value={activeCell.weekIdentifier}
                    onChange={(e) =>
                      handleCellScheduleChange(activeCell.id, e.target.value, activeCell.dayOfWeek)
                    }
                    className="w-full py-2 px-2.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
                  >
                    {Array.from(
                      new Set([
                        ...draft.weeksDetected,
                        'Week 1',
                        'Week 2',
                        'Week 3',
                        'Week 4'
                      ])
                    )
                      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                      .map((wk) => (
                        <option key={wk} value={wk}>
                          {wk}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="editor-day" className="block font-bold text-slate-800">
                    4. Weekday Column
                  </label>
                  <select
                    id="editor-day"
                    value={activeCell.dayOfWeek}
                    onChange={(e) =>
                      handleCellScheduleChange(
                        activeCell.id,
                        activeCell.weekIdentifier,
                        e.target.value as DayOfWeek
                      )
                    }
                    className="w-full py-2 px-2.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
                  >
                    {SCHOOL_WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Per-cell edit history snippet */}
              {activeCell.correctionHistory && activeCell.correctionHistory.length > 0 && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-700 text-[11px]">Cell Edit Log:</div>
                  {activeCell.correctionHistory.slice(-3).map((ch) => (
                    <div key={ch.id} className="text-[11px] text-slate-600">
                      · {ch.previousValue} &rarr; <strong>{ch.newValue}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Editor Footer Actions */}
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleMarkReviewedOnly(activeCell.id)}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
              >
                {activeCell.reviewedByAdmin ? '✓ Reviewed' : 'Mark Reviewed'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveCellId(null)}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={handleSaveAndNextUnresolved}
                  className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  <span>Next Unresolved</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FINAL CONFIRMATION MODAL WITH EXPLICIT ACKNOWLEDGEMENT & DUPLICATE CHECK */}
      {showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Attendance Modal"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
        >
          <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] flex flex-col shadow-xl border border-slate-200 overflow-hidden">
            <div className="p-5 pb-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800">
                  <ShieldCheck className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Final Attendance Confirmation
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isSupabaseLive
                      ? 'Atomic PostgreSQL Transaction (Supabase)'
                      : 'Local Browser Demonstration Record'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isConfirmSubmitting}
                onClick={() => setShowConfirmModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg disabled:opacity-40 cursor-pointer"
                aria-label="Close confirmation modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-slate-600 leading-relaxed overflow-y-auto">
              {/* 1 & 2: Class, Period, Student & Cell Counts */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2">
                <div className="flex justify-between gap-2">
                  <span>Class:</span>
                  <strong className="text-slate-900 text-right">{className}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Attendance Period:</span>
                  <strong className="text-slate-900 text-right">
                    {draft.attendancePeriod} · {selectedWeek}
                  </strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Students & Cells:</span>
                  <strong className="text-slate-900 text-right">
                    {draft.rowMappings.length} students · {reviewQueue.totalCells} cells
                  </strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Admin Corrections Logged:</span>
                  <strong className="text-emerald-800 text-right">{draft.editHistory.length}</strong>
                </div>
              </div>

              {/* Potential Duplicate Session Check */}
              {isCheckingDuplicates && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2 text-xs text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-700 shrink-0" />
                  <span>Checking for existing sessions for {className} on {selectedDate}...</span>
                </div>
              )}

              {hasDuplicateMatches && (
                <div className="p-3.5 bg-orange-50 border border-orange-300 rounded-lg text-orange-950 space-y-2.5">
                  <div className="font-bold flex items-center gap-1.5 text-orange-900">
                    <AlertTriangle className="w-4 h-4 text-orange-700 shrink-0" />
                    <span>Potential Duplicate Session Warning</span>
                  </div>
                  <p className="text-[11px] text-orange-900">
                    An existing session already exists for this class and date/period. Existing confirmed sessions will not be silently overwritten.
                  </p>
                  <div className="space-y-2">
                    {duplicateMatches.map((match) => (
                      <div
                        key={match.session.id}
                        className="p-2.5 rounded bg-white border border-orange-200 text-[11px] flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-slate-900">
                            {match.session.classGrade} · {match.session.date}
                          </strong>
                          <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-900 font-bold text-[10px]">
                            {match.session.reviewStatus}
                          </span>
                        </div>
                        <div className="text-slate-600">
                          {match.session.presentCount} Present · {match.session.absentCount} Absent · By {match.session.recordedBy}
                        </div>
                        {onInspectExistingSession && (
                          <button
                            type="button"
                            onClick={() => {
                              if (onSaveDraftOnly) {
                                onSaveDraftOnly(draft);
                              }
                              setShowConfirmModal(false);
                              onInspectExistingSession(match.session);
                            }}
                            className="inline-flex items-center gap-1 self-start text-[11px] font-bold text-emerald-700 hover:text-emerald-900 hover:underline cursor-pointer"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Inspect Existing Record</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <label className="flex items-start gap-2 pt-2 border-t border-orange-200 cursor-pointer text-[11px] font-semibold text-orange-950">
                    <input
                      type="checkbox"
                      checked={acknowledgeDuplicate}
                      onChange={(e) => setAcknowledgeDuplicate(e.target.checked)}
                      className="mt-0.5 rounded border-orange-500 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span>
                      I have reviewed the existing record notice and still want to record this as an additional session.
                    </span>
                  </label>
                </div>
              )}

              {/* 3 & 4: Unresolved Warning + Mandatory Acknowledgement Checkbox */}
              {hasUnresolvedIssues && (
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg text-amber-950 space-y-2.5">
                  <div className="font-bold flex items-center gap-1.5 text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Unresolved Items Remain</span>
                  </div>
                  <ul className="space-y-0.5 text-[11px] list-disc list-inside">
                    <li>{reviewQueue.uncertainCells} cell(s) remain UNCERTAIN (never auto-converted)</li>
                    <li>{reviewQueue.mappingIssueCells} cell(s) have missing student mappings</li>
                    <li>{reviewQueue.awaitingReview} cell(s) have not been marked reviewed</li>
                  </ul>

                  <label className="flex items-start gap-2 pt-2 border-t border-amber-200 cursor-pointer text-[11px] font-semibold text-amber-950">
                    <input
                      type="checkbox"
                      checked={acknowledgeUnresolved}
                      onChange={(e) => setAcknowledgeUnresolved(e.target.checked)}
                      className="mt-0.5 rounded border-amber-500 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span>
                      I acknowledge that unresolved uncertain or unmapped cells remain and wish to record this confirmation.
                    </span>
                  </label>
                </div>
              )}

              {confirmError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 text-[11px] space-y-1.5">
                  <div className="font-bold">Confirmation Save Failed (Draft Preserved Locally)</div>
                  <p>{confirmError}</p>
                </div>
              )}

              <div className="p-2.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                {isSupabaseLive ? (
                  <>
                    <strong>Atomic Persistence:</strong> Confirming executes a single PostgreSQL transaction saving the session and all extracted records together. Duplicate confirmations of the same draft are blocked.
                  </>
                ) : (
                  <>
                    <strong>Note:</strong> At this stage, confirmation saves a locally stored demonstration record in this browser. Configure Supabase in <code>.env</code> to persist remotely.
                  </>
                )}
              </div>
            </div>

            {/* 5: Final Confirmation Button */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={isConfirmSubmitting}
                onClick={() => setShowConfirmModal(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-md cursor-pointer disabled:opacity-40"
              >
                Back to Review
              </button>
              <button
                type="button"
                disabled={
                  isConfirmSubmitting ||
                  isCheckingDuplicates ||
                  (isSupabaseLive && !isOnline) ||
                  (hasUnresolvedIssues && !acknowledgeUnresolved) ||
                  (hasDuplicateMatches && !acknowledgeDuplicate) ||
                  confirmedDraftIds.includes(draft.id)
                }
                onClick={() => void executeConfirmation()}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md cursor-pointer"
              >
                {isConfirmSubmitting
                  ? 'Saving Transaction...'
                  : confirmError
                  ? 'Retry Confirmation'
                  : isSupabaseLive
                  ? 'Confirm & Save to Database'
                  : 'Confirm Demonstration Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN IMAGE MODAL */}
      {isFullscreenImage && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xs flex flex-col p-4">
          <div className="flex items-center justify-between pb-3 text-white border-b border-slate-800">
            <div className="text-sm font-semibold truncate">
              {className} · Register Photograph Inspection
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFullscreenImage(false)}
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img
              src={imageUri}
              alt="Fullscreen Register"
              className="max-h-[85vh] max-w-[90vw] object-contain transition-transform"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
