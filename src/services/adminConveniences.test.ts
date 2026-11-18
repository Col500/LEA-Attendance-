import assert from 'node:assert/strict';
import {
  ATTENDANCE_CSV_HEADERS,
  buildAttendanceRecordsCsv,
  isMockSampleSession,
  sanitizeCsvCell
} from './attendanceExport';
import { findPotentialDuplicateSessions } from './duplicateSession';
import { isNetworkOrOfflineError } from '../hooks/useOnlineStatus';
import type { AttendanceSession, ClassItem, Student } from '../types/attendance';
import {
  checkDuplicateSessionsInSupabase,
  fetchScopedSessionsForCsvExport,
  type DbClient
} from './supabaseAttendanceService';

function runCsvExportTests() {
  console.log('Running Admin Conveniences Tests (CSV Export, Duplicate Protection, Offline Error Handling)...\n');

  // 1. Formula Injection & RFC-4180 Escaping
  assert.equal(sanitizeCsvCell('=SUM(A1:A5)'), `'=SUM(A1:A5)`);
  assert.equal(sanitizeCsvCell('+cmd|"/C calc"!A0'), `"' +cmd|\"\"/C calc\"\"!A0"`.replace(' ', ''));
  assert.equal(sanitizeCsvCell('-1+1'), `'-1+1`);
  assert.equal(sanitizeCsvCell('@SUM(1,2)'), `"'\@SUM(1,2)"`.replace('\\', ''));
  assert.equal(sanitizeCsvCell('  =HYPERLINK("http://bad")'), `"'  =HYPERLINK(""http://bad"")"`);
  assert.equal(sanitizeCsvCell('\t=1+1'), `'\t=1+1`);
  assert.equal(sanitizeCsvCell('Aliyu, "Sani" Jr.'), `"Aliyu, ""Sani"" Jr."`);
  console.log('✓ Test 1 passed: RFC-4180 CSV escaping and OWASP formula injection neutralization');

  // 2. Column Allowlist, Strict PII Exclusion, Mock Exclusion & RBAC Check
  const classes: ClassItem[] = [
    { id: 'cls-p4a', name: 'Primary 4A', createdAt: '2026-09-01T00:00:00Z' }
  ];

  const students: Student[] = [
    {
      id: 'stu-1',
      classId: 'cls-p4a',
      studentNumber: 1,
      fullName: '=HYPERLINK("http://evil.example","Abubakar")',
      admissionNumber: 'LEA/CONFIDENTIAL/99881',
      active: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z'
    }
  ];

  const realConfirmedSession: AttendanceSession = {
    id: 'real-ses-101',
    classId: 'cls-p4a',
    classGrade: 'Primary 4A',
    date: '2026-10-12',
    term: 'First Term',
    sessionYear: 'Week 2',
    totalEnrolled: 1,
    presentCount: 1,
    absentCount: 0,
    reviewStatus: 'Confirmed',
    recordedBy: 'Admin',
    persistenceTarget: 'supabase',
    records: [
      {
        id: 'rec-1',
        studentId: 'stu-1',
        rowNumber: 1,
        studentName: '=HYPERLINK("http://evil.example","Abubakar")',
        weekIdentifier: 'Week 2',
        dayOfWeek: 'Monday',
        status: 'PRESENT',
        reviewed: true
      }
    ]
  };

  const draftSession: AttendanceSession = {
    ...realConfirmedSession,
    id: 'real-ses-draft',
    reviewStatus: 'Draft'
  };

  // Non-admin must be rejected
  assert.throws(() => {
    buildAttendanceRecordsCsv({
      sessions: [realConfirmedSession],
      classes,
      students,
      canWrite: false
    });
  }, /Only an authorized School Admin/);

  const mockSampleSessions: AttendanceSession[] = [
    {
      ...realConfirmedSession,
      id: 'ses-2026-10-09-p4a',
      persistenceTarget: 'local-demo'
    },
    {
      ...realConfirmedSession,
      id: 'ses-2026-10-09-p2b',
      persistenceTarget: 'local-demo'
    }
  ];

  // Official export combines real + mock + draft -> excludes mock and draft when confirmedOnly=true
  const exportRes = buildAttendanceRecordsCsv({
    sessions: [mockSampleSessions[0], mockSampleSessions[1], draftSession, realConfirmedSession],
    classes,
    students,
    canWrite: true,
    confirmedOnly: true
  });

  assert.equal(exportRes.excludedMockCount, 2, 'Mock sample sessions must be excluded');
  assert.equal(exportRes.excludedUnconfirmedCount, 1, 'Draft session excluded when confirmedOnly=true');
  assert.equal(exportRes.exportedSessionCount, 1);
  assert.equal(exportRes.rowCount, 1);

  const lines = exportRes.csvContent.split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], ATTENDANCE_CSV_HEADERS.join(','));
  assert.ok(!exportRes.csvContent.includes('LEA/CONFIDENTIAL/99881'), 'Admission number PII must never be exported');
  assert.ok(lines[1].startsWith('Primary 4A,1,"\'=HYPERLINK'), 'Formula prefix must neutralize cell');
  assert.ok(lines[1].endsWith(',2026-10-12 (Week 2),Week 2,Monday,PRESENT,Yes'));

  // Confirm all built-in mock IDs are identified as mock
  assert.ok(mockSampleSessions.every((s) => isMockSampleSession(s)));
  console.log('✓ Test 2 passed: RBAC export guard, strict PII omission, and built-in mock exclusion');
}

