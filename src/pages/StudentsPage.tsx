import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  Users,
  Edit2,
  Trash2,
  UserCheck,
  X,
  AlertCircle,
  FolderPlus,
  Layers,
  CheckCircle2,
  ScanLine,
  UploadCloud,
  Camera,
  Loader2,
  AlertTriangle,
  Maximize2,
  Crop,
  ChevronLeft,
  ChevronRight,
  Wand2,
  RotateCcw,
  Eye
} from 'lucide-react';
import { ClassItem, NormalizedCropBox, Student } from '../types/attendance';
import {
  MIN_RECOMMENDED_SHORT_SIDE_PX,
  preprocessRegisterImage,
  PreprocessedImageResult
} from '../services/imagePreprocessing';
import { RegisterImageCropperModal } from '../components/RegisterImageCropperModal';
import { LiveCameraViewfinderModal } from '../components/LiveCameraViewfinderModal';

interface ExtractedRosterDraftRow {
  localId: string;
  include: boolean;
  studentNumber: string;
  fullName: string;
  admissionNumber: string;
  originalOcrName?: string;
  aiCorrected?: boolean;
  aiCorrectionNote?: string;
}

type EditableExtractedField = 'studentNumber' | 'fullName' | 'admissionNumber';

interface StudentsPageProps {
  students: Student[];
  classes: ClassItem[];
  onAddStudent: (student: Omit<Student, 'id' | 'createdAt' | 'updatedAt'>) => void | Promise<void>;
  onBulkAddStudents?: (
    students: Array<Omit<Student, 'id' | 'createdAt' | 'updatedAt'>>
  ) => Promise<Student[] | void> | void;
  onEditStudent: (student: Student) => void | Promise<void>;
  onToggleStudentActive: (studentId: string) => void | Promise<void>;
  onAddClass: (classData: { name: string; classTeacher?: string; notes?: string }) => Promise<ClassItem | void> | void;
  onEditClass: (updatedClass: ClassItem) => void | Promise<void>;
  onDeleteClass: (classId: string) => void | Promise<void>;
  canWrite?: boolean;
  autoOpenBulkScanSignal?: number;
  highlightedTarget?: string | null;
}

