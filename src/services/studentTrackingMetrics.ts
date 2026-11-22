import {
  AttendanceSession,
  ClassItem,
  NonSchoolGapRecord,
  Student
} from '../types/attendance';
import { calculateAttendancePercentage, resolveClassMatch } from './attendanceReports';
import { buildNonSchoolDateMap } from './schoolCalendarGaps';

export type StarredTodayStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'NON_SCHOOL_DAY'
  | 'SUMMARY_ONLY_TODAY'
  | 'NOT_SCANNED_TODAY';

export interface StarredStudentSummary {
  studentId: string;
  studentNumber: number;
  studentName: string;
  classId: string;
  className: string;
  todayStatus: StarredTodayStatus;
  todayStatusLabel: string;
  presentDays: number;
  absentDays: number;
  totalRecordedDays: number;
  attendancePercentage: number | null;
  ratioText: string; // e.g. "Present 25/50 days (50.0%)"
}

export interface StudentPunctualityRow {
  studentId: string;
  studentNumber: number;
  studentName: string;
  classId: string;
  className: string;
  presentDays: number;
  absentDays: number;
  totalRecordedDays: number;
  attendancePercentage: number | null;
}

export interface ClassPunctualityQueryResult {
  mostPunctual: StudentPunctualityRow[];
  mostAbsent: StudentPunctualityRow[];
  allRanked: StudentPunctualityRow[];
  directRegisterSessionCount: number;
  excludedSummarySessionCount: number;
  excludedNonSchoolSessionCount: number;
}

export function isDirectRegisterSession(session: AttendanceSession): boolean {
  return (session.captureMode ?? 'register') === 'register';
}

function getStudentStatusInSession(
  session: AttendanceSession,
  student: Student
): 'PRESENT' | 'ABSENT' | null {
  if (Array.isArray(session.records) && session.records.length > 0) {
    const matchedRecords = session.records.filter(
      (r) =>
        r.studentId === student.id ||
        (r.studentId === null &&
          r.rowNumber !== null &&
          r.rowNumber === student.studentNumber) ||
        r.studentName.trim().toLowerCase() === student.fullName.trim().toLowerCase()
    );
    if (matchedRecords.some((r) => r.status === 'PRESENT')) return 'PRESENT';
    if (matchedRecords.some((r) => r.status === 'ABSENT')) return 'ABSENT';
    return null;
  }

  if (Array.isArray(session.entries) && session.entries.length > 0) {
    const entry = session.entries.find(
      (e) =>
        e.studentId === student.id ||
        e.rollNumber === student.studentNumber ||
        e.studentName.trim().toLowerCase() === student.fullName.trim().toLowerCase()
    );
    if (!entry) return null;
    if (entry.status === 'Present') return 'PRESENT';
    if (entry.status === 'Absent') return 'ABSENT';
  }

  return null;
}

/**
 * Computes numeric & percentage summaries for starred pupils strictly from
 * confirmed Direct Register sessions (excluding Summary Note sessions & Non-School Days).
 */
