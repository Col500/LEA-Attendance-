import { AttendanceSession, ClassItem, ReviewStatus, Student } from '../types/attendance';

export interface AttendanceHistoryFilter {
  classId: string; // 'All' or class ID / class name
  startDate: string; // 'YYYY-MM-DD' or ''
  endDate: string; // 'YYYY-MM-DD' or ''
  status: 'All' | ReviewStatus;
}

export interface StudentAttendanceReportRow {
  studentId: string;
  studentNumber: number;
  studentName: string;
  classId: string;
  className: string;
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  blankCount: number;
  uncertainCount: number;
  attendancePercentage: number | null;
}

export interface AttendanceReportResult {
  confirmedSessionCount: number;
  excludedUnconfirmedCount: number;
  totalPresent: number;
  totalAbsent: number;
  totalBlank: number;
  totalUncertain: number;
  unmappedRecordCount: number;
  overallPercentage: number | null;
  studentRows: StudentAttendanceReportRow[];
}

export const ATTENDANCE_FORMULA_EXPLANATION =
  'Attendance % = Present / (Present + Absent) x 100 across Confirmed sessions only. BLANK / unrecorded marks are never counted as ABSENT, UNCERTAIN marks are excluded from definitive totals and denominators, and unconfirmed Draft, Flagged, or Failed sessions are omitted from official reports. Shown as N/A when Present + Absent = 0.';

export function isConfirmedOfficialSession(session: Pick<AttendanceSession, 'reviewStatus'>): boolean {
  return session.reviewStatus === 'Confirmed';
}

/**
 * Computes percentage where a meaningful denominator (Present + Absent > 0) exists.
 * BLANK and UNCERTAIN marks are excluded from the denominator.
 */
export function calculateAttendancePercentage(presentCount: number, absentCount: number): number | null {
  const denominator = presentCount + absentCount;
  if (denominator <= 0) {
    return null;
  }
  return Math.round((presentCount / denominator) * 1000) / 10;
}

export function resolveClassMatch(
  session: Pick<AttendanceSession, 'classId' | 'classGrade'>,
  classFilterValue: string,
  classes: ClassItem[]
): boolean {
  if (!classFilterValue || classFilterValue === 'All') return true;
  if (session.classId && session.classId === classFilterValue) return true;
  const matchedCls = classes.find(
    (c) => c.id === classFilterValue || c.name.toLowerCase() === classFilterValue.toLowerCase()
  );
  if (matchedCls) {
    return (
      session.classId === matchedCls.id ||
      session.classGrade.trim().toLowerCase() === matchedCls.name.trim().toLowerCase()
    );
  }
  return session.classGrade.trim().toLowerCase() === classFilterValue.trim().toLowerCase();
}

export function filterAttendanceSessions(
  sessions: AttendanceSession[],
  filter: AttendanceHistoryFilter,
  classes: ClassItem[]
): AttendanceSession[] {
  return sessions.filter((session) => {
    if (!resolveClassMatch(session, filter.classId, classes)) {
      return false;
    }
    if (filter.startDate && session.date < filter.startDate) {
      return false;
    }
    if (filter.endDate && session.date > filter.endDate) {
      return false;
    }
    if (filter.status !== 'All' && session.reviewStatus !== filter.status) {
      return false;
    }
    return true;
  });
}

