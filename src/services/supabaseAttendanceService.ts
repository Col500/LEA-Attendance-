import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AttendanceSession,
  AttendanceSessionDraft,
  ClassItem,
  ReviewStatus,
  SessionAttendanceRecord,
  SessionStudentEntry,
  StaffProfile,
  Student,
  ValidatedAttendanceStatus
} from '../types/attendance';
import {
  AttendanceReportResult,
  computeStudentAttendanceReport
} from './attendanceReports';

export type DbClient = Pick<SupabaseClient, 'from' | 'rpc' | 'auth'>;

interface DbClassRow {
  id: string;
  name: string;
  class_teacher: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface DbStudentRow {
  id: string;
  class_id: string;
  student_number: number;
  full_name: string;
  admission_number: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface DbAttendanceRecordJoinedRow {
  id: string;
  attendance_session_id: string;
  student_id: string | null;
  row_number: number | null;
  week_identifier: string;
  day_of_week: string;
  status: ValidatedAttendanceStatus;
  original_ai_status: ValidatedAttendanceStatus | null;
  reviewed: boolean;
  corrected_at: string | null;
  students?: {
    id: string;
    full_name: string;
    student_number: number;
  } | null;
}

interface DbAttendanceSessionJoinedRow {
  id: string;
  class_id: string;
  attendance_date: string | null;
  attendance_period: string;
  source_type: string;
  status: string;
  source_draft_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  confirmed_at: string | null;
  classes?: { name: string } | null;
  profiles?: { display_name: string } | null;
  attendance_records?: DbAttendanceRecordJoinedRow[];
}

export function formatSupabaseError(err: unknown, fallbackMessage: string): string {
  if (!err || typeof err !== 'object') {
    return typeof err === 'string' && err.trim() ? err : fallbackMessage;
  }

  const e = err as { code?: string; message?: string; details?: string };
  const msg = e.message || '';

  if (e.code === '42501' || msg.toLowerCase().includes('row-level security') || msg.toLowerCase().includes('permission denied')) {
    return 'Access denied by Row Level Security policy. Only an authenticated School Admin can modify school records; Head Teacher and Visitor logins have read-only access.';
  }
  if (e.code === '23505' || msg.includes('DUPLICATE_DRAFT_CONFIRMATION')) {
    if (msg.includes('DUPLICATE_DRAFT_CONFIRMATION') || msg.includes('source_draft_id')) {
      return 'This review draft has already been confirmed and saved to the database. Duplicate confirmation was prevented.';
    }
    if (msg.includes('admission_number')) {
      return 'A student with this admission number already exists in the database.';
    }
    if (msg.includes('uq_student_number_per_class')) {
      return 'That roll number is already assigned to another student in the selected class.';
    }
    return 'A duplicate record already exists in the database.';
  }
  if (e.code === '23503') {
    return 'Cannot complete operation because related class or attendance records still reference this item.';
  }
  if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network')) {
    return 'Could not reach Supabase database. Check your internet connection and retry—your local changes remain intact.';
  }

  return msg || fallbackMessage;
}

function mapClassRow(row: DbClassRow): ClassItem {
  return {
    id: row.id,
    name: row.name,
    classTeacher: row.class_teacher || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined
  };
}

function mapStudentRow(row: DbStudentRow): Student {
  return {
    id: row.id,
    classId: row.class_id,
    studentNumber: row.student_number,
    fullName: row.full_name,
    admissionNumber: row.admission_number || undefined,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getCurrentStaffProfile(client: DbClient): Promise<StaffProfile | null> {
  const authApi = client.auth as DbClient['auth'] & {
    getSession?: () => Promise<{ data: { session: { expires_at?: number } | null }; error: unknown }>;
  };

  if (typeof authApi.getSession === 'function') {
    const { data: sessionData, error: sessionErr } = await authApi.getSession();
    if (sessionErr || !sessionData?.session) {
      return null;
    }
    if (sessionData.session.expires_at && sessionData.session.expires_at * 1000 <= Date.now()) {
      return null;
    }
  }

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    return null;
  }

  const user = userData.user;
  const { data: profileData, error: profileError } = await client
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(formatSupabaseError(profileError, 'Unable to read staff profile.'));
  }

  if (!profileData) {
    return {
      id: user.id,
      displayName: user.email || 'Authenticated User',
      role: 'visitor',
      email: user.email
    };
  }

  return {
    id: profileData.id,
    displayName: profileData.display_name,
    role: profileData.role as StaffProfile['role'],
    email: user.email
  };
}

/**
 * Verifies that an active, unexpired Supabase Auth session exists AND belongs to an Admin profile
 * before attempting any write or confirmation operation. Preserves drafts on failure.
 */
export async function requireValidAdminSession(client: DbClient): Promise<StaffProfile> {
  const profile = await getCurrentStaffProfile(client);
  if (!profile) {
    throw new Error(
      'Your session has expired or you are signed out. Your changes were not saved—please sign in again as School Admin.'
    );
  }
  if (profile.role !== 'admin') {
    throw new Error(
      `Read-only access (${profile.role}): Only the School Admin login has permission to modify school records or confirm attendance.`
    );
  }
  return profile;
}

export async function fetchClassesFromSupabase(client: DbClient): Promise<ClassItem[]> {
  const { data, error } = await client
    .from('classes')
    .select('id, name, class_teacher, notes, created_at, updated_at')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to load classes from database.'));
  }

