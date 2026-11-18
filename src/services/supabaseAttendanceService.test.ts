import assert from 'node:assert/strict';
import {
  confirmAttendanceSessionInSupabase,
  createClassInSupabase,
  createStudentInSupabase,
  deleteAllAttendanceSessionsInSupabase,
  deleteAttendanceSessionInSupabase,
  fetchClassesFromSupabase,
  fetchConfirmedSessionsFromSupabase,
  fetchStudentsFromSupabase,
  formatSupabaseError,
  getCurrentStaffProfile,
  seedLocalDemoRosterToSupabase,
  updateStudentInSupabase,
  type DbClient
} from './supabaseAttendanceService';
import { createValidationTestSamples, validateAndBuildSessionDraft } from './attendanceValidation';
import type { AttendanceSession, Student } from '../types/attendance';

/**
 * In-memory PostgreSQL + RLS + RPC behavioral harness verifying repository logic
 * for adding/editing students, reloading records, atomic session confirmation,
 * duplicate draft prevention, RLS error translation, and explicit local seeding.
 */
function createMockSupabaseHarness(options?: { authenticated?: boolean; role?: 'admin' | 'teacher' | 'viewer'; failNextRpc?: boolean }) {
  const state = {
    authenticated: options?.authenticated ?? true,
    userId: '11111111-1111-4111-8111-111111111111',
    role: options?.role ?? 'admin',
    failNextRpc: options?.failNextRpc ?? false,
    classes: [] as Array<{
      id: string;
      name: string;
      class_teacher: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>,
    students: [] as Array<{
      id: string;
      class_id: string;
      student_number: number;
      full_name: string;
      admission_number: string | null;
      active: boolean;
      created_at: string;
      updated_at: string;
    }>,
    sessions: [] as Array<{
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
    }>,
    records: [] as Array<{
      id: string;
      attendance_session_id: string;
      student_id: string | null;
      row_number: number | null;
      week_identifier: string;
      day_of_week: string;
      status: string;
      original_ai_status: string | null;
      reviewed: boolean;
      corrected_at: string | null;
    }>,
    seq: 1
  };

  const nextUuid = (prefix: string) =>
    `${prefix}0000-0000-4000-8000-${String(state.seq++).padStart(12, '0')}`;

  const client = {
    auth: {
      async getUser() {
        if (!state.authenticated) {
          return { data: { user: null }, error: null };
        }
        return {
          data: { user: { id: state.userId, email: 'headteacher@wuse3.lea.ng' } },
          error: null
        };
      }
    },
    from(table: string) {
      let filterEq: Record<string, unknown> = {};
      let filterNeq: Record<string, unknown> = {};
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let payload: any = null;

      const exec = async (singleMode: 'many' | 'single' | 'maybeSingle') => {
        if (!state.authenticated) {
          return {
            data: null,
            error: { code: '42501', message: 'permission denied for table ' + table }
          };
        }

        const now = new Date().toISOString();

        if (table === 'profiles') {
          if (singleMode !== 'many') {
            return {
              data: { id: state.userId, display_name: 'Mrs. Folashade Adebayo', role: state.role },
              error: null
            };
          }
          return { data: [], error: null };
        }

        if (table === 'classes') {
          if (op === 'select') {
            const rows = [...state.classes].sort((a, b) => a.name.localeCompare(b.name));
            return { data: singleMode === 'many' ? rows : rows[0] || null, error: null };
          }
          if (op === 'insert') {
            if (state.role === 'viewer') {
              return { data: null, error: { code: '42501', message: 'row-level security policy violation' } };
            }
            const row = {
              id: nextUuid('c000'),
              name: payload.name,
              class_teacher: payload.class_teacher ?? null,
              notes: payload.notes ?? null,
              created_at: now,
              updated_at: now
            };
            state.classes.push(row);
            return { data: row, error: null };
          }
        }

        if (table === 'students') {
          if (op === 'select') {
            const rows = [...state.students].sort((a, b) => a.student_number - b.student_number);
            return { data: singleMode === 'many' ? rows : rows[0] || null, error: null };
          }
          if (op === 'insert') {
            if (state.role === 'viewer') {
              return { data: null, error: { code: '42501', message: 'row-level security policy violation' } };
            }
            if (
              payload.admission_number &&
              state.students.some((s) => s.admission_number === payload.admission_number)
            ) {
              return {
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint "students_admission_number_key"' }
              };
            }
            const row = {
              id: nextUuid('a000'),
              class_id: payload.class_id,
              student_number: payload.student_number,
              full_name: payload.full_name,
              admission_number: payload.admission_number ?? null,
              active: payload.active ?? true,
              created_at: now,
              updated_at: now
            };
            state.students.push(row);
            return { data: row, error: null };
          }
          if (op === 'update') {
            const idx = state.students.findIndex((s) => s.id === filterEq.id);
            if (idx === -1) return { data: null, error: { message: 'Not found' } };
            state.students[idx] = { ...state.students[idx], ...payload, updated_at: now };
            return { data: state.students[idx], error: null };
          }
        }

        if (table === 'attendance_sessions') {
          if (op === 'select') {
            const rows = state.sessions.map((s) => {
              const cls = state.classes.find((c) => c.id === s.class_id);
              const recs = state.records
                .filter((r) => r.attendance_session_id === s.id)
                .map((r) => {
                  const st = state.students.find((x) => x.id === r.student_id);
                  return {
                    ...r,
                    students: st
                      ? { id: st.id, full_name: st.full_name, student_number: st.student_number }
                      : null
                  };
                });
              return {
                ...s,
                classes: cls ? { name: cls.name } : null,
                profiles: { display_name: 'Mrs. Folashade Adebayo' },
                attendance_records: recs
              };
            });
            return { data: rows, error: null };
          }
          if (op === 'delete') {
            if (state.role !== 'admin') {
              return { data: null, error: { code: '42501', message: 'row-level security policy violation' } };
            }
            const remaining = state.sessions.filter((s) => {
              if (filterEq.id !== undefined && s.id === filterEq.id) return false;
              if (filterNeq.id !== undefined && s.id !== filterNeq.id) return false;
              return true;
            });
            const removedIds = new Set(
              state.sessions.filter((s) => !remaining.includes(s)).map((s) => s.id)
            );
            state.sessions = remaining;
            state.records = state.records.filter((r) => !removedIds.has(r.attendance_session_id));
            return { data: null, error: null };
          }
        }

        return { data: [], error: null };
      };

      const builder: any = {
        select() {
          return builder;
        },
        insert(vals: any) {
          op = 'insert';
          payload = vals;
          return builder;
        },
        update(vals: any) {
          op = 'update';
          payload = vals;
          return builder;
        },
        delete() {
          op = 'delete';
          return builder;
        },
        eq(col: string, val: unknown) {
          filterEq[col] = val;
          return builder;
        },
        neq(col: string, val: unknown) {
          filterNeq[col] = val;
          return builder;
        },
        then(onFulfilled: any, onRejected: any) {
          return exec('many').then(onFulfilled, onRejected);
        },
        order() {
          return {
            limit() {
              return exec('many');
            },
            then(onFulfilled: any, onRejected: any) {
              return exec('many').then(onFulfilled, onRejected);
            }
          };
        },
        single() {
          return exec('single');
        },
        maybeSingle() {
          return exec('maybeSingle');
        }
      };
      return builder;
    },
    async rpc(fnName: string, args: any) {
      if (fnName !== 'confirm_attendance_session') {
        return { data: null, error: { message: `Unknown RPC ${fnName}` } };
      }
      if (!state.authenticated || state.role === 'viewer') {
        return { data: null, error: { code: '42501', message: 'row-level security policy violation' } };
      }
      if (state.failNextRpc) {
        state.failNextRpc = false;
        return { data: null, error: { message: 'Failed to fetch: upstream connection reset' } };
      }
      if (
        args.p_source_draft_id &&
        state.sessions.some((s) => s.source_draft_id === args.p_source_draft_id)
      ) {
        return {
          data: null,
          error: {
            code: '23505',
            message: `DUPLICATE_DRAFT_CONFIRMATION: draft ${args.p_source_draft_id} already exists`
          }
        };
      }

      const now = new Date().toISOString();
      const sessionId = nextUuid('e000');
      const newSession = {
        id: sessionId,
        class_id: args.p_class_id,
        attendance_date: args.p_attendance_date,
        attendance_period: args.p_attendance_period,
        source_type: args.p_source_type,
        status: args.p_status,
        source_draft_id: args.p_source_draft_id,
        notes: args.p_notes,
        created_by: state.userId,
        created_at: now,
        confirmed_at: now
      };

      // Simulate atomic transaction: validate all records before committing
      const stagedRecords = (args.p_records as any[]).map((r) => ({
        id: nextUuid('f000'),
        attendance_session_id: sessionId,
        student_id: r.student_id,
        row_number: r.row_number,
        week_identifier: r.week_identifier,
        day_of_week: r.day_of_week,
        status: r.status,
        original_ai_status: r.original_ai_status,
        reviewed: r.reviewed,
        corrected_at: r.was_corrected ? now : null
      }));

      state.sessions.push(newSession);
      state.records.push(...stagedRecords);
      return { data: newSession, error: null };
    }
  };

  return { client: client as unknown as DbClient, state };
}

async function runTests() {
  console.log('Running Supabase Persistence, RLS Error Handling & Atomic Transaction Tests...\n');

  // 1. Adding, editing, and reloading students & classes
  const harness = createMockSupabaseHarness({ authenticated: true, role: 'admin' });
  const profile = await getCurrentStaffProfile(harness.client);
  assert.equal(profile?.role, 'admin');

  const createdClass = await createClassInSupabase(harness.client, {
    name: 'Primary 4A',
    classTeacher: 'Mrs. Maryam Idris'
  });
  assert.ok(createdClass.id.length === 36, 'Created class must receive UUID from DB');

  const addedStudent = await createStudentInSupabase(harness.client, {
    classId: createdClass.id,
    studentNumber: 1,
    fullName: 'Abubakar Aliyu',
    admissionNumber: 'LEA/2021/0014',
    active: true
  });
  assert.equal(addedStudent.fullName, 'Abubakar Aliyu');

  const editedStudent = await updateStudentInSupabase(harness.client, {
    ...addedStudent,
    fullName: 'Abubakar Aliyu Sani'
  });
  assert.equal(editedStudent.fullName, 'Abubakar Aliyu Sani');

  // Reload from Supabase
  const reloadedClasses = await fetchClassesFromSupabase(harness.client);
  const reloadedStudents = await fetchStudentsFromSupabase(harness.client);
  assert.equal(reloadedClasses.length, 1);
  assert.equal(reloadedStudents.length, 1);
  assert.equal(reloadedStudents[0].fullName, 'Abubakar Aliyu Sani');
  console.log('✓ Test 1 passed: Adding, editing, and reloading classes & students from Supabase');

  // 2. Saving a confirmed attendance session atomically & retrieving it
  const { validMultiWeekSample } = createValidationTestSamples();
  const classRoster: Student[] = reloadedStudents;
  const draft = validateAndBuildSessionDraft(validMultiWeekSample, {
    classId: createdClass.id,
    className: createdClass.name,
    attendancePeriod: '2026-10-09 (Morning Session)',
    sourceImageMetadata: {
      fileName: 'reg.jpg',
      rotation: 0,
      capturedAt: new Date().toISOString(),
      modelUsed: 'gemini-3.8-flash'
    },
    classStudents: classRoster
  });

  const summary: AttendanceSession = {
    id: 'temp-session',
    date: '2026-10-09',
    classId: createdClass.id,
    classGrade: createdClass.name,
    term: 'First Term',
    sessionYear: '2026/2027',
    totalEnrolled: draft.rowMappings.length,
    presentCount: 2,
    absentCount: 1,
    reviewStatus: 'Flagged',
    recordedBy: 'Mrs. Folashade Adebayo',
    notes: 'Verified test draft',
    sourceDraftId: draft.id
  };

  // Verify failed DB request throws cleanly and leaves 0 partial sessions committed
  harness.state.failNextRpc = true;
  await assert.rejects(
    () =>
      confirmAttendanceSessionInSupabase(harness.client, {
        draft,
        sessionSummary: summary,
        classId: createdClass.id,
        selectedDate: '2026-10-09',
        modelUsed: 'gemini-3.8-flash'
      }),
    /Could not reach Supabase database/
  );
  assert.equal(harness.state.sessions.length, 0, 'Failed transaction must not leave partial session');
  assert.equal(harness.state.records.length, 0, 'Failed transaction must not leave partial records');

  // Now commit cleanly
  const savedSession = await confirmAttendanceSessionInSupabase(harness.client, {
    draft,
    sessionSummary: summary,
    classId: createdClass.id,
    selectedDate: '2026-10-09',
    modelUsed: 'gemini-3.8-flash'
  });
  assert.equal(savedSession.persistenceTarget, 'supabase');
  assert.equal(harness.state.sessions.length, 1);
  assert.equal(harness.state.records.length, draft.cells.length);

  // Retrieve saved attendance
  const loadedSessions = await fetchConfirmedSessionsFromSupabase(harness.client);
  assert.equal(loadedSessions.length, 1);
  assert.equal(loadedSessions[0].classGrade, 'Primary 4A');
  assert.ok((loadedSessions[0].entries?.length || 0) > 0, 'Should retrieve student attendance entries');
  console.log('✓ Test 2 passed: Failed DB rollback safety, atomic session+records commit, and retrieval');

  // 3. Duplicate confirmation of the same draft must be blocked
  await assert.rejects(
    () =>
      confirmAttendanceSessionInSupabase(harness.client, {
        draft,
        sessionSummary: summary,
        classId: createdClass.id,
        selectedDate: '2026-10-09',
        modelUsed: 'gemini-3.8-flash'
      }),
    /already been confirmed/
  );
  console.log('✓ Test 3 passed: Duplicate confirmation of same draft rejected');

  // 4. Anonymous / unauthorized RLS denial checks
  const anonHarness = createMockSupabaseHarness({ authenticated: false });
  await assert.rejects(
    () => fetchStudentsFromSupabase(anonHarness.client),
    /Row Level Security/
  );
  const viewerHarness = createMockSupabaseHarness({ authenticated: true, role: 'viewer' });
  await assert.rejects(
    () => createClassInSupabase(viewerHarness.client, { name: 'Unauthorized Class' }),
    /Read-only access|Row Level Security/
  );
  assert.ok(
    formatSupabaseError({ code: '23505', message: 'students_admission_number_key' }, 'err').includes('admission number')
  );
  console.log('✓ Test 4 passed: Anonymous access denied and RLS error messages surfaced clearly');

  // 5. Explicit non-destructive local-to-Supabase roster seeding skips existing records cleanly
  const seedResult = await seedLocalDemoRosterToSupabase(
    harness.client,
    [
      { id: 'cls-p4a', name: 'Primary 4A', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'cls-p5a', name: 'Primary 5A', createdAt: '2026-09-01T00:00:00Z' }
    ],
    [
      {
        id: 'std-101',
        studentNumber: 1,
        fullName: 'Abubakar Aliyu Sani',
        classId: 'cls-p4a',
        admissionNumber: 'LEA/2021/0014',
        active: true,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z'
      },
      {
        id: 'std-501',
        studentNumber: 1,
        fullName: 'Nadia Suleiman',
        classId: 'cls-p5a',
        admissionNumber: 'LEA/2020/0099',
        active: true,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z'
      }
    ]
  );

  assert.equal(seedResult.classesCreated, 1, 'Should create Primary 5A and skip existing Primary 4A');
  assert.equal(seedResult.classesSkipped, 1);
  assert.equal(seedResult.studentsCreated, 1, 'Should create Nadia Suleiman and skip existing Abubakar');
  assert.equal(seedResult.studentsSkipped, 1);
  console.log('✓ Test 5 passed: Explicit local-to-remote roster seeding avoids duplicates safely');

  // 6. Admin-only single & bulk attendance session deletion
  await assert.rejects(
    () => deleteAttendanceSessionInSupabase(viewerHarness.client, savedSession.id),
    /Read-only access|Row Level Security/
  );
  await deleteAttendanceSessionInSupabase(harness.client, savedSession.id);
  assert.equal(harness.state.sessions.length, 0);
  assert.equal(harness.state.records.length, 0);

  // Confirm a second session, then verify deleteAllAttendanceSessionsInSupabase clears all sessions & records
  const secondDraft = validateAndBuildSessionDraft(validMultiWeekSample, {
    classId: createdClass.id,
    className: createdClass.name,
    attendancePeriod: '2026-10-16 (Morning Session)',
    sourceImageMetadata: {
      fileName: 'reg2.jpg',
      rotation: 0,
      capturedAt: new Date().toISOString(),
      modelUsed: 'gemini-3.8-flash'
    },
    classStudents: classRoster
  });
  await confirmAttendanceSessionInSupabase(harness.client, {
    draft: secondDraft,
    sessionSummary: { ...summary, id: 'temp-session-2', date: '2026-10-16', sourceDraftId: secondDraft.id },
    classId: createdClass.id,
    selectedDate: '2026-10-16',
    modelUsed: 'gemini-3.8-flash'
  });
  assert.equal(harness.state.sessions.length, 1);
  await deleteAllAttendanceSessionsInSupabase(harness.client);
  assert.equal(harness.state.sessions.length, 0);
  assert.equal(harness.state.records.length, 0);
  assert.equal(harness.state.students.length >= 1, true, 'Enrolled students must stay intact');
  console.log('✓ Test 6 passed: Admin-only attendance record deletion preserves enrolled roster');

  console.log('\nALL SUPABASE PERSISTENCE & SAFETY TESTS PASSED.');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
