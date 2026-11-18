import assert from 'node:assert/strict';
import {
  canAccessNavTab,
  canWriteSchoolRecords,
  getRoleDisplayLabel,
  isAdminRole,
  resolveLoginIdentifier
} from '../lib/authRoles';
import {
  confirmExistingSessionInSupabase,
  createClassInSupabase,
  createStudentInSupabase,
  fetchAttendanceSessionsFiltered,
  fetchStudentsFromSupabase,
  getCurrentStaffProfile,
  requireValidAdminSession,
  updateStudentInSupabase,
  type DbClient
} from './supabaseAttendanceService';
import type { StaffRole } from '../types/attendance';

function createAuthRbacHarness(options: {
  authenticated: boolean;
  expiredSession?: boolean;
  role?: StaffRole;
}) {
  const state = {
    authenticated: options.authenticated,
    expiredSession: options.expiredSession ?? false,
    role: options.role ?? 'visitor',
    userId: '22222222-2222-4222-8222-222222222222',
    classes: [
      {
        id: 'c0000000-0000-4000-8000-000000000001',
        name: 'Primary 4A',
        class_teacher: 'Mrs. Maryam Idris',
        notes: null,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z'
      }
    ],
    students: [
      {
        id: 'a0000000-0000-4000-8000-000000000001',
        class_id: 'c0000000-0000-4000-8000-000000000001',
        student_number: 1,
        full_name: 'Amina Bello',
        admission_number: 'LEA/2026/001',
        active: true,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z'
      }
    ],
    sessions: [
      {
        id: 'e0000000-0000-4000-8000-000000000001',
        class_id: 'c0000000-0000-4000-8000-000000000001',
        attendance_date: '2026-10-09',
        attendance_period: '2026-10-09 (Morning)',
        source_type: 'gemini-vision',
        status: 'DRAFT',
        source_draft_id: null,
        notes: null,
        created_by: '22222222-2222-4222-8222-222222222222',
        created_at: '2026-10-09T08:30:00Z',
        confirmed_at: null,
        classes: { name: 'Primary 4A' },
        profiles: { display_name: 'School Admin' },
        attendance_records: []
      }
    ]
  };

  const client = {
    auth: {
      async getSession() {
        if (!state.authenticated) {
          return { data: { session: null }, error: null };
        }
        const expiresAtSeconds = state.expiredSession
          ? Math.floor(Date.now() / 1000) - 600
          : Math.floor(Date.now() / 1000) + 3600;
        return {
          data: {
            session: {
              access_token: 'test-token',
              expires_at: expiresAtSeconds
            }
          },
          error: null
        };
      },
      async getUser() {
        if (!state.authenticated || state.expiredSession) {
          return { data: { user: null }, error: null };
        }
        return {
          data: {
            user: {
              id: state.userId,
              email: `${state.role}@lea-wuse3.school`
            }
          },
          error: null
        };
      }
    },
    from(table: string) {
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let payload: any = null;
      const eqFilters: Record<string, unknown> = {};

      const exec = async () => {
        if (!state.authenticated || state.expiredSession) {
          return {
            data: null,
            error: { code: '42501', message: 'permission denied for table ' + table }
          };
        }

        if (table === 'profiles') {
          return {
            data: { id: state.userId, display_name: `Test ${state.role}`, role: state.role },
            error: null
          };
        }

        // Enforce strict admin-only writes simulating 002_strict_roles_and_admin_only_writes.sql RLS
        if (op !== 'select' && state.role !== 'admin') {
          return {
            data: null,
            error: { code: '42501', message: 'new row violates row-level security policy' }
          };
        }

        if (table === 'students') {
          if (op === 'select') {
            return { data: state.students, error: null };
          }
          if (op === 'insert') {
            const newStudent = {
              id: 'a0000000-0000-4000-8000-000000000099',
              ...payload,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            state.students.push(newStudent);
            return { data: newStudent, error: null };
          }
          if (op === 'update') {
            const target = state.students.find((s) => s.id === eqFilters.id);
            if (!target) return { data: null, error: { message: 'Not found' } };
            Object.assign(target, payload, { updated_at: new Date().toISOString() });
            return { data: target, error: null };
          }
        }

        if (table === 'classes' && op === 'insert') {
          const newCls = {
            id: 'c0000000-0000-4000-8000-000000000099',
            ...payload,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          state.classes.push(newCls);
          return { data: newCls, error: null };
        }

        if (table === 'attendance_sessions') {
          if (op === 'select') {
            return { data: state.sessions, error: null };
          }
          if (op === 'update') {
            const target = state.sessions.find((s) => s.id === eqFilters.id);
            if (target) Object.assign(target, payload);
            return { data: target || null, error: null };
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
          eqFilters[col] = val;
          return builder;
        },
        gte() {
          return builder;
        },
        lte() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return exec();
        },
        single() {
          return exec();
        },
        maybeSingle() {
          return exec();
        },
        then(onFulfilled: any, onRejected: any) {
          return exec().then(onFulfilled, onRejected);
        }
      };
      return builder;
    },
    async rpc() {
      return { data: null, error: null };
    }
  };

  return { client: client as unknown as DbClient, state };
}

async function runTests() {
  console.log('Running Authentication & 3-Role RBAC Security Tests...\n');

  // 1. Login identifier mapping (username or email, zero hardcoded passwords)
  assert.equal(resolveLoginIdentifier('admin'), 'admin@lea-wuse3.school');
  assert.equal(resolveLoginIdentifier(' HeadTeacher '), 'headteacher@lea-wuse3.school');
  assert.equal(resolveLoginIdentifier('visitor'), 'visitor@lea-wuse3.school');
  assert.equal(resolveLoginIdentifier('custom@school.edu.ng'), 'custom@school.edu.ng');
  assert.equal(resolveLoginIdentifier('   '), '');
  console.log('✓ Test 1 passed: Login identifier resolves short role usernames and emails safely');

  // 2. Role permission & route matrix
  assert.equal(isAdminRole('admin'), true);
  assert.equal(canWriteSchoolRecords('admin'), true);
  assert.equal(canWriteSchoolRecords('headteacher'), false);
  assert.equal(canWriteSchoolRecords('visitor'), false);
  assert.equal(canWriteSchoolRecords(null), false);

  // Admin has all routes
  assert.equal(canAccessNavTab('admin', 'scan'), true);
  assert.equal(canAccessNavTab('admin', 'students'), true);
  assert.equal(canAccessNavTab('admin', 'settings'), true);

  // Head Teacher: read-only metrics, reports, records, students; NO scan or settings
  assert.equal(canAccessNavTab('headteacher', 'dashboard'), true);
  assert.equal(canAccessNavTab('headteacher', 'reports'), true);
  assert.equal(canAccessNavTab('headteacher', 'records'), true);
  assert.equal(canAccessNavTab('headteacher', 'students'), true);
  assert.equal(canAccessNavTab('headteacher', 'scan'), false);
  assert.equal(canAccessNavTab('headteacher', 'settings'), false);

  // Visitor / Inspector: read-only dashboard, reports, records; NO scan, students, settings
  assert.equal(canAccessNavTab('visitor', 'dashboard'), true);
  assert.equal(canAccessNavTab('visitor', 'reports'), true);
  assert.equal(canAccessNavTab('visitor', 'records'), true);
  assert.equal(canAccessNavTab('visitor', 'students'), false);
  assert.equal(canAccessNavTab('visitor', 'scan'), false);
  assert.equal(canAccessNavTab('visitor', 'settings'), false);

  // Unauthenticated: zero protected routes
  assert.equal(canAccessNavTab(null, 'dashboard'), false);
  assert.equal(canAccessNavTab(null, 'reports'), false);
  assert.ok(getRoleDisplayLabel('headteacher').includes('Read-Only'));
  console.log('✓ Test 2 passed: 3-role RBAC route & write permissions verified');

  // 3. Unauthenticated user cannot view student records or attendance
  const anonHarness = createAuthRbacHarness({ authenticated: false });
  assert.equal(await getCurrentStaffProfile(anonHarness.client), null);
  await assert.rejects(() => fetchStudentsFromSupabase(anonHarness.client), /Row Level Security/);
  await assert.rejects(
    () => fetchAttendanceSessionsFiltered(anonHarness.client, {}),
    /Row Level Security/
  );
  console.log('✓ Test 3 passed: Unauthenticated user denied direct reads of students & attendance');

  // 4. Read-only roles (headteacher & visitor) can read records/reports but are rejected on writes
  const headteacherHarness = createAuthRbacHarness({ authenticated: true, role: 'headteacher' });
  const htStudents = await fetchStudentsFromSupabase(headteacherHarness.client);
  assert.equal(htStudents.length, 1);
  await assert.rejects(
    () =>
      createStudentInSupabase(headteacherHarness.client, {
        classId: 'c0000000-0000-4000-8000-000000000001',
        studentNumber: 2,
        fullName: 'Unauthorized Insert',
        active: true
      }),
    /Read-only access/
  );

  const visitorHarness = createAuthRbacHarness({ authenticated: true, role: 'visitor' });
  await assert.rejects(
    () => confirmExistingSessionInSupabase(visitorHarness.client, 'e0000000-0000-4000-8000-000000000001'),
    /Read-only access/
  );
  assert.equal(visitorHarness.state.sessions[0].status, 'DRAFT', 'Visitor cannot confirm sessions');
  console.log('✓ Test 4 passed: Head Teacher & Visitor can read allowed data and are blocked from writes');

  // 5. Expired session fails cleanly without silently saving records
  const expiredAdminHarness = createAuthRbacHarness({
    authenticated: true,
    expiredSession: true,
    role: 'admin'
  });
  await assert.rejects(() => requireValidAdminSession(expiredAdminHarness.client), /expired/);
  await assert.rejects(
    () => createClassInSupabase(expiredAdminHarness.client, { name: 'Primary 6A' }),
    /expired/
  );
  assert.equal(expiredAdminHarness.state.classes.length, 1, 'Expired session must not write class');
  console.log('✓ Test 5 passed: Expired session prevented from silently saving records');

  // 6. Signed-in admin can add/edit students and confirm sessions, and sign-out revokes access
  const adminHarness = createAuthRbacHarness({ authenticated: true, role: 'admin' });
  const created = await createStudentInSupabase(adminHarness.client, {
    classId: 'c0000000-0000-4000-8000-000000000001',
    studentNumber: 2,
    fullName: 'Musa Ibrahim',
    active: true
  });
  assert.equal(created.fullName, 'Musa Ibrahim');

  const edited = await updateStudentInSupabase(adminHarness.client, {
    ...created,
    fullName: 'Musa Ibrahim Danjuma'
  });
  assert.equal(edited.fullName, 'Musa Ibrahim Danjuma');

  await confirmExistingSessionInSupabase(
    adminHarness.client,
    'e0000000-0000-4000-8000-000000000001'
  );
  assert.equal(adminHarness.state.sessions[0].status, 'CONFIRMED');

  // Simulate sign-out clearing authenticated session
  adminHarness.state.authenticated = false;
  assert.equal(await getCurrentStaffProfile(adminHarness.client), null);
  await assert.rejects(() => fetchStudentsFromSupabase(adminHarness.client), /Row Level Security/);
  console.log('✓ Test 6 passed: Admin writes succeed and sign-out immediately revokes protected access');

  console.log('\nALL AUTHENTICATION & RBAC SECURITY TESTS PASSED.');
}

runTests().catch((err) => {
  console.error('Auth/RBAC test suite failed:', err);
  process.exit(1);
});