  return ((data || []) as DbClassRow[]).map(mapClassRow);
}

export async function fetchStudentsFromSupabase(client: DbClient): Promise<Student[]> {
  const { data, error } = await client
    .from('students')
    .select('id, class_id, student_number, full_name, admission_number, active, created_at, updated_at')
    .order('student_number', { ascending: true });

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to load students from database.'));
  }

  return ((data || []) as DbStudentRow[]).map(mapStudentRow);
}

export async function createClassInSupabase(
  client: DbClient,
  input: { name: string; classTeacher?: string; notes?: string }
): Promise<ClassItem> {
  await requireValidAdminSession(client);
  const { data, error } = await client
    .from('classes')
    .insert({
      name: input.name.trim(),
      class_teacher: input.classTeacher?.trim() || null,
      notes: input.notes?.trim() || null
    })
    .select('id, name, class_teacher, notes, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(formatSupabaseError(error, 'Failed to create class in database.'));
  }

  return mapClassRow(data as DbClassRow);
}

export async function updateClassInSupabase(
  client: DbClient,
  cls: ClassItem
): Promise<ClassItem> {
  await requireValidAdminSession(client);
  const { data, error } = await client
    .from('classes')
    .update({
      name: cls.name.trim(),
      class_teacher: cls.classTeacher?.trim() || null,
      notes: cls.notes?.trim() || null
    })
    .eq('id', cls.id)
    .select('id, name, class_teacher, notes, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(formatSupabaseError(error, 'Failed to update class in database.'));
  }

  return mapClassRow(data as DbClassRow);
}

export async function deleteClassInSupabase(client: DbClient, classId: string): Promise<void> {
  await requireValidAdminSession(client);
  const { error } = await client.from('classes').delete().eq('id', classId);
  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to delete class from database.'));
  }
}

