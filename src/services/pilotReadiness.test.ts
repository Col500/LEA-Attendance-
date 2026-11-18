import assert from 'node:assert/strict';
import { validateAndBuildSessionDraft, getReviewQueueStats } from './attendanceValidation';
import {
  addStoredAttendanceSession,
  clearAllStoredAttendanceRecords,
  deleteStoredAttendanceSession,
  deleteStoredSessionDraft,
  getStoredAttendanceSessions,
  getStoredSessionDrafts,
  initialSampleClasses,
  initialSampleStudents,
  saveStoredSessionDraft,
  SESSIONS_STORAGE_KEY
} from './rosterStorage';
import { sampleAttendanceSessions } from '../data/mockData';
import type { AttendanceSession, GeminiExtractionResult } from '../types/attendance';
import {
  formatGeminiApiError,
  isQuotaExhaustedError,
  shouldFallbackFromGeminiError
} from '../server/geminiErrorUtils';
import {
  parseVisionOCRToAttendance,
  parseVisionOCRToRoster,
  reconstructRowsFromVisionAnnotation
} from '../server/googleCloudVisionService';

function setupMemoryLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, val: string) => {
      store.set(key, String(val));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
  return store;
}

function runPilotReadinessTests() {
  console.log('Running Final Quality Review & Pilot Readiness Tests...\n');

  // 1. Register Photo Retention Elimination in Local Storage
  const store = setupMemoryLocalStorage();
  const sessionWithLegacyPhoto: AttendanceSession = {
    id: 'ses-pilot-1',
    date: '2026-10-15',
    classId: 'cls-p4a',
    classGrade: 'Primary 4A',
    term: 'First Term',
    sessionYear: '2026/2027',
    totalEnrolled: 2,
    presentCount: 2,
    absentCount: 0,
    reviewStatus: 'Confirmed',
    recordedBy: 'School Administrator',
    persistenceTarget: 'local-demo',
    registerImageUri: 'data:image/jpeg;base64,/9j/SENSITIVE_PUPIL_PHOTO_DATA',
    entries: []
  };

  addStoredAttendanceSession(sessionWithLegacyPhoto);
  const storedRaw = store.get(SESSIONS_STORAGE_KEY) || '';
  assert.ok(
    !storedRaw.includes('SENSITIVE_PUPIL_PHOTO_DATA') && !storedRaw.includes('registerImageUri'),
    'Persisted session storage must strip raw registerImageUri photograph payloads'
  );

  // Also ensure legacy sessions loaded from storage have registerImageUri stripped
  store.set(SESSIONS_STORAGE_KEY, JSON.stringify([sessionWithLegacyPhoto]));
  const reloaded = getStoredAttendanceSessions();
  assert.equal(reloaded[0].registerImageUri, undefined, 'Reloaded session must strip legacy registerImageUri');
  console.log('✓ Test 1 passed: Register photograph data is stripped from persisted session storage');

  // 2. Empty Class Roster Handling & Integrity Guards (BLANK != ABSENT, UNCERTAIN != ABSENT, no auto-confirm)
  const samplePayload: GeminiExtractionResult = {
    classIdentified: 'Primary 1B',
    totalRowsDetected: 2,
    detectedDays: ['Monday', 'Tuesday'],
    overallConfidence: 'MEDIUM',
    layoutQuality: {
      detectedWeeks: ['Week 1']
    },
    rows: [
      {
        rowNumber: 1,
        studentNameDetected: 'Sadiq Umar',
        marks: [
          { week: 'Week 1', day: 'Monday', rawSymbol: '/', status: 'PRESENT' },
          { week: 'Week 1', day: 'Tuesday', rawSymbol: '', status: 'BLANK' }
        ]
      },
      {
        rowNumber: 2,
        studentNameDetected: 'Amina Bello',
        marks: [
          { week: 'Week 1', day: 'Monday', rawSymbol: '?', status: 'UNCERTAIN' },
          { week: 'Week 1', day: 'Tuesday', rawSymbol: '0', status: 'ABSENT' }
        ]
      }
    ]
  };

  const emptyClassDraft = validateAndBuildSessionDraft(samplePayload, {
    classId: 'cls-p1b',
    className: 'Primary 1B',
    attendancePeriod: '2026-10-15 (morning)',
    sourceImageMetadata: {
      fileName: 'register.jpg',
      rotation: 0,
      capturedAt: new Date().toISOString(),
      modelUsed: 'gemini-4-hydrogen'
    },
    classStudents: [] // Empty class roster scenario
  });

  assert.equal(emptyClassDraft.rowMappings.length, 2);
  assert.ok(
    emptyClassDraft.rowMappings.every((m) => m.studentId === null && m.mappingConfidence === 'UNMAPPED'),
    'Empty class roster must leave extracted rows UNMAPPED rather than inventing student IDs'
  );
  assert.ok(
    emptyClassDraft.validationIssues.some((i) => i.code === 'UNMAPPED_STUDENT'),
    'Empty class rows must emit UNMAPPED_STUDENT validation issues'
  );

  // Check BLANK and UNCERTAIN integrity
  const blankCell = emptyClassDraft.cells.find((c) => c.rowNumber === 1 && c.dayOfWeek === 'Tuesday');
  const uncertainCell = emptyClassDraft.cells.find((c) => c.rowNumber === 2 && c.dayOfWeek === 'Monday');
  assert.equal(blankCell?.status, 'BLANK', 'Blank cell must remain BLANK (never ABSENT)');
  assert.equal(uncertainCell?.status, 'UNCERTAIN', 'Uncertain mark must remain UNCERTAIN (never ABSENT)');
  assert.equal(uncertainCell?.reviewedByAdmin, false, 'AI-flagged uncertain cell must never be auto-confirmed');

  const stats = getReviewQueueStats(emptyClassDraft);
  assert.equal(stats.uncertainCells, 7, '1 explicit uncertain mark + 6 missing weekday slots must remain UNCERTAIN');
  assert.equal(
    emptyClassDraft.cells.filter((c) => c.status === 'BLANK').length,
    1,
    'Explicit blank cell must stay BLANK and not become ABSENT'
  );
  assert.ok(stats.awaitingReview >= 7);
  console.log('✓ Test 2 passed: Empty class roster unmapped flagging + BLANK/UNCERTAIN integrity + no auto-confirm');

  // 3. Draft preservation & post-confirmation cleanup
  saveStoredSessionDraft(emptyClassDraft);
  assert.equal(getStoredSessionDrafts().length, 1);
  deleteStoredSessionDraft(emptyClassDraft.id);
  assert.equal(getStoredSessionDrafts().length, 0, 'Confirmed draft must be cleaned up from local draft storage');
  console.log('✓ Test 3 passed: Confirmed draft cleanup verified');

  // 4. Clean slate default check (no pre-seeded mock schools/rosters/sessions)
  assert.equal(initialSampleClasses.length, 0, 'Default sample classes must start empty');
  assert.equal(initialSampleStudents.length, 0, 'Default sample students must start empty');
  assert.equal(sampleAttendanceSessions.length, 0, 'Default sample sessions must start empty');
  console.log('✓ Test 4 passed: Clean-slate empty default roster & sessions verified');

  // 5. Gemini 429 RESOURCE_EXHAUSTED fallback detection & clean formatting
  const raw429Err = new Error(
    JSON.stringify({
      error: {
        code: 429,
        message: 'You exceeded your current quota, limit: 20, model: gemini-4-hydrogen',
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '42081s' }]
      }
    })
  );
  assert.equal(shouldFallbackFromGeminiError(raw429Err), true);
  assert.equal(isQuotaExhaustedError(raw429Err), true);
  const formatted429 = formatGeminiApiError(raw429Err, 'ROSTER_EXTRACT_ERROR', 'Failed');
  assert.equal(formatted429.httpStatus, 429);
  assert.equal(formatted429.code, 'QUOTA_EXCEEDED');
  assert.ok(!formatted429.error.startsWith('{'), 'Formatted error must never expose raw JSON');
  assert.ok(formatted429.error.includes('11h 42m') || formatted429.error.includes('11h'), 'Should include friendly retry duration');
  console.log('✓ Test 5 passed: Gemini 429 fallback trigger and clean quota formatting verified');

  // 6. Google Cloud Vision row reconstruction & roster extraction parser
  const mockAnnotation = {
    text: '1\nAbubakar Aliyu\n/\n2\nZainab Bello\n0',
    pages: [
      {
        blocks: [
          {
            paragraphs: [
              {
                words: [
                  { symbols: [{ text: '1' }], boundingBox: { vertices: [{ x: 10, y: 100 }, { x: 20, y: 100 }, { x: 20, y: 120 }, { x: 10, y: 120 }] } },
                  { symbols: [{ text: 'Abubakar' }], boundingBox: { vertices: [{ x: 50, y: 102 }, { x: 120, y: 102 }, { x: 120, y: 122 }, { x: 50, y: 122 }] } },
                  { symbols: [{ text: 'Aliyu' }], boundingBox: { vertices: [{ x: 130, y: 101 }, { x: 170, y: 101 }, { x: 170, y: 121 }, { x: 130, y: 121 }] } },
                  { symbols: [{ text: '/' }], boundingBox: { vertices: [{ x: 250, y: 100 }, { x: 260, y: 100 }, { x: 260, y: 120 }, { x: 250, y: 120 }] } },
                  { symbols: [{ text: '2' }], boundingBox: { vertices: [{ x: 10, y: 150 }, { x: 20, y: 150 }, { x: 20, y: 170 }, { x: 10, y: 170 }] } },
                  { symbols: [{ text: 'Zainab' }], boundingBox: { vertices: [{ x: 50, y: 151 }, { x: 110, y: 151 }, { x: 110, y: 171 }, { x: 50, y: 171 }] } },
                  { symbols: [{ text: 'Bello' }], boundingBox: { vertices: [{ x: 120, y: 152 }, { x: 165, y: 152 }, { x: 165, y: 172 }, { x: 120, y: 172 }] } }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const reconstructed = reconstructRowsFromVisionAnnotation(mockAnnotation);
  assert.equal(reconstructed, '1 Abubakar Aliyu /\n2 Zainab Bello');
  const parsedRoster = parseVisionOCRToRoster('CLASS: Primary 4A\nS/N FULL NAME\n1 Abubakar Aliyu ADM/2026/01\n2. Zainab Bello');
  assert.equal(parsedRoster.classDetected, 'Primary 4A');
  assert.equal(parsedRoster.students.length, 2);
  assert.equal(parsedRoster.students[0].fullName, 'Abubakar Aliyu');
  assert.equal(parsedRoster.students[0].admissionNumber, 'ADM/2026/01');
  assert.equal(parsedRoster.students[1].studentNumber, 2);

  const parsedAttendance = parseVisionOCRToAttendance(
    'CLASS : Primary 4A\n1 Abubakar Aliyu /\n2 Zainab Bello 0\n3 Musa Garba LEA/2026/009 X sick\n4 Amina Yusuf',
    'Primary 4A',
    '2026-11-16'
  );
  assert.equal(parsedAttendance.rows.length, 4);
  assert.equal(parsedAttendance.rows[0].studentNameDetected, 'Abubakar Aliyu');
  assert.equal(parsedAttendance.rows[0].marks[0].status, 'PRESENT');
  assert.equal(parsedAttendance.rows[1].studentNameDetected, 'Zainab Bello');
  assert.equal(parsedAttendance.rows[1].marks[0].status, 'ABSENT');
  assert.equal(parsedAttendance.rows[2].studentNameDetected, 'Musa Garba');
  assert.equal(parsedAttendance.rows[2].admissionNumberDetected, 'LEA/2026/009');
  assert.equal(parsedAttendance.rows[2].marks[0].status, 'ABSENT');
  assert.equal(parsedAttendance.rows[2].marks[0].notes, 'Sick / Illness');
  assert.equal(parsedAttendance.rows[3].studentNameDetected, 'Amina Yusuf');
  assert.equal(parsedAttendance.rows[3].marks[0].status, 'BLANK');
  console.log('✓ Test 6 passed: Google Cloud Vision spatial row reconstruction, attendance parser, and roster parser verified');

  // 7. Single & bulk local attendance record deletion
  clearAllStoredAttendanceRecords();
  assert.equal(getStoredAttendanceSessions().length, 0);

  const sessionA: AttendanceSession = { ...sessionWithLegacyPhoto, id: 'ses-del-a' };
  const sessionB: AttendanceSession = { ...sessionWithLegacyPhoto, id: 'ses-del-b' };
  addStoredAttendanceSession(sessionA);
  addStoredAttendanceSession(sessionB);
  assert.equal(getStoredAttendanceSessions().length, 2);

  const afterSingleDelete = deleteStoredAttendanceSession('ses-del-a');
  assert.equal(afterSingleDelete.length, 1);
  assert.equal(afterSingleDelete[0].id, 'ses-del-b');

  saveStoredSessionDraft(emptyClassDraft);
  assert.equal(getStoredSessionDrafts().length, 1);

  clearAllStoredAttendanceRecords();
  assert.equal(getStoredAttendanceSessions().length, 0);
  assert.equal(getStoredSessionDrafts().length, 0);
  console.log('✓ Test 7 passed: Single & bulk local attendance session deletion verified');

  console.log('\nAll Pilot Readiness & Security Tests Passed!');
}

runPilotReadinessTests();
