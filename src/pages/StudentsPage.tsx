import React, { useState, useMemo, useEffect } from 'react';
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
  Maximize2
} from 'lucide-react';
import { ClassItem, Student } from '../types/attendance';
import { preprocessRegisterImage } from '../services/imagePreprocessing';

interface ExtractedRosterDraftRow {
  localId: string;
  include: boolean;
  studentNumber: string;
  fullName: string;
  admissionNumber: string;
}

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
  const [bulkPreviewUrl, setBulkPreviewUrl] = useState<string | null>(null);
  const [bulkImageMeta, setBulkImageMeta] = useState<{
    fileName: string;
    width: number;
    height: number;
    sizeLabel: string;
  } | null>(null);
  const [bulkImageSource, setBulkImageSource] = useState<'camera' | 'gallery' | null>(null);
  const [bulkHasExtracted, setBulkHasExtracted] = useState(false);
  const [bulkIsFullscreenPreview, setBulkIsFullscreenPreview] = useState(false);
  const [isExtractingRoster, setIsExtractingRoster] = useState(false);
  const [bulkExtractError, setBulkExtractError] = useState<string | null>(null);
  const [bulkRows, setBulkRows] = useState<ExtractedRosterDraftRow[]>([]);
  const [bulkDetectedClass, setBulkDetectedClass] = useState<string | null>(null);
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  const bulkFileInputRef = React.useRef<HTMLInputElement>(null);
  const bulkCameraInputRef = React.useRef<HTMLInputElement>(null);
  const bulkAbortRef = React.useRef<AbortController | null>(null);

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
    setBulkPreviewUrl(null);
    setBulkImageMeta(null);
    setBulkImageSource(null);
    setBulkHasExtracted(false);
    setBulkIsFullscreenPreview(false);
    setIsExtractingRoster(false);
    setBulkExtractError(null);
    setBulkRows([]);
    setBulkDetectedClass(null);
    setIsSavingBulk(false);
    setShowBulkScanModal(true);
  };

  const handleCloseBulkScanModal = () => {
    if (bulkAbortRef.current) {
      bulkAbortRef.current.abort();
      bulkAbortRef.current = null;
    }
    setIsExtractingRoster(false);
    setBulkIsFullscreenPreview(false);
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
    setBulkRows([]);

    try {
      const response = await fetch('/api/extract-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageDataUrl, model: 'google-cloud-vision' }),
        signal: controller.signal
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Could not extract student roster via Google Cloud Vision.');
      }

      const detectedName = typeof json.classDetected === 'string' && json.classDetected.trim()
        ? json.classDetected.trim()
        : null;
      setBulkDetectedClass(detectedName);
      if (detectedName) {
        setBulkNewClassName((prev) => (prev.trim() ? prev : detectedName));
      }

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
        admissionNumber: String(item.admissionNumber || '').trim()
      }));

      setBulkRows(mappedRows);
      if (mappedRows.length === 0) {
        setBulkExtractError('No student names were detected. Crop closer or upload a clearer photo of the names column.');
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

    try {
      const pre = await preprocessRegisterImage({
        source: file,
        rotation: 0,
        maxDimension: 1800,
        preferredMimeType: file.type
      });
      setBulkPreviewUrl(pre.dataUrl);
      setBulkImageSource(options.source);
      setBulkHasExtracted(false);
      setBulkRows([]);
      setBulkDetectedClass(null);
      setBulkImageMeta({
        fileName: file.name,
        width: pre.outputWidth,
        height: pre.outputHeight,
        sizeLabel: `${(pre.estimatedBytes / (1024 * 1024)).toFixed(2)} MB`
      });

      if (options.autoExtract) {
        // Immediately auto-initiate extraction after camera capture
        void runRosterExtraction(pre.dataUrl);
      }
    } catch (err: any) {
      setBulkExtractError(err?.message || 'Unable to prepare photograph for extraction.');
    }
  };

  const handleClearBulkPreview = () => {
    if (bulkAbortRef.current) {
      bulkAbortRef.current.abort();
      bulkAbortRef.current = null;
    }
    setIsExtractingRoster(false);
    setBulkPreviewUrl(null);
    setBulkImageMeta(null);
    setBulkImageSource(null);
    setBulkHasExtracted(false);
    setBulkRows([]);
    setBulkDetectedClass(null);
    setBulkExtractError(null);
    setBulkIsFullscreenPreview(false);
  };

  const handleRetakeBulkPhoto = () => {
    handleClearBulkPreview();
    bulkCameraInputRef.current?.click();
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
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-emerald-700" />
                  <span>Bulk Enroll Students from Register Scan</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Upload or capture the student names/details section once to enroll the whole class.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseBulkScanModal}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
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

              {/* Capture / Preview Strip */}
              {!bulkPreviewUrl ? (
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center bg-slate-50/70 space-y-3">
                  <div className="font-semibold text-slate-800">
                    Select or photograph the student details page of the register
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Gallery uploads show a preview first before uploading; camera captures auto-scan immediately.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => bulkCameraInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Capture Photo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => bulkFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer"
                    >
                      <UploadCloud className="w-4 h-4 text-slate-500" />
                      <span>Upload Image</span>
                    </button>
                  </div>
                </div>
              ) : !bulkHasExtracted && !isExtractingRoster ? (
                /* 9:16 Portrait Image Preview Before Uploading */
                <div className="space-y-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="relative w-full max-w-[260px] mx-auto aspect-9/16 max-h-[56vh] rounded-lg overflow-hidden border border-slate-300 bg-slate-950 flex items-center justify-center">
                    <img
                      src={bulkPreviewUrl}
                      alt="Preview of student register before upload"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-slate-900/85 p-1 rounded-md border border-slate-700">
                      <button
                        type="button"
                        onClick={() => setBulkIsFullscreenPreview(true)}
                        className="p-1.5 rounded hover:bg-slate-800 text-white cursor-pointer"
                        title="Inspect full image"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleClearBulkPreview}
                        className="p-1.5 rounded hover:bg-rose-900/80 text-rose-300 hover:text-white cursor-pointer"
                        title="Delete photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {bulkImageMeta && (
                    <div className="text-[11px] text-slate-500 text-center truncate">
                      {bulkImageMeta.fileName} · {bulkImageMeta.sizeLabel}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRetakeBulkPhoto}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 font-semibold cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Retake</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearBulkPreview}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 font-semibold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => bulkFileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                      >
                        Gallery
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void runRosterExtraction(bulkPreviewUrl)}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-bold shadow-xs cursor-pointer"
                    >
                      <ScanLine className="w-4 h-4" />
                      <span>Extract Roster</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => setBulkIsFullscreenPreview(true)}
                      className="shrink-0 cursor-pointer rounded border border-slate-300 overflow-hidden hover:opacity-90"
                      title="Inspect photo"
                    >
                      <img
                        src={bulkPreviewUrl}
                        alt="Scanned student register"
                        className="w-12 h-20 object-cover bg-slate-900"
                      />
                    </button>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800">
                        {bulkImageSource === 'gallery' ? 'Gallery photo loaded' : 'Register photo loaded'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {isExtractingRoster
                          ? 'Extracting names and admission numbers...'
                          : `${bulkRows.length} student row(s) detected`}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isExtractingRoster ? (
                      <button
                        type="button"
                        onClick={handleCancelRosterExtraction}
                        className="px-3 py-1.5 rounded-md bg-rose-50 border border-rose-300 text-rose-800 font-semibold hover:bg-rose-100 cursor-pointer"
                      >
                        Cancel
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void runRosterExtraction(bulkPreviewUrl)}
                          className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                        >
                          Re-Scan
                        </button>
                        <button
                          type="button"
                          onClick={handleRetakeBulkPhoto}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 font-semibold cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Retake</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleClearBulkPreview}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 font-semibold cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {bulkIsFullscreenPreview && bulkPreviewUrl && (
                <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4">
                  <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => setBulkIsFullscreenPreview(false)}
                      className="self-end mb-2 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Close Preview</span>
                    </button>
                    <img
                      src={bulkPreviewUrl}
                      alt="Full size register preview"
                      className="max-h-[82vh] max-w-full object-contain rounded-lg border border-slate-700 bg-slate-900"
                    />
                  </div>
                </div>
              )}

              {/* Extracting spinner */}
              {isExtractingRoster && (
                <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-emerald-950">
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-700 shrink-0" />
                    <span className="font-semibold">
                      Reading student roll numbers, names, and admission numbers...
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

              {/* Error feedback */}
              {bulkExtractError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{bulkExtractError}</span>
                </div>
              )}

              {/* Extracted Student Preview Table */}
              {bulkRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">
                      Extracted Students ({includedValidBulkRows.length} selected to enroll)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setBulkRows((prev) => [
                          ...prev,
                          {
                            localId: `manual-${Date.now()}`,
                            include: true,
                            studentNumber: String(prev.length + 1),
                            fullName: '',
                            admissionNumber: ''
                          }
                        ])
                      }
                      className="text-emerald-700 hover:underline font-semibold cursor-pointer"
                    >
                      + Add Row
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold sticky top-0">
                        <tr>
                          <th className="py-2 px-2.5 w-10 text-center">Use</th>
                          <th className="py-2 px-2 w-16">S/N</th>
                          <th className="py-2 px-2">Full Name</th>
                          <th className="py-2 px-2 w-36">Admission No.</th>
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
                              <td className="py-1.5 px-2.5 text-center">
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
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  min="1"
                                  value={row.studentNumber}
                                  onChange={(e) =>
                                    setBulkRows((prev) =>
                                      prev.map((r) =>
                                        r.localId === row.localId
                                          ? { ...r, studentNumber: e.target.value }
                                          : r
                                      )
                                    )
                                  }
                                  className={`w-14 px-2 py-1 border rounded ${
                                    hasSnConflict
                                      ? 'border-amber-400 bg-amber-50'
                                      : 'border-slate-300'
                                  }`}
                                  title={
                                    hasSnConflict
                                      ? 'This S/N already exists in the selected class'
                                      : undefined
                                  }
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="text"
                                  value={row.fullName}
                                  onChange={(e) =>
                                    setBulkRows((prev) =>
                                      prev.map((r) =>
                                        r.localId === row.localId
                                          ? { ...r, fullName: e.target.value }
                                          : r
                                      )
                                    )
                                  }
                                  placeholder="Full Name"
                                  className="w-full px-2 py-1 border border-slate-300 rounded"
                                />
                                {hasSnConflict && (
                                  <div className="text-[10px] text-amber-800 flex items-center gap-1 mt-0.5">
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    <span>S/N #{parsedSn} already exists in this class</span>
                                  </div>
                                )}
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="text"
                                  value={row.admissionNumber}
                                  onChange={(e) =>
                                    setBulkRows((prev) =>
                                      prev.map((r) =>
                                        r.localId === row.localId
                                          ? { ...r, admissionNumber: e.target.value }
                                          : r
                                      )
                                    )
                                  }
                                  placeholder="Optional"
                                  className="w-full px-2 py-1 border border-slate-300 rounded font-mono text-[11px]"
                                />
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setBulkRows((prev) =>
                                      prev.filter((r) => r.localId !== row.localId)
                                    )
                                  }
                                  className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
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

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5 text-xs">
              <button
                type="button"
                onClick={handleCloseBulkScanModal}
                className="px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200/70 rounded-md cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                disabled={isExtractingRoster || isSavingBulk || includedValidBulkRows.length === 0}
                onClick={() => void handleBulkEnrollSubmit()}
                className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md shadow-xs cursor-pointer"
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
    </div>
  );
};