export async function createStudentInSupabase(
  client: DbClient,
  input: Omit<Student, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Student> {
  await requireValidAdminSession(client);
  const { data, error } = await client
    .from('students')
    .insert({
      class_id: input.classId,
      student_number: input.studentNumber,
      full_name: input.fullName.trim(),
      admission_number: input.admissionNumber?.trim() || null,
      active: input.active
    })
    .select('id, class_id, student_number, full_name, admission_number, active, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(formatSupabaseError(error, 'Failed to save new student to database.'));
  }

  return mapStudentRow(data as DbStudentRow);
}

export async function createStudentsBulkInSupabase(
  client: DbClient,
  inputs: Array<Omit<Student, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Student[]> {
  await requireValidAdminSession(client);
  if (inputs.length === 0) return [];

  const rows = inputs.map((input) => ({
    class_id: input.classId,
    student_number: input.studentNumber,
    full_name: input.fullName.trim(),
    admission_number: input.admissionNumber?.trim() || null,
    active: input.active
  }));

  const { data, error } = await client
    .from('students')
    .insert(rows)
    .select('id, class_id, student_number, full_name, admission_number, active, created_at, updated_at');

  if (error || !data) {
    throw new Error(formatSupabaseError(error, 'Failed to enroll extracted students in database.'));
  }

  return (data as DbStudentRow[]).map(mapStudentRow);
}

export async function updateStudentInSupabase(
  client: DbClient,
  student: Student
): Promise<Student> {
  await requireValidAdminSession(client);
  const { data, error } = await client
    .from('students')
    .update({
      class_id: student.classId,
      student_number: student.studentNumber,
      full_name: student.fullName.trim(),
      admission_number: student.admissionNumber?.trim() || null,
      active: student.active
    })
    .eq('id', student.id)
    .select('id, class_id, student_number, full_name, admission_number, active, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(formatSupabaseError(error, 'Failed to update student record in database.'));
  }

  return mapStudentRow(data as DbStudentRow);
}

export async function toggleStudentActiveInSupabase(
  client: DbClient,
  studentId: string,
  nextActive: boolean
): Promise<Student> {
  await requireValidAdminSession(client);
  const { data, error } = await client
    .from('students')
    .update({ active: nextActive })
    .eq('id', studentId)
    .select('id, class_id, student_number, full_name, admission_number, active, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(formatSupabaseError(error, 'Failed to update student active status.'));
  }

  return mapStudentRow(data as DbStudentRow);
}

export interface ConfirmAttendanceRpcParams {
  draft: AttendanceSessionDraft;
  sessionSummary: AttendanceSession;
  classId: string;
  selectedDate: string;
  modelUsed: string;
}

/**
 * Atomically saves attendance_sessions + attendance_records via PostgreSQL RPC transaction.
 * Rejects duplicate drafts (`source_draft_id`) and preserves client draft on any failure.
 */
export async function confirmAttendanceSessionInSupabase(
  client: DbClient,
  params: ConfirmAttendanceRpcParams
): Promise<AttendanceSession> {
  await requireValidAdminSession(client);
  const { draft, sessionSummary, classId, selectedDate, modelUsed } = params;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(classId);
  if (!isUuid) {
    throw new Error(
      'Selected class does not have a valid database UUID yet. Migrate local classes/students to Supabase first in Settings.'
    );
  }

  // Detect unresolved duplicate student+week+day keys before hitting unique index
  const seenKeys = new Set<string>();
  for (const cell of draft.cells) {
    if (cell.studentId) {
      const dedupeKey = `${cell.studentId}::${cell.weekIdentifier}::${cell.dayOfWeek}`;
      if (seenKeys.has(dedupeKey)) {
        throw new Error(
          `Duplicate attendance entries remain for Row #${cell.rowNumber} (${cell.weekIdentifier} ${cell.dayOfWeek}). Resolve duplicates before saving.`
        );
      }
      seenKeys.add(dedupeKey);
    }
  }

  const normalizedSourceType =
    modelUsed.toLowerCase().includes('cloud vision')
      ? 'google-cloud-vision'
      : modelUsed.toLowerCase().includes('validation')
      ? 'validation-sample'
      : 'gemini-vision';

  const recordsPayload = draft.cells.map((cell) => ({
    student_id: cell.studentId && /^[0-9a-f-]{36}$/i.test(cell.studentId) ? cell.studentId : null,
    row_number: cell.rowNumber,
    week_identifier: cell.weekIdentifier,
    day_of_week: cell.dayOfWeek,
    status: cell.status,
    original_ai_status: cell.originalAiStatus,
    reviewed: cell.reviewedByAdmin,
    was_corrected: Boolean(cell.correctionHistory && cell.correctionHistory.length > 0)
  }));

  const hasUnresolved =
    sessionSummary.reviewStatus === 'Flagged' ||
    draft.cells.some((c) => c.status === 'UNCERTAIN' || !c.studentId);

  const { data, error } = await client.rpc('confirm_attendance_session', {
    p_class_id: classId,
    p_attendance_date: /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : null,
    p_attendance_period: draft.attendancePeriod,
    p_source_type: normalizedSourceType,
    p_status: hasUnresolved ? 'FLAGGED' : 'CONFIRMED',
    p_source_draft_id: draft.id,
    p_notes: sessionSummary.notes || null,
    p_records: recordsPayload
  });

  if (error || !data) {
    throw new Error(
      formatSupabaseError(
        error,
        'Failed to save confirmed attendance session to Supabase. Your review draft has been preserved.'
      )
    );
  }

  const savedRow = data as { id: string; confirmed_at?: string | null; status: string };

  return {
    ...sessionSummary,
    id: savedRow.id,
    classId,
    sourceDraftId: draft.id,
    persistenceTarget: 'supabase',
    verifiedBy: `${sessionSummary.recordedBy} (Verified & Saved to Supabase)`
  };
}

function mapDbSessionStatus(status: string): ReviewStatus {
  if (status === 'CONFIRMED') return 'Confirmed';
  if (status === 'DRAFT') return 'Draft';
  if (status === 'FLAGGED') return 'Flagged';
  if (status === 'FAILED') return 'Failed';
  return 'Pending Review';
}

function mapJoinedSessionRow(row: DbAttendanceSessionJoinedRow): AttendanceSession {
  const records = row.attendance_records || [];

  const studentBuckets = new Map<
    string,
    {
      studentId: string;
      rollNumber: number;
      studentName: string;
      present: number;
      absent: number;
      blank: number;
      uncertain: number;
    }
  >();

  let blankCount = 0;
  let uncertainCount = 0;
  let unmappedCount = 0;

  const detailedRecords: SessionAttendanceRecord[] = [];

  records.forEach((rec, idx) => {
    if (rec.status === 'BLANK') blankCount += 1;
    else if (rec.status === 'UNCERTAIN') uncertainCount += 1;
    if (!rec.student_id) unmappedCount += 1;

    const studentName = rec.students?.full_name || `Unmapped Row #${rec.row_number || idx + 1}`;
    const rollNumber = rec.students?.student_number || rec.row_number || idx + 1;

    if (rec.week_identifier && rec.day_of_week) {
      detailedRecords.push({
        id: rec.id,
        studentId: rec.student_id,
        rowNumber: rec.row_number,
        studentName,
        weekIdentifier: rec.week_identifier,
        dayOfWeek: rec.day_of_week,
        status: rec.status,
        originalAiStatus: rec.original_ai_status,
        reviewed: rec.reviewed
      });
    }

    const bucketKey = rec.student_id || `row-${rec.row_number ?? idx}`;
    const existing = studentBuckets.get(bucketKey) || {
      studentId: rec.student_id || bucketKey,
      rollNumber,
      studentName,
      present: 0,
      absent: 0,
      blank: 0,
      uncertain: 0
    };

    if (rec.status === 'PRESENT') existing.present += 1;
    else if (rec.status === 'ABSENT') existing.absent += 1;
    else if (rec.status === 'BLANK') existing.blank += 1;
    else existing.uncertain += 1;

    studentBuckets.set(bucketKey, existing);
  });

  const entries: SessionStudentEntry[] = Array.from(studentBuckets.values())
    .sort((a, b) => a.rollNumber - b.rollNumber)
    .map((b) => {
      let entryStatus: SessionStudentEntry['status'] = 'Excused';
      if (b.present > 0 && b.present >= b.absent) entryStatus = 'Present';
      else if (b.absent > b.present) entryStatus = 'Absent';

      return {
        studentId: b.studentId,
        rollNumber: b.rollNumber,
        studentName: b.studentName,
        status: entryStatus,
        presentMarks: b.present,
        absentMarks: b.absent,
        blankMarks: b.blank,
        uncertainMarks: b.uncertain,
        remarks: `${b.present} Present, ${b.absent} Absent, ${b.blank} Blank, ${b.uncertain} Uncertain`
      };
    });

  const presentCount = records.filter((r) => r.status === 'PRESENT').length;
  const absentCount = records.filter((r) => r.status === 'ABSENT').length;

  return {
    id: row.id,
    classId: row.class_id,
    date: row.attendance_date || row.created_at.slice(0, 10),
    classGrade: row.classes?.name || 'Class',
    term: 'First Term',
    sessionYear: row.attendance_period,
    totalEnrolled: studentBuckets.size,
    presentCount,
    absentCount,
    blankCount,
    uncertainCount,
    unmappedCount,
    reviewStatus: mapDbSessionStatus(row.status),
    recordedBy: row.profiles?.display_name || 'School Staff',
    verifiedBy: row.confirmed_at ? 'Confirmed in Supabase PostgreSQL' : undefined,
    notes: row.notes || undefined,
    sourceDraftId: row.source_draft_id || undefined,
    persistenceTarget: 'supabase',
    entries,
    records: detailedRecords
  };
}

/**
 * Retrieves recent attendance sessions (capped at 25) for Dashboard summary & initial view.
 */
export async function fetchConfirmedSessionsFromSupabase(
  client: DbClient
): Promise<AttendanceSession[]> {
  const { data, error } = await client
    .from('attendance_sessions')
    .select(`
      id,
      class_id,
      attendance_date,
      attendance_period,
      source_type,
      status,
      source_draft_id,
      notes,
      created_by,
      created_at,
      confirmed_at,
      classes ( name ),
      profiles ( display_name ),
      attendance_records (
        id,
        attendance_session_id,
        student_id,
        row_number,
        week_identifier,
        day_of_week,
        status,
        original_ai_status,
        reviewed,
        corrected_at,
        students ( id, full_name, student_number )
      )
    `)
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to retrieve saved attendance sessions.'));
  }

  return ((data || []) as unknown as DbAttendanceSessionJoinedRow[]).map(mapJoinedSessionRow);
}

export interface ScopedSessionQueryParams {
  classId?: string;
  startDate?: string;
  endDate?: string;
  status?: 'All' | ReviewStatus;
  limit?: number;
}

/**
 * Queries only matching attendance session summaries (scoped by class, date range, and status)
 * without eagerly downloading every student row across the entire database.
 */
export async function fetchAttendanceSessionsFiltered(
  client: DbClient,
  params: ScopedSessionQueryParams
): Promise<AttendanceSession[]> {
  let query = client
    .from('attendance_sessions')
    .select(`
      id,
      class_id,
      attendance_date,
      attendance_period,
      source_type,
      status,
      source_draft_id,
      notes,
      created_by,
      created_at,
      confirmed_at,
      classes ( name ),
      profiles ( display_name ),
      attendance_records ( id, student_id, status )
    `);

  if (params.classId && params.classId !== 'All') {
    query = query.eq('class_id', params.classId);
  }
  if (params.startDate) {
    query = query.gte('attendance_date', params.startDate);
  }
  if (params.endDate) {
    query = query.lte('attendance_date', params.endDate);
  }
  if (params.status && params.status !== 'All') {
    const dbStatus =
      params.status === 'Confirmed'
        ? 'CONFIRMED'
        : params.status === 'Flagged'
        ? 'FLAGGED'
        : params.status === 'Draft' || params.status === 'Pending Review'
        ? 'DRAFT'
        : params.status;
    query = query.eq('status', dbStatus);
  }

  const { data, error } = await query
    .order('attendance_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 50);

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to load filtered attendance history.'));
  }

  return ((data || []) as unknown as DbAttendanceSessionJoinedRow[]).map((row) => {
    const recs = row.attendance_records || [];
    const distinctStudents = new Set(recs.map((r) => r.student_id || r.id));
    return {
      id: row.id,
      classId: row.class_id,
      date: row.attendance_date || row.created_at.slice(0, 10),
      classGrade: row.classes?.name || 'Class',
      term: 'First Term',
      sessionYear: row.attendance_period,
      totalEnrolled: distinctStudents.size,
      presentCount: recs.filter((r) => r.status === 'PRESENT').length,
      absentCount: recs.filter((r) => r.status === 'ABSENT').length,
      blankCount: recs.filter((r) => r.status === 'BLANK').length,
      uncertainCount: recs.filter((r) => r.status === 'UNCERTAIN').length,
      unmappedCount: recs.filter((r) => !r.student_id).length,
      reviewStatus: mapDbSessionStatus(row.status),
      recordedBy: row.profiles?.display_name || 'School Staff',
      verifiedBy: row.confirmed_at ? 'Confirmed in Supabase PostgreSQL' : undefined,
      notes: row.notes || undefined,
      sourceDraftId: row.source_draft_id || undefined,
      persistenceTarget: 'supabase'
    };
  });
}

/**
 * Loads full individual student & cell records ONLY for the single session opened by the administrator.
 */
export async function fetchSessionDetailFromSupabase(
  client: DbClient,
  sessionId: string
): Promise<AttendanceSession> {
  const { data, error } = await client
    .from('attendance_sessions')
    .select(`
      id,
      class_id,
      attendance_date,
      attendance_period,
      source_type,
      status,
      source_draft_id,
      notes,
      created_by,
      created_at,
      confirmed_at,
      classes ( name ),
      profiles ( display_name ),
      attendance_records (
        id,
        attendance_session_id,
        student_id,
        row_number,
        week_identifier,
        day_of_week,
        status,
        original_ai_status,
        reviewed,
        corrected_at,
        students ( id, full_name, student_number )
      )
    `)
    .eq('id', sessionId)
    .single();

  if (error || !data) {
    throw new Error(formatSupabaseError(error, 'Failed to open session details from database.'));
  }

  return mapJoinedSessionRow(data as unknown as DbAttendanceSessionJoinedRow);
}

/**
 * Promotes a Draft/Flagged session in Supabase to Confirmed status.
 */
export async function confirmExistingSessionInSupabase(
  client: DbClient,
  sessionId: string
): Promise<void> {
  await requireValidAdminSession(client);
  const { error } = await client
    .from('attendance_sessions')
    .update({
      status: 'CONFIRMED',
      confirmed_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to confirm session in Supabase.'));
  }
}

/**
 * Deletes a single attendance session (and cascades to its attendance_records) in Supabase.
 */
export async function deleteAttendanceSessionInSupabase(
  client: DbClient,
  sessionId: string
): Promise<void> {
  await requireValidAdminSession(client);
  const { error } = await client
    .from('attendance_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to delete attendance session from database.'));
  }
}

