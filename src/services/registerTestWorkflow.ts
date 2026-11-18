import type {
  AttendanceSessionDraft,
  DayOfWeek,
  GeminiExtractionResult,
  RegisterFailureCategory,
  RegisterTestOutcome,
  Student,
  ValidatedAttendanceStatus
} from '../types/attendance';
import { validateAndBuildSessionDraft } from './attendanceValidation';

export interface LabeledRegisterCell {
  rowNumber: number;
  weekIdentifier: string;
  dayOfWeek: DayOfWeek;
  expectedStatus: ValidatedAttendanceStatus;
}

export interface RegisterTestFixture {
  id: 'clean-daily' | 'rotated-cropped-daily' | 'multiweek-corrections-gaps' | 'distorted-clip-layout';
  label: string;
  description: string;
  className: string;
  simulatedPayload: GeminiExtractionResult;
  expectedCells: LabeledRegisterCell[];
}

export function getLabeledRegisterTestFixtures(): RegisterTestFixture[] {
  return [
    {
      id: 'clean-daily',
      label: '1. Clean Overhead Register (Friday Daily)',
      description: 'Well-lit 5-row excerpt with / Present, 0 Absent, and 1 faint ambiguous mark.',
      className: 'Primary 4A',
      simulatedPayload: {
        schoolIdentified: 'L.E.A. Primary School, Wuse III',
        classIdentified: 'Primary 4A',
        periodIdentified: '2026-10-09 (Morning)',
        layoutNotes: 'Clear page and attendance-table boundaries detected.',
        layoutQuality: {
          pageBoundariesDetected: true,
          tableBoundariesDetected: true,
          tableBoundingBox: { ymin: 120, xmin: 40, ymax: 910, xmax: 960 },
          detectedWeeks: ['Week 1'],
          uncertainHeadings: [],
          layoutTooDistorted: false,
          retakeOrCropAdvice: null
        },
        processingStageUsed: 'whole-page',
        totalRowsDetected: 4,
        detectedDays: ['Friday'],
        rows: [
          {
            rowNumber: 1,
            studentNameDetected: 'Abubakar Aliyu',
            admissionNumberDetected: 'LEA/2021/0014',
            marks: [{ week: 'Week 1', day: 'Friday', status: 'PRESENT', rawSymbol: '/' }]
          },
          {
            rowNumber: 2,
            studentNameDetected: 'Amina Yusuf Balarabe',
            admissionNumberDetected: 'LEA/2021/0022',
            marks: [{ week: 'Week 1', day: 'Friday', status: 'PRESENT', rawSymbol: '/' }]
          },
          {
            rowNumber: 3,
            studentNameDetected: 'Chukwuma David Eze',
            admissionNumberDetected: 'LEA/2021/0056',
            marks: [{ week: 'Week 1', day: 'Friday', status: 'ABSENT', rawSymbol: '0' }]
          },
          {
            rowNumber: 4,
            studentNameDetected: 'Goodness Oluwaseun Adeleke',
            admissionNumberDetected: 'LEA/2021/0115',
            marks: [
              {
                week: 'Week 1',
                day: 'Friday',
                status: 'UNCERTAIN',
                rawSymbol: '?',
                notes: 'Faint pencil mark near line'
              }
            ]
          }
        ],
        ambiguityDetected: true,
        overallConfidence: 'HIGH'
      },
      expectedCells: [
        { rowNumber: 1, weekIdentifier: 'Week 1', dayOfWeek: 'Friday', expectedStatus: 'PRESENT' },
        { rowNumber: 2, weekIdentifier: 'Week 1', dayOfWeek: 'Friday', expectedStatus: 'PRESENT' },
        { rowNumber: 3, weekIdentifier: 'Week 1', dayOfWeek: 'Friday', expectedStatus: 'ABSENT' },
        { rowNumber: 4, weekIdentifier: 'Week 1', dayOfWeek: 'Friday', expectedStatus: 'UNCERTAIN' }
      ]
    },
    {
      id: 'multiweek-corrections-gaps',
      label: '2. Multi-Week With Blank, Overwritten & Missing Row',
      description: 'Tests BLANK != ABSENT, overwritten stroke flagging, uncertain heading, and Row #3 skipped.',
      className: 'Primary 4A',
      simulatedPayload: {
        schoolIdentified: 'L.E.A. Primary School, Wuse III',
        classIdentified: 'Primary 4A',
        periodIdentified: 'Weeks 1-2',
        layoutNotes: 'Row #3 obscured/skipped; Week 2 Thursday header faint.',
        layoutQuality: {
          pageBoundariesDetected: true,
          tableBoundariesDetected: true,
          tableBoundingBox: { ymin: 100, xmin: 50, ymax: 930, xmax: 950 },
          detectedWeeks: ['Week 1', 'Week 2'],
          uncertainHeadings: ['Week 2 Thursday'],
          layoutTooDistorted: false,
          retakeOrCropAdvice: null
        },
        processingStageUsed: 'staged-cell-verification',
        totalRowsDetected: 3,
        detectedDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        rows: [
          {
            rowNumber: 1,
            studentNameDetected: 'Abubakar Aliyu',
            admissionNumberDetected: 'LEA/2021/0014',
            marks: [
              { week: 'Week 1', day: 'Monday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Tuesday', status: 'BLANK', rawSymbol: '', notes: 'Empty cell' },
              {
                week: 'Week 1',
                day: 'Wednesday',
                status: 'UNCERTAIN',
                rawSymbol: '0/',
                isCorrectionOrOverwritten: true,
                notes: 'Tick overwritten on 0'
              },
              { week: 'Week 1', day: 'Thursday', status: 'ABSENT', rawSymbol: '0' },
              { week: 'Week 1', day: 'Friday', status: 'PRESENT', rawSymbol: '/' }
            ]
          },
          {
            rowNumber: 2,
            studentNameDetected: 'Amina Yusuf Balarabe',
            admissionNumberDetected: 'LEA/2021/0022',
            marks: [
              { week: 'Week 1', day: 'Monday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Tuesday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Wednesday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Thursday', status: 'ABSENT', rawSymbol: '0' },
              { week: 'Week 1', day: 'Friday', status: 'PRESENT', rawSymbol: '/' }
            ]
          },
          // Row #3 intentionally missing to test MISSING_ROW gap alert
          {
            rowNumber: 4,
            studentNameDetected: 'Chukwuma David Eze',
            admissionNumberDetected: 'LEA/2021/0056',
            marks: [
              { week: 'Week 1', day: 'Monday', status: 'ABSENT', rawSymbol: '0' },
              { week: 'Week 1', day: 'Tuesday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Wednesday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Thursday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Friday', status: 'BLANK', rawSymbol: '' }
            ]
          }
        ],
        ambiguityDetected: true,
        overallConfidence: 'MEDIUM'
      },
      expectedCells: [
        { rowNumber: 1, weekIdentifier: 'Week 1', dayOfWeek: 'Monday', expectedStatus: 'PRESENT' },
        { rowNumber: 1, weekIdentifier: 'Week 1', dayOfWeek: 'Tuesday', expectedStatus: 'BLANK' },
        { rowNumber: 1, weekIdentifier: 'Week 1', dayOfWeek: 'Wednesday', expectedStatus: 'UNCERTAIN' },
        { rowNumber: 1, weekIdentifier: 'Week 1', dayOfWeek: 'Thursday', expectedStatus: 'ABSENT' },
        { rowNumber: 1, weekIdentifier: 'Week 1', dayOfWeek: 'Friday', expectedStatus: 'PRESENT' },
        { rowNumber: 4, weekIdentifier: 'Week 1', dayOfWeek: 'Friday', expectedStatus: 'BLANK' }
      ]
    },
    {
      id: 'distorted-clip-layout',
      label: '3. Distorted / Shadowed / Clipped Sheet',
      description: 'Tests layoutTooDistorted crop/retake warning and conflicting duplicate handling.',
      className: 'Primary 4A',
      simulatedPayload: {
        schoolIdentified: null,
        classIdentified: 'Primary 4A',
        periodIdentified: null,
        layoutNotes: 'Strong desk shadow across right columns and skewed camera angle.',
        layoutQuality: {
          pageBoundariesDetected: false,
          tableBoundariesDetected: false,
          tableBoundingBox: null,
          detectedWeeks: ['Week 1'],
          uncertainHeadings: ['Week 1 Friday'],
          layoutTooDistorted: true,
          retakeOrCropAdvice:
            'Right-hand columns are shadowed and angled. Crop to the attendance table or retake directly overhead.'
        },
        processingStageUsed: 'whole-page',
        totalRowsDetected: 2,
        detectedDays: ['Monday', 'Friday'],
        rows: [
          {
            rowNumber: 1,
            studentNameDetected: 'Abubakar Aliyu',
            marks: [
              { week: 'Week 1', day: 'Monday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Friday', status: 'PRESENT', rawSymbol: '/' },
              { week: 'Week 1', day: 'Friday', status: 'ABSENT', rawSymbol: '0' } // Conflicting duplicate
            ]
          }
        ],
        ambiguityDetected: true,
        overallConfidence: 'LOW'
      },
      expectedCells: [
        { rowNumber: 1, weekIdentifier: 'Week 1', dayOfWeek: 'Monday', expectedStatus: 'PRESENT' },
        { rowNumber: 1, weekIdentifier: 'Week 1', dayOfWeek: 'Friday', expectedStatus: 'UNCERTAIN' }
      ]
    }
  ];
}

