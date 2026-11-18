import assert from 'node:assert/strict';
import {
  createValidationTestSamples,
  getReviewQueueStats,
  markDraftCellReviewed,
  normalizeWeekIdentifier,
  normalizeWeekday,
  reassignDraftCellSchedule,
  updateDraftCellStatus,
  updateDraftRowMapping,
  validateAndBuildSessionDraft
} from './attendanceValidation';
import { Student } from '../types/attendance';

const classStudents: Student[] = [
  {
    id: 'std-101',
    studentNumber: 1,
    fullName: 'Abubakar Aliyu',
    classId: 'cls-p4a',
    admissionNumber: 'LEA/2021/0014',
    active: true,
    createdAt: '2026-09-01T08:15:00.000Z',
    updatedAt: '2026-09-01T08:15:00.000Z'
  },
  {
    id: 'std-102',
    studentNumber: 2,
    fullName: 'Amina Yusuf Balarabe',
    classId: 'cls-p4a',
    admissionNumber: 'LEA/2021/0022',
    active: true,
    createdAt: '2026-09-01T08:15:00.000Z',
    updatedAt: '2026-09-01T08:15:00.000Z'
  },
  {
    id: 'std-103',
    studentNumber: 3,
    fullName: 'Blessing Chinaza Okafor',
    classId: 'cls-p4a',
    admissionNumber: 'LEA/2021/0045',
    active: true,
    createdAt: '2026-09-01T08:15:00.000Z',
    updatedAt: '2026-09-01T08:15:00.000Z'
  },
  {
    id: 'std-104',
    studentNumber: 4,
    fullName: 'Chukwuma David Eze',
    classId: 'cls-p4a',
    admissionNumber: 'LEA/2021/0056',
    active: true,
    createdAt: '2026-09-01T08:15:00.000Z',
    updatedAt: '2026-09-01T08:15:00.000Z'
  },
  {
    id: 'std-114',
    studentNumber: 14,
    fullName: 'Sadiq Umar Faruq',
    classId: 'cls-p4a',
    admissionNumber: 'LEA/2021/0219',
    active: true,
    createdAt: '2026-09-01T08:15:00.000Z',
    updatedAt: '2026-09-01T08:15:00.000Z'
  }
];

const baseContext = {
  classId: 'cls-p4a',
  className: 'Primary 4A',
  attendancePeriod: 'Weeks 1 & 2 - First Term 2026/2027',
  sourceImageMetadata: {
    fileName: 'test-register.jpg',
    rotation: 0,
    capturedAt: '2026-11-15T09:00:00.000Z',
    modelUsed: 'gemini-3.8-flash'
  },
  sourceImageReference: 'test-register.jpg',
  classStudents
};

console.log('Running Attendance Validation & Human-Review Test Suite...\n');

// Test 1: Valid Multi-Week Sample + Out-of-Order Student Mapping + Missing & Blank Cells
{
  const { validMultiWeekSample } = createValidationTestSamples();
  const draft = validateAndBuildSessionDraft(validMultiWeekSample, baseContext);

  assert.equal(draft.weeksDetected.length, 2, 'Should detect 2 weeks');
  assert.deepEqual(draft.weeksDetected, ['Week 1', 'Week 2']);
  assert.equal(draft.rowMappings.length, 3, 'Should retain all 3 valid rows');

  // Row 1 on register is Chukwuma David Eze (DB student #4 = std-104), NOT DB #1 (std-101)
  const row1Map = draft.rowMappings.find((m) => m.rowNumber === 1)!;
  assert.equal(row1Map.studentId, 'std-104', 'Should map by identity, NOT blindly row 1 -> DB #1');
  assert.equal(row1Map.mappingConfidence, 'EXACT_ADMISSION');

  // Row 3 is "Sadiq Faruk (Faint)" — does NOT match Blessing (#3) and is partial/ambiguous -> must stay unmapped (null)
  const row3Map = draft.rowMappings.find((m) => m.rowNumber === 3)!;
  assert.equal(row3Map.studentId, null, 'Unreliable student row must remain null until admin confirms');
  assert.equal(row3Map.reviewRequired, true, 'Unmapped row must be flagged for review');

  // Verify BLANK stays BLANK (Row 1 Week 2 Tuesday) — never converted to ABSENT
  const blankCell = draft.cells.find(
    (c) => c.rowNumber === 1 && c.weekIdentifier === 'Week 2' && c.dayOfWeek === 'Tuesday'
  )!;
  assert.equal(blankCell.status, 'BLANK', 'Blank physical cell must remain BLANK, not ABSENT');

  // Verify UNCERTAIN stays UNCERTAIN (Row 1 Week 2 Thursday)
  const uncertainCell = draft.cells.find(
    (c) => c.rowNumber === 1 && c.weekIdentifier === 'Week 2' && c.dayOfWeek === 'Thursday'
  )!;
  assert.equal(uncertainCell.status, 'UNCERTAIN', 'Ambiguous mark must remain UNCERTAIN');
  assert.equal(uncertainCell.reviewRequired, true);

  // Verify missing AI cells (Row 3 omitted Thu/Fri & Week 2) are flagged MISSING_CELL, NEVER ABSENT
  const missingThu = draft.cells.find(
    (c) => c.rowNumber === 3 && c.weekIdentifier === 'Week 1' && c.dayOfWeek === 'Thursday'
  )!;
  assert.equal(missingThu.status, 'UNCERTAIN', 'Missing AI response must NOT default to ABSENT');
  assert.equal(missingThu.isMissingFromAI, true);
  assert.equal(missingThu.reviewRequired, true);

  // Verify manual student mapping update propagates to all cells in that row
  const remapped = updateDraftRowMapping(draft, 3, 'std-114', 'MANUAL');
  const remappedRow3 = remapped.rowMappings.find((m) => m.rowNumber === 3)!;
  assert.equal(remappedRow3.studentId, 'std-114');
  assert.equal(remappedRow3.mappingConfirmed, true);
  assert.ok(
    remapped.cells.filter((c) => c.rowNumber === 3).every((c) => c.studentId === 'std-114'),
    'Remapped studentId should propagate to all cells for row 3'
  );

  // Verify cell status update works cleanly
  const edited = updateDraftCellStatus(remapped, uncertainCell.id, 'PRESENT');
  const editedCell = edited.cells.find((c) => c.id === uncertainCell.id)!;
  assert.equal(editedCell.status, 'PRESENT');
  assert.equal(editedCell.reviewRequired, false);

  console.log('✓ Test 1 passed: Valid multi-week extraction, order-independent mapping, blank/uncertain/missing semantics');
}