/**
 * Deletes all saved attendance sessions (and cascades to all attendance_records) in Supabase.
 * Enrolled classes and students are preserved untouched.
 */
export async function deleteAllAttendanceSessionsInSupabase(
  client: DbClient
): Promise<void> {
  await requireValidAdminSession(client);
  const { error } = await client
    .from('attendance_sessions')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to delete all saved attendance records from database.'));
  }
}

/**
 * Queries ONLY confirmed sessions, scoped students, and matching attendance_records
 * for the requested class and date range.
 */
export async function fetchAttendanceReportFromSupabase(
  client: DbClient,
  params: {
    classId: string;
    startDate: string;
    endDate: string;
    classes: ClassItem[];
  }
): Promise<AttendanceReportResult> {
  const { classId, startDate, endDate, classes } = params;

  // 1. Scoped query for CONFIRMED sessions only
  let sessionQuery = client
    .from('attendance_sessions')
    .select(`
      id,
      class_id,
      attendance_date,
      attendance_period,
      source_type,
      status,
      source_draft_id,
      notes,
      created_by,
      created_at,
      confirmed_at,
      classes ( name ),
      profiles ( display_name )
    `)
    .eq('status', 'CONFIRMED');

  if (classId && classId !== 'All') {
    sessionQuery = sessionQuery.eq('class_id', classId);
  }
  if (startDate) {
    sessionQuery = sessionQuery.gte('attendance_date', startDate);
  }
  if (endDate) {
    sessionQuery = sessionQuery.lte('attendance_date', endDate);
  }

  const { data: confirmedRows, error: sessionErr } = await sessionQuery.order('attendance_date', {
    ascending: false
  });
  if (sessionErr) {
    throw new Error(formatSupabaseError(sessionErr, 'Failed to load confirmed sessions for report.'));
  }

  // 2. Scoped lightweight count of unconfirmed (draft/flagged) sessions in the same filter
  let unconfirmedQuery = client
    .from('attendance_sessions')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'CONFIRMED');

  if (classId && classId !== 'All') {
    unconfirmedQuery = unconfirmedQuery.eq('class_id', classId);
  }
  if (startDate) {
    unconfirmedQuery = unconfirmedQuery.gte('attendance_date', startDate);
  }
  if (endDate) {
    unconfirmedQuery = unconfirmedQuery.lte('attendance_date', endDate);
  }

  const { count: excludedUnconfirmedCount, error: countErr } = await unconfirmedQuery;
  if (countErr) {
    throw new Error(formatSupabaseError(countErr, 'Failed to verify unconfirmed session count.'));
  }

  // 3. Scoped students query (only selected class when specified)
  let studentsQuery = client
    .from('students')
    .select('id, class_id, student_number, full_name, admission_number, active, created_at, updated_at')
    .order('student_number', { ascending: true });

  if (classId && classId !== 'All') {
    studentsQuery = studentsQuery.eq('class_id', classId);
  }

  const { data: studentRows, error: studentErr } = await studentsQuery;
  if (studentErr) {
    throw new Error(formatSupabaseError(studentErr, 'Failed to load class students for report.'));
  }
  const scopedStudents = ((studentRows || []) as DbStudentRow[]).map(mapStudentRow);

  // 4. Fetch attendance_records ONLY for the matched confirmed sessions
  const sessionList = (confirmedRows || []) as unknown as DbAttendanceSessionJoinedRow[];
  const sessionIds = sessionList.map((s) => s.id);

  let recordsBySession = new Map<string, DbAttendanceRecordJoinedRow[]>();
  if (sessionIds.length > 0) {
    const { data: recRows, error: recErr } = await client
      .from('attendance_records')
      .select(`
        id,
        attendance_session_id,
        student_id,
        row_number,
        week_identifier,
        day_of_week,
        status,
        original_ai_status,
        reviewed,
        corrected_at,
        students ( id, full_name, student_number )
      `)
      .in('attendance_session_id', sessionIds);

    if (recErr) {
      throw new Error(formatSupabaseError(recErr, 'Failed to load attendance records for report.'));
    }

    recordsBySession = new Map<string, DbAttendanceRecordJoinedRow[]>();
    ((recRows || []) as unknown as DbAttendanceRecordJoinedRow[]).forEach((rec) => {
      const list = recordsBySession.get(rec.attendance_session_id) || [];
      list.push(rec);
      recordsBySession.set(rec.attendance_session_id, list);
    });
  }

  const hydratedConfirmedSessions = sessionList.map((row) =>
    mapJoinedSessionRow({
      ...row,
      attendance_records: recordsBySession.get(row.id) || []
    })
  );

  return computeStudentAttendanceReport({
    sessions: hydratedConfirmedSessions,
    students: scopedStudents,
    classes,
    classId,
    startDate,
    endDate,
    preExcludedUnconfirmedCount: excludedUnconfirmedCount ?? 0
  });
}

