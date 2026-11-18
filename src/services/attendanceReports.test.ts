import assert from 'node:assert/strict';
import {
  calculateAttendancePercentage,
  computeStudentAttendanceReport,
  filterAttendanceSessions
} from './attendanceReports';
import {
  fetchAttendanceReportFromSupabase,
  fetchAttendanceSessionsFiltered,
  fetchSessionDetailFromSupabase,
  type DbClient
} from './supabaseAttendanceService';
import type { AttendanceSession, ClassItem, Student } from '../types/attendance';

function runReportUnitTests() {
  console.log('Running Attendance History & Reports Calculation Tests...\n');

  const classes: ClassItem[] = [
    { id: 'cls-p4a', name: 'Primary 4A', createdAt: '2026-09-01T00:00:00Z' },
    { id: 'cls-p5a', name: 'Primary 5A', createdAt: '2026-09-01T00:00:00Z' }
  ];

  const students: Student[] = [
    {
      id: 'stu-1',
      classId: 'cls-p4a',
      studentNumber: 1,
      fullName: 'Abubakar Aliyu',
      active: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z'
    },
    {
      id: 'stu-2',
      classId: 'cls-p4a',
      studentNumber: 2,
      fullName: 'Amina Yusuf',
      active: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z'
    },
    {
      id: 'stu-3',
      classId: 'cls-p4a',
      studentNumber: 3,
      fullName: 'Chidi Eze',
      active: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z'
    },
    {
      id: 'stu-p5',
      classId: 'cls-p5a',
      studentNumber: 1,
      fullName: 'Nadia Suleiman',
      active: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z'
    }
  ];

  const sessions: AttendanceSession[] = [
    // 1. Confirmed session with Present, Absent, Blank, Uncertain, and an unrecorded active student (stu-3)
    {
      id: 'ses-confirmed-1',
      classId: 'cls-p4a',
      classGrade: 'Primary 4A',
      date: '2026-10-12',
      term: 'First Term',
      sessionYear: 'Week 2',
      totalEnrolled: 3,
      presentCount: 3,
      absentCount: 1,
      blankCount: 4,
      uncertainCount: 3,
      reviewStatus: 'Confirmed',
      recordedBy: 'Mrs. Maryam Idris',
      verifiedBy: 'Confirmed in Supabase PostgreSQL',
      records: [
        // Student 1: 3 PRESENT, 1 ABSENT, 1 BLANK, 1 UNCERTAIN -> 3 / (3+1) = 75%
        { id: 'r1', studentId: 'stu-1', rowNumber: 1, studentName: 'Abubakar Aliyu', weekIdentifier: 'Week 2', dayOfWeek: 'Monday', status: 'PRESENT', reviewed: true },
        { id: 'r2', studentId: 'stu-1', rowNumber: 1, studentName: 'Abubakar Aliyu', weekIdentifier: 'Week 2', dayOfWeek: 'Tuesday', status: 'PRESENT', reviewed: true },
        { id: 'r3', studentId: 'stu-1', rowNumber: 1, studentName: 'Abubakar Aliyu', weekIdentifier: 'Week 2', dayOfWeek: 'Wednesday', status: 'PRESENT', reviewed: true },
        { id: 'r4', studentId: 'stu-1', rowNumber: 1, studentName: 'Abubakar Aliyu', weekIdentifier: 'Week 2', dayOfWeek: 'Thursday', status: 'ABSENT', reviewed: true },
        { id: 'r5', studentId: 'stu-1', rowNumber: 1, studentName: 'Abubakar Aliyu', weekIdentifier: 'Week 2', dayOfWeek: 'Friday', status: 'BLANK', reviewed: true },
        { id: 'r6', studentId: 'stu-1', rowNumber: 1, studentName: 'Abubakar Aliyu', weekIdentifier: 'Week 3', dayOfWeek: 'Monday', status: 'UNCERTAIN', reviewed: false },
        // Student 2: 0 PRESENT, 0 ABSENT, 3 BLANK, 2 UNCERTAIN -> denominator 0 -> null (N/A)
        { id: 'r7', studentId: 'stu-2', rowNumber: 2, studentName: 'Amina Yusuf', weekIdentifier: 'Week 2', dayOfWeek: 'Monday', status: 'BLANK', reviewed: true },
        { id: 'r8', studentId: 'stu-2', rowNumber: 2, studentName: 'Amina Yusuf', weekIdentifier: 'Week 2', dayOfWeek: 'Tuesday', status: 'BLANK', reviewed: true },
        { id: 'r9', studentId: 'stu-2', rowNumber: 2, studentName: 'Amina Yusuf', weekIdentifier: 'Week 2', dayOfWeek: 'Wednesday', status: 'BLANK', reviewed: true },
        { id: 'r10', studentId: 'stu-2', rowNumber: 2, studentName: 'Amina Yusuf', weekIdentifier: 'Week 2', dayOfWeek: 'Thursday', status: 'UNCERTAIN', reviewed: false },
        { id: 'r11', studentId: 'stu-2', rowNumber: 2, studentName: 'Amina Yusuf', weekIdentifier: 'Week 2', dayOfWeek: 'Friday', status: 'UNCERTAIN', reviewed: false }
        // Student 3 (stu-3) has ZERO records in this session -> counted as 1 unrecorded/blank
      ]
    },
    // 2. Unconfirmed DRAFT session (must NOT affect official totals)
    {
      id: 'ses-draft-1',
      classId: 'cls-p4a',
      classGrade: 'Primary 4A',
      date: '2026-10-13',
      term: 'First Term',
      sessionYear: 'Week 2',
      totalEnrolled: 3,
      presentCount: 2,
      absentCount: 1,
      reviewStatus: 'Draft',
      recordedBy: 'Mrs. Maryam Idris',
      records: [
        { id: 'd1', studentId: 'stu-1', rowNumber: 1, studentName: 'Abubakar Aliyu', weekIdentifier: 'Week 2', dayOfWeek: 'Monday', status: 'ABSENT', reviewed: false },
        { id: 'd2', studentId: 'stu-2', rowNumber: 2, studentName: 'Amina Yusuf', weekIdentifier: 'Week 2', dayOfWeek: 'Monday', status: 'PRESENT', reviewed: false }
      ]
    },
    // 3. Unconfirmed Pending Review session (must NOT affect official totals)
    {
      id: 'ses-pending-1',
      classId: 'cls-p4a',
      classGrade: 'Primary 4A',
      date: '2026-10-14',
      term: 'First Term',
      sessionYear: 'Week 2',
      totalEnrolled: 3,
      presentCount: 3,
      absentCount: 0,
      reviewStatus: 'Pending Review',
      recordedBy: 'Mrs. Maryam Idris',
      records: [
        { id: 'p1', studentId: 'stu-2', rowNumber: 2, studentName: 'Amina Yusuf', weekIdentifier: 'Week 2', dayOfWeek: 'Monday', status: 'PRESENT', reviewed: false }
      ]
    },
    // 4. Flagged session (must NOT affect official totals)
    {
      id: 'ses-flagged-1',
      classId: 'cls-p4a',
      classGrade: 'Primary 4A',
      date: '2026-10-15',
      term: 'First Term',
      sessionYear: 'Week 2',
      totalEnrolled: 3,
      presentCount: 1,
      absentCount: 1,
      uncertainCount: 1,
      reviewStatus: 'Flagged',
      recordedBy: 'Mrs. Maryam Idris',
      records: [
        { id: 'f1', studentId: 'stu-1', rowNumber: 1, studentName: 'Abubakar Aliyu', weekIdentifier: 'Week 2', dayOfWeek: 'Monday', status: 'ABSENT', reviewed: true }
      ]
    },
    // 5. Failed save session (must NOT affect official totals)
    {
      id: 'ses-failed-1',
      classId: 'cls-p4a',
      classGrade: 'Primary 4A',
      date: '2026-10-16',
      term: 'First Term',
      sessionYear: 'Week 2',
      totalEnrolled: 3,
      presentCount: 3,
      absentCount: 0,
      reviewStatus: 'Failed',
      failureReason: 'Network timeout during confirmation',
      recordedBy: 'Mrs. Maryam Idris'
    },
    // 6. Confirmed session in Primary 5A outside Primary 4A filter
    {
      id: 'ses-p5a-1',
      classId: 'cls-p5a',
      classGrade: 'Primary 5A',
      date: '2026-10-12',
      term: 'First Term',
      sessionYear: 'Week 2',
      totalEnrolled: 1,
      presentCount: 1,
      absentCount: 0,
      reviewStatus: 'Confirmed',
      recordedBy: 'Mrs. Patience Yakubu',
      records: [
        { id: 'p5-1', studentId: 'stu-p5', rowNumber: 1, studentName: 'Nadia Suleiman', weekIdentifier: 'Week 2', dayOfWeek: 'Monday', status: 'PRESENT', reviewed: true }
      ]
    }
  ];

  // Test 1: Direct percentage calculation rule
  assert.equal(calculateAttendancePercentage(3, 1), 75);
  assert.equal(calculateAttendancePercentage(0, 0), null);
  assert.equal(calculateAttendancePercentage(2, 1), 66.7);
  console.log('✓ Test 1 passed: Attendance percentage excludes Blank/Uncertain and returns null when denominator is 0');

  // Test 2: Confirmed-only Student Report for Primary 4A
  const p4Report = computeStudentAttendanceReport({
    sessions,
    students,
    classes,
    classId: 'cls-p4a',
    startDate: '2026-10-01',
    endDate: '2026-10-31'
  });

  assert.equal(p4Report.confirmedSessionCount, 1, 'Only 1 session is Confirmed for Primary 4A');
  assert.equal(p4Report.excludedUnconfirmedCount, 4, 'Draft, Pending Review, Flagged, and Failed sessions excluded');
  assert.equal(p4Report.totalPresent, 3);
  assert.equal(p4Report.totalAbsent, 1);
  assert.equal(p4Report.totalBlank, 5, '4 explicit BLANK marks + 1 unrecorded student slot');
  assert.equal(p4Report.totalUncertain, 3);
  assert.equal(p4Report.overallPercentage, 75);
  assert.equal(p4Report.studentRows.length, 3, 'Only Primary 4A students included');

  const row1 = p4Report.studentRows.find((r) => r.studentId === 'stu-1')!;
  assert.equal(row1.totalSessions, 1);
  assert.equal(row1.presentCount, 3);
  assert.equal(row1.absentCount, 1);
  assert.equal(row1.blankCount, 1);
  assert.equal(row1.uncertainCount, 1);
  assert.equal(row1.attendancePercentage, 75);

  const row2 = p4Report.studentRows.find((r) => r.studentId === 'stu-2')!;
  assert.equal(row2.totalSessions, 1);
  assert.equal(row2.presentCount, 0);
  assert.equal(row2.absentCount, 0);
  assert.equal(row2.blankCount, 3);
  assert.equal(row2.uncertainCount, 2);
  assert.equal(row2.attendancePercentage, null, 'Student with only BLANK/UNCERTAIN has N/A percentage');

  const row3 = p4Report.studentRows.find((r) => r.studentId === 'stu-3')!;
  assert.equal(row3.totalSessions, 1);
  assert.equal(row3.presentCount, 0);
  assert.equal(row3.absentCount, 0);
  assert.equal(row3.blankCount, 1, 'Unrecorded student slot tracked as blank/unrecorded, never absent');
  assert.equal(row3.attendancePercentage, null);
  console.log('✓ Test 2 passed: Confirmed-only totals, BLANK != ABSENT, UNCERTAIN excluded, unrecorded pupil tracked');

  // Test 3: History filtering by class, date range, and status (Draft / Confirmed / Failed)
  const failedOnly = filterAttendanceSessions(
    sessions,
    { classId: 'All', startDate: '', endDate: '', status: 'Failed' },
    classes
  );
  assert.equal(failedOnly.length, 1);
  assert.equal(failedOnly[0].id, 'ses-failed-1');

  const oct12P4a = filterAttendanceSessions(
    sessions,
    { classId: 'cls-p4a', startDate: '2026-10-12', endDate: '2026-10-12', status: 'All' },
    classes
  );
  assert.equal(oct12P4a.length, 1);
  assert.equal(oct12P4a[0].id, 'ses-confirmed-1');
  console.log('✓ Test 3 passed: Attendance history filters by class, date range, and Draft/Confirmed/Failed status');
}