// Test 2: Deliberately Malformed Payload (Bad rows, invalid status, invalid week, Saturday, duplicate Wednesday)
{
  const { malformedSample } = createValidationTestSamples();
  const draft = validateAndBuildSessionDraft(malformedSample, baseContext);

  assert.equal(draft.processingStatus, 'QUARANTINED', 'Malformed rows/cells must put draft in QUARANTINED state');
  assert.equal(draft.rowMappings.length, 1, 'Only positive integer row #1 should be accepted; row 0 and -2 quarantined');

  const issueCodes = new Set(draft.validationIssues.map((v) => v.code));
  assert.ok(issueCodes.has('INVALID_ROW_NUMBER'), 'Should flag invalid row numbers 0 and -2');
  assert.ok(issueCodes.has('INVALID_STATUS'), 'Should flag invalid status "LATE_EARLY"');
  assert.ok(issueCodes.has('INVALID_WEEK'), 'Should flag invalid week "Week 99"');
  assert.ok(issueCodes.has('INVALID_WEEKDAY'), 'Should flag invalid weekday "Saturday"');
  assert.ok(issueCodes.has('DUPLICATE_CELL'), 'Should flag duplicate Wednesday mark');
  assert.ok(issueCodes.has('MISSING_CELL'), 'Should flag missing Tuesday/Thursday cells');

  // Verify invalid status "LATE_EARLY" on Monday was quarantined to UNCERTAIN (never coerced to PRESENT/ABSENT)
  const monCell = draft.cells.find(
    (c) => c.rowNumber === 1 && c.weekIdentifier === 'Week 1' && c.dayOfWeek === 'Monday'
  )!;
  assert.equal(monCell.status, 'UNCERTAIN');
  assert.equal(monCell.reviewRequired, true);

  // Verify duplicate Wednesday cells are both flagged
  const wedCells = draft.cells.filter(
    (c) => c.rowNumber === 1 && c.weekIdentifier === 'Week 1' && c.dayOfWeek === 'Wednesday'
  );
  assert.equal(wedCells.length, 2, 'Duplicate cells should be preserved for inspection, not silently dropped');
  assert.ok(wedCells.every((c) => c.isDuplicate && c.reviewRequired));

  console.log('✓ Test 2 passed: Malformed statuses, bad weeks/weekdays, duplicate cells, invalid row numbers quarantined cleanly');
}

// Test 3: Completely Invalid Top-Level Payloads Must Be REJECTED
{
  const nullDraft = validateAndBuildSessionDraft(null, baseContext);
  assert.equal(nullDraft.processingStatus, 'REJECTED');
  assert.equal(nullDraft.cells.length, 0);

  const missingRowsDraft = validateAndBuildSessionDraft({ schoolIdentified: 'X' }, baseContext);
  assert.equal(missingRowsDraft.processingStatus, 'REJECTED');
  assert.ok(missingRowsDraft.validationIssues.some((v) => v.code === 'MISSING_REQUIRED_FIELD'));

  const stringDraft = validateAndBuildSessionDraft('corrupted string', baseContext);
  assert.equal(stringDraft.processingStatus, 'REJECTED');

  console.log('✓ Test 3 passed: Completely malformed top-level AI outputs rejected without coercion');
}