function runDuplicateProtectionTests() {
  const existing: AttendanceSession[] = [
    {
      id: 'ses-existing-confirmed',
      classId: 'cls-p4a',
      classGrade: 'Primary 4A',
      date: '2026-10-12',
      term: 'First Term',
      sessionYear: '2026-10-12 (morning)',
      totalEnrolled: 30,
      presentCount: 28,
      absentCount: 2,
      reviewStatus: 'Confirmed',
      sourceDraftId: 'draft-old',
      recordedBy: 'Admin'
    },
    {
      id: 'ses-failed-attempt',
      classId: 'cls-p4a',
      classGrade: 'Primary 4A',
      date: '2026-10-15',
      term: 'First Term',
      sessionYear: '2026-10-15 (morning)',
      totalEnrolled: 30,
      presentCount: 0,
      absentCount: 0,
      reviewStatus: 'Failed',
      sourceDraftId: 'draft-failed',
      recordedBy: 'Admin'
    }
  ];

  // Matches confirmed session on same class & date
  const dupMatches = findPotentialDuplicateSessions({
    candidateClassId: 'cls-p4a',
    candidateClassName: 'Primary 4A',
    candidateDate: '2026-10-12',
    candidatePeriod: '2026-10-12 (morning)',
    candidateDraftId: 'draft-new',
    existingSessions: existing
  });
  assert.equal(dupMatches.length, 1);
  assert.equal(dupMatches[0].session.id, 'ses-existing-confirmed');

  // Same draftId excluded (idempotent check handles same draft elsewhere)
  const sameDraftMatches = findPotentialDuplicateSessions({
    candidateClassId: 'cls-p4a',
    candidateClassName: 'Primary 4A',
    candidateDate: '2026-10-12',
    candidateDraftId: 'draft-old',
    existingSessions: existing
  });
  assert.equal(sameDraftMatches.length, 0);

  // Failed session on 2026-10-15 does NOT trigger duplicate warning
  const failedDateMatches = findPotentialDuplicateSessions({
    candidateClassId: 'cls-p4a',
    candidateClassName: 'Primary 4A',
    candidateDate: '2026-10-15',
    candidateDraftId: 'draft-retry',
    existingSessions: existing
  });
  assert.equal(failedDateMatches.length, 0);

  // Different class does NOT trigger duplicate warning
  const otherClassMatches = findPotentialDuplicateSessions({
    candidateClassId: 'cls-p5a',
    candidateClassName: 'Primary 5A',
    candidateDate: '2026-10-12',
    candidateDraftId: 'draft-other',
    existingSessions: existing
  });
  assert.equal(otherClassMatches.length, 0);

  console.log('✓ Test 3 passed: Duplicate session warning detects same class/date, ignores Failed saves');
}

