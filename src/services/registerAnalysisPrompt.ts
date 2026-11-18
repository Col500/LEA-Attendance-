import type {
  GeminiExtractionMark,
  GeminiExtractionResult,
  GeminiExtractionRow,
  MarkStatus
} from '../types/attendance';

export interface RegisterPromptContext {
  className?: string;
  formatMode?: string;
  period?: string;
  date?: string;
  rotation?: number;
  wasCropped?: boolean;
}

/**
 * Builds the structured Stage 1 Gemini prompt for physical attendance register photographs.
 * Explicitly instructs Gemini to inspect page/table boundaries, headings, row lines,
 * overwritten corrections, blank vs absent vs uncertain marks, and layout distortion without guessing.
 */
export function buildRegisterAnalysisPrompt(ctx: RegisterPromptContext): string {
  return `You are an expert document vision inspector for primary school attendance registers.

The administrator has uploaded a photograph of a physical paper attendance register.

Context Provided:
- Target School Class: ${ctx.className || 'Unspecified'}
- Register Capture Mode: ${ctx.formatMode || 'daily'} (Single Day or Multi-Week grid — verify actual columns printed on the sheet)
- Expected Date: ${ctx.date || 'Current Session'}
- Preprocessing Applied: Rotation ${ctx.rotation || 0}°${ctx.wasCropped ? ', manually cropped to attendance region' : ''}

CRITICAL LAYOUT & BOUNDARY INSPECTION RULES:
1. Identify **page boundaries** where visible (is a ledger edge, fold, or adjacent page clipped or visible?).
2. Identify **attendance-table boundaries** in normalized 0..1000 image coordinates:
   - Return \`layoutQuality.tableBoundingBox\` as { "ymin", "xmin", "ymax", "xmax" } enclosing the header + student attendance grid.
3. Identify **week headings** (e.g. "Week 1", "Wk 2", or dated week headers) and **weekday headings** ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", or M/T/W/TH/F).
   - Do NOT assume every register page uses an identical template, fixed 4-week count, or identical column spacing.
   - If any week or weekday heading is cut off, illegible, or ambiguous, list it in \`layoutQuality.uncertainHeadings\`.
4. Identify **student-row boundaries** (S/N integer >= 1, horizontal grid lines, student name, admission number). Follow horizontal ledger rules carefully so marks are never shifted up or down by a row.
5. Assess whether the photograph layout is **too distorted, tilted, shadowed, blurry, or clipped** to align rows/columns reliably:
   - If so, set \`layoutQuality.layoutTooDistorted = true\` and provide clear guidance in \`layoutQuality.retakeOrCropAdvice\` asking the administrator to crop closer to the attendance table or retake the photo overhead.
6. Mark classification rules:
   - "PRESENT": clear handwritten tick (/ or \\ or ✓) indicating attendance.
   - "ABSENT": clear zero (0), cross (X), or circle (O / ⊘) indicating absence.
   - "BLANK": cell is visibly empty / unmarked. NEVER convert BLANK into ABSENT.
   - "UNCERTAIN": cell is smudged, faint, illegible, occluded by shadow/glare, or sitting ambiguously on a grid border.
   - **Corrections & overwritten marks**: If a mark is crossed out, scribbled over, erased, or overwritten (e.g. a tick written over a 0 or vice versa), set \`isCorrectionOrOverwritten: true\`, classify as "UNCERTAIN" unless the intended final mark is unmistakably clear, and describe the correction in \`notes\`.
7. NEVER GUESS or infer an attendance mark from neighboring cells, adjacent days, or other students in the same column.

Return STRICT JSON matching this schema:
{
  "schoolIdentified": string or null,
  "classIdentified": string or null,
  "periodIdentified": string or null,
  "layoutNotes": string,
  "layoutQuality": {
    "pageBoundariesDetected": boolean,
    "tableBoundariesDetected": boolean,
    "tableBoundingBox": { "ymin": number, "xmin": number, "ymax": number, "xmax": number } or null,
    "detectedWeeks": string[],
    "uncertainHeadings": string[],
    "layoutTooDistorted": boolean,
    "retakeOrCropAdvice": string or null
  },
  "totalRowsDetected": number,
  "detectedDays": string[],
  "rows": [
    {
      "rowNumber": number,
      "studentNameDetected": string or null,
      "admissionNumberDetected": string or null,
      "marks": [
        {
          "week": string,
          "day": "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday",
          "status": "PRESENT" | "ABSENT" | "BLANK" | "UNCERTAIN",
          "rawSymbol": string,
          "isCorrectionOrOverwritten": boolean,
          "notes": string or null
        }
      ],
      "uncertaintyNotes": string or null
    }
  ],
  "ambiguityDetected": boolean,
  "summaryStatistics": {
    "presentCount": number,
    "absentCount": number,
    "blankCount": number,
    "uncertainCount": number
  },
  "overallConfidence": "HIGH" | "MEDIUM" | "LOW",
  "disclaimer": "Unconfirmed machine transcription preview. Final verification required by school administrator."
}`;
}