// Test 4: Strict Weekday & Week Identifier Normalizers
{
  assert.equal(normalizeWeekday('Mon'), 'Monday');
  assert.equal(normalizeWeekday('TH'), 'Thursday');
  assert.equal(normalizeWeekday('F (TODAY)'), 'Friday');
  assert.equal(normalizeWeekday('2026-10-09'), 'Friday');
  assert.equal(normalizeWeekday('Saturday'), null);
  assert.equal(normalizeWeekday('Sunday'), null);
  assert.equal(normalizeWeekday(''), null);

  assert.equal(normalizeWeekIdentifier('Wk 2').normalized, 'Week 2');
  assert.equal(normalizeWeekIdentifier('2026-W46').valid, true);
  assert.equal(normalizeWeekIdentifier('Week 0').valid, false);
  assert.equal(normalizeWeekIdentifier('Week 99').valid, false);
  assert.equal(normalizeWeekIdentifier('').valid, false);

  console.log('✓ Test 4 passed: Strict weekday and week identifier normalization');
}

// Test 5: Human-Review Queue Stats, Explicit Review Without Coercion, Schedule Reassignment & Edit History
{
  const { validMultiWeekSample } = createValidationTestSamples();
  let draft = validateAndBuildSessionDraft(validMultiWeekSample, baseContext);

  const initialStats = getReviewQueueStats(draft);
  assert.equal(initialStats.totalCells, 30, '3 rows x 2 weeks x 5 weekdays = 30 cells');
  assert.equal(initialStats.reviewedCells, 0, 'Must never auto-mark cells reviewed upon opening');
  assert.ok(initialStats.awaitingReview > 0, 'Draft with uncertain/unmapped cells must have awaitingReview > 0');
  assert.ok(initialStats.uncertainCells > 0, 'Must detect uncertain cells');
  assert.equal(initialStats.mappingIssueCells, 10, 'Unmapped row 3 spans 10 cells across 2 weeks');
  assert.ok(initialStats.nextUnresolvedCell !== null, 'Should point directly to first unresolved cell');

  // Explicitly mark an UNCERTAIN cell as reviewed WITHOUT converting it to PRESENT or ABSENT
  const uncertainCell = draft.cells.find(
    (c) => c.rowNumber === 1 && c.weekIdentifier === 'Week 2' && c.dayOfWeek === 'Thursday'
  )!;
  draft = markDraftCellReviewed(draft, uncertainCell.id);

  const reviewedUncertain = draft.cells.find((c) => c.id === uncertainCell.id)!;
  assert.equal(reviewedUncertain.reviewedByAdmin, true, 'Cell should be marked reviewed by admin');
  assert.equal(reviewedUncertain.status, 'UNCERTAIN', 'Must never silently change UNCERTAIN to PRESENT or ABSENT');
  assert.equal(draft.editHistory[0]?.field, 'reviewed', 'Review action should be logged in draft edit history');

  // Reassign student mapping and record studentId edit history
  draft = updateDraftRowMapping(draft, 3, 'std-114', 'MANUAL');
  const afterMapStats = getReviewQueueStats(draft);
  assert.equal(afterMapStats.mappingIssueCells, 0, 'Mapping issue cells must drop to 0 once row 3 is mapped');
  assert.equal(draft.editHistory[0]?.field, 'studentId');
  assert.equal(draft.editHistory[0]?.newValue, 'std-114');

  // Edit cell status and confirm original AI suggestion is preserved in history
  draft = updateDraftCellStatus(draft, uncertainCell.id, 'ABSENT');
  const updatedCell = draft.cells.find((c) => c.id === uncertainCell.id)!;
  assert.equal(updatedCell.status, 'ABSENT');
  assert.equal(updatedCell.originalAiStatus, 'UNCERTAIN', 'Must preserve original AI suggestion');
  assert.equal(draft.editHistory[0]?.originalAiSuggestion, 'UNCERTAIN');
  assert.equal(draft.editHistory[0]?.newValue, 'ABSENT');

  // Reassign cell week & weekday schedule
  const targetForSchedule = draft.cells.find(
    (c) => c.rowNumber === 2 && c.weekIdentifier === 'Week 1' && c.dayOfWeek === 'Friday'
  )!;
  draft = reassignDraftCellSchedule(draft, targetForSchedule.id, 'Week 3', 'Monday');
  const movedCell = draft.cells.find((c) => c.id === targetForSchedule.id)!;
  assert.equal(movedCell.weekIdentifier, 'Week 3');
  assert.equal(movedCell.dayOfWeek, 'Monday');
  assert.equal(movedCell.originalAiWeekIdentifier, 'Week 1');
  assert.equal(movedCell.originalAiDayOfWeek, 'Friday');
  assert.ok(draft.weeksDetected.includes('Week 3'), 'Weeks list should include reassigned week');
  assert.equal(draft.editHistory[0]?.field, 'schedule');
  assert.equal(draft.editHistory[0]?.newValue, 'Week 3 Monday');

  console.log('✓ Test 5 passed: Review queue stats, non-coercive explicit review, schedule reassignment, and edit history tracking');
}

console.log('\nALL VALIDATION & HUMAN-REVIEW TESTS PASSED.');