export function computeStudentAttendanceReport(params: {
  sessions: AttendanceSession[];
  students: Student[];
  classes: ClassItem[];
  classId: string; // 'All' or class UUID / ID / name
  startDate: string;
  endDate: string;
  preExcludedUnconfirmedCount?: number;
}): AttendanceReportResult {
  const { sessions, students, classes, classId, startDate, endDate, preExcludedUnconfirmedCount } = params;

  const classNameById = new Map<string, string>();
  const classIdByName = new Map<string, string>();
  classes.forEach((c) => {
    classNameById.set(c.id, c.name);
    classIdByName.set(c.name.trim().toLowerCase(), c.id);
  });

  // Resolve selected class ID cleanly whether caller passed class ID or class name
  const selectedClassObj =
    classId === 'All'
      ? undefined
      : classes.find((c) => c.id === classId || c.name.toLowerCase() === classId.toLowerCase());
  const normalizedSelectedClassId = selectedClassObj?.id || classId;

  const inRangeSessions = sessions.filter((s) => {
    if (!resolveClassMatch(s, normalizedSelectedClassId, classes)) return false;
    if (startDate && s.date < startDate) return false;
    if (endDate && s.date > endDate) return false;
    return true;
  });

  const confirmedSessions = inRangeSessions.filter(isConfirmedOfficialSession);
  const excludedUnconfirmedCount =
    typeof preExcludedUnconfirmedCount === 'number'
      ? preExcludedUnconfirmedCount
      : inRangeSessions.length - confirmedSessions.length;

  interface MutableStudentAccumulator {
    studentId: string;
    studentNumber: number;
    studentName: string;
    classId: string;
    className: string;
    sessionIds: Set<string>;
    presentCount: number;
    absentCount: number;
    blankCount: number;
    uncertainCount: number;
  }

  const accumulators = new Map<string, MutableStudentAccumulator>();

  const ensureAccumulator = (
    id: string,
    fallback?: { studentNumber?: number; studentName?: string; classId?: string; className?: string }
  ): MutableStudentAccumulator => {
    const existing = accumulators.get(id);
    if (existing) return existing;

    const rosterStudent = students.find((s) => s.id === id);
    const resolvedClassId = rosterStudent?.classId || fallback?.classId || '';
    const resolvedClassName =
      classNameById.get(resolvedClassId) || fallback?.className || 'Assigned Class';

    const created: MutableStudentAccumulator = {
      studentId: id,
      studentNumber: rosterStudent?.studentNumber ?? fallback?.studentNumber ?? 0,
      studentName: rosterStudent?.fullName || fallback?.studentName || 'Student',
      classId: resolvedClassId,
      className: resolvedClassName,
      sessionIds: new Set<string>(),
      presentCount: 0,
      absentCount: 0,
      blankCount: 0,
      uncertainCount: 0
    };
    accumulators.set(id, created);
    return created;
  };

  // Seed roster students in scope when filtering by a specific class so unrecorded pupils are visible
  if (normalizedSelectedClassId !== 'All') {
    students
      .filter((s) => s.active && s.classId === normalizedSelectedClassId)
      .forEach((s) => {
        ensureAccumulator(s.id, {
          studentNumber: s.studentNumber,
          studentName: s.fullName,
          classId: s.classId,
          className: classNameById.get(s.classId)
        });
      });
  }

  let unmappedRecordCount = 0;
  let sessionOnlyPresent = 0;
  let sessionOnlyAbsent = 0;
  let sessionOnlyBlank = 0;
  let sessionOnlyUncertain = 0;

  for (const session of confirmedSessions) {
    const resolvedSessionClassId =
      session.classId || classIdByName.get(session.classGrade.trim().toLowerCase()) || '';
    const seenStudentIdsInSession = new Set<string>();

    if (session.records && session.records.length > 0) {
      for (const rec of session.records) {
        if (!rec.studentId) {
          unmappedRecordCount += 1;
          if (rec.status === 'UNCERTAIN') {
            sessionOnlyUncertain += 1;
          }
          continue;
        }
        const acc = ensureAccumulator(rec.studentId, {
          studentNumber: rec.rowNumber ?? 0,
          studentName: rec.studentName,
          classId: resolvedSessionClassId,
          className: session.classGrade
        });
        seenStudentIdsInSession.add(rec.studentId);
        acc.sessionIds.add(session.id);

        if (rec.status === 'PRESENT') acc.presentCount += 1;
        else if (rec.status === 'ABSENT') acc.absentCount += 1;
        else if (rec.status === 'BLANK') acc.blankCount += 1;
        else acc.uncertainCount += 1;
      }

      // Active students enrolled in this class with zero records in this confirmed session count as unrecorded (blank)
      students
        .filter((s) => s.active && resolvedSessionClassId && s.classId === resolvedSessionClassId)
        .forEach((s) => {
          const acc = ensureAccumulator(s.id);
          acc.sessionIds.add(session.id);
          if (!seenStudentIdsInSession.has(s.id)) {
            acc.blankCount += 1;
          }
        });
    } else if (session.entries && session.entries.length > 0) {
      for (const entry of session.entries) {
        const acc = ensureAccumulator(entry.studentId, {
          studentNumber: entry.rollNumber,
          studentName: entry.studentName,
          classId: resolvedSessionClassId,
          className: session.classGrade
        });
        seenStudentIdsInSession.add(entry.studentId);
        acc.sessionIds.add(session.id);

        const hasExplicitCellCounts =
          typeof entry.presentMarks === 'number' ||
          typeof entry.absentMarks === 'number' ||
          typeof entry.blankMarks === 'number' ||
          typeof entry.uncertainMarks === 'number';

        if (hasExplicitCellCounts) {
          acc.presentCount += entry.presentMarks || 0;
          acc.absentCount += entry.absentMarks || 0;
          acc.blankCount += entry.blankMarks || 0;
          acc.uncertainCount += entry.uncertainMarks || 0;
        } else {
          if (entry.status === 'Present') acc.presentCount += 1;
          else if (entry.status === 'Absent') acc.absentCount += 1;
          // 'Excused' is intentionally excluded from definitive Present/Absent counts
        }
      }

      students
        .filter((s) => s.active && resolvedSessionClassId && s.classId === resolvedSessionClassId)
        .forEach((s) => {
          const acc = ensureAccumulator(s.id);
          acc.sessionIds.add(session.id);
          if (!seenStudentIdsInSession.has(s.id)) {
            acc.blankCount += 1;
          }
        });
    } else {
      // Session-level summary only (legacy demonstration session without per-student entries)
      sessionOnlyPresent += session.presentCount || 0;
      sessionOnlyAbsent += session.absentCount || 0;
      sessionOnlyBlank += session.blankCount || 0;
      sessionOnlyUncertain += session.uncertainCount || 0;
    }
  }

  const studentRows: StudentAttendanceReportRow[] = Array.from(accumulators.values())
    .sort((a, b) => {
      const clsCmp = a.className.localeCompare(b.className);
      if (clsCmp !== 0) return clsCmp;
      if (a.studentNumber !== b.studentNumber) return a.studentNumber - b.studentNumber;
      return a.studentName.localeCompare(b.studentName);
    })
    .map((acc) => ({
      studentId: acc.studentId,
      studentNumber: acc.studentNumber,
      studentName: acc.studentName,
      classId: acc.classId,
      className: acc.className,
      totalSessions: acc.sessionIds.size,
      presentCount: acc.presentCount,
      absentCount: acc.absentCount,
      blankCount: acc.blankCount,
      uncertainCount: acc.uncertainCount,
      attendancePercentage: calculateAttendancePercentage(acc.presentCount, acc.absentCount)
    }));

  const studentPresentSum = studentRows.reduce((sum, r) => sum + r.presentCount, 0);
  const studentAbsentSum = studentRows.reduce((sum, r) => sum + r.absentCount, 0);
  const studentBlankSum = studentRows.reduce((sum, r) => sum + r.blankCount, 0);
  const studentUncertainSum = studentRows.reduce((sum, r) => sum + r.uncertainCount, 0);

  const totalPresent = studentPresentSum + sessionOnlyPresent;
  const totalAbsent = studentAbsentSum + sessionOnlyAbsent;
  const totalBlank = studentBlankSum + sessionOnlyBlank;
  const totalUncertain = studentUncertainSum + sessionOnlyUncertain;

  return {
    confirmedSessionCount: confirmedSessions.length,
    excludedUnconfirmedCount,
    totalPresent,
    totalAbsent,
    totalBlank,
    totalUncertain,
    unmappedRecordCount,
    overallPercentage: calculateAttendancePercentage(totalPresent, totalAbsent),
    studentRows
  };
}