/**
 * Checks Supabase for existing non-failed sessions matching the same class and date
 * so administrators are warned before saving duplicate registers.
 */
export async function checkDuplicateSessionsInSupabase(
  client: DbClient,
  params: {
    classId: string;
    attendanceDate: string;
    sourceDraftId?: string;
  }
): Promise<AttendanceSession[]> {
  const { classId, attendanceDate, sourceDraftId } = params;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(classId);
  if (!isUuid || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
    return [];
  }

  const { data, error } = await client
    .from('attendance_sessions')
    .select(`
      id,
      class_id,
      attendance_date,
      attendance_period,
      source_type,
      status,
      source_draft_id,
      notes,
      created_by,
      created_at,
      confirmed_at,
      classes ( name ),
      profiles ( display_name ),
      attendance_records (
        id,
        attendance_session_id,
        student_id,
        row_number,
        week_identifier,
        day_of_week,
        status,
        original_ai_status,
        reviewed,
        corrected_at,
        students ( id, full_name, student_number )
      )
    `)
    .eq('class_id', classId)
    .eq('attendance_date', attendanceDate)
    .neq('status', 'FAILED')
    .limit(10);

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to check for existing duplicate sessions.'));
  }

  return ((data || []) as unknown as DbAttendanceSessionJoinedRow[])
    .filter((row) => !sourceDraftId || row.source_draft_id !== sourceDraftId)
    .map(mapJoinedSessionRow);
}

