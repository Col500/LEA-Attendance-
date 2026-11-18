import assert from 'node:assert/strict';
import {
  clampCropBox,
  computeAspectPreservingSize,
  computeRotatedDimensions,
  computeTableRowStrips,
  normalizeQuarterRotation
} from './imagePreprocessing';
import {
  buildCellLevelVerificationPrompt,
  buildRegisterAnalysisPrompt,
  mergeStagedCellResults
} from './registerAnalysisPrompt';
import { validateAndBuildSessionDraft } from './attendanceValidation';
import {
  getLabeledRegisterTestFixtures,
  runFixtureValidationBenchmark
} from './registerTestWorkflow';
import type { GeminiExtractionResult, Student } from '../types/attendance';

const sampleStudents: Student[] = [
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
  }
];

// 1. Image Preprocessing Geometry Tests
{
  const scaled = computeAspectPreservingSize(5200, 2600, 2600);
  assert.equal(scaled.width, 2600);
  assert.equal(scaled.height, 1300);
  assert.equal(scaled.wasResized, true);

  const notUpscaled = computeAspectPreservingSize(1200, 800, 2600);
  assert.equal(notUpscaled.width, 1200);
  assert.equal(notUpscaled.height, 800);
  assert.equal(notUpscaled.wasResized, false);

  assert.equal(normalizeQuarterRotation(450), 90);
  assert.equal(normalizeQuarterRotation(-90), 270);

  const rot90 = computeRotatedDimensions(1200, 800, 90);
  assert.deepEqual(rot90, { width: 800, height: 1200 });

  // Near-full frame normalizes to null so full image isn't unnecessarily cropped
  assert.equal(clampCropBox({ x: 0, y: 0, width: 1, height: 1 }), null);
  const clamped = clampCropBox({ x: -0.1, y: 0.1, width: 0.5, height: 0.8 });
  assert.ok(clamped !== null && clamped.x === 0 && clamped.y === 0.1);

  const strips = computeTableRowStrips({ ymin: 100, xmin: 50, ymax: 900, xmax: 950 }, 2);
  assert.equal(strips.length, 2);
  assert.equal(strips[0].ymin, 100);
  assert.equal(strips[1].ymax, 900);
  // Overlapping boundary check ensures rows near middle aren't clipped
  assert.ok(strips[0].ymax > strips[1].ymin);
}

// 2. Register Prompt Structure & Template Non-Assumption Tests
{
  const prompt = buildRegisterAnalysisPrompt({
    className: 'Primary 4A',
    formatMode: 'multi-week',
    period: 'morning',
    date: '2026-10-09',
    rotation: 90,
    wasCropped: true
  });

  assert.ok(prompt.includes('page boundaries'));
  assert.ok(prompt.includes('attendance-table boundaries'));
  assert.ok(prompt.includes('week headings'));
  assert.ok(prompt.includes('weekday headings'));
  assert.ok(prompt.includes('student-row boundaries'));
  assert.ok(prompt.includes('Corrections & overwritten marks'));
  assert.ok(prompt.includes('Do NOT assume every register page uses an identical template'));
  assert.ok(prompt.includes('NEVER convert BLANK into ABSENT'));
  assert.ok(prompt.includes('NEVER GUESS or infer'));

  const cellPrompt = buildCellLevelVerificationPrompt({
    className: 'Primary 4A',
    detectedWeeks: ['Week 1'],
    detectedDays: ['Monday', 'Tuesday'],
    targetSlots: [{ rowNumber: 2, studentName: 'Amina', week: 'Week 1', day: 'Tuesday' }]
  });
  assert.ok(cellPrompt.includes('Row #2 (Amina): Week 1 / Tuesday'));
  assert.ok(cellPrompt.includes('NEVER guess or infer'));
}

// 3. Staged Cell Verification Merge Tests (Conflicting detections -> UNCERTAIN, never neighbor-inferred)
{
  const stage1: GeminiExtractionResult = {
    totalRowsDetected: 1,
    rows: [
      {
        rowNumber: 1,
        studentNameDetected: 'Abubakar Aliyu',
        marks: [
          { week: 'Week 1', day: 'Monday', status: 'UNCERTAIN', rawSymbol: '?' },
          { week: 'Week 1', day: 'Tuesday', status: 'PRESENT', rawSymbol: '/' }
        ]
      }
    ],
    overallConfidence: 'LOW'
  };

  const merged = mergeStagedCellResults(stage1, [
    // Resolving a previously UNCERTAIN cell
    { rowNumber: 1, week: 'Week 1', day: 'Monday', status: 'ABSENT', rawSymbol: '0' },
    // Disagreement on Tuesday: Stage 1 said PRESENT (/), Stage 2 says ABSENT (0) -> must force UNCERTAIN
    { rowNumber: 1, week: 'Week 1', day: 'Tuesday', status: 'ABSENT', rawSymbol: '0' }
  ]);

  assert.equal(merged.processingStageUsed, 'staged-cell-verification');
  assert.equal(merged.rows[0].marks[0].status, 'ABSENT');
  assert.equal(merged.rows[0].marks[1].status, 'UNCERTAIN');
  assert.equal(merged.rows[0].marks[1].isCorrectionOrOverwritten, true);
}

