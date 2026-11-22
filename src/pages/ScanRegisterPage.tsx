import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  UploadCloud,
  FileCheck,
  AlertCircle,
  X,
  CheckCircle2,
  Loader2,
  Maximize2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  SwitchCamera,
  CircleDot,
  CameraOff,
  Code2,
  Crop,
  AlertTriangle,
  FlaskConical,
  Trash2,
  WifiOff,
  ScanLine,
  NotebookPen,
  CalendarOff,
  ArrowRight
} from 'lucide-react';
import {
  RegisterFormatMode,
  SchoolInfo,
  ClassItem,
  ScanWorkflowState,
  GeminiExtractionResult,
  AttendanceSession,
  AttendanceSessionDraft,
  Student,
  NormalizedCropBox,
  RegisterTestOutcome,
  ScanCaptureMode,
  DefaultScanModePreference,
  NonSchoolGapRecord,
  ClassWorkflowHistoryEntry,
  DetectedHolidayAnnotation
} from '../types/attendance';
import { TranscriptionReviewView } from '../components/TranscriptionReviewView';
import { RegisterImageCropperModal } from '../components/RegisterImageCropperModal';
import { GapLabelPromptModal } from '../components/GapLabelPromptModal';
import { SummaryNoteScanPanel } from '../components/SummaryNoteScanPanel';
import { StarredPupilsCard } from '../components/StarredPupilsCard';
import {
  createValidationTestSamples,
  validateAndBuildSessionDraft
} from '../services/attendanceValidation';
import {
  computeTableRowStrips,
  extractNormalizedRegionDataUrl,
  MIN_RECOMMENDED_SHORT_SIDE_PX,
  normalizeQuarterRotation,
  preprocessRegisterImage,
  PreprocessedImageResult
} from '../services/imagePreprocessing';
import {
  CellTargetSlot,
  mergeStagedCellResults,
  StagedVerifiedCell
} from '../services/registerAnalysisPrompt';
import { verifyRegisterCellsOnCanvas } from '../services/tickStrokeVerifier';
import {
  clearStoredRegisterTestOutcomes,
  getLabeledRegisterTestFixtures,
  getStoredRegisterTestOutcomes,
  RegisterTestFixture,
  runFixtureValidationBenchmark,
  saveRegisterTestOutcome
} from '../services/registerTestWorkflow';
import {
  deleteStoredSessionDraft,
  isDeveloperDiagnosticsEnabled,
  saveStoredSessionDraft
} from '../services/rosterStorage';
import {
  DuplicateSessionMatch,
  findPotentialDuplicateSessions
} from '../services/duplicateSession';
import {
  DetectedWeekdayGap,
  detectUnlabeledWeekdayGap,
  formatReadableDate,
  getDefaultSchoolDate,
  getStoredDismissedGapKeys,
  getTargetWeekdayInfo,
  isWeekendDate,
  saveStoredDismissedGapKeys
} from '../services/schoolCalendarGaps';
import {
  appendClassToWorkflowHistory,
  NextClassSuggestion,
  suggestNextClassToScan
} from '../services/workflowPreferences';
import { computeStarredStudentSummaries } from '../services/studentTrackingMetrics';
import { getSupabaseClient } from '../lib/supabaseClient';
import { checkDuplicateSessionsInSupabase } from '../services/supabaseAttendanceService';
import { isNetworkOrOfflineError, useOnlineStatus } from '../hooks/useOnlineStatus';

interface ScanRegisterPageProps {
  onNavigateToRecords: () => void;
  onNavigateToDashboard?: () => void;
  school?: SchoolInfo;
  classes?: ClassItem[];
  students?: Student[];
  existingSessions?: AttendanceSession[];
  isSupabaseLive?: boolean;
  defaultScanMode?: DefaultScanModePreference;
  onChangeDefaultScanMode?: (pref: DefaultScanModePreference) => void;
  nonSchoolGaps?: NonSchoolGapRecord[];
  onAddNonSchoolGap?: (params: {
    startDate: string;
    endDate: string;
    label: string;
    source: NonSchoolGapRecord['source'];
  }) => NonSchoolGapRecord | void;
  starredStudentIds?: string[];
  workflowHistory?: ClassWorkflowHistoryEntry[];
  onInspectExistingSession?: (session: AttendanceSession) => void;
  onSaveConfirmedSession?: (
    session: AttendanceSession,
    draft?: AttendanceSessionDraft
  ) => void | Promise<void>;
  highlightedTarget?: string | null;
}

const MAX_FILE_SIZE_MB = 15;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_DIMENSION = 1800;

function createBlankDiagnosticPreviewDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 500;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 800, 500);
  }
  return canvas.toDataURL('image/png');
}
export const ScanRegisterPage: React.FC<ScanRegisterPageProps> = ({
  onNavigateToRecords,
  onNavigateToDashboard,
  school,
  classes = [],
  students = [],
  existingSessions = [],
  isSupabaseLive = false,
  defaultScanMode = 'ask',
  onChangeDefaultScanMode,
  nonSchoolGaps = [],
  onAddNonSchoolGap,
  starredStudentIds = [],
  workflowHistory = [],
  onInspectExistingSession,
  onSaveConfirmedSession,
  highlightedTarget
}) => {
  const isOnline = useOnlineStatus();
  const activeClasses = classes;

  // Dual Scan Capture Mode ('register' vs 'summary') + Default Preference Chooser
  const [activeScanMode, setActiveScanMode] = useState<ScanCaptureMode | null>(() =>
    defaultScanMode === 'register' || defaultScanMode === 'summary' ? defaultScanMode : null
  );
  const [chooserSelection, setChooserSelection] = useState<ScanCaptureMode>('register');
  const [setChoiceAsDefault, setSetChoiceAsDefault] = useState<boolean>(false);
  const [showSummarySwitchWarning, setShowSummarySwitchWarning] = useState<boolean>(false);
  const [pendingSummaryDefaultFlag, setPendingSummaryDefaultFlag] = useState<boolean>(false);

  // Gap Labeling & Holiday Annotation Confirmation State
  const [dismissedGapKeys, setDismissedGapKeys] = useState<string[]>(() =>
    getStoredDismissedGapKeys()
  );
  const [pendingHolidayPrompt, setPendingHolidayPrompt] = useState<{
    annotation: DetectedHolidayAnnotation;
    extraction: GeminiExtractionResult;
    draft: AttendanceSessionDraft;
    usedModelName: string;
  } | null>(null);
  const [holidayLabelInput, setHolidayLabelInput] = useState<string>('');
  const [isSavingHolidayDay, setIsSavingHolidayDay] = useState<boolean>(false);
  const [autoAdvanceToast, setAutoAdvanceToast] = useState<string | null>(null);
  const [nextSuggestedClass, setNextSuggestedClass] = useState<NextClassSuggestion | null>(null);

  // Workflow explicit state machine:
  // 'empty' | 'image-selected' | 'ready-to-analyze' | 'processing' | 'review' | 'confirmed' | 'error'
  const [workflowState, setWorkflowState] = useState<ScanWorkflowState>('empty');

  // Cloud Vision Engine (Google Cloud Vision OCR exclusively)
  const [selectedModel] = useState<string>('google-cloud-vision');
  const [actualModelUsed, setActualModelUsed] = useState<string>('Google Cloud Vision API');
  const [billingAlert, setBillingAlert] = useState<{
    required: boolean;
    message: string;
    billingUrl: string;
  } | null>(null);

  // Register Metadata — Single-day rightmost-week scanning is the built-in default
  const [registerMode] = useState<RegisterFormatMode>('daily');
  const [selectedClass, setSelectedClass] = useState<string>(() =>
    classes.length === 1 ? classes[0].name : ''
  );
  const [selectedDate, setSelectedDate] = useState<string>(() => getDefaultSchoolDate());

  // In-memory image state (Never persisted to localStorage)
  const [rawSourceImage, setRawSourceImage] = useState<string | null>(null);
  const [rawDimensions, setRawDimensions] = useState<{ width: number; height: number } | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [imageFileSize, setImageFileSize] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isResized, setIsResized] = useState<boolean>(false);
  const [rotation, setRotation] = useState<number>(0); // 0, 90, 180, 270
  const [cropBox, setCropBox] = useState<NormalizedCropBox | null>(null);
  const [preprocessMeta, setPreprocessMeta] = useState<PreprocessedImageResult | null>(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState<boolean>(false);
  const [isStagedVerifying, setIsStagedVerifying] = useState<boolean>(false);
  const [imageCaptureSource, setImageCaptureSource] = useState<'camera' | 'gallery' | null>(null);

  // Analysis result, validated draft & progress
  const [geminiResult, setGeminiResult] = useState<GeminiExtractionResult | null>(null);
  const [validatedDraft, setValidatedDraft] = useState<AttendanceSessionDraft | null>(null);
  const [processingPhase, setProcessingPhase] = useState<string>('');
  const [confirmedSessionSummary, setConfirmedSessionSummary] = useState<AttendanceSession | null>(null);
  const [showDevTestPanel, setShowDevTestPanel] = useState(false);
  const [showBenchmarkPanel, setShowBenchmarkPanel] = useState(false);
  const [testOutcomes, setTestOutcomes] = useState<RegisterTestOutcome[]>(() =>
    getStoredRegisterTestOutcomes()
  );

  // UI state
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);

  // File & Camera Input Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const analyzeAbortControllerRef = useRef<AbortController | null>(null);

  // Live in-app Camera Viewfinder State
  const [isLiveCameraOpen, setIsLiveCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  // Auto-select single class or first class when tutorial highlights scan page
  useEffect(() => {
    if (!selectedClass && activeClasses.length === 1) {
      setSelectedClass(activeClasses[0].name);
    } else if (
      highlightedTarget === 'scan-register-capture' &&
      !selectedClass &&
      activeClasses.length > 0
    ) {
      setSelectedClass(activeClasses[0].name);
    }
  }, [activeClasses, selectedClass, highlightedTarget]);

  // Keep default scan mode preference synced if updated in Settings
  useEffect(() => {
    if (defaultScanMode === 'register' || defaultScanMode === 'summary') {
      setActiveScanMode((prev) => prev || defaultScanMode);
    }
  }, [defaultScanMode]);

  // Weekend awareness & Single-Day Rightmost-Week Target Info
  const dateIsWeekend = isWeekendDate(selectedDate);
  const targetWeekdayInfo = getTargetWeekdayInfo(selectedDate);

  // Detect any skipped school weekdays (Mon-Fri) between the last recorded date and selectedDate
  const detectedWeekdayGap: DetectedWeekdayGap | null = React.useMemo(() => {
    if (!activeScanMode || dateIsWeekend) return null;
    const gap = detectUnlabeledWeekdayGap({
      targetDate: selectedDate,
      sessions: existingSessions,
      existingGaps: nonSchoolGaps
    });
    if (!gap) return null;
    const key = `${gap.startDate}__${gap.endDate}`;
    if (dismissedGapKeys.includes(key)) return null;
    return gap;
  }, [activeScanMode, dateIsWeekend, selectedDate, existingSessions, nonSchoolGaps, dismissedGapKeys]);

  const hasDirectRegisterHistory = React.useMemo(
    () =>
      existingSessions.some(
        (s) => s.reviewStatus === 'Confirmed' && (s.captureMode ?? 'register') === 'register'
      ),
    [existingSessions]
  );

  const requestSwitchToScanMode = (nextMode: ScanCaptureMode, saveAsDefault = false) => {
    const switchingFromRegister =
      activeScanMode === 'register' || (activeScanMode === null && hasDirectRegisterHistory);
    if (nextMode === 'summary' && switchingFromRegister) {
      setPendingSummaryDefaultFlag(saveAsDefault);
      setShowSummarySwitchWarning(true);
      return;
    }
    setActiveScanMode(nextMode);
    if (saveAsDefault && onChangeDefaultScanMode) {
      onChangeDefaultScanMode(nextMode);
    }
  };

  const confirmSwitchToSummaryMode = () => {
    setShowSummarySwitchWarning(false);
    setActiveScanMode('summary');
    if (pendingSummaryDefaultFlag && onChangeDefaultScanMode) {
      onChangeDefaultScanMode('summary');
    }
    setPendingSummaryDefaultFlag(false);
  };

  const computeAndSuggestNextClass = (
    confirmedClassIds: string[],
    dateStr: string
  ): NextClassSuggestion | null => {
    if (activeClasses.length <= 1 || confirmedClassIds.length === 0) return null;
    const lastConfirmedClassId = confirmedClassIds[confirmedClassIds.length - 1];
    const scannedToday = new Set<string>(confirmedClassIds);
    existingSessions.forEach((s) => {
      if (s.date === dateStr && s.reviewStatus === 'Confirmed') {
        if (s.classId) scannedToday.add(s.classId);
        const byName = activeClasses.find(
          (c) => c.name.toLowerCase() === s.classGrade.toLowerCase()
        );
        if (byName) scannedToday.add(byName.id);
      }
    });

    let updatedHistory = workflowHistory;
    for (const cid of confirmedClassIds) {
      updatedHistory = appendClassToWorkflowHistory(updatedHistory, dateStr, cid);
    }

    return suggestNextClassToScan({
      currentClassId: lastConfirmedClassId,
      classes: activeClasses,
      scannedTodayClassIds: scannedToday,
      history: updatedHistory
    });
  };

  // Clean up camera stream & pending analysis abort controller when component unmounts
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      if (analyzeAbortControllerRef.current) {
        analyzeAbortControllerRef.current.abort();
      }
    };
  }, [cameraStream]);

  // Connect video element to stream when viewfinder opens
  useEffect(() => {
    if (isLiveCameraOpen && videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch((err) => {
        console.warn('Video playback warning:', err);
      });
    }
  }, [isLiveCameraOpen, cameraStream]);

  // Start live camera stream
  const startLiveCamera = async (mode: 'environment' | 'user' = facingMode) => {
    setIsCameraStarting(true);
    setIsVideoReady(false);
    setCameraError(null);
    setIsLiveCameraOpen(true);

    // Stop previous track before switching
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('In-app live camera is not supported on this browser. You can still use the Phone Camera App button.');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
      } catch (constraintErr: any) {
        // Fallback for devices that reject high-res or facingMode constraints
        if (constraintErr?.name === 'OverconstrainedError' || constraintErr?.name === 'ConstraintNotSatisfiedError') {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        } else {
          throw constraintErr;
        }
      }

      setCameraStream(stream);
      setFacingMode(mode);

      // Detect if user device has more than 1 camera (e.g. front & back)
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      } catch {
        setHasMultipleCameras(true);
      }
    } catch (err: any) {
      console.warn('Camera stream acquisition error:', err);
      let msg = 'Could not access camera. Please check camera permissions in your browser.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. Please allow camera access in your browser settings, or use the Phone Camera App button.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No camera hardware detected on this device.';
      } else if (err.message) {
        msg = err.message;
      }
      setCameraError(msg);
    } finally {
      setIsCameraStarting(false);
    }
  };

  // Flip between rear and front camera
  const handleToggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    startLiveCamera(nextMode);
  };

  // Close live camera and stop stream to conserve battery & release hardware
  const stopLiveCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    setIsVideoReady(false);
    setIsLiveCameraOpen(false);
    setCameraError(null);
  };

  // Capture current high-res frame from live stream to canvas
  const handleCaptureFromLiveStream = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    if (!video.videoWidth || !video.videoHeight) {
      setCameraError('Camera stream is still warming up. Please wait a moment and try again.');
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);

    // Immediately stop hardware stream
    stopLiveCamera();

    // Populate register state via canvas preprocessing (respects resolution & aspect ratio)
    const timestamp = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toTimeString().slice(0, 5).replace(':', '');
    const targetClass = selectedClass || (activeClasses.length === 1 ? activeClasses[0].name : '');
    if (!selectedClass && targetClass) {
      setSelectedClass(targetClass);
    }
    setImageCaptureSource('camera');

    void (async () => {
      let finalDataUrl = dataUrl;
      try {
        const pre = await preprocessRegisterImage({
          source: dataUrl,
          rotation: 0,
          cropBox: null,
          maxDimension: MAX_DIMENSION
        });
        finalDataUrl = pre.dataUrl;
        setRawSourceImage(pre.dataUrl);
        setRawDimensions({ width: pre.outputWidth, height: pre.outputHeight });
        setImageFileName(`REGISTER_CAMERA_${timestamp}_${timeStr}.jpg`);
        setImageFileSize(`${(pre.estimatedBytes / (1024 * 1024)).toFixed(2)} MB`);
        setImageDimensions({ width: pre.outputWidth, height: pre.outputHeight });
        setUploadedImage(pre.dataUrl);
        setPreprocessMeta(pre);
        setRotation(0);
        setCropBox(null);
        setIsResized(pre.wasResized);
        setErrorMessage(null);
        setGeminiResult(null);
        setValidatedDraft(null);
      } catch {
        setRawSourceImage(dataUrl);
        setRawDimensions({ width, height });
        setImageFileName(`REGISTER_CAMERA_${timestamp}_${timeStr}.jpg`);
        setImageFileSize(`${((dataUrl.length * 0.75) / (1024 * 1024)).toFixed(2)} MB`);
        setImageDimensions({ width, height });
        setUploadedImage(dataUrl);
        setPreprocessMeta(null);
        setRotation(0);
        setCropBox(null);
        setIsResized(false);
        setErrorMessage(null);
        setGeminiResult(null);
        setValidatedDraft(null);
      }

      if (targetClass) {
        void handleAnalyzeRegister({
          overrideImage: finalDataUrl,
          overrideRawImage: finalDataUrl,
          overrideClass: targetClass
        });
      } else {
        setWorkflowState('image-selected');
      }
    })();
  };

  // Helper to re-evaluate workflow state
  const evaluateWorkflowState = (hasImage: boolean, hasClass: boolean): ScanWorkflowState => {
    if (!hasImage) return 'empty';
    if (!hasClass) return 'image-selected';
    return 'ready-to-analyze';
  };

  // Applies physical pixel rotation + crop to rawSourceImage while preserving aspect ratio
  const applyPreprocessingTransform = async (
    sourceDataUrl: string,
    nextRotation: number,
    nextCrop: NormalizedCropBox | null
  ): Promise<PreprocessedImageResult | null> => {
    try {
      const pre = await preprocessRegisterImage({
        source: sourceDataUrl,
        rotation: nextRotation,
        cropBox: nextCrop
      });
      setUploadedImage(pre.dataUrl);
      setImageDimensions({ width: pre.outputWidth, height: pre.outputHeight });
      setImageFileSize(`${(pre.estimatedBytes / (1024 * 1024)).toFixed(2)} MB`);
      setIsResized(pre.wasResized);
      setPreprocessMeta(pre);
      return pre;
    } catch (err: any) {
      setErrorMessage(err?.message || 'Unable to preprocess the selected register image.');
      return null;
    }
  };

  // Handle Class change — auto-start extraction only for live camera captures
  const handleClassChange = (newClass: string) => {
    setSelectedClass(newClass);
    if (workflowState !== 'processing' && workflowState !== 'review' && workflowState !== 'confirmed') {
      if (uploadedImage && newClass && imageCaptureSource === 'camera') {
        void handleAnalyzeRegister({ overrideClass: newClass });
      } else {
        setWorkflowState(evaluateWorkflowState(Boolean(uploadedImage), Boolean(newClass)));
      }
    }
  };

  // Validate, normalize EXIF orientation, resize if excessive (preserving aspect ratio)
  // Camera captures auto-extract immediately; gallery uploads show preview first before uploading.
  const validateAndProcessFile = async (
    file: File,
    options: { source: 'camera' | 'gallery'; autoAnalyze: boolean } = { source: 'gallery', autoAnalyze: false }
  ) => {
    setErrorMessage(null);

    if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
      setWorkflowState('error');
      setErrorMessage(
        `Unsupported file type "${file.type || 'unknown'}". Please select a JPEG, PNG, or WebP photograph.`
      );
      return;
    }

    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      setWorkflowState('error');
      setErrorMessage(
        `File size (${fileSizeMB.toFixed(1)} MB) exceeds the ${MAX_FILE_SIZE_MB} MB limit. Please take a smaller photograph.`
      );
      return;
    }

    try {
      const pre = await preprocessRegisterImage({
        source: file,
        rotation: 0,
        cropBox: null,
        maxDimension: MAX_DIMENSION,
        preferredMimeType: file.type
      });

      const targetClass = selectedClass || (activeClasses.length === 1 ? activeClasses[0].name : '');
      if (!selectedClass && targetClass) {
        setSelectedClass(targetClass);
      }

      setImageCaptureSource(options.source);
      setRawSourceImage(pre.dataUrl);
      setRawDimensions({ width: pre.outputWidth, height: pre.outputHeight });
      setUploadedImage(pre.dataUrl);
      setImageFileName(file.name);
      setImageFileSize(`${(pre.estimatedBytes / (1024 * 1024)).toFixed(2)} MB`);
      setImageDimensions({ width: pre.outputWidth, height: pre.outputHeight });
      setIsResized(pre.wasResized);
      setPreprocessMeta(pre);
      setRotation(0);
      setCropBox(null);
      setGeminiResult(null);
      setValidatedDraft(null);

      if (options.autoAnalyze && targetClass) {
        void handleAnalyzeRegister({
          overrideImage: pre.dataUrl,
          overrideRawImage: pre.dataUrl,
          overrideClass: targetClass
        });
      } else {
        setWorkflowState(evaluateWorkflowState(true, Boolean(targetClass)));
      }
    } catch (err: any) {
      setWorkflowState('error');
      setErrorMessage(err?.message || 'Error processing photograph. Please try another image.');
    }
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    fromCamera = false
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      void validateAndProcessFile(file, {
        source: fromCamera ? 'camera' : 'gallery',
        autoAnalyze: fromCamera
      });
    }
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void validateAndProcessFile(file, { source: 'gallery', autoAnalyze: false });
    }
  };

  const handleResetCrop = () => {
    setRotation(0);
    setCropBox(null);
    if (rawSourceImage) {
      void applyPreprocessingTransform(rawSourceImage, 0, null);
    }
  };

  const handleApplyCrop = (nextCrop: NormalizedCropBox | null) => {
    setCropBox(nextCrop);
    if (rawSourceImage) {
      void applyPreprocessingTransform(rawSourceImage, rotation, nextCrop);
    }
  };

  // Single unified camera trigger: uses native camera app on phones, webcam viewfinder on desktop
  const handleTakePhotoAction = () => {
    const isMobileTouch =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)')?.matches ||
        (navigator.maxTouchPoints > 0 && window.innerWidth < 768));

    if (isMobileTouch && cameraInputRef.current) {
      cameraInputRef.current.click();
    } else {
      void startLiveCamera('environment');
    }
  };

  // Remove image & clear current scan completely
  const handleRemoveImage = () => {
    if (analyzeAbortControllerRef.current) {
      analyzeAbortControllerRef.current.abort();
      analyzeAbortControllerRef.current = null;
    }
    setRawSourceImage(null);
    setRawDimensions(null);
    setUploadedImage(null);
    setImageFileName(null);
    setImageFileSize(null);
    setImageDimensions(null);
    setRotation(0);
    setCropBox(null);
    setPreprocessMeta(null);
    setErrorMessage(null);
    setIsResized(false);
    setGeminiResult(null);
    setValidatedDraft(null);
    setImageCaptureSource(null);
    setWorkflowState(evaluateWorkflowState(false, Boolean(selectedClass)));
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // Delete current picture/scan and immediately launch camera to retake another one
  const handleRetakePhoto = () => {
    handleRemoveImage();
    handleTakePhotoAction();
  };

  // Cancel active extraction cleanly without throwing an error
  const handleCancelAnalysis = () => {
    if (analyzeAbortControllerRef.current) {
      analyzeAbortControllerRef.current.abort();
      analyzeAbortControllerRef.current = null;
    }
    setWorkflowState(evaluateWorkflowState(Boolean(uploadedImage), Boolean(selectedClass)));
  };

  // Helper to build validated draft with full preprocessing metadata
  const buildDraftWithPreprocessMetadata = (
    extractionPayload: GeminiExtractionResult,
    usedModelName: string,
    targetClassOverride?: string
  ): AttendanceSessionDraft => {
    const targetClassName = targetClassOverride || selectedClass;
    const targetClassObj = activeClasses.find((c) => c.name === targetClassName);
    const rosterForClass = students.filter(
      (s) => targetClassObj && s.classId === targetClassObj.id && s.active
    );

    return validateAndBuildSessionDraft(extractionPayload, {
      classId: targetClassObj?.id || 'cls-unassigned',
      className: targetClassName,
      attendancePeriod: selectedDate,
      sourceImageMetadata: {
        fileName: imageFileName || 'register-scan.jpg',
        fileSize: imageFileSize || undefined,
        width: rawDimensions?.width || imageDimensions?.width,
        height: rawDimensions?.height || imageDimensions?.height,
        preprocessedWidth: preprocessMeta?.outputWidth || imageDimensions?.width,
        preprocessedHeight: preprocessMeta?.outputHeight || imageDimensions?.height,
        rotation,
        wasCropped: Boolean(cropBox),
        wasRotated: rotation !== 0,
        wasResized: isResized,
        isLowResolution: preprocessMeta?.isLowResolution,
        capturedAt: new Date().toISOString(),
        modelUsed: usedModelName
      },
      sourceImageReference: imageFileName || undefined,
      classStudents: rosterForClass
    });
  };

  // Stage 2: Instant browser Canvas Tick & Ink Verifier (fallback to Cloud Vision strips only when gridGeometry is absent)
  const runStagedCellVerification = async (
    stage1Data: GeminiExtractionResult,
    sourceDataUrl: string,
    _modelHint: string
  ): Promise<GeminiExtractionResult> => {
    const rows = stage1Data.rows || [];
    if (rows.length === 0) return stage1Data;

    if (stage1Data.gridGeometry) {
      setIsStagedVerifying(true);
      try {
        return await verifyRegisterCellsOnCanvas(sourceDataUrl, stage1Data);
      } catch (err) {
        console.warn('Stage 2 canvas tick verification skipped due to error:', err);
        return stage1Data;
      } finally {
        setIsStagedVerifying(false);
      }
    }

    const detectedWeeks =
      stage1Data.layoutQuality?.detectedWeeks && stage1Data.layoutQuality.detectedWeeks.length > 0
        ? stage1Data.layoutQuality.detectedWeeks
        : [rows[0]?.marks?.[0]?.week || 'Week 1'];
    const detectedDays =
      stage1Data.detectedDays && stage1Data.detectedDays.length > 0
        ? stage1Data.detectedDays
        : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    // Collect uncertain/overwritten slots or missing weekday slots per row
    const targetSlots: CellTargetSlot[] = [];
    rows.forEach((row) => {
      (row.marks || []).forEach((m) => {
        if (m.status === 'UNCERTAIN' || m.isCorrectionOrOverwritten) {
          targetSlots.push({
            rowNumber: row.rowNumber,
            studentName: row.studentNameDetected,
            week: m.week || detectedWeeks[0] || 'Week 1',
            day: m.day
          });
        }
      });
    });

    // If no explicit uncertain cells were flagged, sample all row marks on the primary detected week
    if (targetSlots.length === 0) {
      const targetWeek = detectedWeeks[0] || 'Week 1';
      rows.slice(0, 15).forEach((row) => {
        detectedDays.slice(0, 5).forEach((day) => {
          targetSlots.push({
            rowNumber: row.rowNumber,
            studentName: row.studentNameDetected,
            week: targetWeek,
            day
          });
        });
      });
    }

    if (targetSlots.length === 0) return stage1Data;

    setIsStagedVerifying(true);
    try {
      const strips = computeTableRowStrips(stage1Data.layoutQuality?.tableBoundingBox, 2);
      const cellModel = 'google-cloud-vision';
      const allVerifiedCells: StagedVerifiedCell[] = [];

      for (const strip of strips) {
        const stripImage = await extractNormalizedRegionDataUrl(sourceDataUrl, strip);
        const resp = await fetch('/api/analyze-register-cells', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: stripImage,
            className: selectedClass,
            detectedWeeks,
            detectedDays,
            targetSlots: targetSlots.slice(0, 40),
            model: cellModel
          })
        });
        if (resp.ok) {
          const stripJson = await resp.json();
          if (stripJson.ok && Array.isArray(stripJson.verifiedCells)) {
            allVerifiedCells.push(...stripJson.verifiedCells);
          }
        }
      }

      const merged = mergeStagedCellResults(stage1Data, allVerifiedCells);
      return {
        ...merged,
        processingStageUsed: 'staged-cell-verification'
      };
    } catch (err) {
      console.warn('Staged cell verification skipped due to error:', err);
      return stage1Data;
    } finally {
      setIsStagedVerifying(false);
    }
  };

  const handleManualStagedVerification = async () => {
    if (!geminiResult || !uploadedImage) return;
    const updatedExtraction = await runStagedCellVerification(
      geminiResult,
      uploadedImage,
      selectedModel
    );
    const updatedDraft = buildDraftWithPreprocessMetadata(updatedExtraction, actualModelUsed);
    setGeminiResult(updatedExtraction);
    setValidatedDraft(updatedDraft);
  };

  // VISION ANALYSIS HANDLER (Supports Gemini Vision & optional Google Cloud Vision API)
  const handleAnalyzeRegister = async (opts?: {
    overrideModel?: string;
    overrideImage?: string;
    overrideRawImage?: string;
    overrideClass?: string;
  }) => {
    const imageToAnalyze = opts?.overrideImage || uploadedImage;
    const rawToAnalyze = opts?.overrideRawImage || rawSourceImage;
    const classToAnalyze = opts?.overrideClass ?? selectedClass;

    if (!imageToAnalyze) {
      setErrorMessage('Please select or upload a register photograph first.');
      return;
    }
    if (!classToAnalyze) {
      setWorkflowState('image-selected');
      return;
    }
    if (!isOnline) {
      setWorkflowState('error');
      setErrorMessage(
        'Network connectivity lost. Register analysis requires an internet connection—your photograph remains intact so you can retry once reconnected.'
      );
      return;
    }

    if (analyzeAbortControllerRef.current) {
      analyzeAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    analyzeAbortControllerRef.current = controller;

    const modelToUse = 'google-cloud-vision';
    setWorkflowState('processing');
    setErrorMessage(null);
    setBillingAlert(null);

    setProcessingPhase('Scanning register photograph...');

    const timer2 = setTimeout(() => {
      setProcessingPhase('Verifying ticks and blanks on attendance grid...');
    }, 900);

    try {
      const normRot = normalizeQuarterRotation(rotation);
      const alreadyPrepared =
        Boolean(opts?.overrideImage) ||
        (preprocessMeta !== null &&
          preprocessMeta.rotationApplied === normRot &&
          preprocessMeta.wasCropped === Boolean(cropBox));

      const prepared =
        !alreadyPrepared && rawToAnalyze && (normRot !== 0 || cropBox)
          ? await preprocessRegisterImage({
              source: rawToAnalyze,
              rotation: normRot,
              cropBox,
              maxDimension: MAX_DIMENSION
            })
          : null;
      const imagePayloadToSend = prepared?.dataUrl || imageToAnalyze;

      const response = await fetch('/api/analyze-register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          image: imagePayloadToSend,
          className: classToAnalyze,
          formatMode: registerMode,
          date: selectedDate,
          rotation,
          wasCropped: Boolean(cropBox),
          model: modelToUse
        })
      });

      clearTimeout(timer2);

      const json = await response.json();

      if (!response.ok || !json.ok) {
        setWorkflowState('error');

        if (json.code === 'GCP_BILLING_REQUIRED') {
          setBillingAlert({
            required: true,
            message: json.error,
            billingUrl: json.billingUrl || 'https://console.cloud.google.com/billing'
          });
          setErrorMessage(json.error || 'Google Cloud Vision requires billing to be enabled on your project.');
          return;
        }

        setErrorMessage(json.error || 'Failed to inspect register photograph via Google Cloud Vision.');
        return;
      }

      const usedModelName = json.modelUsed || 'Google Cloud Vision API';

      let extractionResult: GeminiExtractionResult = json.data;
      if (extractionResult?.gridGeometry) {
        try {
          extractionResult = await verifyRegisterCellsOnCanvas(
            imagePayloadToSend,
            extractionResult
          );
        } catch (stage2Err) {
          console.warn('Stage 2 canvas tick verification warning:', stage2Err);
        }
      }
      const draft = buildDraftWithPreprocessMetadata(extractionResult, usedModelName, classToAnalyze);

      setGeminiResult(extractionResult);
      setValidatedDraft(draft);
      setActualModelUsed(usedModelName);

      if (extractionResult.detectedHolidayAnnotation) {
        setHolidayLabelInput(
          extractionResult.detectedHolidayAnnotation.text || 'Public Holiday'
        );
        setPendingHolidayPrompt({
          annotation: extractionResult.detectedHolidayAnnotation,
          extraction: extractionResult,
          draft,
          usedModelName
        });
        setWorkflowState('ready-to-analyze');
        return;
      }

      setWorkflowState('review');
    } catch (err: any) {
      clearTimeout(timer2);
      if (err?.name === 'AbortError') {
        return;
      }
      setWorkflowState('error');
      setErrorMessage(
        isNetworkOrOfflineError(err)
          ? 'Network connectivity lost while communicating with Google Cloud Vision. Your selected image is preserved—check connectivity and retry.'
          : err?.message || 'Network error communicating with Google Cloud Vision service.'
      );
    } finally {
      if (analyzeAbortControllerRef.current === controller) {
        analyzeAbortControllerRef.current = null;
      }
    }
  };

  // Repeatable Benchmark Test Suite Runner (Developer Diagnostics only)
  const handleRunAllBenchmarks = () => {
    const p4aClass = activeClasses[0];
    const p4aStudents = students.filter(
      (s) => p4aClass && s.classId === p4aClass.id && s.active
    );
    const fixtures = getLabeledRegisterTestFixtures();
    let latest = getStoredRegisterTestOutcomes();
    fixtures.forEach((fixture) => {
      const { outcome } = runFixtureValidationBenchmark(fixture, p4aStudents);
      latest = saveRegisterTestOutcome(outcome);
    });
    setTestOutcomes(latest);
  };

  const handleInspectBenchmarkFixture = async (fixtureId: RegisterTestFixture['id']) => {
    const fixture = getLabeledRegisterTestFixtures().find((f) => f.id === fixtureId);
    if (!fixture) return;
    const samplePng = uploadedImage || createBlankDiagnosticPreviewDataUrl();
    const targetClassObj = activeClasses.find((c) => c.name === fixture.className);
    const roster = students.filter(
      (s) => targetClassObj && s.classId === targetClassObj.id && s.active
    );
    const { draft, outcome } = runFixtureValidationBenchmark(fixture, roster);
    setTestOutcomes(saveRegisterTestOutcome(outcome));
    setSelectedClass(fixture.className);
    setRawSourceImage(samplePng);
    setUploadedImage(samplePng);
    setImageFileName(`BENCHMARK_${fixture.id}.png`);
    setGeminiResult(fixture.simulatedPayload);
    setValidatedDraft(draft);
    setActualModelUsed('Labeled Benchmark Suite');
    setWorkflowState('review');
  };

  // Developer Test Harness Handler
  const handleRunValidationSampleTest = async (mode: 'valid' | 'malformed') => {
    const samplePng = uploadedImage || createBlankDiagnosticPreviewDataUrl();
    const targetClassName = selectedClass || activeClasses[0]?.name || 'Diagnostic Class';
    const targetClassObj = activeClasses.find((c) => c.name === targetClassName);
    const rosterForClass = students.filter(
      (s) => targetClassObj && s.classId === targetClassObj.id && s.active
    );

    const { validMultiWeekSample, malformedSample } = createValidationTestSamples();
    const rawPayload = mode === 'valid' ? validMultiWeekSample : malformedSample;

    const draft = validateAndBuildSessionDraft(rawPayload, {
      classId: targetClassObj?.id || 'cls-diagnostic',
      className: targetClassName,
      attendancePeriod:
        mode === 'valid'
          ? 'Weeks 1 & 2 (Diagnostic Sample)'
          : 'Malformed Payload Sample',
      sourceImageMetadata: {
        fileName: mode === 'valid' ? 'TEST_VALID_MULTIWEEK.png' : 'TEST_MALFORMED_PAYLOAD.png',
        rotation: 0,
        capturedAt: new Date().toISOString(),
        modelUsed: 'Validation Test Harness'
      },
      sourceImageReference: 'developer-test-sample',
      classStudents: rosterForClass
    });

    setSelectedClass(targetClassName);
    setRawSourceImage(samplePng);
    setUploadedImage(samplePng);
    setImageFileName(
      mode === 'valid' ? 'TEST_VALID_MULTIWEEK.png' : 'TEST_MALFORMED_PAYLOAD.png'
    );
    setGeminiResult(rawPayload as unknown as GeminiExtractionResult);
    setValidatedDraft(draft);
    setActualModelUsed(
      mode === 'valid' ? 'Validation Sample (Valid Multi-Week)' : 'Validation Sample (Malformed)'
    );
    setWorkflowState('review');
  };

  // Handle Confirmed Session Save (awaits remote DB transaction when live; throws to preserve draft on failure)
  const handleConfirmAttendance = async (
    session: AttendanceSession,
    confirmedDraft?: AttendanceSessionDraft
  ) => {
    const enrichedSession: AttendanceSession = {
      ...session,
      captureMode: session.captureMode || 'register'
    };
    if (onSaveConfirmedSession) {
      await onSaveConfirmedSession(enrichedSession, confirmedDraft);
    }
    if (confirmedDraft?.id) {
      deleteStoredSessionDraft(confirmedDraft.id);
    }
    const targetClassObj = activeClasses.find(
      (c) =>
        (enrichedSession.classId && c.id === enrichedSession.classId) ||
        c.name.toLowerCase() === enrichedSession.classGrade.toLowerCase()
    );
    const suggestion = targetClassObj
      ? computeAndSuggestNextClass([targetClassObj.id], enrichedSession.date)
      : null;
    setNextSuggestedClass(suggestion);

    setRawSourceImage(null);
    setRawDimensions(null);
    setUploadedImage(null);
    setGeminiResult(null);
    setValidatedDraft(null);
    setConfirmedSessionSummary(enrichedSession);
    setWorkflowState('confirmed');
  };

  // Handle Summary Note batch confirmation + adaptive next-class auto-advance
  const handleSaveSummarySessions = async (
    sessionsToSave: AttendanceSession[],
    confirmedClassIds: string[]
  ) => {
    if (!onSaveConfirmedSession) return;
    for (const sess of sessionsToSave) {
      await onSaveConfirmedSession(sess);
    }

    const suggestion = computeAndSuggestNextClass(confirmedClassIds, selectedDate);
    setNextSuggestedClass(suggestion);

    if (suggestion?.nextClass) {
      setSelectedClass(suggestion.nextClass.name);
      const routeNote =
        suggestion.source === 'learned'
          ? 'following your learned class route'
          : 'next class in sequence';
      setAutoAdvanceToast(
        `Saved ${sessionsToSave.length} class ${sessionsToSave.length === 1 ? 'summary' : 'summaries'}. Auto-advanced to ${suggestion.nextClass.name} (${routeNote}).`
      );
    } else if (suggestion?.source === 'complete') {
      setAutoAdvanceToast(
        `Saved ${sessionsToSave.length} class ${sessionsToSave.length === 1 ? 'summary' : 'summaries'}. All classes are now scanned for ${selectedDate}!`
      );
    } else {
      setAutoAdvanceToast(
        `Saved ${sessionsToSave.length} class ${sessionsToSave.length === 1 ? 'summary' : 'summaries'} for ${selectedDate}.`
      );
    }
  };

  // Confirm detected vertical/upside-down holiday annotation as a Non-School Day
  const handleConfirmDetectedHolidayDay = async () => {
    if (!pendingHolidayPrompt) return;
    const reason = holidayLabelInput.trim() || 'Non-School Day';
    setIsSavingHolidayDay(true);
    try {
      if (onAddNonSchoolGap) {
        onAddNonSchoolGap({
          startDate: selectedDate,
          endDate: selectedDate,
          label: reason,
          source: 'register-ocr'
        });
      }

      const targetClassObj = activeClasses.find((c) => c.name === selectedClass);
      if (onSaveConfirmedSession && targetClassObj) {
        const nonSchoolSession: AttendanceSession = {
          id: `ses-nonschool-${targetClassObj.id.slice(0, 8)}-${selectedDate}-${Date.now()}`,
          date: selectedDate,
          classId: targetClassObj.id,
          classGrade: targetClassObj.name,
          term: school?.currentTerm || 'First Term',
          sessionYear: school?.academicSession || '2025/2026 Academic Session',
          totalEnrolled: classStudents.length,
          presentCount: 0,
          absentCount: 0,
          blankCount: 0,
          uncertainCount: 0,
          unmappedCount: 0,
          reviewStatus: 'Confirmed',
          captureMode: 'register',
          isNonSchoolDay: true,
          nonSchoolReason: reason,
          recordedBy: school?.administratorName || 'School Administrator',
          verifiedBy: `${school?.administratorName || 'School Administrator'} (Confirmed Non-School Day)`,
          notes: `Marked as Non-School Day (${reason}) from register sheet annotation.`,
          sourceDraftId: `nonschool-${targetClassObj.id.slice(0, 8)}-${selectedDate}-${Date.now()}`
        };
        await onSaveConfirmedSession(nonSchoolSession);
      }

      setPendingHolidayPrompt(null);
      handleRemoveImage();
      setAutoAdvanceToast(
        `${formatReadableDate(selectedDate)} recorded as Non-School Day ("${reason}") and excluded from attendance percentages.`
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'Unable to save Non-School Day record.');
    } finally {
      setIsSavingHolidayDay(false);
    }
  };

  // Reset to scan next class (optionally auto-selecting the suggested next class)
  const handleResetToScanAnother = (nextClassNameOverride?: string) => {
    setRawSourceImage(null);
    setRawDimensions(null);
    setUploadedImage(null);
    setImageFileName(null);
    setImageFileSize(null);
    setImageDimensions(null);
    setRotation(0);
    setCropBox(null);
    setPreprocessMeta(null);
    setErrorMessage(null);
    setGeminiResult(null);
    setValidatedDraft(null);
    setConfirmedSessionSummary(null);
    setSelectedClass(nextClassNameOverride ?? nextSuggestedClass?.nextClass?.name ?? '');
    if (nextClassNameOverride || nextSuggestedClass?.nextClass) {
      const targetName = nextClassNameOverride || nextSuggestedClass?.nextClass?.name || '';
      const routeText =
        nextSuggestedClass?.source === 'learned' ? 'learned route' : 'sequential order';
      setAutoAdvanceToast(`Ready for ${targetName} (${routeText}).`);
    }
    setWorkflowState('empty');
  };

  const handleCheckDuplicateSessions = async (params: {
    classId: string;
    className: string;
    date: string;
    period: string;
    draftId: string;
  }): Promise<DuplicateSessionMatch[]> => {
    const localMatches = findPotentialDuplicateSessions({
      candidateClassId: params.classId,
      candidateClassName: params.className,
      candidateDate: params.date,
      candidatePeriod: params.period,
      candidateDraftId: params.draftId,
      existingSessions
    });

    if (!isSupabaseLive || !isOnline) {
      return localMatches;
    }

    const client = getSupabaseClient();
    const targetClassObj = activeClasses.find(
      (c) => c.id === params.classId || c.name.toLowerCase() === params.className.toLowerCase()
    );
    if (!client || !targetClassObj) {
      return localMatches;
    }

    try {
      const remoteExisting = await checkDuplicateSessionsInSupabase(client, {
        classId: targetClassObj.id,
        attendanceDate: params.date,
        sourceDraftId: params.draftId
      });

      const mergedMap = new Map<string, AttendanceSession>();
      existingSessions.forEach((s) => mergedMap.set(s.id, s));
      remoteExisting.forEach((s) => mergedMap.set(s.id, s));

      return findPotentialDuplicateSessions({
        candidateClassId: targetClassObj.id,
        candidateClassName: params.className,
        candidateDate: params.date,
        candidatePeriod: params.period,
        candidateDraftId: params.draftId,
        existingSessions: Array.from(mergedMap.values())
      });
    } catch {
      return localMatches;
    }
  };

  // Relevant enrolled students for the selected class
  const selectedClassItem = activeClasses.find((c) => c.name === selectedClass);
  const classStudents = students.filter(
    (s) => selectedClassItem && s.classId === selectedClassItem.id && s.active
  );

  // 1. IF IN REVIEW STATE: Render the TranscriptionReviewView component
  // NOTE: uploadedImage already has pixel rotation & crop baked in, so display rotation passed to viewer is 0.
  if (workflowState === 'review' && geminiResult && uploadedImage) {
    return (
      <TranscriptionReviewView
        imageUri={uploadedImage}
        rotation={0}
        className={selectedClass}
        selectedDate={selectedDate}
        attendancePeriod={selectedDate}
        formatMode={registerMode}
        geminiResult={geminiResult}
        initialDraft={validatedDraft || undefined}
        modelUsed={actualModelUsed}
        classStudents={classStudents}
        school={school}
        isSupabaseLive={isSupabaseLive}
        isStagedVerifying={isStagedVerifying}
        onReAnalyze={() => void handleAnalyzeRegister()}
        onCropOrRetake={() => {
          setWorkflowState('ready-to-analyze');
          setIsCropModalOpen(true);
        }}
        onRetakeOrDelete={handleRetakePhoto}
        onRunStagedVerification={handleManualStagedVerification}
        onSaveDraftOnly={(draftToSave) => saveStoredSessionDraft(draftToSave)}
        onCheckDuplicateSessions={handleCheckDuplicateSessions}
        onInspectExistingSession={onInspectExistingSession}
        onConfirmAttendance={handleConfirmAttendance}
        onCancel={() => setWorkflowState('ready-to-analyze')}
      />
    );
  }

  // 2. IF IN CONFIRMED STATE: Render Confirmed Success Celebration Screen + Post-Scan Starred Pupils & Auto-Advance
  if (workflowState === 'confirmed' && confirmedSessionSummary) {
    const presentRate =
      confirmedSessionSummary.totalEnrolled > 0
        ? Math.round(
            (confirmedSessionSummary.presentCount / confirmedSessionSummary.totalEnrolled) * 100
          )
        : 0;

    const confirmedClassObj = activeClasses.find(
      (c) =>
        (confirmedSessionSummary.classId && c.id === confirmedSessionSummary.classId) ||
        c.name.toLowerCase() === confirmedSessionSummary.classGrade.toLowerCase()
    );

    const postScanStarredSummaries =
      (confirmedSessionSummary.captureMode ?? 'register') === 'register' &&
      starredStudentIds.length > 0
        ? computeStarredStudentSummaries({
            students,
            classes: activeClasses,
            sessions: [
              confirmedSessionSummary,
              ...existingSessions.filter((s) => s.id !== confirmedSessionSummary.id)
            ],
            starredIds: starredStudentIds,
            targetDate: confirmedSessionSummary.date,
            nonSchoolGaps,
            filterClassId: confirmedClassObj?.id
          })
        : [];

    return (
      <div className="max-w-2xl mx-auto py-6 sm:py-8 space-y-5">
        <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-xs text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="w-9 h-9 text-emerald-700" />
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
              {confirmedSessionSummary.persistenceTarget === 'supabase'
                ? 'Saved to Supabase PostgreSQL'
                : 'Demonstration Record Saved Locally'}
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Attendance Session Confirmed
            </h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              {confirmedSessionSummary.persistenceTarget === 'supabase' ? (
                <>
                  The attendance review for <strong className="text-slate-900">{confirmedSessionSummary.classGrade}</strong> has been committed atomically to your <strong className="text-slate-800">Supabase PostgreSQL database</strong>.
                </>
              ) : (
                <>
                  The attendance review for <strong className="text-slate-900">{confirmedSessionSummary.classGrade}</strong> has been confirmed and stored in your <strong className="text-slate-800">local browser demonstration storage</strong>.
                </>
              )}
            </p>
          </div>

          {/* Breakdown summary card */}
          <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 text-xs text-slate-700 text-left space-y-3">
            <div className="font-semibold text-slate-900 pb-2 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
              <span>Session Summary</span>
              <span className="text-[11px] font-medium text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                {confirmedSessionSummary.persistenceTarget === 'supabase'
                  ? 'Confirmed · Supabase DB'
                  : 'Confirmed · Local Demo Record'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-2.5 bg-white rounded border border-slate-200">
                <div className="text-slate-400 text-[10px] uppercase font-bold">Class</div>
                <div className="text-sm font-bold text-slate-800 mt-0.5">
                  {confirmedSessionSummary.classGrade}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded border border-slate-200">
                <div className="text-slate-400 text-[10px] uppercase font-bold">Date</div>
                <div className="text-sm font-bold text-slate-800 mt-0.5 tabular-nums">
                  {confirmedSessionSummary.date}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded border border-slate-200">
                <div className="text-slate-400 text-[10px] uppercase font-bold">Present</div>
                <div className="text-sm font-bold text-emerald-700 mt-0.5 tabular-nums">
                  {confirmedSessionSummary.presentCount}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded border border-slate-200">
                <div className="text-slate-400 text-[10px] uppercase font-bold">Absent</div>
                <div className="text-sm font-bold text-rose-700 mt-0.5 tabular-nums">
                  {confirmedSessionSummary.absentCount}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 pt-1 flex items-center justify-between">
              <span>Attendance Rate: <strong className="text-slate-800 tabular-nums">{presentRate}%</strong></span>
              <span>Total Enrolled: <strong className="text-slate-800 tabular-nums">{confirmedSessionSummary.totalEnrolled} Pupils</strong></span>
            </div>
          </div>

          {/* Adaptive Next-Class Auto-Advance Notice */}
          {nextSuggestedClass?.nextClass && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-emerald-950">
                <div className="font-bold">
                  Next Class Ready: {nextSuggestedClass.nextClass.name}
                </div>
                <div className="text-emerald-800 mt-0.5">
                  {nextSuggestedClass.source === 'learned'
                    ? `Suggested automatically from your learned daily route (${nextSuggestedClass.learnedDaysCount} school days observed).`
                    : 'Auto-advancing sequentially to the next unscanned class.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleResetToScanAnother(nextSuggestedClass.nextClass?.name)}
                className="min-h-[42px] px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
              >
                <span>Scan {nextSuggestedClass.nextClass.name}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {nextSuggestedClass?.source === 'complete' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs font-semibold text-emerald-900">
              All {activeClasses.length} classes have been scanned for {confirmedSessionSummary.date}.
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={onNavigateToRecords}
              className="w-full sm:w-auto min-h-[42px] px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              View in Attendance Records
            </button>

            {onNavigateToDashboard && (
              <button
                type="button"
                onClick={onNavigateToDashboard}
                className="w-full sm:w-auto min-h-[42px] px-5 py-2.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors shadow-2xs cursor-pointer"
              >
                Return to Dashboard
              </button>
            )}

            <button
              type="button"
              onClick={() => handleResetToScanAnother()}
              className="w-full sm:w-auto min-h-[42px] px-5 py-2.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
            >
              {nextSuggestedClass?.nextClass
                ? `Next: ${nextSuggestedClass.nextClass.name}`
                : 'Scan Another Register'}
            </button>
          </div>
        </div>

        {/* Post-Scan Starred Pupils Callout (Direct Register Only, Numbers & Percentages Only) */}
        {postScanStarredSummaries.length > 0 && (
          <StarredPupilsCard
            summaries={postScanStarredSummaries}
            title={`Starred Pupils in ${confirmedSessionSummary.classGrade}`}
            subtitle={`Updated from today's direct register scan (${confirmedSessionSummary.date})`}
          />
        )}
      </div>
    );
  }

  // 3. MAIN INTAKE & UPLOAD INTERFACE (Mobile-First Full Width)
  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-5 max-w-2xl mx-auto">
      {/* Contextual Offline Banner (Only shown when browser loses connectivity) */}
      {!isOnline && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 text-xs flex items-start gap-2.5">
          <WifiOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <strong>Network Connectivity Lost:</strong> You can crop photos locally or inspect saved drafts, while scanning and saving require an internet connection.
          </div>
        </div>
      )}

      {/* Page Title & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-2xl font-bold text-slate-900">
            {activeScanMode === 'summary' ? 'Scan Written Summary' : 'Scan Attendance Register'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
            {activeScanMode === null
              ? 'Choose whether to scan directly from the class register or from your written notebook summary.'
              : activeScanMode === 'summary'
              ? 'Select class & date, then photograph or upload your handwritten class totals.'
              : 'Captures today’s exact day column from the rightmost week on the register sheet.'}
          </p>
        </div>

        {activeScanMode !== null && (
          <div className="inline-flex items-center p-1 bg-slate-200/80 rounded-xl shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => requestSwitchToScanMode('register')}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                activeScanMode === 'register'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>Scan from Register</span>
            </button>
            <button
              type="button"
              onClick={() => requestSwitchToScanMode('summary')}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                activeScanMode === 'summary'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <NotebookPen className="w-3.5 h-3.5" />
              <span>Scan from Summary</span>
            </button>
          </div>
        )}
      </div>

      {/* Auto-advance / Gap Saved Confirmation Toast */}
      {autoAdvanceToast && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{autoAdvanceToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setAutoAdvanceToast(null)}
            className="text-emerald-700 hover:text-emerald-950 font-semibold cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* INITIAL SCAN MODE CHOOSER (Shown when default scan mode is 'ask' and no mode selected yet) */}
      {activeScanMode === null && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-xs space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setChooserSelection('register')}
              className={`text-left p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2 ${
                chooserSelection === 'register'
                  ? 'border-emerald-600 bg-emerald-50/60'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <ScanLine className="w-5 h-5" />
              </div>
              <div className="text-sm font-bold text-slate-900">Scan from Register</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Photograph the physical class register directly. Automatically reads today’s day column in the rightmost week and updates starred pupils &amp; punctuality records.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setChooserSelection('summary')}
              className={`text-left p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2 ${
                chooserSelection === 'summary'
                  ? 'border-emerald-600 bg-emerald-50/60'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
                <NotebookPen className="w-5 h-5" />
              </div>
              <div className="text-sm font-bold text-slate-900">Scan from Summary</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Photograph your handwritten notebook summary of Present, Absent, and Total counts collected across classes.
              </p>
            </button>
          </div>

          <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={setChoiceAsDefault}
                onChange={(e) => setSetChoiceAsDefault(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span>Set current choice as default scan mode (changeable in Settings)</span>
            </label>

            <button
              type="button"
              onClick={() => requestSwitchToScanMode(chooserSelection, setChoiceAsDefault)}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <span>
                Continue with {chooserSelection === 'register' ? 'Scan from Register' : 'Scan from Summary'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Billing Alert Banner */}
      {billingAlert && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 shadow-sm space-y-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1 min-w-0">
              <h3 className="text-sm font-bold text-amber-900">
                Google Cloud Billing Required
              </h3>
              <p className="text-xs text-amber-800 leading-relaxed">
                {billingAlert.message}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-amber-200/70 flex flex-wrap items-center gap-2.5">
            <a
              href={billingAlert.billingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-800 hover:bg-amber-900 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <span>Open Billing Console</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={() => setBillingAlert(null)}
              className="px-3 py-2 text-xs font-medium text-amber-800 hover:text-amber-950 underline ml-auto cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* General Error Banner */}
      {errorMessage && !billingAlert && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl text-xs font-medium flex items-start justify-between gap-2.5 shadow-2xs">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <span className="font-semibold">Scan Notice:</span>
              <p className="text-rose-800 leading-relaxed wrap-break-word">{errorMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-600 hover:text-rose-800 text-xs font-semibold shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Full-width Mobile Intake Workflow (Visible once a scan mode is selected) */}
      {activeScanMode !== null && (
      <div className="w-full min-w-0 space-y-4">
        {/* 1. Class & Date Details */}
        <div className="w-full min-w-0 bg-white rounded-xl border border-slate-200 p-3.5 sm:p-5 shadow-xs space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-800">
              1. Class &amp; Date
            </h3>
            <span className="text-[11px] font-medium text-slate-500">
              {activeScanMode === 'summary' ? 'Written Summary Mode' : 'Single-Day · Rightmost Week'}
            </span>
          </div>

          {/* Class Selection & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                School Class <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedClass}
                onChange={(e) => handleClassChange(e.target.value)}
                disabled={activeClasses.length === 0}
                className="w-full min-h-[44px] text-xs sm:text-sm py-2.5 px-3 border border-slate-300 rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-emerald-700 font-medium disabled:bg-slate-100"
              >
                <option value="">
                  {activeClasses.length === 0 ? '-- No classes enrolled yet --' : '-- Choose Class --'}
                </option>
                {activeClasses.map((cls) => (
                  <option key={cls.id} value={cls.name}>
                    {cls.name} {cls.classTeacher ? `· ${cls.classTeacher}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0">
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Attendance Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full min-h-[44px] text-xs sm:text-sm py-2.5 px-3 border border-slate-300 rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-emerald-700 tabular-nums"
              />
            </div>
          </div>

          {/* Weekend Warning (Sat & Sun are No School by default) */}
          {dateIsWeekend ? (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start gap-2">
                <CalendarOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  <strong>No School on Weekends:</strong> Saturdays and Sundays are non-school days by default. Choose a Monday–Friday school date to scan.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDate(getDefaultSchoolDate())}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold cursor-pointer shrink-0"
              >
                Use Latest School Day
              </button>
            </div>
          ) : activeScanMode === 'register' ? (
            <div className="px-3 py-2 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-bold">Target:</span>{' '}
                <span>{targetWeekdayInfo.dayName}</span> ·{' '}
                <span className="font-semibold">{targetWeekdayInfo.ordinalHint}</span> ·{' '}
                <span>Rightmost Week</span>
              </div>
              <span className="text-[11px] text-emerald-800">
                Use Crop to frame the exact region if needed
              </span>
            </div>
          ) : null}

          {activeClasses.length === 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                No classes exist yet. Go to <strong>Students</strong> and add a class or enroll students first.
              </span>
            </div>
          )}

          {activeScanMode === 'register' && selectedClassItem && classStudents.length === 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                <strong>{selectedClassItem.name}</strong> has 0 enrolled students. Extracted rows remain unmapped until students are enrolled under <strong>Students</strong>.
              </span>
            </div>
          )}
        </div>

        {/* SUMMARY MODE PANEL */}
        {activeScanMode === 'summary' && !dateIsWeekend && (
          <SummaryNoteScanPanel
            school={school}
            classes={activeClasses}
            students={students}
            selectedClassId={selectedClassItem?.id || ''}
            selectedClassName={selectedClass}
            selectedDate={selectedDate}
            onSelectClassId={(cid) => {
              const found = activeClasses.find((c) => c.id === cid);
              if (found) setSelectedClass(found.name);
            }}
            onSaveSummarySessions={handleSaveSummarySessions}
          />
        )}

        {/* DIRECT REGISTER CAPTURE CARD (Only when in Register mode) */}
        {activeScanMode === 'register' && !dateIsWeekend && (
        <>

        {/* 2. Photograph Capture & 9:16 Portrait Preview */}
        <div
          data-tutorial-target="scan-register-capture"
          className={`w-full min-w-0 bg-white rounded-xl border p-3.5 sm:p-5 shadow-xs space-y-3.5 transition-all ${
            highlightedTarget === 'scan-register-capture'
              ? 'border-emerald-500 ring-2 ring-emerald-500/30'
              : 'border-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-800">
              2. Register Photograph
            </h3>
            <span className="text-[11px] text-slate-500">
              {uploadedImage
                ? workflowState === 'processing'
                  ? 'Scanning sheet...'
                  : '9:16 Portrait Preview'
                : 'Camera or Gallery'}
            </span>
          </div>

          {/* Hidden native file inputs */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFileChange(e, false)}
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
          />
          <input
            type="file"
            ref={cameraInputRef}
            onChange={(e) => handleFileChange(e, true)}
            accept="image/*"
            capture="environment"
            className="hidden"
          />

          {!uploadedImage ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`w-full border-2 border-dashed rounded-xl p-4 sm:p-7 text-center transition-all ${
                isDragging
                  ? 'border-emerald-600 bg-emerald-50/50'
                  : 'border-slate-300 hover:border-slate-400 bg-slate-50/60'
              }`}
            >
              <div className="w-full max-w-md mx-auto space-y-3.5">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto shadow-2xs">
                  <Camera className="w-6 h-6 text-emerald-700" />
                </div>

                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Capture or upload daily register
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Camera captures scan automatically; gallery uploads open for cropping first.
                  </p>
                </div>

                {/* Two clear choices: 1 Camera option + 1 Gallery upload */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleTakePhotoAction}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm shadow-xs cursor-pointer active:scale-98"
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    <span>Take Photo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs sm:text-sm shadow-2xs cursor-pointer active:scale-98"
                  >
                    <UploadCloud className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Upload from Gallery</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* 9:16 Portrait Preview & Action Controls */
            <div className="space-y-3 min-w-0">
              {/* 9:16 Vertical Register Frame */}
              <div className="relative w-full max-w-[290px] sm:max-w-[330px] mx-auto aspect-9/16 max-h-[66vh] rounded-xl overflow-hidden border border-slate-300 bg-slate-950 flex items-center justify-center">
                <img
                  src={uploadedImage}
                  alt="Physical Register Preview"
                  className="w-full h-full object-contain"
                />

                {/* Top-right quick overlay actions */}
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-slate-900/85 p-1 rounded-lg backdrop-blur-xs border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setIsCropModalOpen(true)}
                    className="p-2 rounded-md hover:bg-slate-800 text-emerald-300 cursor-pointer"
                    title="Crop photo"
                    aria-label="Crop photo"
                  >
                    <Crop className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFullscreenPreview(true)}
                    className="p-2 rounded-md hover:bg-slate-800 text-white cursor-pointer"
                    title="Fullscreen preview"
                    aria-label="Fullscreen preview"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="p-2 rounded-md hover:bg-rose-900/90 text-rose-300 hover:text-white cursor-pointer"
                    title="Delete photo"
                    aria-label="Delete photo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {cropBox && (
                  <div className="absolute bottom-2.5 left-2.5 bg-slate-900/85 text-white text-[11px] font-medium px-2 py-0.5 rounded border border-slate-700">
                    Cropped
                  </div>
                )}
              </div>

              {/* Clean Mobile Action Row: Crop, Retake, Delete, Gallery */}
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap col-span-2 sm:col-span-1">
                  <button
                    type="button"
                    onClick={() => setIsCropModalOpen(true)}
                    className={`min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg font-semibold shadow-2xs cursor-pointer ${
                      cropBox
                        ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                    }`}
                  >
                    <Crop className="w-3.5 h-3.5 text-emerald-700" />
                    <span>{cropBox ? 'Edit Crop' : 'Crop'}</span>
                  </button>

                  {cropBox && (
                    <button
                      type="button"
                      onClick={handleResetCrop}
                      className="text-[11px] text-slate-600 hover:text-slate-900 underline px-1.5 cursor-pointer"
                    >
                      Reset Crop
                    </button>
                  )}
                </div>

                <div className="col-span-2 sm:col-span-1 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleRetakePhoto}
                    className="flex-1 sm:flex-initial min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-300 text-emerald-800 font-semibold text-xs cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Retake</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="flex-1 sm:flex-initial min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 font-semibold text-xs cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-semibold text-xs cursor-pointer"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-slate-500" />
                    <span>Gallery</span>
                  </button>
                </div>
              </div>

              {/* Low-resolution warning */}
              {preprocessMeta?.isLowResolution && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-950 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    Image resolution ({preprocessMeta.outputWidth}×{preprocessMeta.outputHeight}px) is below {MIN_RECOMMENDED_SHORT_SIDE_PX}px on its short edge. Handwriting may be blurry — consider retaking closer or widening the crop.
                  </span>
                </div>
              )}

              {/* File Metadata */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 px-0.5 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-medium text-slate-800 truncate">{imageFileName}</span>
                  <span className="text-slate-400 shrink-0">({imageFileSize})</span>
                </div>

                {isResized && (
                  <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 shrink-0">
                    Optimized (&le;{MAX_DIMENSION}px)
                  </span>
                )}
              </div>

              {/* Active Extraction Progress Bar with Cancel */}
              {workflowState === 'processing' && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Loader2 className="w-5 h-5 text-emerald-700 animate-spin shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-emerald-950">
                        Extracting Attendance...
                      </div>
                      <div className="text-[11px] text-emerald-800 font-medium mt-0.5 truncate">
                        {processingPhase || 'Preparing photograph...'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelAnalysis}
                    className="px-3 py-1.5 rounded-lg bg-white hover:bg-rose-50 border border-rose-300 text-rose-800 text-xs font-semibold cursor-pointer shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Action prompt when gallery preview is ready or error retry is needed (no Sparkles, no Upload & Analyze Register) */}
              {workflowState !== 'processing' && (!selectedClass ? (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  Select a class in Step 1 above to extract this register photograph.
                </div>
              ) : (imageCaptureSource === 'gallery' && !geminiResult) || workflowState === 'error' ? (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => void handleAnalyzeRegister()}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer active:scale-99"
                  >
                    <ScanLine className="w-4 h-4 shrink-0" />
                    <span>{workflowState === 'error' ? 'Retry Scan' : 'Scan Register'}</span>
                  </button>
                </div>
              ) : null)}
            </div>
          )}
        </div>

          {/* Developer Tools (hidden unless explicitly enabled in Settings) */}
          {isDeveloperDiagnosticsEnabled() && (
            <div className="space-y-4">
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden text-xs shadow-2xs">
                <button
                  type="button"
                  onClick={() => setShowBenchmarkPanel((prev) => !prev)}
                  className="w-full px-4 py-3 flex items-center justify-between font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <FlaskConical className="w-4 h-4 text-emerald-700" />
                    <span>Extraction Test &amp; Benchmark Workflow</span>
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {testOutcomes.length > 0 ? `${testOutcomes.length} logged` : showBenchmarkPanel ? 'Hide' : 'Open'}
                  </span>
                </button>

                {showBenchmarkPanel && (
                  <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/50">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleRunAllBenchmarks}
                        className="px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] cursor-pointer"
                      >
                        Run All 3 Labeled Fixtures
                      </button>
                      {testOutcomes.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            clearStoredRegisterTestOutcomes();
                            setTestOutcomes([]);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-600 font-semibold text-[11px] cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Clear Outcomes</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {getLabeledRegisterTestFixtures().map((fix) => (
                        <div
                          key={fix.id}
                          className="p-2.5 rounded-md bg-white border border-slate-200 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 text-[11px] truncate">
                              {fix.label}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {fix.description}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleInspectBenchmarkFixture(fix.id)}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-[10px] shrink-0 cursor-pointer"
                          >
                            Inspect
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-slate-900 text-slate-200 rounded-lg border border-slate-800 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setShowDevTestPanel((prev) => !prev)}
                  className="w-full px-4 py-2.5 flex items-center justify-between font-mono text-[11px] hover:bg-slate-800/80 cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
                    <Code2 className="w-3.5 h-3.5" />
                    <span>Developer Validation Test Samples</span>
                  </span>
                  <span className="text-slate-400">{showDevTestPanel ? 'Hide' : 'Show'}</span>
                </button>

                {showDevTestPanel && (
                  <div className="p-3.5 border-t border-slate-800 space-y-2.5">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRunValidationSampleTest('valid')}
                        className="w-full py-2 px-3 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-[11px] text-left cursor-pointer"
                      >
                        1. Load Valid Multi-Week Sample (Weeks 1 &amp; 2)
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRunValidationSampleTest('malformed')}
                        className="w-full py-2 px-3 rounded bg-rose-800 hover:bg-rose-700 text-white font-semibold text-[11px] text-left cursor-pointer"
                      >
                        2. Load Deliberately Malformed Sample
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
        )}
        </div>
      )}

      {/* REGISTER -> SUMMARY SWITCH WARNING MODAL */}
      {showSummarySwitchWarning && (
        <div
          className="fixed inset-0 z-[75] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Switch to Written Summary Mode?
                </h3>
                <p className="text-xs text-slate-500">Pupil-level tracking notice</p>
              </div>
            </div>
            <div className="p-5 space-y-4 text-xs sm:text-sm text-slate-700 leading-relaxed">
              <p>
                Written Summary mode records class-level <strong>Present</strong>, <strong>Absent</strong>, and <strong>Total</strong> counts only.
              </p>
              <p>
                You will not capture individual pupil-level metrics (<strong>starred pupil alerts</strong> or <strong>punctuality ratings</strong>) for dates scanned in summary mode. Pupil-level metrics will continue to show for dates scanned directly from the register.
              </p>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSummarySwitchWarning(false);
                    setPendingSummaryDefaultFlag(false);
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Stay on Register Scan
                </button>
                <button
                  type="button"
                  onClick={confirmSwitchToSummaryMode}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
                >
                  Continue to Summary Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SEQUENTIAL WEEKDAY GAP LABEL MODAL (Free-text typed input, no presets) */}
      <GapLabelPromptModal
        gap={detectedWeekdayGap}
        onSaveLabel={(typedLabel) => {
          if (detectedWeekdayGap && onAddNonSchoolGap) {
            onAddNonSchoolGap({
              startDate: detectedWeekdayGap.startDate,
              endDate: detectedWeekdayGap.endDate,
              label: typedLabel,
              source: 'gap-prompt'
            });
            setAutoAdvanceToast(
              `Recorded "${typedLabel}" for ${detectedWeekdayGap.missingWeekdays.length} skipped school ${
                detectedWeekdayGap.missingWeekdays.length === 1 ? 'day' : 'days'
              }.`
            );
          }
        }}
        onSkip={() => {
          if (detectedWeekdayGap) {
            const key = `${detectedWeekdayGap.startDate}__${detectedWeekdayGap.endDate}`;
            setDismissedGapKeys((prev) => {
              const next = prev.includes(key) ? prev : [...prev, key];
              saveStoredDismissedGapKeys(next);
              return next;
            });
          }
        }}
      />

      {/* VERTICAL / UPSIDE-DOWN SHEET HOLIDAY ANNOTATION CONFIRMATION MODAL */}
      {pendingHolidayPrompt && (
        <div
          className="fixed inset-0 z-[75] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <CalendarOff className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Possible Non-School Day Detected on Sheet
                </h3>
                <p className="text-xs text-slate-500">
                  Detected {pendingHolidayPrompt.annotation.orientation} text: &ldquo;{pendingHolidayPrompt.annotation.text}&rdquo;
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                This register sheet appears to contain a holiday, strike, or school closure note for{' '}
                <strong>{formatReadableDate(selectedDate)}</strong>. Confirm below if you want to record it as a Non-School Day and exclude it from attendance percentages.
              </p>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Non-School Day Label
                </label>
                <input
                  type="text"
                  value={holidayLabelInput}
                  onChange={(e) => setHolidayLabelInput(e.target.value)}
                  placeholder="Type label (e.g. Strike, Public Holiday, Mid-Term Break)"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSavingHolidayDay}
                  onClick={() => {
                    setPendingHolidayPrompt(null);
                    setWorkflowState('review');
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Normal School Day — Review Sheet
                </button>
                <button
                  type="button"
                  disabled={isSavingHolidayDay}
                  onClick={() => void handleConfirmDetectedHolidayDay()}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-bold cursor-pointer inline-flex items-center justify-center gap-1.5"
                >
                  {isSavingHolidayDay ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Confirm Non-School Day</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LIVE IN-APP CAMERA VIEWFINDER MODAL */}
      {isLiveCameraOpen && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between">
          {/* Top Bar */}
          <div className="bg-slate-950/85 backdrop-blur-md px-4 py-3 flex items-center justify-between text-white border-b border-slate-800/80 z-20">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-bold tracking-wide text-white">
                Register Camera {facingMode === 'environment' ? '· Rear' : '· Front'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {hasMultipleCameras && (
                <button
                  type="button"
                  onClick={handleToggleFacingMode}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer active:scale-95"
                  title="Switch camera"
                >
                  <SwitchCamera className="w-4 h-4 text-emerald-400" />
                  <span className="hidden sm:inline">Flip Camera</span>
                </button>
              )}
              <button
                type="button"
                onClick={stopLiveCamera}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                title="Close camera"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Video Viewport with 9:16 Register Framing Guide */}
          <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden p-4">
            {isCameraStarting && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/90 text-white gap-3 p-4 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                <p className="text-sm font-semibold">Starting camera...</p>
                <p className="text-xs text-slate-400 max-w-xs">Please allow camera permissions if prompted by your phone or browser.</p>
              </div>
            )}

            {cameraError ? (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950 p-6 text-center max-w-md mx-auto">
                <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
                  <CameraOff className="w-6 h-6" />
                </div>
                <h4 className="text-base font-bold text-white mb-1.5">Camera Access Needed</h4>
                <p className="text-xs text-slate-300 mb-5 leading-relaxed">{cameraError}</p>

                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      stopLiveCamera();
                      cameraInputRef.current?.click();
                    }}
                    className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-md flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Open Phone Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startLiveCamera(facingMode)}
                    className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Try Again</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => setIsVideoReady(true)}
                  onPlaying={() => setIsVideoReady(true)}
                  className="w-full h-full object-cover sm:object-contain"
                />

                {/* 9:16 Portrait Register Frame Overlay Guide */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
                  <div className="w-[82vw] max-w-[350px] aspect-9/16 max-h-[75vh] border-2 border-dashed border-emerald-400/80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.52)] flex flex-col items-center justify-between p-2.5">
                    <div className="bg-slate-950/85 backdrop-blur-xs text-emerald-300 text-[11px] font-semibold px-3 py-1 rounded-full border border-emerald-500/40 shadow-sm text-center">
                      Align vertical register page inside frame
                    </div>

                    <div className="bg-slate-950/85 backdrop-blur-xs text-slate-200 text-[11px] px-3 py-1 rounded-full border border-slate-700 shadow-sm text-center">
                      Hold upright in clear lighting
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Bottom Shutter Controls Bar */}
          <div className="bg-slate-950/95 backdrop-blur-md px-6 py-4 flex items-center justify-between z-20 border-t border-slate-800 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => {
                stopLiveCamera();
                cameraInputRef.current?.click();
              }}
              className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5 font-medium cursor-pointer"
            >
              <Camera className="w-4 h-4 text-emerald-400" />
              <span>Phone App</span>
            </button>

            <button
              type="button"
              disabled={isCameraStarting || !isVideoReady || Boolean(cameraError)}
              onClick={handleCaptureFromLiveStream}
              className="w-16 h-16 rounded-full border-4 border-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all flex items-center justify-center shadow-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="Snap Register Photo"
            >
              <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center">
                <CircleDot className="w-7 h-7 text-emerald-700" />
              </div>
            </button>

            <button
              type="button"
              onClick={stopLiveCamera}
              className="text-xs text-slate-400 hover:text-white font-medium cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* FULLSCREEN PREVIEW MODAL */}
      {isFullscreenPreview && uploadedImage && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xs flex flex-col p-4">
          <div className="flex items-center justify-between pb-3 text-white border-b border-slate-800">
            <div className="text-sm font-semibold truncate">
              {imageFileName} · {selectedClass || 'Unassigned'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsFullscreenPreview(false);
                  handleRemoveImage();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-900/70 hover:bg-rose-800 text-xs text-white cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              <button
                type="button"
                onClick={() => setIsFullscreenPreview(false)}
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img
              src={uploadedImage}
              alt="Fullscreen Register Preview"
              className="max-h-[85vh] max-w-[90vw] object-contain"
            />
          </div>
        </div>
      )}

      {/* FULLSCREEN ANDROID-STYLE DRAG-EDGE CROPPER */}
      {rawSourceImage && (
        <RegisterImageCropperModal
          isOpen={isCropModalOpen}
          imageUrl={rawSourceImage}
          initialCropBox={cropBox}
          imageDimensions={rawDimensions || imageDimensions}
          onApplyCrop={handleApplyCrop}
          onClose={() => setIsCropModalOpen(false)}
        />
      )}
    </div>
  );
};