/**
 * Queries full cell-level attendance records scoped strictly to active filter criteria for CSV export.
 * Excludes Failed sessions and caps at 150 sessions to prevent unbounded memory reads.
 */
export async function fetchScopedSessionsForCsvExport(
  client: DbClient,
  params: ScopedSessionQueryParams & { confirmedOnly?: boolean }
): Promise<AttendanceSession[]> {
  let query = client
    .from('attendance_sessions')
    .select(`
      id,
      class_id,
      attendance_date,
      attendance_period,
      source_type,
      status,
      source_draft_id,
      notes,
      created_by,
      created_at,
      confirmed_at,
      classes ( name ),
      profiles ( display_name )
    `)
    .neq('status', 'FAILED');

  if (params.confirmedOnly) {
    query = query.eq('status', 'CONFIRMED');
  } else if (params.status && params.status !== 'All') {
    const dbStatus =
      params.status === 'Confirmed'
        ? 'CONFIRMED'
        : params.status === 'Flagged'
        ? 'FLAGGED'
        : params.status === 'Draft' || params.status === 'Pending Review'
        ? 'DRAFT'
        : params.status;
    query = query.eq('status', dbStatus);
  }

  if (params.classId && params.classId !== 'All') {
    query = query.eq('class_id', params.classId);
  }
  if (params.startDate) {
    query = query.gte('attendance_date', params.startDate);
  }
  if (params.endDate) {
    query = query.lte('attendance_date', params.endDate);
  }

  const { data: sessionRows, error: sessionErr } = await query
    .order('attendance_date', { ascending: false })
    .limit(params.limit ?? 150);

  if (sessionErr) {
    throw new Error(formatSupabaseError(sessionErr, 'Failed to load attendance sessions for CSV export.'));
  }

  const sessions = (sessionRows || []) as unknown as DbAttendanceSessionJoinedRow[];
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) return [];

  const { data: recRows, error: recErr } = await client
    .from('attendance_records')
    .select(`
      id,
      attendance_session_id,
      student_id,
      row_number,
      week_identifier,
      day_of_week,
      status,
      original_ai_status,
      reviewed,
      corrected_at,
      students ( id, full_name, student_number )
    `)
    .in('attendance_session_id', sessionIds);

  if (recErr) {
    throw new Error(formatSupabaseError(recErr, 'Failed to load cell records for CSV export.'));
  }

  const recordsBySession = new Map<string, DbAttendanceRecordJoinedRow[]>();
  ((recRows || []) as unknown as DbAttendanceRecordJoinedRow[]).forEach((rec) => {
    const list = recordsBySession.get(rec.attendance_session_id) || [];
    list.push(rec);
    recordsBySession.set(rec.attendance_session_id, list);
  });

  return sessions.map((row) =>
    mapJoinedSessionRow({
      ...row,
      attendance_records: recordsBySession.get(row.id) || []
    })
  );
}

