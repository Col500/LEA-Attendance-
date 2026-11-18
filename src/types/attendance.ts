export type ReviewStatus = 'Confirmed' | 'Pending Review' | 'Draft' | 'Flagged' | 'Failed';

export type StudentStatus = 'Active' | 'Transferred' | 'Inactive';

export type AttendanceStatus = 'Present' | 'Absent' | 'Excused';

export type ScanWorkflowState = 'empty' | 'image-selected' | 'ready-to-analyze' | 'processing' | 'review' | 'confirmed' | 'error';

export interface EditableAttendanceRow {
  id: string;
  rowNumber: number;
  studentName: string;
  admissionNumber?: string;
  matchedStudentId?: string;
  status: 'Present' | 'Absent' | 'Excused' | 'Uncertain' | 'Blank';
  rawMarkStatus: MarkStatus;
  rawSymbol: string;
  isUncertain: boolean;
  uncertaintyNotes?: string | null;
  dayMarks?: { day: string; status: MarkStatus; rawSymbol: string }[];
}

export interface ClassItem {
  id: string;
  name: string;
  classTeacher?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Student {
  id: string;
  studentNumber: number;
  fullName: string;
  classId: string;
  admissionNumber?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStudentEntry {
  studentId: string;
  rollNumber: number;
  studentName: string;
  status: AttendanceStatus;
  remarks?: string;
  presentMarks?: number;
  absentMarks?: number;
  blankMarks?: number;
  uncertainMarks?: number;
}

export interface SessionAttendanceRecord {
  id: string;
  studentId: string | null;
  rowNumber: number | null;
  studentName: string;
  weekIdentifier: string;
  dayOfWeek: string;
  status: ValidatedAttendanceStatus;
  originalAiStatus?: ValidatedAttendanceStatus | null;
  reviewed: boolean;
}

export type StaffRole = 'admin' | 'headteacher' | 'visitor' | 'teacher' | 'viewer';

export interface StaffProfile {
  id: string;
  displayName: string;
  role: StaffRole;
  email?: string;
}

export interface AttendanceSession {
  id: string;
  date: string;
  classId?: string;
  classGrade: string;
  term: string;
  sessionYear: string;
  totalEnrolled: number;
  presentCount: number;
  absentCount: number;
  blankCount?: number;
  uncertainCount?: number;
  unmappedCount?: number;
  reviewStatus: ReviewStatus;
  recordedBy: string;
  verifiedBy?: string;
  registerImageUri?: string;
  notes?: string;
  failureReason?: string;
  sourceDraftId?: string;
  persistenceTarget?: 'supabase' | 'local-demo';
  entries?: SessionStudentEntry[];
  records?: SessionAttendanceRecord[];
}

export interface SchoolClass {
  id: string;
  name: string;
  arm: string;
  classTeacher: string;
  studentCount: number;
  roomNumber: string;
}

export type RegisterFormatMode = 'daily' | 'multi-week';

export interface SchoolInfo {
  id: string;
  name: string;
  shortName: string;
  subLocation: string;
  zone: string;
  city: string;
  state: string;
  lga: string;
  academicSession: string;
  currentTerm: string;
  headTeacher: string;
  administratorName: string;
  contactPhone?: string;
  contactEmail?: string;
  absenceAlertThreshold?: number;
}

export type MarkStatus = 'PRESENT' | 'ABSENT' | 'BLANK' | 'UNCERTAIN';

export interface NormalizedCropBox {
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
}

export interface NormalizedBoundingBox {
  ymin: number; // 0..1000
  xmin: number; // 0..1000
  ymax: number; // 0..1000
  xmax: number; // 0..1000
}

export interface RegisterLayoutQuality {
  pageBoundariesDetected?: boolean;
  tableBoundariesDetected?: boolean;
  tableBoundingBox?: NormalizedBoundingBox | null;
  detectedWeeks?: string[];
  uncertainHeadings?: string[];
  layoutTooDistorted?: boolean;
  retakeOrCropAdvice?: string | null;
}

export interface GeminiExtractionMark {
  week?: string;
  day: string;
  status: MarkStatus;
  rawSymbol: string;
  isCorrectionOrOverwritten?: boolean;
  notes?: string | null;
}

export interface GeminiExtractionRow {
  rowNumber: number;
  studentNameDetected?: string | null;
  admissionNumberDetected?: string | null;
  marks: GeminiExtractionMark[];
  uncertaintyNotes?: string | null;
}

export interface LeaGridRowGeometry {
  rowNumber: number;
  yCenterAtZeroX: number;
}

export interface LeaGridDayGeometry {
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
  xCenter: number;
  dayWidth: number;
}

export interface LeaGridWeekGeometry {
  weekLabel: string;
  days: LeaGridDayGeometry[];
}

export interface LeaGridGeometry {
  pageWidth: number;
  pageHeight: number;
  rightSlope: number;
  rowHeight: number;
  dayHeaderBaseY: number;
  bodyTopY: number;
  isLeftRosterPage: boolean;
  rows: LeaGridRowGeometry[];
  weeks: LeaGridWeekGeometry[];
}

export interface GeminiExtractionResult {
  schoolIdentified?: string | null;
  classIdentified?: string | null;
  periodIdentified?: string | null;
  layoutNotes?: string;
  layoutQuality?: RegisterLayoutQuality;
  processingStageUsed?: 'whole-page' | 'staged-cell-verification';
  gridGeometry?: LeaGridGeometry | null;
  totalRowsDetected: number;
  detectedDays?: string[];
  rows: GeminiExtractionRow[];
  ambiguityDetected?: boolean;
  summaryStatistics?: {
    presentCount: number;
    absentCount: number;
    blankCount: number;
    uncertainCount: number;
  };
  overallConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  disclaimer?: string;
}

export interface GeminiAnalysisResponse {
  ok: boolean;
  code?: string;
  error?: string;
  data?: GeminiExtractionResult;
  rawText?: string;
  modelUsed?: string;
  timestamp?: string;
}

// --- Stage 6: Validated Draft Attendance & Student Row Mapping Types ---
// Note: MarkStatus ('PRESENT' | 'ABSENT' | 'BLANK' | 'UNCERTAIN') already serves as the
// machine-extracted status enum, distinct from confirmed AttendanceStatus ('Present' | 'Absent' | 'Excused').
export type ValidatedAttendanceStatus = MarkStatus;

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export interface SourceImageMetadata {
  fileName: string;
  fileSize?: string;
  width?: number;
  height?: number;
  preprocessedWidth?: number;
  preprocessedHeight?: number;
  rotation: number;
  wasCropped?: boolean;
  wasRotated?: boolean;
  wasResized?: boolean;
  isLowResolution?: boolean;
  capturedAt: string;
  modelUsed?: string;
}

export interface CellCorrectionEntry {
  id: string;
  timestamp: string;
  field: 'status' | 'studentId' | 'schedule' | 'reviewed';
  originalAiSuggestion: string;
  previousValue: string;
  newValue: string;
}

export interface AttendanceCell {
  id: string;
  studentId: string | null;
  rowNumber: number;
  detectedStudentName?: string | null;
  detectedAdmissionNumber?: string | null;
  weekIdentifier: string;
  dayOfWeek: DayOfWeek;
  status: ValidatedAttendanceStatus;
  originalAiStatus: ValidatedAttendanceStatus;
  originalAiWeekIdentifier?: string;
  originalAiDayOfWeek?: DayOfWeek;
  rawSymbol?: string;
  notes?: string | null;
  reviewRequired: boolean;
  reviewReason?: string;
  reviewedByAdmin: boolean;
  reviewedAt?: string;
  correctionHistory?: CellCorrectionEntry[];
  isMissingFromAI?: boolean;
  isDuplicate?: boolean;
  isCorrectionOrOverwritten?: boolean;
  hasConflictingDetection?: boolean;
  sourceImageReference?: string;
}

export type MappingConfidence =
  | 'EXACT_ADMISSION'
  | 'EXACT_NAME'
  | 'ROW_ORDER_MATCH'
  | 'MANUAL'
  | 'ROW_ORDER_SUGGESTED'
  | 'UNMAPPED';

export interface RowStudentMapping {
  rowNumber: number;
  detectedName: string | null;
  detectedAdmissionNumber: string | null;
  studentId: string | null;
  suggestedStudentId?: string | null;
  mappingConfidence: MappingConfidence;
  mappingConfirmed: boolean;
  reviewRequired: boolean;
  notes?: string;
}

export type DraftProcessingStatus =
  | 'VALIDATED_DRAFT'
  | 'NEEDS_REVIEW'
  | 'QUARANTINED'
  | 'REJECTED';

export type ValidationIssueCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_STATUS'
  | 'INVALID_WEEK'
  | 'INVALID_WEEKDAY'
  | 'INVALID_ROW_NUMBER'
  | 'DUPLICATE_CELL'
  | 'CONFLICTING_DETECTION'
  | 'MISSING_CELL'
  | 'MISSING_ROW'
  | 'UNCERTAIN_HEADING'
  | 'OVERWRITTEN_MARK'
  | 'MALFORMED_PAYLOAD'
  | 'UNMAPPED_STUDENT'
  | 'AMBIGUOUS_MARK';

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code: ValidationIssueCode;
  message: string;
  rowNumber?: number;
  weekIdentifier?: string;
  dayOfWeek?: string;
  rawValue?: unknown;
}

export interface DraftEditHistoryEntry extends CellCorrectionEntry {
  rowNumber: number;
  cellId?: string;
  weekIdentifier?: string;
  dayOfWeek?: DayOfWeek;
  reviewedByAdmin: boolean;
}

export interface AttendanceSessionDraft {
  id: string;
  classId: string;
  className: string;
  attendancePeriod: string;
  sourceImageMetadata: SourceImageMetadata;
  cells: AttendanceCell[];
  rowMappings: RowStudentMapping[];
  weeksDetected: string[];
  processingStatus: DraftProcessingStatus;
  validationIssues: ValidationIssue[];
  quarantinedItems: Array<{ reason: string; rawData: unknown }>;
  editHistory: DraftEditHistoryEntry[];
  confirmationAcknowledgedUnresolved?: boolean;
  rawAiResponse: unknown;
  createdAt: string;
}

export type RegisterFailureCategory =
  | 'NONE'
  | 'ORIENTATION_ROTATED'
  | 'EXCESSIVE_MARGIN_OR_SKEW'
  | 'FAINT_OR_AMBIGUOUS_INK'
  | 'OVERWRITTEN_CORRECTION'
  | 'MISSING_OR_SKIPPED_ROW'
  | 'HEADING_UNCERTAINTY'
  | 'CONFLICTING_DUPLICATE';

export interface RegisterTestOutcome {
  id: string;
  fixtureId: string;
  fixtureLabel: string;
  testedAt: string;
  modelUsed: string;
  stageUsed: 'whole-page' | 'staged-cell-verification';
  totalExpectedCells: number;
  exactMatches: number;
  uncertainOrFlaggedCount: number;
  mismatchedDefinitiveCount: number;
  missingRowGapsDetected: number;
  layoutDistortionFlagged: boolean;
  failureCategories: RegisterFailureCategory[];
  notes: string;
}