/**
 * Evaluates a validated AttendanceSessionDraft against a labeled fixture's ground truth.
 * Reports exact matches and failure modes strictly for the tested fixture (never claims unmeasured accuracy).
 */
export function evaluateExtractionAgainstGroundTruth(params: {
  fixture: RegisterTestFixture;
  draft: AttendanceSessionDraft;
  extraction: GeminiExtractionResult;
  modelUsed: string;
}): RegisterTestOutcome {
  const { fixture, draft, extraction, modelUsed } = params;

  let exactMatches = 0;
  let uncertainOrFlaggedCount = 0;
  let mismatchedDefinitiveCount = 0;

  fixture.expectedCells.forEach((exp) => {
    const matchedCells = draft.cells.filter(
      (c) =>
        c.rowNumber === exp.rowNumber &&
        c.weekIdentifier === exp.weekIdentifier &&
        c.dayOfWeek === exp.dayOfWeek
    );
    const cell = matchedCells[0];
    if (!cell) {
      uncertainOrFlaggedCount += 1;
      return;
    }

    if (cell.status === exp.expectedStatus) {
      exactMatches += 1;
    } else if (cell.status === 'UNCERTAIN') {
      uncertainOrFlaggedCount += 1;
    } else {
      mismatchedDefinitiveCount += 1;
    }
  });

  const failureCategories: RegisterFailureCategory[] = [];
  const hasMissingRow = draft.validationIssues.some((i) => i.code === 'MISSING_ROW');
  const hasOverwritten = draft.validationIssues.some((i) => i.code === 'OVERWRITTEN_MARK');
  const hasUncertainHeading = draft.validationIssues.some((i) => i.code === 'UNCERTAIN_HEADING');
  const hasConflict = draft.validationIssues.some((i) => i.code === 'CONFLICTING_DETECTION');
  const hasAmbiguous = draft.cells.some((c) => c.status === 'UNCERTAIN');
  const layoutDistorted = Boolean(extraction.layoutQuality?.layoutTooDistorted);

  if (layoutDistorted) failureCategories.push('EXCESSIVE_MARGIN_OR_SKEW');
  if (hasAmbiguous) failureCategories.push('FAINT_OR_AMBIGUOUS_INK');
  if (hasOverwritten) failureCategories.push('OVERWRITTEN_CORRECTION');
  if (hasMissingRow) failureCategories.push('MISSING_OR_SKIPPED_ROW');
  if (hasUncertainHeading) failureCategories.push('HEADING_UNCERTAINTY');
  if (hasConflict) failureCategories.push('CONFLICTING_DUPLICATE');
  if (failureCategories.length === 0) failureCategories.push('NONE');

  const missingRowGapsDetected = draft.validationIssues.filter((i) => i.code === 'MISSING_ROW').length;

  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fixtureId: fixture.id,
    fixtureLabel: fixture.label,
    testedAt: new Date().toISOString(),
    modelUsed,
    stageUsed: extraction.processingStageUsed || 'whole-page',
    totalExpectedCells: fixture.expectedCells.length,
    exactMatches,
    uncertainOrFlaggedCount,
    mismatchedDefinitiveCount,
    missingRowGapsDetected,
    layoutDistortionFlagged: layoutDistorted,
    failureCategories,
    notes:
      mismatchedDefinitiveCount === 0
        ? `Human-review preserved (${draft.cells.filter((c) => c.reviewRequired).length} flagged cells).`
        : `${mismatchedDefinitiveCount} definitive status mismatch(es) observed vs labeled ground truth.`
  };
}