export interface SeedMigrationResult {
  classesCreated: number;
  classesSkipped: number;
  studentsCreated: number;
  studentsSkipped: number;
}

/**
 * Safely seeds local browser demonstration/custom classes & students into Supabase
 * without discarding or overwriting existing records.
 */
export async function seedLocalDemoRosterToSupabase(
  client: DbClient,
  localClasses: ClassItem[],
  localStudents: Student[]
): Promise<SeedMigrationResult> {
  const existingClasses = await fetchClassesFromSupabase(client);
  const classNameToRemoteId = new Map<string, string>();
  const localIdToRemoteId = new Map<string, string>();

  existingClasses.forEach((c) => {
    classNameToRemoteId.set(c.name.trim().toLowerCase(), c.id);
    localIdToRemoteId.set(c.id, c.id);
  });

  let classesCreated = 0;
  let classesSkipped = 0;

  for (const localCls of localClasses) {
    const key = localCls.name.trim().toLowerCase();
    const existingRemoteId = classNameToRemoteId.get(key);
    if (existingRemoteId) {
      localIdToRemoteId.set(localCls.id, existingRemoteId);
      classesSkipped += 1;
    } else {
      const created = await createClassInSupabase(client, {
        name: localCls.name,
        classTeacher: localCls.classTeacher,
        notes: localCls.notes
      });
      classNameToRemoteId.set(key, created.id);
      localIdToRemoteId.set(localCls.id, created.id);
      classesCreated += 1;
    }
  }

  const existingStudents = await fetchStudentsFromSupabase(client);
  const existingAdmissionNumbers = new Set(
    existingStudents
      .map((s) => s.admissionNumber?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v))
  );
  const existingRollKeys = new Set(
    existingStudents.map((s) => `${s.classId}::${s.studentNumber}`)
  );

  let studentsCreated = 0;
  let studentsSkipped = 0;

  for (const localStudent of localStudents) {
    const targetClassId = localIdToRemoteId.get(localStudent.classId);
    if (!targetClassId) {
      studentsSkipped += 1;
      continue;
    }

    const admKey = localStudent.admissionNumber?.trim().toLowerCase();
    const rollKey = `${targetClassId}::${localStudent.studentNumber}`;

    if ((admKey && existingAdmissionNumbers.has(admKey)) || existingRollKeys.has(rollKey)) {
      studentsSkipped += 1;
      continue;
    }

    await createStudentInSupabase(client, {
      classId: targetClassId,
      studentNumber: localStudent.studentNumber,
      fullName: localStudent.fullName,
      admissionNumber: localStudent.admissionNumber,
      active: localStudent.active
    });

    if (admKey) existingAdmissionNumbers.add(admKey);
    existingRollKeys.add(rollKey);
    studentsCreated += 1;
  }

  return {
    classesCreated,
    classesSkipped,
    studentsCreated,
    studentsSkipped
  };
}