export function computeStarredStudentSummaries(params: {
  students: Student[];
  classes: ClassItem[];
  sessions: AttendanceSession[];
  starredIds: string[];
  targetDate: string;
  nonSchoolGaps?: NonSchoolGapRecord[];
  filterClassId?: string;
}): StarredStudentSummary[] {
  const {
    students,
    classes,
    sessions,
    starredIds,
    targetDate,
    nonSchoolGaps = [],
    filterClassId
  } = params;

  if (starredIds.length === 0) return [];
  const starredSet = new Set(starredIds);
  const classNameById = new Map(classes.map((c) => [c.id, c.name]));
  const nonSchoolDateMap = buildNonSchoolDateMap(sessions, nonSchoolGaps);

  const confirmedSessions = sessions.filter((s) => s.reviewStatus === 'Confirmed');

  const trackedStudents = students.filter((st) => {
    if (!starredSet.has(st.id)) return false;
    if (filterClassId && filterClassId !== 'All' && st.classId !== filterClassId) {
      return false;
    }
    return true;
  });

  return trackedStudents.map((student) => {
    const className = classNameById.get(student.classId) || 'Unknown Class';

    // Deduplicate by date so multiple scans on the same date reflect the latest confirmed direct register scan
    const statusByDate = new Map<string, 'PRESENT' | 'ABSENT'>();
    let hasSummaryOnlyForTargetDate = false;

    const classSessions = confirmedSessions.filter((s) =>
      resolveClassMatch(s, student.classId, classes)
    );

    // Sort oldest -> newest so latest session for a given date wins
    const orderedClassSessions = [...classSessions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    for (const sess of orderedClassSessions) {
      if (sess.isNonSchoolDay || nonSchoolDateMap.has(sess.date)) {
        continue;
      }

      if (!isDirectRegisterSession(sess)) {
        if (sess.date === targetDate) {
          hasSummaryOnlyForTargetDate = true;
        }
        continue;
      }

      const stStatus = getStudentStatusInSession(sess, student);
      if (stStatus) {
        statusByDate.set(sess.date, stStatus);
      }
    }

    let presentDays = 0;
    let absentDays = 0;
    for (const val of statusByDate.values()) {
      if (val === 'PRESENT') presentDays += 1;
      else if (val === 'ABSENT') absentDays += 1;
    }

    const totalRecordedDays = presentDays + absentDays;
    const attendancePercentage = calculateAttendancePercentage(presentDays, absentDays);

    let todayStatus: StarredTodayStatus = 'NOT_SCANNED_TODAY';
    let todayStatusLabel = 'No direct register scan yet today';

    const targetStatus = statusByDate.get(targetDate);
    if (nonSchoolDateMap.has(targetDate)) {
      todayStatus = 'NON_SCHOOL_DAY';
      todayStatusLabel = `Non-school day (${nonSchoolDateMap.get(targetDate)})`;
    } else if (targetStatus === 'PRESENT') {
      todayStatus = 'PRESENT';
      todayStatusLabel = `${student.fullName} is Present today`;
    } else if (targetStatus === 'ABSENT') {
      todayStatus = 'ABSENT';
      todayStatusLabel = `${student.fullName} is Absent today`;
    } else if (hasSummaryOnlyForTargetDate) {
      todayStatus = 'SUMMARY_ONLY_TODAY';
      todayStatusLabel = 'Summary scan only today (direct register required for pupil status)';
    }

    const ratioText =
      totalRecordedDays > 0 && attendancePercentage !== null
        ? `Present ${presentDays}/${totalRecordedDays} days (${attendancePercentage.toFixed(1)}%)`
        : 'No direct register days recorded yet';

    return {
      studentId: student.id,
      studentNumber: student.studentNumber,
      studentName: student.fullName,
      classId: student.classId,
      className,
      todayStatus,
      todayStatusLabel,
      presentDays,
      absentDays,
      totalRecordedDays,
      attendancePercentage,
      ratioText
    };
  });
}

/**
 * On-demand per-student punctuality & absence rankings (Settings query).
 * Strictly uses confirmed Direct Register sessions and excludes Summary Note scans & Non-School Days.
 */
export function computeClassPunctualityRankings(params: {
  classId: string;
  students: Student[];
  classes: ClassItem[];
  sessions: AttendanceSession[];
  startDate?: string;
  endDate?: string;
  nonSchoolGaps?: NonSchoolGapRecord[];
}): ClassPunctualityQueryResult {
  const {
    classId,
    students,
    classes,
    sessions,
    startDate,
    endDate,
    nonSchoolGaps = []
  } = params;

  const classNameById = new Map(classes.map((c) => [c.id, c.name]));
  const nonSchoolDateMap = buildNonSchoolDateMap(sessions, nonSchoolGaps);

  const scopedStudents = students.filter(
    (s) => s.active && (classId === 'All' || s.classId === classId)
  );

  const confirmedInScope = sessions.filter((s) => {
    if (s.reviewStatus !== 'Confirmed') return false;
    if (classId !== 'All' && !resolveClassMatch(s, classId, classes)) return false;
    if (startDate && s.date < startDate) return false;
    if (endDate && s.date > endDate) return false;
    return true;
  });

  let directRegisterSessionCount = 0;
  let excludedSummarySessionCount = 0;
  let excludedNonSchoolSessionCount = 0;

  const directSessions: AttendanceSession[] = [];
  for (const s of confirmedInScope) {
    if (s.isNonSchoolDay || nonSchoolDateMap.has(s.date)) {
      excludedNonSchoolSessionCount += 1;
      continue;
    }
    if (!isDirectRegisterSession(s)) {
      excludedSummarySessionCount += 1;
      continue;
    }
    directRegisterSessionCount += 1;
    directSessions.push(s);
  }

  const orderedDirect = [...directSessions].sort((a, b) => a.date.localeCompare(b.date));

  const rows: StudentPunctualityRow[] = scopedStudents.map((student) => {
    const statusByDate = new Map<string, 'PRESENT' | 'ABSENT'>();
    for (const sess of orderedDirect) {
      if (!resolveClassMatch(sess, student.classId, classes)) continue;
      const st = getStudentStatusInSession(sess, student);
      if (st) statusByDate.set(sess.date, st);
    }

    let presentDays = 0;
    let absentDays = 0;
    for (const val of statusByDate.values()) {
      if (val === 'PRESENT') presentDays += 1;
      else if (val === 'ABSENT') absentDays += 1;
    }

    const totalRecordedDays = presentDays + absentDays;
    return {
      studentId: student.id,
      studentNumber: student.studentNumber,
      studentName: student.fullName,
      classId: student.classId,
      className: classNameById.get(student.classId) || 'Unknown Class',
      presentDays,
      absentDays,
      totalRecordedDays,
      attendancePercentage: calculateAttendancePercentage(presentDays, absentDays)
    };
  });

  const withData = rows.filter((r) => r.totalRecordedDays > 0);

  const mostPunctual = [...withData].sort((a, b) => {
    const pctDiff = (b.attendancePercentage ?? -1) - (a.attendancePercentage ?? -1);
    if (pctDiff !== 0) return pctDiff;
    if (b.presentDays !== a.presentDays) return b.presentDays - a.presentDays;
    return a.absentDays - b.absentDays || a.studentNumber - b.studentNumber;
  });

  const mostAbsent = [...withData]
    .filter((r) => r.absentDays > 0)
    .sort((a, b) => {
      if (b.absentDays !== a.absentDays) return b.absentDays - a.absentDays;
      const pctDiff = (a.attendancePercentage ?? 101) - (b.attendancePercentage ?? 101);
      if (pctDiff !== 0) return pctDiff;
      return a.studentNumber - b.studentNumber;
    });

  return {
    mostPunctual,
    mostAbsent,
    allRanked: mostPunctual,
    directRegisterSessionCount,
    excludedSummarySessionCount,
    excludedNonSchoolSessionCount
  };
}