export function runFixtureValidationBenchmark(
  fixture: RegisterTestFixture,
  classStudents: Student[]
): { draft: AttendanceSessionDraft; outcome: RegisterTestOutcome } {
  const draft = validateAndBuildSessionDraft(fixture.simulatedPayload, {
    classId: classStudents[0]?.classId || 'cls-p4a',
    className: fixture.className,
    attendancePeriod: fixture.simulatedPayload.periodIdentified || 'Test Benchmark',
    sourceImageMetadata: {
      fileName: `BENCHMARK_${fixture.id}.png`,
      rotation: 0,
      capturedAt: new Date().toISOString(),
      modelUsed: 'Labeled Benchmark Suite'
    },
    classStudents
  });

  const outcome = evaluateExtractionAgainstGroundTruth({
    fixture,
    draft,
    extraction: fixture.simulatedPayload,
    modelUsed: 'Labeled Benchmark Suite'
  });

  return { draft, outcome };
}

const OUTCOMES_STORAGE_KEY = 'lea_register_test_outcomes_v1';

export function getStoredRegisterTestOutcomes(): RegisterTestOutcome[] {
  try {
    const raw = localStorage.getItem(OUTCOMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRegisterTestOutcome(outcome: RegisterTestOutcome): RegisterTestOutcome[] {
  const updated = [outcome, ...getStoredRegisterTestOutcomes()].slice(0, 15);
  try {
    localStorage.setItem(OUTCOMES_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota errors
  }
  return updated;
}

export function clearStoredRegisterTestOutcomes(): void {
  try {
    localStorage.removeItem(OUTCOMES_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