export interface CellTargetSlot {
  rowNumber: number;
  studentName?: string | null;
  week: string;
  day: string;
}

/**
 * Builds a focused Stage 2 prompt inspecting a zoomed horizontal strip of rows/cells
 * so marks are verified individually and mapped back strictly to (rowNumber, week, day).
 */
export function buildCellLevelVerificationPrompt(params: {
  className?: string;
  detectedWeeks: string[];
  detectedDays: string[];
  targetSlots: CellTargetSlot[];
}): string {
  const slotList = params.targetSlots
    .map(
      (s) =>
        `- Row #${s.rowNumber}${s.studentName ? ` (${s.studentName})` : ''}: ${s.week} / ${s.day}`
    )
    .join('\n');

  return `You are performing Stage 2 cell-level verification on a cropped horizontal strip from an attendance register (${params.className || 'Unspecified'}).

Detected Column Headers:
- Weeks visible: ${params.detectedWeeks.join(', ') || 'Week 1'}
- Weekdays visible: ${params.detectedDays.join(', ') || 'Monday-Friday'}

Target (Row, Week, Day) cells to inspect closely in this zoomed strip:
${slotList}

RULES:
1. Locate each student's horizontal row rule and trace across to the requested weekday column.
2. Inspect ONLY the pixels inside that cell:
   - Clear / or \\ or ✓ -> "PRESENT"
   - Clear 0 or X or O -> "ABSENT"
   - Completely empty cell -> "BLANK"
   - Smudge, faint pencil, scratched-out / overwritten stroke, shadow, or clipped edge -> "UNCERTAIN" (set "isCorrectionOrOverwritten": true if overwritten).
3. NEVER guess or infer a cell value from neighboring rows or days.
4. Only return entries for rows and columns clearly visible inside this strip.

Return STRICT JSON:
{
  "verifiedCells": [
    {
      "rowNumber": number,
      "week": string,
      "day": "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday",
      "status": "PRESENT" | "ABSENT" | "BLANK" | "UNCERTAIN",
      "rawSymbol": string,
      "isCorrectionOrOverwritten": boolean,
      "notes": string or null
    }
  ]
}`;
}

export interface StagedVerifiedCell {
  rowNumber: number;
  week: string;
  day: string;
  status: MarkStatus;
  rawSymbol?: string;
  isCorrectionOrOverwritten?: boolean;
  notes?: string | null;
}

/**
 * Merges Stage 2 cell-level verifications back into Stage 1 extraction rows.
 * Only fills missing cells or updates previously UNCERTAIN/ambiguous cells, and forces UNCERTAIN
 * if Stage 1 and Stage 2 give conflicting definitive answers (PRESENT vs ABSENT).
 */