// 4. Uncertainty & Structural Validation Tests (MISSING_ROW, UNCERTAIN_HEADING, OVERWRITTEN_MARK, CONFLICTING_DETECTION, BLANK != ABSENT)
{
  const payload: GeminiExtractionResult = {
    layoutQuality: {
      pageBoundariesDetected: true,
      tableBoundariesDetected: true,
      detectedWeeks: ['Week 1'],
      uncertainHeadings: ['Week 1 Wednesday'],
      layoutTooDistorted: false
    },
    totalRowsDetected: 2,
    rows: [
      {
        rowNumber: 1,
        studentNameDetected: 'Abubakar Aliyu',
        admissionNumberDetected: 'LEA/2021/0014',
        marks: [
          { week: 'Week 1', day: 'Monday', status: 'BLANK', rawSymbol: '' },
          {
            week: 'Week 1',
            day: 'Tuesday',
            status: 'PRESENT',
            rawSymbol: '/ over 0',
            isCorrectionOrOverwritten: true
          },
          // Disagreeing duplicate detections on Friday -> must force UNCERTAIN + CONFLICTING_DETECTION
          { week: 'Week 1', day: 'Friday', status: 'PRESENT', rawSymbol: '/' },
          { week: 'Week 1', day: 'Friday', status: 'ABSENT', rawSymbol: '0' }
        ]
      },
      // Row 2 omitted intentionally to verify MISSING_ROW gap warning!
      {
        rowNumber: 3,
        studentNameDetected: 'Blessing Chinaza Okafor',
        admissionNumberDetected: 'LEA/2021/0045',
        marks: [{ week: 'Week 1', day: 'Monday', status: 'PRESENT', rawSymbol: '/' }]
      }
    ]
  };

  const draft = validateAndBuildSessionDraft(payload, {
    classId: 'cls-p4a',
    className: 'Primary 4A',
    attendancePeriod: '2026-10-09 (Morning)',
    sourceImageMetadata: {
      fileName: 'test.jpg',
      rotation: 0,
      capturedAt: new Date().toISOString(),
      modelUsed: 'gemini-4-hydrogen'
    },
    classStudents: sampleStudents
  });

  const issueCodes = new Set(draft.validationIssues.map((i) => i.code));
  assert.ok(issueCodes.has('UNCERTAIN_HEADING'));
  assert.ok(issueCodes.has('MISSING_ROW'));
  assert.ok(issueCodes.has('OVERWRITTEN_MARK'));
  assert.ok(issueCodes.has('CONFLICTING_DETECTION'));

  const row1Mon = draft.cells.find(
    (c) => c.rowNumber === 1 && c.weekIdentifier === 'Week 1' && c.dayOfWeek === 'Monday'
  );
  assert.equal(row1Mon?.status, 'BLANK'); // Never converted to ABSENT

  const row1Tue = draft.cells.find(
    (c) => c.rowNumber === 1 && c.weekIdentifier === 'Week 1' && c.dayOfWeek === 'Tuesday'
  );
  assert.equal(row1Tue?.isCorrectionOrOverwritten, true);
  assert.equal(row1Tue?.reviewRequired, true);

  const row1Fri = draft.cells.find(
    (c) => c.rowNumber === 1 && c.weekIdentifier === 'Week 1' && c.dayOfWeek === 'Friday'
  );
  assert.equal(row1Fri?.hasConflictingDetection, true);
  assert.equal(row1Fri?.status, 'UNCERTAIN'); // Forced UNCERTAIN, never guessed
}

// 5. Repeatable Labeled Benchmark Fixtures Workflow Tests
{
  const fixtures = getLabeledRegisterTestFixtures();
  assert.equal(fixtures.length, 3);

  const outcomes = fixtures.map((f) => runFixtureValidationBenchmark(f, sampleStudents).outcome);
  // Clean overhead fixture: zero definitive mismatches, zero failure categories other than faint ink
  assert.equal(outcomes[0].exactMatches, outcomes[0].totalExpectedCells);
  assert.equal(outcomes[0].mismatchedDefinitiveCount, 0);

  // Multi-week corrections & gaps fixture detects overwritten corrections, missing row, uncertain heading
  assert.ok(outcomes[1].failureCategories.includes('MISSING_OR_SKIPPED_ROW'));
  assert.ok(outcomes[1].failureCategories.includes('OVERWRITTEN_CORRECTION'));
  assert.ok(outcomes[1].failureCategories.includes('HEADING_UNCERTAINTY'));
  assert.equal(outcomes[1].mismatchedDefinitiveCount, 0);

  // Distorted fixture flags layout distortion & conflicting duplicate without guessing
  assert.equal(outcomes[2].layoutDistortionFlagged, true);
  assert.ok(outcomes[2].failureCategories.includes('EXCESSIVE_MARGIN_OR_SKEW'));
  assert.ok(outcomes[2].failureCategories.includes('CONFLICTING_DUPLICATE'));
  assert.equal(outcomes[2].mismatchedDefinitiveCount, 0);
}

console.log('✅ All register preprocessing, prompt, staged verification & benchmark tests passed!');
