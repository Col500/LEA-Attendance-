import { AttendanceSession, ClassItem, Student } from '../types/attendance';

/**
 * Built-in demonstration/sample session IDs from mockData.ts.
 * These MUST never be included in official school attendance CSV exports.
 */
export const MOCK_SAMPLE_SESSION_IDS = new Set<string>([
  'ses-2026-10-09-p4a',
  'ses-2026-10-09-p2b',
  'ses-2026-10-09-p3a',
  'ses-2026-10-08-p5b',
  'ses-2026-10-08-p6a',
  'ses-2026-10-07-p1a',
  'ses-2026-10-07-p4b',
  'ses-2026-10-06-p2a'
]);

/**
 * Strictly approved columns for CSV export.
 * Explicitly excludes unrelated PII (admission numbers, emails, phone numbers, internal UUIDs).
 */
export const ATTENDANCE_CSV_HEADERS = [
  'Class',
  'Student Number',
  'Student Name',
  'Attendance Date or Period',
  'Week',
  'Weekday',
  'Attendance Status',
  'Reviewed'
] as const;

const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralizes spreadsheet formula injection (OWASP CSV Injection mitigation)
 * and applies RFC-4180 CSV escaping.
 */
export function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';

  let str = String(value);

  // Neutralize formula triggers both at index 0 and after leading whitespace
  const trimmedStart = str.trimStart();
  if (
    str.length > 0 &&
    (FORMULA_TRIGGER_CHARS.has(str[0]) ||
      (trimmedStart.length > 0 && FORMULA_TRIGGER_CHARS.has(trimmedStart[0])))
  ) {
    str = `'${str}`;
  }

  // RFC-4180 quoting if cell contains quotes, commas, CR/LF, or outer spaces
  if (/[",\r\n]/.test(str) || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function formatCsvRow(
  cells: ReadonlyArray<string | number | boolean | null | undefined>
): string {
  return cells.map((cell) => sanitizeCsvCell(cell)).join(',');
}

/**
 * Returns true if a session represents built-in demonstration/mock sample data
 * or a failed save attempt that must never appear in official school exports.
 */
export function isMockSampleSession(session: AttendanceSession): boolean {
  if (MOCK_SAMPLE_SESSION_IDS.has(session.id)) {
    return true;
  }
  return false;
}

export function isOfficialExportableSession(
  session: AttendanceSession,
  options?: { confirmedOnly?: boolean }
): boolean {
  if (isMockSampleSession(session)) return false;
  if (session.reviewStatus === 'Failed') return false;
  if (options?.confirmedOnly && session.reviewStatus !== 'Confirmed') return false;
  return true;
}

export interface BuildAttendanceCsvOptions {
  sessions: AttendanceSession[];
  classes?: ClassItem[];
  students?: Student[];
  canWrite: boolean;
  confirmedOnly?: boolean;
}

export interface BuildAttendanceCsvResult {
  csvContent: string;
  rowCount: number;
  exportedSessionCount: number;
  excludedMockCount: number;
  excludedUnconfirmedCount: number;
}

/**
 * Builds an RFC-4180 + formula-safe CSV string from filtered attendance sessions.
 * Enforces:
 * 1) Admin authorization (`canWrite === true`)
 * 2) Exclusion of built-in mock sample records & Failed attempts
 * 3) Strict column allowlist (no admission numbers, emails, phones, or unrelated PII)
 */
export function buildAttendanceRecordsCsv(
  options: BuildAttendanceCsvOptions
): BuildAttendanceCsvResult {
  const { sessions, classes = [], students = [], canWrite, confirmedOnly = false } = options;

  if (!canWrite) {
    throw new Error(
      'Authorization required: Only an authorized School Admin can export attendance records to CSV.'
    );
  }

  const classById = new Map<string, ClassItem>();
  classes.forEach((c) => classById.set(c.id, c));

  const studentById = new Map<string, Student>();
  students.forEach((s) => studentById.set(s.id, s));

  let excludedMockCount = 0;
  let excludedUnconfirmedCount = 0;
  const exportableSessions: AttendanceSession[] = [];

  for (const session of sessions) {
    if (isMockSampleSession(session) || session.reviewStatus === 'Failed') {
      if (isMockSampleSession(session)) excludedMockCount += 1;
      continue;
    }
    if (confirmedOnly && session.reviewStatus !== 'Confirmed') {
      excludedUnconfirmedCount += 1;
      continue;
    }
    exportableSessions.push(session);
  }

  const csvLines: string[] = [formatCsvRow(ATTENDANCE_CSV_HEADERS)];
  let rowCount = 0;

  for (const session of exportableSessions) {
    const className =
      (session.classId ? classById.get(session.classId)?.name : undefined) ||
      session.classGrade ||
      'Unknown Class';

    const dateOrPeriod =
      session.sessionYear && session.date && !session.sessionYear.includes(session.date)
        ? `${session.date} (${session.sessionYear})`
        : session.date || session.sessionYear || '';

    if (session.records && session.records.length > 0) {
      for (const rec of session.records) {
        const studentObj = rec.studentId ? studentById.get(rec.studentId) : undefined;
        const studentNumber =
          studentObj?.studentNumber ?? (rec.rowNumber !== null ? rec.rowNumber : '');

        csvLines.push(
          formatCsvRow([
            className,
            studentNumber,
            rec.studentName,
            dateOrPeriod,
            rec.weekIdentifier,
            rec.dayOfWeek,
            rec.status,
            rec.reviewed ? 'Yes' : 'No'
          ])
        );
        rowCount += 1;
      }
      continue;
    }

    if (session.entries && session.entries.length > 0) {
      const fallbackReviewed = session.reviewStatus === 'Confirmed' ? 'Yes' : 'No';
      for (const entry of session.entries) {
        const studentObj = entry.studentId ? studentById.get(entry.studentId) : undefined;
        const studentNumber = studentObj?.studentNumber ?? entry.rollNumber ?? '';

        csvLines.push(
          formatCsvRow([
            className,
            studentNumber,
            entry.studentName,
            dateOrPeriod,
            session.term || 'Session Summary',
            'All Days',
            entry.status.toUpperCase(),
            fallbackReviewed
          ])
        );
        rowCount += 1;
      }
    }
  }

  return {
    csvContent: csvLines.join('\r\n'),
    rowCount,
    exportedSessionCount: exportableSessions.length,
    excludedMockCount,
    excludedUnconfirmedCount
  };
}

export function triggerCsvDownload(csvContent: string, filename: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