export function mergeStagedCellResults(
  stage1: GeminiExtractionResult,
  verifiedCells: StagedVerifiedCell[]
): GeminiExtractionResult {
  if (!verifiedCells || verifiedCells.length === 0) {
    return stage1;
  }

  const byRow = new Map<number, GeminiExtractionRow>();
  const clonedRows: GeminiExtractionRow[] = (stage1.rows || []).map((row) => {
    const copy: GeminiExtractionRow = {
      ...row,
      marks: (row.marks || []).map((m) => ({ ...m }))
    };
    byRow.set(copy.rowNumber, copy);
    return copy;
  });

  verifiedCells.forEach((cell) => {
    const targetRow = byRow.get(cell.rowNumber);
    if (!targetRow) return;

    const weekKey = (cell.week || 'Week 1').trim().toLowerCase();
    const dayKey = (cell.day || '').trim().toLowerCase();
    const existingIdx = targetRow.marks.findIndex(
      (m) =>
        (m.week || 'Week 1').trim().toLowerCase() === weekKey &&
        m.day.trim().toLowerCase() === dayKey
    );

    if (existingIdx === -1) {
      const added: GeminiExtractionMark = {
        week: cell.week || 'Week 1',
        day: cell.day,
        status: cell.status,
        rawSymbol: cell.rawSymbol || '',
        isCorrectionOrOverwritten: Boolean(cell.isCorrectionOrOverwritten),
        notes: cell.notes ? `[Staged cell check] ${cell.notes}` : '[Staged cell check]'
      };
      targetRow.marks.push(added);
      return;
    }

    const existing = targetRow.marks[existingIdx];
    const stage1Definitive = existing.status === 'PRESENT' || existing.status === 'ABSENT';
    const stage2Definitive = cell.status === 'PRESENT' || cell.status === 'ABSENT';

    if (existing.status === 'UNCERTAIN' && cell.status !== 'UNCERTAIN') {
      targetRow.marks[existingIdx] = {
        ...existing,
        status: cell.status,
        rawSymbol: cell.rawSymbol || existing.rawSymbol,
        isCorrectionOrOverwritten: Boolean(
          cell.isCorrectionOrOverwritten || existing.isCorrectionOrOverwritten
        ),
        notes: cell.notes
          ? `[Staged cell check] ${cell.notes}`
          : existing.notes || '[Resolved by staged cell check]'
      };
    } else if (stage1Definitive && stage2Definitive && existing.status !== cell.status) {
      // Conflicting readings between Stage 1 and Stage 2 -> force UNCERTAIN for human review!
      targetRow.marks[existingIdx] = {
        ...existing,
        status: 'UNCERTAIN',
        rawSymbol: `${existing.rawSymbol || existing.status} vs ${cell.rawSymbol || cell.status}`,
        isCorrectionOrOverwritten: true,
        notes: `Conflicting whole-page (${existing.status}) vs cell-strip (${cell.status}) detection — human review required.`
      };
    } else if (cell.isCorrectionOrOverwritten) {
      targetRow.marks[existingIdx] = {
        ...existing,
        isCorrectionOrOverwritten: true,
        notes: cell.notes || existing.notes
      };
    }
  });

  // Recompute summary statistics from merged marks
  let presentCount = 0;
  let absentCount = 0;
  let blankCount = 0;
  let uncertainCount = 0;
  clonedRows.forEach((r) => {
    r.marks.forEach((m) => {
      if (m.status === 'PRESENT') presentCount += 1;
      else if (m.status === 'ABSENT') absentCount += 1;
      else if (m.status === 'BLANK') blankCount += 1;
      else uncertainCount += 1;
    });
  });

  return {
    ...stage1,
    processingStageUsed: 'staged-cell-verification',
    rows: clonedRows,
    ambiguityDetected: Boolean(stage1.ambiguityDetected || uncertainCount > 0),
    summaryStatistics: {
      presentCount,
      absentCount,
      blankCount,
      uncertainCount
    }
  };
}