async function runScopedSupabaseQueryTests() {
  const recordedFilters: Array<{ table: string; filters: string[] }> = [];

  const mockClient = {
    auth: { async getUser() { return { data: { user: { id: 'u1' } }, error: null }; } },
    from(table: string) {
      const filters: string[] = [];
      let isHeadCount = false;

      const finish = async () => {
        recordedFilters.push({ table, filters: [...filters] });
        if (table === 'attendance_sessions' && isHeadCount) {
          return { data: null, count: 2, error: null };
        }
        if (table === 'attendance_sessions') {
          if (filters.includes('eq:id=ses-1')) {
            return {
              data: {
                id: 'ses-1',
                class_id: 'cls-p4a',
                attendance_date: '2026-10-12',
                attendance_period: 'Week 2',
                source_type: 'gemini-vision',
                status: 'CONFIRMED',
                source_draft_id: 'draft-1',
                notes: null,
                created_by: 'u1',
                created_at: '2026-10-12T09:00:00Z',
                confirmed_at: '2026-10-12T09:10:00Z',
                classes: { name: 'Primary 4A' },
                profiles: { display_name: 'Mrs. Maryam Idris' },
                attendance_records: [
                  {
                    id: 'rec-1',
                    attendance_session_id: 'ses-1',
                    student_id: 'stu-1',
                    row_number: 1,
                    week_identifier: 'Week 2',
                    day_of_week: 'Monday',
                    status: 'PRESENT',
                    original_ai_status: 'PRESENT',
                    reviewed: true,
                    corrected_at: null,
                    students: { id: 'stu-1', full_name: 'Abubakar Aliyu', student_number: 1 }
                  },
                  {
                    id: 'rec-2',
                    attendance_session_id: 'ses-1',
                    student_id: 'stu-1',
                    row_number: 1,
                    week_identifier: 'Week 2',
                    day_of_week: 'Tuesday',
                    status: 'BLANK',
                    original_ai_status: 'BLANK',
                    reviewed: true,
                    corrected_at: null,
                    students: { id: 'stu-1', full_name: 'Abubakar Aliyu', student_number: 1 }
                  }
                ]
              },
              error: null
            };
          }
          return {
            data: [
              {
                id: 'ses-1',
                class_id: 'cls-p4a',
                attendance_date: '2026-10-12',
                attendance_period: 'Week 2',
                source_type: 'gemini-vision',
                status: 'CONFIRMED',
                source_draft_id: 'draft-1',
                notes: null,
                created_by: 'u1',
                created_at: '2026-10-12T09:00:00Z',
                confirmed_at: '2026-10-12T09:10:00Z',
                classes: { name: 'Primary 4A' },
                profiles: { display_name: 'Mrs. Maryam Idris' },
                attendance_records: [
                  { id: 'rec-1', student_id: 'stu-1', status: 'PRESENT' },
                  { id: 'rec-2', student_id: 'stu-1', status: 'BLANK' }
                ]
              }
            ],
            error: null
          };
        }
        if (table === 'students') {
          return {
            data: [
              {
                id: 'stu-1',
                class_id: 'cls-p4a',
                student_number: 1,
                full_name: 'Abubakar Aliyu',
                admission_number: null,
                active: true,
                created_at: '2026-09-01T00:00:00Z',
                updated_at: '2026-09-01T00:00:00Z'
              }
            ],
            error: null
          };
        }
        if (table === 'attendance_records') {
          return {
            data: [
              {
                id: 'rec-1',
                attendance_session_id: 'ses-1',
                student_id: 'stu-1',
                row_number: 1,
                week_identifier: 'Week 2',
                day_of_week: 'Monday',
                status: 'PRESENT',
                original_ai_status: 'PRESENT',
                reviewed: true,
                corrected_at: null,
                students: { id: 'stu-1', full_name: 'Abubakar Aliyu', student_number: 1 }
              },
              {
                id: 'rec-2',
                attendance_session_id: 'ses-1',
                student_id: 'stu-1',
                row_number: 1,
                week_identifier: 'Week 2',
                day_of_week: 'Tuesday',
                status: 'BLANK',
                original_ai_status: 'BLANK',
                reviewed: true,
                corrected_at: null,
                students: { id: 'stu-1', full_name: 'Abubakar Aliyu', student_number: 1 }
              }
            ],
            error: null
          };
        }
        return { data: [], error: null };
      };

      const builder: any = {
        select(_cols?: string, opts?: { head?: boolean }) {
          if (opts?.head) isHeadCount = true;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push(`eq:${col}=${String(val)}`);
          return builder;
        },
        neq(col: string, val: unknown) {
          filters.push(`neq:${col}=${String(val)}`);
          return builder;
        },
        gte(col: string, val: unknown) {
          filters.push(`gte:${col}=${String(val)}`);
          return builder;
        },
        lte(col: string, val: unknown) {
          filters.push(`lte:${col}=${String(val)}`);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          filters.push(`in:${col}=${vals.join(',')}`);
          return builder;
        },
        order(col: string) {
          filters.push(`order:${col}`);
          return builder;
        },
        limit(n: number) {
          filters.push(`limit:${n}`);
          return finish();
        },
        single() {
          return finish();
        },
        then(onFulfilled: any, onRejected: any) {
          return finish().then(onFulfilled, onRejected);
        }
      };

      return builder;
    },
    async rpc() {
      return { data: null, error: null };
    }
  } as unknown as DbClient;

  // Verify scoped history filter
  const historyRows = await fetchAttendanceSessionsFiltered(mockClient, {
    classId: 'cls-p4a',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    status: 'Confirmed'
  });
  assert.equal(historyRows.length, 1);
  assert.equal(historyRows[0].blankCount, 1);

  // Verify single-session lazy detail load
  const detail = await fetchSessionDetailFromSupabase(mockClient, 'ses-1');
  assert.equal(detail.records?.length, 2);

  // Verify scoped report query
  const report = await fetchAttendanceReportFromSupabase(mockClient, {
    classId: 'cls-p4a',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    classes: [{ id: 'cls-p4a', name: 'Primary 4A', createdAt: '2026-09-01T00:00:00Z' }]
  });
  assert.equal(report.confirmedSessionCount, 1);
  assert.equal(report.excludedUnconfirmedCount, 2);
  assert.equal(report.totalPresent, 1);
  assert.equal(report.totalAbsent, 0);
  assert.equal(report.totalBlank, 1);
  assert.equal(report.overallPercentage, 100);

  const recQuery = recordedFilters.find((q) => q.table === 'attendance_records');
  assert.ok(recQuery?.filters.includes('in:attendance_session_id=ses-1'), 'Records query must scope strictly to matched confirmed session IDs');

  console.log('✓ Test 4 passed: Supabase history, lazy detail, and confirmed-only report queries scope class/date/status cleanly');
  console.log('\nALL ATTENDANCE HISTORY & REPORT TESTS PASSED.');
}

runReportUnitTests();
runScopedSupabaseQueryTests().catch((err) => {
  console.error('Scoped query test failed:', err);
  process.exit(1);
});