function runOfflineClassifierTests() {
  assert.equal(isNetworkOrOfflineError(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkOrOfflineError(new Error('NetworkError when attempting to fetch resource.')), true);
  assert.equal(
    isNetworkOrOfflineError(new Error('Could not reach Supabase database. Check your internet connection and retry')),
    true
  );
  assert.equal(isNetworkOrOfflineError(new Error('DUPLICATE_DRAFT_CONFIRMATION')), false);
  console.log('✓ Test 4 passed: Network/offline errors separated from database constraint errors');
}

async function runSupabaseDuplicateAndExportQueryTests() {
  const queries: Array<{ table: string; ops: string[] }> = [];
  const validClassUuid = '11111111-1111-4111-8111-111111111111';

  const mockClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'u1' } }, error: null };
      }
    },
    from(table: string) {
      const ops: string[] = [];
      const finish = async () => {
        queries.push({ table, ops: [...ops] });
        if (table === 'attendance_sessions') {
          return {
            data: [
              {
                id: 'db-ses-1',
                class_id: validClassUuid,
                attendance_date: '2026-10-12',
                attendance_period: '2026-10-12 (morning)',
                source_type: 'gemini-vision',
                status: 'CONFIRMED',
                source_draft_id: 'draft-existing',
                notes: null,
                created_by: 'u1',
                created_at: '2026-10-12T09:00:00Z',
                confirmed_at: '2026-10-12T09:05:00Z',
                classes: { name: 'Primary 4A' },
                profiles: { display_name: 'Admin' },
                attendance_records: []
              }
            ],
            error: null
          };
        }
        if (table === 'attendance_records') {
          return {
            data: [
              {
                id: 'rec-db-1',
                attendance_session_id: 'db-ses-1',
                student_id: 'stu-uuid-1',
                row_number: 1,
                week_identifier: 'Week 2',
                day_of_week: 'Monday',
                status: 'PRESENT',
                original_ai_status: 'PRESENT',
                reviewed: true,
                corrected_at: null,
                students: { id: 'stu-uuid-1', full_name: 'Amina Yusuf', student_number: 2 }
              }
            ],
            error: null
          };
        }
        return { data: [], error: null };
      };

      const builder: any = {
        select() { return builder; },
        eq(c: string, v: unknown) { ops.push(`eq:${c}=${v}`); return builder; },
        neq(c: string, v: unknown) { ops.push(`neq:${c}=${v}`); return builder; },
        gte(c: string, v: unknown) { ops.push(`gte:${c}=${v}`); return builder; },
        lte(c: string, v: unknown) { ops.push(`lte:${c}=${v}`); return builder; },
        in(c: string, v: unknown[]) { ops.push(`in:${c}=${v.join(',')}`); return builder; },
        order() { return builder; },
        limit(n: number) { ops.push(`limit:${n}`); return finish(); },
        then(onFulfilled: any, onRejected: any) { return finish().then(onFulfilled, onRejected); }
      };
      return builder;
    },
    async rpc() {
      return { data: null, error: null };
    }
  } as unknown as DbClient;

  const existingRemote = await checkDuplicateSessionsInSupabase(mockClient, {
    classId: validClassUuid,
    attendanceDate: '2026-10-12',
    sourceDraftId: 'draft-brand-new'
  });
  assert.equal(existingRemote.length, 1);
  assert.equal(existingRemote[0].id, 'db-ses-1');

  const exportSessions = await fetchScopedSessionsForCsvExport(mockClient, {
    classId: validClassUuid,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    confirmedOnly: true
  });
  assert.equal(exportSessions.length, 1);
  assert.equal(exportSessions[0].records?.length, 1);
  assert.equal(exportSessions[0].records?.[0].studentName, 'Amina Yusuf');

  const recOps = queries.find((q) => q.table === 'attendance_records')?.ops || [];
  assert.ok(recOps.includes('in:attendance_session_id=db-ses-1'));

  console.log('✓ Test 5 passed: Supabase duplicate-session check and scoped CSV export hydration');
  console.log('\nALL ADMIN CONVENIENCE TESTS PASSED.');
}

runCsvExportTests();
runDuplicateProtectionTests();
runOfflineClassifierTests();
runSupabaseDuplicateAndExportQueryTests().catch((err) => {
  console.error('Async test failed:', err);
  process.exit(1);
});