export const StudentsPage: React.FC<StudentsPageProps> = ({
  students,
  classes,
  onAddStudent,
  onBulkAddStudents,
  onEditStudent,
  onToggleStudentActive,
  onAddClass,
  onEditClass,
  onDeleteClass,
  canWrite = true,
  autoOpenBulkScanSignal = 0,
  highlightedTarget
}) => {
  // Navigation tabs between Students directory and Classes
  const [activeSubTab, setActiveSubTab] = useState<'students' | 'classes'>('students');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('All');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'All' | 'active' | 'inactive'>('All');

  // Student Modals
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);

  // Class Modals
  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassItem | null>(null);
  const [deletingClass, setDeletingClass] = useState<ClassItem | null>(null);

  // Bulk Scan Roster Modal
  const [showBulkScanModal, setShowBulkScanModal] = useState(false);
  const [bulkClassMode, setBulkClassMode] = useState<'existing' | 'new'>('new');
  const [bulkClassId, setBulkClassId] = useState('');
  const [bulkNewClassName, setBulkNewClassName] = useState('');
  const [bulkNewClassTeacher, setBulkNewClassTeacher] = useState('');
  const [bulkRawSourceUrl, setBulkRawSourceUrl] = useState<string | null>(null);
  const [bulkRawDimensions, setBulkRawDimensions] = useState<{ width: number; height: number } | null>(null);
  const [bulkPreviewUrl, setBulkPreviewUrl] = useState<string | null>(null);
  const [bulkCropBox, setBulkCropBox] = useState<NormalizedCropBox | null>(null);
  const [bulkPreprocessMeta, setBulkPreprocessMeta] = useState<PreprocessedImageResult | null>(null);
  const [bulkImageMeta, setBulkImageMeta] = useState<{
    fileName: string;
    width: number;
    height: number;
    sizeLabel: string;
  } | null>(null);
  const [bulkImageSource, setBulkImageSource] = useState<'camera' | 'gallery' | null>(null);
  const [bulkHasExtracted, setBulkHasExtracted] = useState(false);
  const [bulkIsFullscreenPreview, setBulkIsFullscreenPreview] = useState(false);
  const [bulkIsCropModalOpen, setBulkIsCropModalOpen] = useState(false);
  const [bulkIsLiveCameraOpen, setBulkIsLiveCameraOpen] = useState(false);
  const [isDraggingBulk, setIsDraggingBulk] = useState(false);
  const [isExtractingRoster, setIsExtractingRoster] = useState(false);
  const [isCorrectingNames, setIsCorrectingNames] = useState(false);
  const [bulkExtractError, setBulkExtractError] = useState<string | null>(null);
  const [bulkAiNotice, setBulkAiNotice] = useState<string | null>(null);
  const [bulkRawOcrText, setBulkRawOcrText] = useState<string>('');
  const [bulkRows, setBulkRows] = useState<ExtractedRosterDraftRow[]>([]);
  const [bulkDetectedClass, setBulkDetectedClass] = useState<string | null>(null);
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  const [fullscreenEditTarget, setFullscreenEditTarget] = useState<{
    localId: string;
    field: EditableExtractedField;
  } | null>(null);
  const [fullscreenShowPhotoRef, setFullscreenShowPhotoRef] = useState(false);

  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const bulkCameraInputRef = useRef<HTMLInputElement>(null);
  const bulkAbortRef = useRef<AbortController | null>(null);
  const fullscreenRowNumInputRef = useRef<HTMLInputElement>(null);
  const fullscreenNameInputRef = useRef<HTMLInputElement>(null);
  const fullscreenAdmInputRef = useRef<HTMLInputElement>(null);

  // Add/Edit Student Form States
  const [formFullName, setFormFullName] = useState('');
  const [formClassId, setFormClassId] = useState('');
  const [formStudentNumber, setFormStudentNumber] = useState<string>('');
  const [formAdmissionNumber, setFormAdmissionNumber] = useState('');
  const [formActive, setFormActive] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Add Class Form State
  const [newClassName, setNewClassName] = useState('');
  const [newClassTeacher, setNewClassTeacher] = useState('');
  const [newClassNotes, setNewClassNotes] = useState('');
  const [classFormError, setClassFormError] = useState<string | null>(null);

  // Edit Class Form State
  const [editClassName, setEditClassName] = useState('');
  const [editClassTeacher, setEditClassTeacher] = useState('');
  const [editClassNotes, setEditClassNotes] = useState('');
  const [editClassFormError, setEditClassFormError] = useState<string | null>(null);

  // Success Feedback Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    if (autoOpenBulkScanSignal > 0 && canWrite) {
      handleOpenBulkScanModal();
    }
  }, [autoOpenBulkScanSignal, canWrite]);

  // Helper map for class names
  const classMap = useMemo(() => {
    const map = new Map<string, string>();
    classes.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [classes]);

  // Filtered Students
  const filteredStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return students.filter((student) => {
      const matchesSearch =
        !query ||
        student.fullName.toLowerCase().includes(query) ||
        String(student.studentNumber).includes(query) ||
        (student.admissionNumber && student.admissionNumber.toLowerCase().includes(query));

      const matchesClass =
        selectedClassFilter === 'All' || student.classId === selectedClassFilter;

      const matchesStatus =
        selectedStatusFilter === 'All' ||
        (selectedStatusFilter === 'active' && student.active) ||
        (selectedStatusFilter === 'inactive' && !student.active);

      return matchesSearch && matchesClass && matchesStatus;
    });
  }, [students, searchQuery, selectedClassFilter, selectedStatusFilter]);

  // Open Add Student Modal
  const handleOpenAddStudent = () => {
    setFormFullName('');
    const defaultClass =
      selectedClassFilter !== 'All' && classes.some((c) => c.id === selectedClassFilter)
        ? selectedClassFilter
        : classes[0]?.id || '';
    setFormClassId(defaultClass);

    const inClassCount = students.filter((s) => s.classId === defaultClass).length;
    setFormStudentNumber(String(inClassCount + 1));
    setFormAdmissionNumber('');
    setFormActive(true);
    setFormError(null);
    setShowAddStudentModal(true);
  };

  // Open Edit Student Modal
  const handleOpenEditStudent = (student: Student) => {
    setEditingStudent(student);
    setFormFullName(student.fullName);
    setFormClassId(student.classId);
    setFormStudentNumber(String(student.studentNumber));
    setFormAdmissionNumber(student.admissionNumber || '');
    setFormActive(student.active);
    setFormError(null);
  };

  // Submit Add Student
  const handleAddStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formFullName.trim()) {
      setFormError('Student full name is required.');
      return;
    }
    if (!formClassId || !classes.some((c) => c.id === formClassId)) {
      setFormError('Please select a valid existing class.');
      return;
    }
    const num = parseInt(formStudentNumber, 10);
    if (isNaN(num) || num <= 0) {
      setFormError('Student number must be a valid positive number.');
      return;
    }

    try {
      await onAddStudent({
        fullName: formFullName.trim(),
        classId: formClassId,
        studentNumber: num,
        admissionNumber: formAdmissionNumber.trim() || undefined,
        active: formActive
      });

      setShowAddStudentModal(false);
      showToast(`Student "${formFullName.trim()}" added to ${classMap.get(formClassId) || 'class'}.`);
    } catch (err: any) {
      setFormError(err?.message || 'Unable to save student record.');
    }
  };

  // Submit Edit Student
  const handleEditStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setFormError(null);

    if (!formFullName.trim()) {
      setFormError('Student full name is required.');
      return;
    }
    if (!formClassId || !classes.some((c) => c.id === formClassId)) {
      setFormError('Please select a valid existing class.');
      return;
    }
    const num = parseInt(formStudentNumber, 10);
    if (isNaN(num) || num <= 0) {
      setFormError('Student number must be a valid positive number.');
      return;
    }

    const updated: Student = {
      ...editingStudent,
      fullName: formFullName.trim(),
      classId: formClassId,
      studentNumber: num,
      admissionNumber: formAdmissionNumber.trim() || undefined,
      active: formActive,
      updatedAt: new Date().toISOString()
    };

    try {
      await onEditStudent(updated);
      setEditingStudent(null);
      showToast(`Updated details for "${formFullName.trim()}".`);
    } catch (err: any) {
      setFormError(err?.message || 'Unable to update student record.');
    }
  };

  // Open Edit Class Modal
  const handleOpenEditClass = (cls: ClassItem) => {
    setEditingClass(cls);
    setEditClassName(cls.name);
    setEditClassTeacher(cls.classTeacher || '');
    setEditClassNotes(cls.notes || '');
    setEditClassFormError(null);
  };

  // Submit Add Class
  const handleAddClassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClassFormError(null);

    const trimmedName = newClassName.trim();
    if (!trimmedName) {
      setClassFormError('Class name is required (e.g. "Primary 1C").');
      return;
    }

    if (classes.some((c) => c.name.toLowerCase() === trimmedName.toLowerCase())) {
      setClassFormError(`A class named "${trimmedName}" already exists.`);
      return;
    }

    try {
      await onAddClass({
        name: trimmedName,
        classTeacher: newClassTeacher.trim() || undefined,
        notes: newClassNotes.trim() || undefined
      });

      setNewClassName('');
      setNewClassTeacher('');
      setNewClassNotes('');
      setShowAddClassModal(false);
      showToast(`Class "${trimmedName}" created and available for student enrollment.`);
    } catch (err: any) {
      setClassFormError(err?.message || 'Unable to create class.');
    }
  };

  // Submit Edit Class
  const handleEditClassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass) return;
    setEditClassFormError(null);

    const trimmedName = editClassName.trim();
    if (!trimmedName) {
      setEditClassFormError('Class name cannot be empty.');
      return;
    }

    // Check duplicate name on other classes
    if (
      classes.some(
        (c) => c.id !== editingClass.id && c.name.toLowerCase() === trimmedName.toLowerCase()
      )
    ) {
      setEditClassFormError(`Another class named "${trimmedName}" already exists.`);
      return;
    }

    try {
      await onEditClass({
        ...editingClass,
        name: trimmedName,
        classTeacher: editClassTeacher.trim() || undefined,
        notes: editClassNotes.trim() || undefined,
        updatedAt: new Date().toISOString()
      });

      setEditingClass(null);
      showToast(`Class "${trimmedName}" details updated successfully.`);
    } catch (err: any) {
      setEditClassFormError(err?.message || 'Unable to update class details.');
    }
  };

  // Submit Delete Class
  const handleConfirmDeleteClass = async () => {
    if (!deletingClass) return;
    const name = deletingClass.name;
    try {
      await onDeleteClass(deletingClass.id);
      setDeletingClass(null);
      showToast(`Class "${name}" removed from school classes directory.`);
    } catch (err: any) {
      setDeletingClass(null);
      showToast(err?.message || `Cannot delete "${name}". Ensure no students or sessions reference it.`);
    }
  };

  // Focus the tapped extracted field inside the Fullscreen Field Editor
  useEffect(() => {
    if (!fullscreenEditTarget) return;
    const timer = window.setTimeout(() => {
      if (fullscreenEditTarget.field === 'studentNumber') {
        fullscreenRowNumInputRef.current?.focus();
        fullscreenRowNumInputRef.current?.select();
      } else if (fullscreenEditTarget.field === 'admissionNumber') {
        fullscreenAdmInputRef.current?.focus();
      } else {
        fullscreenNameInputRef.current?.focus();
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [fullscreenEditTarget]);

  // Bulk Scan Roster Enrollment handlers
  const handleOpenBulkScanModal = () => {
    if (bulkAbortRef.current) {
      bulkAbortRef.current.abort();
      bulkAbortRef.current = null;
    }
    const defaultExisting =
      selectedClassFilter !== 'All' && classes.some((c) => c.id === selectedClassFilter)
        ? selectedClassFilter
        : classes[0]?.id || '';
    setBulkClassMode(classes.length > 0 ? 'existing' : 'new');
    setBulkClassId(defaultExisting);
    setBulkNewClassName('');
    setBulkNewClassTeacher('');
    setBulkRawSourceUrl(null);
    setBulkRawDimensions(null);
    setBulkPreviewUrl(null);
    setBulkCropBox(null);
    setBulkPreprocessMeta(null);
    setBulkImageMeta(null);
    setBulkImageSource(null);
    setBulkHasExtracted(false);
    setBulkIsFullscreenPreview(false);
    setBulkIsCropModalOpen(false);
    setBulkIsLiveCameraOpen(false);
    setIsDraggingBulk(false);
    setIsExtractingRoster(false);
    setIsCorrectingNames(false);
    setBulkExtractError(null);
    setBulkAiNotice(null);
    setBulkRawOcrText('');
    setBulkRows([]);
    setBulkDetectedClass(null);
    setIsSavingBulk(false);
    setFullscreenEditTarget(null);
    setFullscreenShowPhotoRef(false);
    setShowBulkScanModal(true);
  };

  const handleCloseBulkScanModal = () => {
    if (bulkAbortRef.current) {
      bulkAbortRef.current.abort();
      bulkAbortRef.current = null;
    }
    setIsExtractingRoster(false);
    setIsCorrectingNames(false);
    setBulkIsFullscreenPreview(false);
    setBulkIsCropModalOpen(false);
    setBulkIsLiveCameraOpen(false);
    setFullscreenEditTarget(null);
    setShowBulkScanModal(false);
  };

  const runRosterExtraction = async (imageDataUrl: string) => {
    if (bulkAbortRef.current) {
      bulkAbortRef.current.abort();
    }
    const controller = new AbortController();
    bulkAbortRef.current = controller;

    setIsExtractingRoster(true);
    setBulkHasExtracted(true);
    setBulkExtractError(null);
    setBulkAiNotice(null);
    setBulkRows([]);
    setFullscreenEditTarget(null);

    try {
      const response = await fetch('/api/extract-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageDataUrl,
          model: 'google-cloud-vision',
          applyAiCorrection: true
        }),
        signal: controller.signal
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Could not extract student roster via Google Cloud Vision.');
      }

      const detectedName =
        typeof json.classDetected === 'string' && json.classDetected.trim()
          ? json.classDetected.trim()
          : null;
      setBulkDetectedClass(detectedName);
      if (detectedName) {
        setBulkNewClassName((prev) => (prev.trim() ? prev : detectedName));
      }
      setBulkRawOcrText(typeof json.rawText === 'string' ? json.rawText : '');

      const rawList = Array.isArray(json.students) ? json.students : [];
      const mappedRows: ExtractedRosterDraftRow[] = rawList.map((item: any, idx: number) => ({
        localId: `ext-${Date.now()}-${idx}`,
        include: true,
        studentNumber: String(
          Number.isFinite(Number(item.studentNumber)) && Number(item.studentNumber) > 0
            ? Number(item.studentNumber)
            : idx + 1
        ),
        fullName: String(item.fullName || '').trim(),
        admissionNumber: String(item.admissionNumber || '').trim(),
        originalOcrName: item.originalOcrName ? String(item.originalOcrName).trim() : String(item.fullName || '').trim(),
        aiCorrected: Boolean(item.aiCorrected),
        aiCorrectionNote: typeof item.aiCorrectionNote === 'string' ? item.aiCorrectionNote : undefined
      }));

      setBulkRows(mappedRows);
      if (json.aiCorrectionStatus === 'applied') {
        const count = Number(json.aiCorrectedCount || 0);
        setBulkAiNotice(
          count > 0
            ? `AI Nigerian-context check refined ${count} pupil ${count === 1 ? 'name' : 'names'} to closest spelling.`
            : 'AI Nigerian-context check verified all extracted names.'
        );
      } else if (json.aiCorrectionStatus === 'error' && json.aiCorrectionMessage) {
        setBulkAiNotice(`OCR completed, but AI name check could not run: ${json.aiCorrectionMessage}`);
      }

      if (mappedRows.length === 0) {
        setBulkExtractError(
          'No student names were detected. Crop closer to the names column or upload a clearer photograph.'
        );
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return;
      }
      setBulkExtractError(err?.message || 'Error extracting student details via Google Cloud Vision.');
    } finally {
      if (bulkAbortRef.current === controller) {
        bulkAbortRef.current = null;
      }
      setIsExtractingRoster(false);
    }
  };

  const handleRunAiNameCorrection = async () => {
    if (bulkRows.length === 0 || isCorrectingNames) return;
    setIsCorrectingNames(true);
    setBulkExtractError(null);
    setBulkAiNotice(null);

    try {
      const payloadRows = bulkRows
        .map((r, idx) => ({
          studentNumber:
            Number.isFinite(Number(r.studentNumber)) && Number(r.studentNumber) > 0
              ? Number(r.studentNumber)
              : idx + 1,
          fullName: r.fullName.trim(),
          admissionNumber: r.admissionNumber.trim() || undefined,
          originalOcrName: r.originalOcrName || r.fullName.trim()
        }))
        .filter((r) => r.fullName.length > 0);

      const response = await fetch('/api/correct-roster-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: payloadRows,
          rawText: bulkRawOcrText,
          image: bulkPreviewUrl
        })
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'AI Nigerian-context name correction failed.');
      }

      const returned = Array.isArray(json.students) ? json.students : [];
      const byRowNum = new Map<number, any>();
      returned.forEach((item: any) => {
        if (Number.isFinite(Number(item?.studentNumber))) {
          byRowNum.set(Number(item.studentNumber), item);
        }
      });

      setBulkRows((prev) =>
        prev.map((row, idx) => {
          const sn =
            Number.isFinite(Number(row.studentNumber)) && Number(row.studentNumber) > 0
              ? Number(row.studentNumber)
              : idx + 1;
          const match = byRowNum.get(sn);
          if (!match) return row;
          return {
            ...row,
            fullName: String(match.fullName || row.fullName).trim(),
            originalOcrName: match.originalOcrName || row.originalOcrName || row.fullName,
            aiCorrected: Boolean(match.aiCorrected),
            aiCorrectionNote:
              typeof match.aiCorrectionNote === 'string'
                ? match.aiCorrectionNote
                : row.aiCorrectionNote
          };
        })
      );

      const count = Number(json.correctedCount || 0);
      setBulkAiNotice(
        count > 0
          ? `AI Nigerian-context check updated ${count} pupil ${count === 1 ? 'name' : 'names'}.`
          : 'AI Nigerian-context check reviewed all names and found no spelling issues.'
      );
    } catch (err: any) {
      setBulkExtractError(err?.message || 'Unable to run AI Nigerian-context name check.');
    } finally {
      setIsCorrectingNames(false);
    }
  };

  const applyBulkSourceCapture = async (
    source: File | string,
    meta: { fileName: string; sourceType: 'camera' | 'gallery'; autoExtract: boolean; preferredMimeType?: string }
  ) => {
    setBulkExtractError(null);
    setBulkAiNotice(null);

    try {
      const pre = await preprocessRegisterImage({
        source,
        rotation: 0,
        cropBox: null,
        maxDimension: 1800,
        preferredMimeType: meta.preferredMimeType
      });
      setBulkRawSourceUrl(pre.dataUrl);
      setBulkRawDimensions({ width: pre.outputWidth, height: pre.outputHeight });
      setBulkPreviewUrl(pre.dataUrl);
      setBulkCropBox(null);
      setBulkPreprocessMeta(pre);
      setBulkImageSource(meta.sourceType);
      setBulkHasExtracted(false);
      setBulkRows([]);
      setBulkDetectedClass(null);
      setBulkRawOcrText('');
      setFullscreenEditTarget(null);
      setBulkImageMeta({
        fileName: meta.fileName,
        width: pre.outputWidth,
        height: pre.outputHeight,
        sizeLabel: `${(pre.estimatedBytes / (1024 * 1024)).toFixed(2)} MB`
      });

      if (meta.autoExtract) {
        void runRosterExtraction(pre.dataUrl);
      }
    } catch (err: any) {
      setBulkExtractError(err?.message || 'Unable to prepare photograph for extraction.');
    }
  };

  const handleBulkRosterFileSelected = async (
    file: File,
    options: { source: 'camera' | 'gallery'; autoExtract: boolean } = { source: 'gallery', autoExtract: false }
  ) => {
    setBulkExtractError(null);
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type.toLowerCase())) {
      setBulkExtractError('Unsupported image format. Choose a JPG, PNG, or WebP photograph.');
      return;
    }
    if (file.size / (1024 * 1024) > 15) {
      setBulkExtractError('File size exceeds the 15 MB limit. Please select a smaller photograph.');
      return;
    }

    await applyBulkSourceCapture(file, {
      fileName: file.name,
      sourceType: options.source,
      autoExtract: options.autoExtract,
      preferredMimeType: file.type
    });
  };

  const handleBulkLiveCameraCapture = (
    dataUrl: string,
    _dims: { width: number; height: number }
  ) => {
    const timestamp = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toTimeString().slice(0, 5).replace(':', '');
    void applyBulkSourceCapture(dataUrl, {
      fileName: `ENROLL_CAMERA_${timestamp}_${timeStr}.jpg`,
      sourceType: 'camera',
      autoExtract: true,
      preferredMimeType: 'image/jpeg'
    });
  };

  const handleBulkTakePhotoAction = () => {
    const isMobileTouch =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)')?.matches ||
        (navigator.maxTouchPoints > 0 && window.innerWidth < 768));

    if (isMobileTouch && bulkCameraInputRef.current) {
      bulkCameraInputRef.current.click();
    } else {
      setBulkIsLiveCameraOpen(true);
    }
  };

  const handleApplyBulkCrop = async (nextCrop: NormalizedCropBox | null) => {
    if (!bulkRawSourceUrl) return;
    setBulkExtractError(null);
    setBulkCropBox(nextCrop);

    try {
      const pre = await preprocessRegisterImage({
        source: bulkRawSourceUrl,
        rotation: 0,
        cropBox: nextCrop,
        maxDimension: 1800
      });
      setBulkPreviewUrl(pre.dataUrl);
      setBulkPreprocessMeta(pre);
      setBulkImageMeta((prev) =>
        prev
          ? {
              ...prev,
              width: pre.outputWidth,
              height: pre.outputHeight,
              sizeLabel: `${(pre.estimatedBytes / (1024 * 1024)).toFixed(2)} MB`
            }
          : null
      );

      if (bulkHasExtracted) {
        void runRosterExtraction(pre.dataUrl);
      }
    } catch (err: any) {
      setBulkExtractError(err?.message || 'Unable to apply crop to register photograph.');
    }
  };

  const handleResetBulkCrop = () => {
    void handleApplyBulkCrop(null);
  };

  const handleClearBulkPreview = () => {
    if (bulkAbortRef.current) {
      bulkAbortRef.current.abort();
      bulkAbortRef.current = null;
    }
    setIsExtractingRoster(false);
    setIsCorrectingNames(false);
    setBulkRawSourceUrl(null);
    setBulkRawDimensions(null);
    setBulkPreviewUrl(null);
    setBulkCropBox(null);
    setBulkPreprocessMeta(null);
    setBulkImageMeta(null);
    setBulkImageSource(null);
    setBulkHasExtracted(false);
    setBulkRows([]);
    setBulkDetectedClass(null);
    setBulkExtractError(null);
    setBulkAiNotice(null);
    setBulkRawOcrText('');
    setBulkIsFullscreenPreview(false);
    setBulkIsCropModalOpen(false);
    setFullscreenEditTarget(null);
    if (bulkFileInputRef.current) bulkFileInputRef.current.value = '';
    if (bulkCameraInputRef.current) bulkCameraInputRef.current.value = '';
  };

  const handleRetakeBulkPhoto = () => {
    handleClearBulkPreview();
    handleBulkTakePhotoAction();
  };

  const handleCancelRosterExtraction = () => {
    if (bulkAbortRef.current) {
      bulkAbortRef.current.abort();
      bulkAbortRef.current = null;
    }
    setIsExtractingRoster(false);
  };

  const existingRollNumbersForBulkClass = useMemo(() => {
    if (bulkClassMode !== 'existing' || !bulkClassId) return new Set<number>();
    return new Set(
      students.filter((s) => s.classId === bulkClassId).map((s) => s.studentNumber)
    );
  }, [bulkClassMode, bulkClassId, students]);

  const includedValidBulkRows = useMemo(() => {
    return bulkRows.filter((row) => {
      if (!row.include) return false;
      const num = parseInt(row.studentNumber, 10);
      return Boolean(row.fullName.trim()) && Number.isFinite(num) && num > 0;
    });
  }, [bulkRows]);

  const handleBulkEnrollSubmit = async () => {
    setBulkExtractError(null);
    if (includedValidBulkRows.length === 0) {
      setBulkExtractError('Ensure at least one checked student row has a valid S/N and Full Name.');
      return;
    }

    setIsSavingBulk(true);
    try {
      let targetClassId = bulkClassId;
      let targetClassName = classMap.get(bulkClassId) || '';

      if (bulkClassMode === 'new') {
        const trimmedName = bulkNewClassName.trim();
        if (!trimmedName) {
          setBulkExtractError('Enter a class name (or switch to an existing class).');
          setIsSavingBulk(false);
          return;
        }
        const existingMatch = classes.find(
          (c) => c.name.toLowerCase() === trimmedName.toLowerCase()
        );
        if (existingMatch) {
          targetClassId = existingMatch.id;
          targetClassName = existingMatch.name;
        } else {
          const created = await onAddClass({
            name: trimmedName,
            classTeacher: bulkNewClassTeacher.trim() || undefined
          });
          if (created && typeof created === 'object' && 'id' in created) {
            targetClassId = created.id;
            targetClassName = created.name;
          } else {
            throw new Error('Could not resolve newly created class ID.');
          }
        }
      } else if (!targetClassId || !classes.some((c) => c.id === targetClassId)) {
        setBulkExtractError('Select a valid existing class or switch to Create New Class.');
        setIsSavingBulk(false);
        return;
      }

      const payload: Array<Omit<Student, 'id' | 'createdAt' | 'updatedAt'>> = includedValidBulkRows.map(
        (row) => ({
          classId: targetClassId,
          studentNumber: parseInt(row.studentNumber, 10),
          fullName: row.fullName.trim(),
          admissionNumber: row.admissionNumber.trim() || undefined,
          active: true
        })
      );

      if (onBulkAddStudents) {
        await onBulkAddStudents(payload);
      } else {
        for (const item of payload) {
          await onAddStudent(item);
        }
      }

      handleCloseBulkScanModal();
      showToast(`Enrolled ${payload.length} student${payload.length === 1 ? '' : 's'} into ${targetClassName || 'class'}.`);
    } catch (err: any) {
      setBulkExtractError(err?.message || 'Unable to enroll extracted students.');
    } finally {
      setIsSavingBulk(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-xs animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-800">
            <Users className="w-4 h-4" />
            <span>School Roster Management</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
            Students & Classes Directory
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Manage student enrollments and school classes. Add, edit, or remove classes and update teacher assignments.
          </p>
        </div>

        {/* Action Buttons */}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
            <button
              type="button"
              data-tutorial-target="students-roster-scan"
              onClick={handleOpenBulkScanModal}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm shadow-xs transition-all cursor-pointer ${
                highlightedTarget === 'students-roster-scan'
                  ? 'ring-4 ring-emerald-400/50'
                  : ''
              }`}
            >
              <ScanLine className="w-4 h-4" />
              <span>Scan Register to Enroll</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setNewClassName('');
                setNewClassTeacher('');
                setNewClassNotes('');
                setClassFormError(null);
                setShowAddClassModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs sm:text-sm shadow-xs transition-colors cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 text-emerald-700" />
              <span>Add Class</span>
            </button>

            <button
              type="button"
              onClick={handleOpenAddStudent}
              disabled={classes.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-medium text-xs shadow-xs transition-colors cursor-pointer"
              title="Add one student manually"
            >
              <Plus className="w-3.5 h-3.5 text-slate-600" />
              <span>+ Single Student</span>
            </button>
          </div>
        )}
      </div>

      {!canWrite && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
          <span>
            <strong>Read-Only View:</strong> You can browse class rosters and student enrollments. Only the School Admin login can add, edit, or deactivate records.
          </span>
        </div>
      )}

      {/* Segmented Sub-Tabs: Students vs Classes */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setActiveSubTab('students')}
          className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all ${
            activeSubTab === 'students'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Students Roster ({students.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('classes')}
          className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all ${
            activeSubTab === 'classes'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Manage Classes ({classes.length})</span>
        </button>
      </div>

      {/* TAB 1: STUDENTS ROSTER */}
      {activeSubTab === 'students' && (
        <div className="space-y-4">
          {/* Search & Filters Card */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
              {/* Search by Name or Student Number */}
              <div className="sm:col-span-6 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by student name or roll number..."
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-md border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Class Filter */}
              <div className="sm:col-span-3">
                <select
                  value={selectedClassFilter}
                  onChange={(e) => setSelectedClassFilter(e.target.value)}
                  className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="All">All Classes ({classes.length})</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div className="sm:col-span-3">
                <select
                  value={selectedStatusFilter}
                  onChange={(e) => setSelectedStatusFilter(e.target.value as 'All' | 'active' | 'inactive')}
                  className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="All">All Statuses</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>
              </div>
            </div>

            {/* Filter Summary */}
            <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
              <div>
                Showing <strong className="text-slate-800 font-semibold">{filteredStudents.length}</strong> of{' '}
                <strong className="text-slate-800">{students.length}</strong> students
                {selectedClassFilter !== 'All' && (
                  <span> in <strong>{classMap.get(selectedClassFilter) || 'selected class'}</strong></span>
                )}
              </div>

              {(searchQuery || selectedClassFilter !== 'All' || selectedStatusFilter !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedClassFilter('All');
                    setSelectedStatusFilter('All');
                  }}
                  className="text-emerald-700 hover:underline font-semibold"
                >
                  Clear search & filters
                </button>
              )}
            </div>
          </div>

          {/* Students Table or Empty Search Feedback */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
            {filteredStudents.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  {students.length === 0 ? <Users className="w-6 h-6" /> : <Search className="w-6 h-6" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {students.length === 0 ? 'No students enrolled yet' : 'No matching students found'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    {students.length === 0
                      ? 'Scan the student details page of a register to enroll the whole class at once, or add a class manually.'
                      : searchQuery
                      ? `No student record matches "${searchQuery}".`
                      : 'No students match the selected class or status filters.'}
                  </p>
                </div>
                <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                  {students.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedClassFilter('All');
                        setSelectedStatusFilter('All');
                      }}
                      className="px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Clear All Filters
                    </button>
                  )}
                  {canWrite && (
                    <button
                      type="button"
                      onClick={handleOpenBulkScanModal}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer"
                    >
                      <ScanLine className="w-3.5 h-3.5" />
                      <span>Scan Register to Enroll</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th scope="col" className="py-3 px-4 text-center w-16">
                        S/N
                      </th>
                      <th scope="col" className="py-3 px-4">
                        Student Name
                      </th>
                      <th scope="col" className="py-3 px-4">
                        Assigned Class
                      </th>
                      <th scope="col" className="py-3 px-4">
                        Admission No.
                      </th>
                      <th scope="col" className="py-3 px-4">
                        Status
                      </th>
                      {canWrite && (
                        <th scope="col" className="py-3 px-4 text-right">
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredStudents.map((student) => {
                      const className = classMap.get(student.classId) || 'Unassigned';

                      return (
                        <tr
                          key={student.id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            !student.active ? 'bg-slate-50/40 text-slate-400' : ''
                          }`}
                        >
                          <td className="py-3 px-4 text-center font-bold text-slate-500 whitespace-nowrap">
                            {student.studentNumber}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                            {student.fullName}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800 whitespace-nowrap">
                            {className}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                            {student.admissionNumber || '—'}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {student.active ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                Inactive
                              </span>
                            )}
                          </td>
                          {canWrite && (
                            <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                              <button
                                type="button"
                                onClick={() => handleOpenEditStudent(student)}
                                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 hover:underline px-2 py-1"
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => onToggleStudentActive(student.id)}
                                className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
                                  student.active
                                    ? 'text-slate-500 hover:text-rose-700 hover:bg-rose-50'
                                    : 'text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50'
                                }`}
                                title={student.active ? 'Mark student as inactive' : 'Reactivate student'}
                              >
                                {student.active ? 'Set Inactive' : 'Reactivate'}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: AVAILABLE CLASSES MANAGEMENT */}
      {activeSubTab === 'classes' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  School Classes Directory
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure class arms (e.g. Class 1A, 1B, 1C), assign class teachers, and add room or administrative notes.
                </p>
              </div>

              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    setNewClassName('');
                    setNewClassTeacher('');
                    setNewClassNotes('');
                    setClassFormError(null);
                    setShowAddClassModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs rounded-lg shadow-xs transition-colors self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Class</span>
                </button>
              )}
            </div>

            {/* Grid of classes */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
              {classes.map((cls) => {
                const enrolledTotal = students.filter((s) => s.classId === cls.id).length;
                const activeTotal = students.filter((s) => s.classId === cls.id && s.active).length;

                return (
                  <div
                    key={cls.id}
                    className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-emerald-300 transition-all shadow-xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-bold text-slate-900 text-base">{cls.name}</h4>
                          {cls.classTeacher ? (
                            <div className="flex items-center gap-1 text-xs text-slate-600 mt-0.5">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                              <span className="font-medium">{cls.classTeacher}</span>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 italic mt-0.5">
                              No teacher assigned
                            </div>
                          )}
                        </div>

                        <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/60 shrink-0">
                          {activeTotal} Active
                        </span>
                      </div>

                      {cls.notes && (
                        <p className="mt-2.5 text-xs text-slate-600 bg-white/70 p-2 rounded border border-slate-100 leading-relaxed">
                          {cls.notes}
                        </p>
                      )}

                      <div className="mt-2 text-xs text-slate-500">
                        Total Enrolled: <strong className="text-slate-800">{enrolledTotal} pupils</strong>
                        {enrolledTotal > activeTotal && (
                          <span className="text-amber-700 ml-1.5 font-medium">
                            ({enrolledTotal - activeTotal} inactive)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClassFilter(cls.id);
                          setActiveSubTab('students');
                        }}
                        className="text-emerald-700 hover:underline font-semibold"
                      >
                        View Students →
                      </button>

                      {canWrite && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditClass(cls)}
                            className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                            title="Edit class name, teacher, or notes"
                            aria-label={`Edit ${cls.name}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeletingClass(cls)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                            title="Remove class"
                            aria-label={`Remove ${cls.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ADD STUDENT MODAL */}
      {showAddStudentModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Enroll New Student
                </h3>
                <p className="text-xs text-slate-500">
                  Add student details to class register roster
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStudentModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddStudentSubmit} className="space-y-3.5 text-xs">
              {formError && (
                <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Full Student Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  placeholder="Student Full Name"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Assigned Class <span className="text-rose-600">*</span>
                </label>
                <select
                  value={formClassId}
                  onChange={(e) => {
                    const newClassId = e.target.value;
                    setFormClassId(newClassId);
                    const countInClass = students.filter((s) => s.classId === newClassId).length;
                    setFormStudentNumber(String(countInClass + 1));
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} {cls.classTeacher ? `(${cls.classTeacher})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Student No. (S/N) <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formStudentNumber}
                    onChange={(e) => setFormStudentNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Admission No. (Optional)
                  </label>
                  <input
                    type="text"
                    value={formAdmissionNumber}
                    onChange={(e) => setFormAdmissionNumber(e.target.value)}
                    placeholder="e.g. ADM/2026/001"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  className="px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors shadow-xs"
                >
                  Enroll Student
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT STUDENT MODAL */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Edit Student Details
                </h3>
                <p className="text-xs text-slate-500">
                  Update student identity or class assignment
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditStudentSubmit} className="space-y-3.5 text-xs">
              {formError && (
                <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Full Student Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Assigned Class <span className="text-rose-600">*</span>
                </label>
                <select
                  value={formClassId}
                  onChange={(e) => setFormClassId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} {cls.classTeacher ? `(${cls.classTeacher})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Student No. (S/N) <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formStudentNumber}
                    onChange={(e) => setFormStudentNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Admission No. (Optional)
                  </label>
                  <input
                    type="text"
                    value={formAdmissionNumber}
                    onChange={(e) => setFormAdmissionNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                  />
                  <span className="font-semibold text-slate-800">
                    Active student on current register roll
                  </span>
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5 pl-6">
                  Uncheck to mark inactive without deleting historical attendance marks.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD CLASS MODAL */}
      {showAddClassModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Add School Class
                </h3>
                <p className="text-xs text-slate-500">
                  Create a new class arm with teacher and room details
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddClassModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddClassSubmit} className="space-y-3.5 text-xs">
              {classFormError && (
                <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{classFormError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Class Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="e.g. Primary 1A"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Class Teacher Name (Optional)
                </label>
                <input
                  type="text"
                  value={newClassTeacher}
                  onChange={(e) => setNewClassTeacher(e.target.value)}
                  placeholder="Class Teacher Name"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Additional Notes / Short Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={newClassNotes}
                  onChange={(e) => setNewClassNotes(e.target.value)}
                  placeholder="Room or administrative notes"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddClassModal(false)}
                  className="px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors shadow-xs"
                >
                  Create Class
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CLASS MODAL */}
      {editingClass && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Edit Class Details
                </h3>
                <p className="text-xs text-slate-500">
                  Update class arm name, teacher assignment, or notes
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingClass(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditClassSubmit} className="space-y-3.5 text-xs">
              {editClassFormError && (
                <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editClassFormError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Class Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={editClassName}
                  onChange={(e) => setEditClassName(e.target.value)}
                  placeholder="e.g. Primary 1A"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Class Teacher Name
                </label>
                <input
                  type="text"
                  value={editClassTeacher}
                  onChange={(e) => setEditClassTeacher(e.target.value)}
                  placeholder="Class Teacher Name"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Additional Notes / Short Description
                </label>
                <textarea
                  rows={2}
                  value={editClassNotes}
                  onChange={(e) => setEditClassNotes(e.target.value)}
                  placeholder="Room or administrative notes"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingClass(null)}
                  className="px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REMOVE CLASS CONFIRMATION MODAL */}
      {deletingClass && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-100 text-rose-800">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Remove Class "{deletingClass.name}"?
                </h3>
                <p className="text-xs text-slate-500">
                  Confirm class removal from directory
                </p>
              </div>
            </div>

            {/* Student assignment warning check */}
            {(() => {
              const assignedCount = students.filter((s) => s.classId === deletingClass.id).length;
              if (assignedCount > 0) {
                return (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1.5">
                    <div className="font-semibold flex items-center gap-1.5 text-amber-950">
                      <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>Warning: {assignedCount} students are currently assigned to this class!</span>
                    </div>
                    <p className="leading-relaxed">
                      Removing "{deletingClass.name}" will leave these student records unassigned. You may want to edit this class or reassign the pupils first.
                    </p>
                  </div>
                );
              }
              return (
                <p className="text-xs text-slate-600 leading-relaxed">
                  This class currently has 0 students enrolled. It will be safely removed from class lists and filters.
                </p>
              );
            })()}

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingClass(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteClass}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-md transition-colors shadow-xs"
              >
                Confirm Removal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK SCAN REGISTER TO ENROLL MODAL */}
      {showBulkScanModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-none sm:rounded-xl max-w-3xl w-full h-dvh sm:h-auto sm:max-h-[92vh] flex flex-col shadow-2xl border-0 sm:border sm:border-slate-200 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span className="truncate">Bulk Enroll Students from Register Scan</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Capture or upload the student details page, crop tightly if needed, and verify names.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseBulkScanModal}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer shrink-0"
                aria-label="Close enrollment scan"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Target Class Selector or Inline Create */}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    Target Class
                  </span>
                  {classes.length > 0 && (
                    <div className="flex items-center gap-1 p-0.5 bg-slate-200/80 rounded-md">
                      <button
                        type="button"
                        onClick={() => setBulkClassMode('existing')}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                          bulkClassMode === 'existing'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        Existing Class
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkClassMode('new')}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                          bulkClassMode === 'new'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        + Create New Class
                      </button>
                    </div>
                  )}
                </div>

                {bulkClassMode === 'existing' && classes.length > 0 ? (
                  <select
                    value={bulkClassId}
                    onChange={(e) => setBulkClassId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900 font-medium"
                  >
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name} {cls.classTeacher ? `(${cls.classTeacher})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        New Class Name <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={bulkNewClassName}
                        onChange={(e) => setBulkNewClassName(e.target.value)}
                        placeholder="e.g. Primary 1A"
                        className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Class Teacher (Optional)
                      </label>
                      <input
                        type="text"
                        value={bulkNewClassTeacher}
                        onChange={(e) => setBulkNewClassTeacher(e.target.value)}
                        placeholder="Teacher Name"
                        className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900"
                      />
                    </div>
                  </div>
                )}

                {bulkDetectedClass && (
                  <div className="text-[11px] text-emerald-800">
                    Detected on sheet: <strong>{bulkDetectedClass}</strong>
                  </div>
                )}
              </div>

              {/* Hidden file/camera inputs */}
              <input
                ref={bulkFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleBulkRosterFileSelected(file, { source: 'gallery', autoExtract: false });
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />
              <input
                ref={bulkCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleBulkRosterFileSelected(file, { source: 'camera', autoExtract: true });
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />

              {/* Capture / Preview Strip (Full Register Scan Parity) */}
              {!bulkPreviewUrl ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingBulk(true);
                  }}
                  onDragLeave={() => setIsDraggingBulk(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingBulk(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      void handleBulkRosterFileSelected(file, { source: 'gallery', autoExtract: false });
                    }
                  }}
                  className={`border-2 border-dashed rounded-xl p-5 sm:p-7 text-center space-y-3.5 transition-all ${
                    isDraggingBulk
                      ? 'border-emerald-600 bg-emerald-50/60'
                      : 'border-slate-300 hover:border-slate-400 bg-slate-50/70'
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto shadow-2xs">
                    <Camera className="w-6 h-6 text-emerald-700" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">
                      Capture or upload student roster page
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Camera captures scan automatically; gallery uploads open for cropping first.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-md mx-auto pt-1">
                    <button
                      type="button"
                      onClick={handleBulkTakePhotoAction}
                      className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm shadow-xs cursor-pointer"
                    >
                      <Camera className="w-4 h-4 shrink-0" />
                      <span>Take Photo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => bulkFileInputRef.current?.click()}
                      className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs sm:text-sm shadow-2xs cursor-pointer"
                    >
                      <UploadCloud className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Upload from Gallery</span>
                    </button>
                  </div>
                </div>
              ) : !bulkHasExtracted && !isExtractingRoster ? (
                /* 9:16 Portrait Preview with Crop, Fullscreen, Retake, Delete, Gallery */
                <div className="space-y-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="relative w-full max-w-[270px] mx-auto aspect-9/16 max-h-[56vh] rounded-xl overflow-hidden border border-slate-300 bg-slate-950 flex items-center justify-center">
                    <img
                      src={bulkPreviewUrl}
                      alt="Preview of student register before upload"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-slate-900/85 p-1 rounded-lg backdrop-blur-xs border border-slate-700">
                      <button
                        type="button"
                        onClick={() => setBulkIsCropModalOpen(true)}
                        className="p-2 rounded-md hover:bg-slate-800 text-emerald-300 cursor-pointer"
                        title="Crop photo"
                        aria-label="Crop photo"
                      >
                        <Crop className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkIsFullscreenPreview(true)}
                        className="p-2 rounded-md hover:bg-slate-800 text-white cursor-pointer"
                        title="Fullscreen preview"
                        aria-label="Fullscreen preview"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleClearBulkPreview}
                        className="p-2 rounded-md hover:bg-rose-900/80 text-rose-300 hover:text-white cursor-pointer"
                        title="Delete photo"
                        aria-label="Delete photo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {bulkCropBox && (
                      <div className="absolute bottom-2.5 left-2.5 bg-slate-900/85 text-white text-[11px] font-medium px-2 py-0.5 rounded border border-slate-700">
                        Cropped
                      </div>
                    )}
                  </div>

                  {/* Mobile-Friendly Crop + Camera + Gallery Action Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white rounded-xl border border-slate-200 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setBulkIsCropModalOpen(true)}
                        className={`min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-semibold cursor-pointer ${
                          bulkCropBox
                            ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                            : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                        }`}
                      >
                        <Crop className="w-3.5 h-3.5 text-emerald-700" />
                        <span>{bulkCropBox ? 'Edit Crop' : 'Crop'}</span>
                      </button>
                      {bulkCropBox && (
                        <button
                          type="button"
                          onClick={handleResetBulkCrop}
                          className="text-[11px] text-slate-600 hover:text-slate-900 underline px-1.5 cursor-pointer"
                        >
                          Reset Crop
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRetakeBulkPhoto}
                        className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 font-semibold cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Retake</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearBulkPreview}
                        className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 font-semibold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => bulkFileInputRef.current?.click()}
                        className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                      >
                        <UploadCloud className="w-3.5 h-3.5 text-slate-500" />
                        <span>Gallery</span>
                      </button>
                    </div>
                  </div>

                  {bulkPreprocessMeta?.isLowResolution && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-950 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <span>
                        Image resolution ({bulkPreprocessMeta.outputWidth}×{bulkPreprocessMeta.outputHeight}px) is below {MIN_RECOMMENDED_SHORT_SIDE_PX}px on its short edge. Handwriting may be blurry — consider retaking closer or widening the crop.
                      </span>
                    </div>
                  )}

                  {bulkImageMeta && (
                    <div className="text-[11px] text-slate-500 text-center truncate tabular-nums">
                      {bulkImageMeta.fileName} · {bulkImageMeta.width}×{bulkImageMeta.height}px · {bulkImageMeta.sizeLabel}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void runRosterExtraction(bulkPreviewUrl)}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm shadow-xs cursor-pointer"
                  >
                    <ScanLine className="w-4 h-4" />
                    <span>Extract Roster</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => setBulkIsFullscreenPreview(true)}
                        className="shrink-0 cursor-pointer rounded border border-slate-300 overflow-hidden hover:opacity-90"
                        title="Inspect photo fullscreen"
                      >
                        <img
                          src={bulkPreviewUrl}
                          alt="Scanned student register"
                          className="w-12 h-20 object-cover bg-slate-900"
                        />
                      </button>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                          <span>{bulkImageSource === 'gallery' ? 'Gallery photo loaded' : 'Register photo loaded'}</span>
                          {bulkCropBox && (
                            <span className="text-[10px] font-semibold text-emerald-800">· Cropped</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                          {isExtractingRoster
                            ? 'Extracting student rows & checking names...'
                            : `${bulkRows.length} student row(s) detected`}
                          {bulkImageMeta ? ` · ${bulkImageMeta.width}×${bulkImageMeta.height}px` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {isExtractingRoster ? (
                        <button
                          type="button"
                          onClick={handleCancelRosterExtraction}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-800 font-semibold hover:bg-rose-100 cursor-pointer"
                        >
                          Cancel
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setBulkIsCropModalOpen(true)}
                            className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                          >
                            <Crop className="w-3.5 h-3.5 text-emerald-700" />
                            <span>{bulkCropBox ? 'Edit Crop' : 'Crop'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void runRosterExtraction(bulkPreviewUrl)}
                            className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                          >
                            Re-Scan
                          </button>
                          <button
                            type="button"
                            onClick={handleRetakeBulkPhoto}
                            className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 font-semibold cursor-pointer"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Retake</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleClearBulkPreview}
                            className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 font-semibold cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {bulkPreprocessMeta?.isLowResolution && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-950 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <span>
                        Image resolution ({bulkPreprocessMeta.outputWidth}×{bulkPreprocessMeta.outputHeight}px) is below {MIN_RECOMMENDED_SHORT_SIDE_PX}px on its short edge. Widen the crop or retake closer if names are blurry.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Extracting spinner */}
              {isExtractingRoster && (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-emerald-950">
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-700 shrink-0" />
                    <span className="font-semibold">
                      Reading student rows, names, and admission numbers...
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelRosterExtraction}
                    className="px-2.5 py-1 rounded bg-white border border-emerald-300 text-emerald-900 font-semibold hover:bg-emerald-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* AI Notice */}
              {bulkAiNotice && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-start gap-2">
                  <Wand2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>{bulkAiNotice}</span>
                </div>
              )}

              {/* Error feedback */}
              {bulkExtractError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{bulkExtractError}</span>
                </div>
              )}

              {/* Extracted Student Preview List (Tap any field to edit fullscreen) */}
              {bulkRows.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-slate-800 text-xs sm:text-sm">
                        Extracted Students ({includedValidBulkRows.length} selected to enroll)
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Tap any extracted field (Row #, Full Name, or Admission No.) to open and edit it in fullscreen.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isCorrectingNames || isExtractingRoster}
                        onClick={() => void handleRunAiNameCorrection()}
                        className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-900 font-semibold cursor-pointer"
                      >
                        {isCorrectingNames ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                        ) : (
                          <Wand2 className="w-3.5 h-3.5 text-emerald-700" />
                        )}
                        <span>{isCorrectingNames ? 'Checking Names...' : 'AI Correct Names'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const newLocalId = `manual-${Date.now()}`;
                          const nextRowNum = String(bulkRows.length + 1);
                          setBulkRows((prev) => [
                            ...prev,
                            {
                              localId: newLocalId,
                              include: true,
                              studentNumber: nextRowNum,
                              fullName: '',
                              admissionNumber: ''
                            }
                          ]);
                          setFullscreenEditTarget({ localId: newLocalId, field: 'fullName' });
                        }}
                        className="min-h-[36px] px-2.5 py-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg font-semibold cursor-pointer"
                      >
                        + Add Row
                      </button>
                    </div>
                  </div>

                  {/* Mobile Card List (Tap any field to open Fullscreen Editor) */}
                  <div className="md:hidden space-y-2.5">
                    {bulkRows.map((row) => {
                      const parsedSn = parseInt(row.studentNumber, 10);
                      const hasSnConflict =
                        bulkClassMode === 'existing' &&
                        Number.isFinite(parsedSn) &&
                        existingRollNumbersForBulkClass.has(parsedSn);

                      return (
                        <div
                          key={row.localId}
                          className={`rounded-xl border p-3 space-y-2.5 ${
                            !row.include
                              ? 'opacity-60 bg-slate-50 border-slate-200'
                              : hasSnConflict
                              ? 'bg-amber-50/40 border-amber-300'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[36px]">
                              <input
                                type="checkbox"
                                checked={row.include}
                                onChange={(e) =>
                                  setBulkRows((prev) =>
                                    prev.map((r) =>
                                      r.localId === row.localId
                                        ? { ...r, include: e.target.checked }
                                        : r
                                    )
                                  )
                                }
                                className="w-4 h-4 accent-emerald-700"
                              />
                              <span>Enroll Pupil</span>
                            </label>

                            <button
                              type="button"
                              onClick={() =>
                                setBulkRows((prev) =>
                                  prev.filter((r) => r.localId !== row.localId)
                                )
                              }
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                              aria-label="Remove extracted row"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-12 gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setFullscreenEditTarget({
                                  localId: row.localId,
                                  field: 'studentNumber'
                                })
                              }
                              className={`col-span-3 min-h-[48px] text-left px-2.5 py-2 rounded-lg border transition-colors cursor-pointer ${
                                hasSnConflict
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-slate-300 bg-slate-50 hover:border-emerald-500'
                              }`}
                            >
                              <div className="text-[10px] font-semibold text-slate-500">Row #</div>
                              <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                                {row.studentNumber || '—'}
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setFullscreenEditTarget({
                                  localId: row.localId,
                                  field: 'fullName'
                                })
                              }
                              className="col-span-9 min-h-[48px] text-left px-3 py-2 rounded-lg border border-slate-300 bg-white hover:border-emerald-500 transition-colors cursor-pointer min-w-0"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] font-semibold text-slate-500">
                                  Full Name
                                </span>
                                <span className="text-[10px] font-semibold text-emerald-700">
                                  Tap to edit
                                </span>
                              </div>
                              <div className="text-sm font-bold text-slate-900 truncate mt-0.5">
                                {row.fullName || 'Tap to enter name'}
                              </div>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setFullscreenEditTarget({
                                localId: row.localId,
                                field: 'admissionNumber'
                              })
                            }
                            className="w-full min-h-[44px] text-left px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:border-emerald-500 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <span className="text-[11px] font-semibold text-slate-500">
                              Admission No.
                            </span>
                            <span className="text-xs font-mono font-semibold text-slate-800 truncate">
                              {row.admissionNumber || 'Tap to add (optional)'}
                            </span>
                          </button>

                          {row.aiCorrected && row.originalOcrName && row.originalOcrName !== row.fullName && (
                            <div className="text-[11px] text-emerald-800">
                              AI refined from OCR: <span className="italic">"{row.originalOcrName}"</span>
                            </div>
                          )}

                          {hasSnConflict && (
                            <div className="text-[11px] text-amber-800 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>Row #{parsedSn} already exists in this class</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop & Tablet Table (Tap any field to open Fullscreen Editor) */}
                  <div className="hidden md:block border border-slate-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold sticky top-0 z-10">
                        <tr>
                          <th className="py-2 px-2.5 w-10 text-center">Use</th>
                          <th className="py-2 px-2 w-20">Row #</th>
                          <th className="py-2 px-2">Full Name</th>
                          <th className="py-2 px-2 w-40">Admission No.</th>
                          <th className="py-2 px-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bulkRows.map((row) => {
                          const parsedSn = parseInt(row.studentNumber, 10);
                          const hasSnConflict =
                            bulkClassMode === 'existing' &&
                            Number.isFinite(parsedSn) &&
                            existingRollNumbersForBulkClass.has(parsedSn);

                          return (
                            <tr key={row.localId} className={!row.include ? 'opacity-50 bg-slate-50' : ''}>
                              <td className="py-2 px-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={row.include}
                                  onChange={(e) =>
                                    setBulkRows((prev) =>
                                      prev.map((r) =>
                                        r.localId === row.localId
                                          ? { ...r, include: e.target.checked }
                                          : r
                                      )
                                    )
                                  }
                                />
                              </td>
                              <td className="py-2 px-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFullscreenEditTarget({
                                      localId: row.localId,
                                      field: 'studentNumber'
                                    })
                                  }
                                  className={`w-16 px-2.5 py-1.5 border rounded text-left font-bold tabular-nums cursor-pointer transition-colors ${
                                    hasSnConflict
                                      ? 'border-amber-400 bg-amber-50 text-amber-950'
                                      : 'border-slate-300 bg-white hover:border-emerald-500 text-slate-900'
                                  }`}
                                  title="Tap to edit Row # in fullscreen"
                                >
                                  {row.studentNumber || '—'}
                                </button>
                              </td>
                              <td className="py-2 px-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFullscreenEditTarget({
                                      localId: row.localId,
                                      field: 'fullName'
                                    })
                                  }
                                  className="w-full px-2.5 py-1.5 border border-slate-300 bg-white hover:border-emerald-500 rounded text-left font-semibold text-slate-900 cursor-pointer transition-colors flex items-center justify-between gap-2"
                                  title="Tap to edit Full Name in fullscreen"
                                >
                                  <span className="truncate">
                                    {row.fullName || 'Tap to enter name'}
                                  </span>
                                  <Maximize2 className="w-3 h-3 text-slate-400 shrink-0" />
                                </button>
                                {row.aiCorrected && row.originalOcrName && row.originalOcrName !== row.fullName && (
                                  <div className="text-[10px] text-emerald-800 mt-0.5">
                                    AI refined from OCR: "{row.originalOcrName}"
                                  </div>
                                )}
                                {hasSnConflict && (
                                  <div className="text-[10px] text-amber-800 flex items-center gap-1 mt-0.5">
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    <span>Row #{parsedSn} already exists in this class</span>
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFullscreenEditTarget({
                                      localId: row.localId,
                                      field: 'admissionNumber'
                                    })
                                  }
                                  className="w-full px-2.5 py-1.5 border border-slate-300 bg-white hover:border-emerald-500 rounded text-left font-mono text-[11px] text-slate-800 cursor-pointer transition-colors truncate"
                                  title="Tap to edit Admission No. in fullscreen"
                                >
                                  {row.admissionNumber || 'Optional'}
                                </button>
                              </td>
                              <td className="py-2 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setBulkRows((prev) =>
                                      prev.filter((r) => r.localId !== row.localId)
                                    )
                                  }
                                  className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                                  aria-label="Remove extracted row"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 sm:px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5 text-xs shrink-0 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={handleCloseBulkScanModal}
                className="min-h-[42px] px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200/70 rounded-lg cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                disabled={isExtractingRoster || isSavingBulk || includedValidBulkRows.length === 0}
                onClick={() => void handleBulkEnrollSubmit()}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg shadow-xs cursor-pointer"
              >
                {isSavingBulk && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {isSavingBulk
                    ? 'Enrolling...'
                    : `Enroll ${includedValidBulkRows.length} Student${includedValidBulkRows.length === 1 ? '' : 's'}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN EXTRACTED FIELD EDITOR (Opens when tapping any extracted field) */}
      {showBulkScanModal && fullscreenEditTarget && (() => {
        const activeIndex = bulkRows.findIndex((r) => r.localId === fullscreenEditTarget.localId);
        const activeRow = activeIndex >= 0 ? bulkRows[activeIndex] : null;
        if (!activeRow) return null;

        const prevRow = activeIndex > 0 ? bulkRows[activeIndex - 1] : null;
        const nextRow = activeIndex < bulkRows.length - 1 ? bulkRows[activeIndex + 1] : null;
        const parsedSn = parseInt(activeRow.studentNumber, 10);
        const hasSnConflict =
          bulkClassMode === 'existing' &&
          Number.isFinite(parsedSn) &&
          existingRollNumbersForBulkClass.has(parsedSn);

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Fullscreen Extracted Student Editor"
            className="fixed inset-0 z-[75] bg-white flex flex-col"
          >
            {/* Top Bar */}
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setFullscreenEditTarget(null)}
                  className="min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Done</span>
                </button>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate tabular-nums">
                    Row #{activeRow.studentNumber || '—'} · Pupil {activeIndex + 1} of {bulkRows.length}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Fullscreen enrollment editor
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {bulkPreviewUrl && (
                  <button
                    type="button"
                    onClick={() => setFullscreenShowPhotoRef((prev) => !prev)}
                    className={`min-h-[42px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer ${
                      fullscreenShowPhotoRef
                        ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{fullscreenShowPhotoRef ? 'Hide Photo' : 'Check Photo'}</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={!prevRow}
                  onClick={() =>
                    prevRow &&
                    setFullscreenEditTarget({
                      localId: prevRow.localId,
                      field: fullscreenEditTarget.field
                    })
                  }
                  className="min-h-[42px] min-w-[42px] inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
                  aria-label="Previous student"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={!nextRow}
                  onClick={() =>
                    nextRow &&
                    setFullscreenEditTarget({
                      localId: nextRow.localId,
                      field: fullscreenEditTarget.field
                    })
                  }
                  className="min-h-[42px] min-w-[42px] inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
                  aria-label="Next student"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="max-w-2xl mx-auto space-y-5">
                {fullscreenShowPhotoRef && bulkPreviewUrl && (
                  <div className="rounded-xl border border-slate-300 bg-slate-950 p-2">
                    <div className="max-h-[38vh] overflow-auto flex justify-center">
                      <img
                        src={bulkPreviewUrl}
                        alt="Register handwriting reference"
                        className="max-w-full object-contain rounded"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Physical Register Row #
                  </label>
                  <input
                    ref={fullscreenRowNumInputRef}
                    type="number"
                    min="1"
                    value={activeRow.studentNumber}
                    onChange={(e) =>
                      setBulkRows((prev) =>
                        prev.map((r) =>
                          r.localId === activeRow.localId
                            ? { ...r, studentNumber: e.target.value }
                            : r
                        )
                      )
                    }
                    className={`w-full min-h-[52px] px-4 py-3 text-lg font-bold rounded-xl border-2 tabular-nums focus:outline-hidden focus:ring-2 focus:ring-emerald-600 ${
                      hasSnConflict
                        ? 'border-amber-400 bg-amber-50 text-amber-950'
                        : 'border-slate-300 bg-white text-slate-900'
                    }`}
                  />
                  {hasSnConflict && (
                    <div className="mt-1.5 text-xs text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Row #{parsedSn} already exists in the selected class.</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Student Full Name
                  </label>
                  <input
                    ref={fullscreenNameInputRef}
                    type="text"
                    value={activeRow.fullName}
                    onChange={(e) =>
                      setBulkRows((prev) =>
                        prev.map((r) =>
                          r.localId === activeRow.localId
                            ? { ...r, fullName: e.target.value }
                            : r
                        )
                      )
                    }
                    placeholder="Enter student full name"
                    className="w-full min-h-[54px] px-4 py-3 text-lg font-bold rounded-xl border-2 border-slate-300 bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                  />

                  {activeRow.originalOcrName &&
                    activeRow.originalOcrName !== activeRow.fullName && (
                      <div className="mt-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="text-emerald-950">
                          Original OCR reading: <strong className="italic">"{activeRow.originalOcrName}"</strong>
                          {activeRow.aiCorrectionNote ? ` · ${activeRow.aiCorrectionNote}` : ''}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setBulkRows((prev) =>
                              prev.map((r) =>
                                r.localId === activeRow.localId
                                  ? {
                                      ...r,
                                      fullName: activeRow.originalOcrName || r.fullName,
                                      aiCorrected: false
                                    }
                                  : r
                              )
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-900 font-semibold hover:bg-emerald-100 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Use Original OCR</span>
                        </button>
                      </div>
                    )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Admission Number (Optional)
                  </label>
                  <input
                    ref={fullscreenAdmInputRef}
                    type="text"
                    value={activeRow.admissionNumber}
                    onChange={(e) =>
                      setBulkRows((prev) =>
                        prev.map((r) =>
                          r.localId === activeRow.localId
                            ? { ...r, admissionNumber: e.target.value }
                            : r
                        )
                      )
                    }
                    placeholder="e.g. LEA/2026/0014"
                    className="w-full min-h-[52px] px-4 py-3 text-base font-mono font-semibold rounded-xl border-2 border-slate-300 bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <label className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
                  <div>
                    <div className="text-sm font-bold text-slate-900">Include in Class Enrollment</div>
                    <div className="text-xs text-slate-500">
                      Uncheck if this row is blank, crossed out, or should be skipped.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={activeRow.include}
                    onChange={(e) =>
                      setBulkRows((prev) =>
                        prev.map((r) =>
                          r.localId === activeRow.localId
                            ? { ...r, include: e.target.checked }
                            : r
                        )
                      )
                    }
                    className="w-5 h-5 accent-emerald-700"
                  />
                </label>
              </div>
            </div>

            {/* Bottom Sticky Bar */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2.5 shrink-0 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => {
                  const targetNext = nextRow || prevRow;
                  setBulkRows((prev) => prev.filter((r) => r.localId !== activeRow.localId));
                  if (targetNext) {
                    setFullscreenEditTarget({
                      localId: targetNext.localId,
                      field: fullscreenEditTarget.field
                    });
                  } else {
                    setFullscreenEditTarget(null);
                  }
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Remove Row</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (nextRow) {
                    setFullscreenEditTarget({
                      localId: nextRow.localId,
                      field: fullscreenEditTarget.field
                    });
                  } else {
                    setFullscreenEditTarget(null);
                  }
                }}
                className="min-h-[44px] flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold shadow-xs cursor-pointer"
              >
                <span>{nextRow ? 'Save & Next Pupil' : 'Save & Return'}</span>
                {nextRow && <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );
      })()}

      {/* FULLSCREEN IMAGE PREVIEW FOR ENROLLMENT */}
      {bulkIsFullscreenPreview && bulkPreviewUrl && (
        <div className="fixed inset-0 z-[72] bg-slate-950/95 backdrop-blur-xs flex flex-col p-4">
          <div className="flex items-center justify-between pb-3 text-white border-b border-slate-800">
            <div className="text-sm font-semibold truncate">
              {bulkImageMeta?.fileName || 'Enrollment Register Photo'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setBulkIsFullscreenPreview(false);
                  handleClearBulkPreview();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-rose-900/70 hover:bg-rose-800 text-xs text-white cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              <button
                type="button"
                onClick={() => setBulkIsFullscreenPreview(false)}
                className="p-1.5 rounded text-slate-300 hover:text-white cursor-pointer"
                aria-label="Close fullscreen preview"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img
              src={bulkPreviewUrl}
              alt="Full size enrollment register preview"
              className="max-h-[85vh] max-w-[92vw] object-contain"
            />
          </div>
        </div>
      )}

      {/* FULLSCREEN ANDROID-STYLE DRAG-EDGE CROPPER FOR ENROLLMENT */}
      {bulkRawSourceUrl && (
        <RegisterImageCropperModal
          isOpen={bulkIsCropModalOpen}
          imageUrl={bulkRawSourceUrl}
          initialCropBox={bulkCropBox}
          imageDimensions={bulkRawDimensions || (bulkImageMeta ? { width: bulkImageMeta.width, height: bulkImageMeta.height } : null)}
          onApplyCrop={(crop) => void handleApplyBulkCrop(crop)}
          onClose={() => setBulkIsCropModalOpen(false)}
        />
      )}

      {/* LIVE IN-APP CAMERA VIEWFINDER FOR ENROLLMENT */}
      <LiveCameraViewfinderModal
        isOpen={bulkIsLiveCameraOpen}
        title="Enrollment Roster Camera"
        frameHintTop="Align student names & Row # inside frame"
        frameHintBottom="Hold upright in clear lighting"
        onCaptureDataUrl={handleBulkLiveCameraCapture}
        onFallbackToNativeCamera={() => bulkCameraInputRef.current?.click()}
        onClose={() => setBulkIsLiveCameraOpen(false)}
      />
    </div>
  );
};
