import {
  AttendanceCell,
  AttendanceSessionDraft,
  CellCorrectionEntry,
  DayOfWeek,
  DraftEditHistoryEntry,
  DraftProcessingStatus,
  RowStudentMapping,
  SourceImageMetadata,
  Student,
  ValidatedAttendanceStatus,
  ValidationIssue
} from '../types/attendance';

export const PERMITTED_STATUSES: readonly ValidatedAttendanceStatus[] = [
  'PRESENT',
  'ABSENT',
  'BLANK',
  'UNCERTAIN'
] as const;

export const SCHOOL_WEEKDAYS: readonly DayOfWeek[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday'
] as const;

const WEEKDAY_ALIAS_MAP: Record<string, DayOfWeek> = {
  m: 'Monday',
  mon: 'Monday',
  monday: 'Monday',
  t: 'Tuesday',
  tu: 'Tuesday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  w: 'Wednesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  th: 'Thursday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  f: 'Friday',
  fri: 'Friday',
  friday: 'Friday'
};

/**
 * Strictly validates and normalizes weekday names (Monday-Friday).
 * Also converts valid Mon-Fri date strings (e.g. "2026-10-09" or "09/10/2026") to their weekday.
 * Rejects weekends, empty values, and unrecognized strings.
 */
export function normalizeWeekday(input: unknown): DayOfWeek | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Strip optional parenthetical notes like "F (TODAY)" or "Monday (12/10)"
  const cleaned = trimmed
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .trim()
    .toLowerCase();

  if (WEEKDAY_ALIAS_MAP[cleaned]) {
    return WEEKDAY_ALIAS_MAP[cleaned];
  }

  // Handle ISO YYYY-MM-DD date string -> derive Mon-Fri day
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const dt = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (!Number.isNaN(dt.getTime())) {
      const jsDay = dt.getDay(); // 1=Mon..5=Fri
      if (jsDay >= 1 && jsDay <= 5) {
        return SCHOOL_WEEKDAYS[jsDay - 1];
      }
    }
    return null;
  }

  // Handle DD/MM/YYYY Nigerian date string -> derive Mon-Fri day
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const dt = new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
    if (!Number.isNaN(dt.getTime())) {
      const jsDay = dt.getDay();
      if (jsDay >= 1 && jsDay <= 5) {
        return SCHOOL_WEEKDAYS[jsDay - 1];
      }
    }
    return null;
  }

  return null;
}

/**
 * Strictly validates week identifiers:
 * - Accepts "Week 1" .. "Week 16" (also "Wk 1", "W1")
 * - Accepts ISO weeks "YYYY-Www" (e.g. "2026-W46")
 * - Rejects malformed strings, out-of-range weeks (Week 0, Week 99), or non-strings.
 */
export function normalizeWeekIdentifier(
  input: unknown,
  fallbackWeekIfOmitted?: string
): { valid: boolean; normalized: string | null; wasOmitted?: boolean } {
  if (input === undefined || input === null) {
    if (fallbackWeekIfOmitted) {
      return { valid: true, normalized: fallbackWeekIfOmitted, wasOmitted: true };
    }
    return { valid: false, normalized: null };
  }

  if (typeof input !== 'string') {
    return { valid: false, normalized: null };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, normalized: null };
  }

  // Match "Week 1", "Wk 2", "W3" (term weeks 1..16)
  const termWeekMatch = trimmed.match(/^(?:week|wk|w)\s*[-_#]?\s*(\d{1,2})$/i);
  if (termWeekMatch) {
    const num = Number(termWeekMatch[1]);
    if (Number.isInteger(num) && num >= 1 && num <= 16) {
      return { valid: true, normalized: `Week ${num}` };
    }
    return { valid: false, normalized: null };
  }

  // Match ISO week YYYY-Www (01..53)
  const isoWeekMatch = trimmed.match(/^(\d{4})-W(\d{2})$/i);
  if (isoWeekMatch) {
    const weekNum = Number(isoWeekMatch[2]);
    if (weekNum >= 1 && weekNum <= 53) {
      return { valid: true, normalized: `${isoWeekMatch[1]}-W${isoWeekMatch[2]}` };
    }
    return { valid: false, normalized: null };
  }

  return { valid: false, normalized: null };
}

export function isValidAttendanceStatus(value: unknown): value is ValidatedAttendanceStatus {
  return typeof value === 'string' && (PERMITTED_STATUSES as readonly string[]).includes(value);
}

export function isValidPositiveRowNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeAdm(adm: string): string {
  return adm.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Associates a physical register row with an enrolled student from the class roster.
 * NEVER assumes physical row N corresponds to DB student N unless confirmed by administrator.
 */
export function resolveStudentMapping(
  rowNumber: number,
  detectedName: string | null,
  detectedAdmissionNumber: string | null,
  classStudents: Student[]
): RowStudentMapping {
  const cleanName = detectedName ? detectedName.trim() : null;
  const cleanAdm = detectedAdmissionNumber ? detectedAdmissionNumber.trim() : null;

  // 1. Exact Admission Number Match (highest reliability when uniquely matched)
  if (cleanAdm && cleanAdm.length >= 4) {
    const targetAdm = normalizeAdm(cleanAdm);
    const admMatches = classStudents.filter(
      (s) => s.admissionNumber && normalizeAdm(s.admissionNumber) === targetAdm
    );
    if (admMatches.length === 1) {
      return {
        rowNumber,
        detectedName: cleanName,
        detectedAdmissionNumber: cleanAdm,
        studentId: admMatches[0].id,
        suggestedStudentId: admMatches[0].id,
        mappingConfidence: 'EXACT_ADMISSION',
        mappingConfirmed: true,
        reviewRequired: false,
        notes: `Matched uniquely via admission number ${admMatches[0].admissionNumber}`
      };
    }
  }

  // 2. Exact Full Name Match (case-insensitive, unique within class roster)
  if (cleanName) {
    const targetName = normalizeName(cleanName);
    const exactMatches = classStudents.filter((s) => normalizeName(s.fullName) === targetName);
    if (exactMatches.length === 1) {
      return {
        rowNumber,
        detectedName: cleanName,
        detectedAdmissionNumber: cleanAdm,
        studentId: exactMatches[0].id,
        suggestedStudentId: exactMatches[0].id,
        mappingConfidence: 'EXACT_NAME',
        mappingConfirmed: true,
        reviewRequired: false,
        notes: `Matched uniquely by full name`
      };
    }
  }

  // 3. Partial name or row-order suggestion ONLY (studentId remains NULL until admin confirms)
  let suggestedStudent: Student | undefined;
  let suggestionReason = 'Could not match physical row to an enrolled student reliably.';

  if (cleanName && cleanName.length >= 3) {
    const targetName = normalizeName(cleanName);
    const partialMatches = classStudents.filter((s) => {
      const sName = normalizeName(s.fullName);
      return sName.includes(targetName) || targetName.includes(sName);
    });
    if (partialMatches.length === 1) {
      suggestedStudent = partialMatches[0];
      suggestionReason = `Partial name similarity with "${suggestedStudent.fullName}" — admin confirmation required`;
    }
  }

  if (!suggestedStudent) {
    const rowOrderCandidate = classStudents.find((s) => s.studentNumber === rowNumber);
    if (rowOrderCandidate) {
      suggestedStudent = rowOrderCandidate;
      suggestionReason = cleanName
        ? `Detected "${cleanName}" does not match roster #${rowNumber} ("${rowOrderCandidate.fullName}") — verify order`
        : `No student name detected; row-order candidate is #${rowNumber} ("${rowOrderCandidate.fullName}") — confirm mapping`;
    }
  }

  return {
    rowNumber,
    detectedName: cleanName,
    detectedAdmissionNumber: cleanAdm,
    studentId: null, // Nullable until reliably mapped or confirmed by administrator
    suggestedStudentId: suggestedStudent?.id || null,
    mappingConfidence: suggestedStudent ? 'ROW_ORDER_SUGGESTED' : 'UNMAPPED',
    mappingConfirmed: false,
    reviewRequired: true,
    notes: suggestionReason
  };
}

export interface ValidateDraftContext {
  classId: string;
  className: string;
  attendancePeriod: string;
  sourceImageMetadata: SourceImageMetadata;
  sourceImageReference?: string;
  classStudents: Student[];
  defaultWeekIdentifier?: string;
}

/**
 * Validates raw AI output strictly and produces an AttendanceSessionDraft.
 * Never silently converts malformed data into valid attendance.
 * Rejects invalid top-level shapes and quarantines malformed rows/cells.
 */
export function validateAndBuildSessionDraft(
  rawAiResponse: unknown,
  context: ValidateDraftContext
): AttendanceSessionDraft {
  const now = new Date().toISOString();
  const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const validationIssues: ValidationIssue[] = [];
  const quarantinedItems: Array<{ reason: string; rawData: unknown }> = [];
  const cells: AttendanceCell[] = [];
  const rowMappings: RowStudentMapping[] = [];

  const fallbackWeek = context.defaultWeekIdentifier || 'Week 1';

  const makeRejectedDraft = (reason: string): AttendanceSessionDraft => ({
    id: draftId,
    classId: context.classId,
    className: context.className,
    attendancePeriod: context.attendancePeriod,
    sourceImageMetadata: context.sourceImageMetadata,
    cells: [],
    rowMappings: [],
    weeksDetected: [],
    processingStatus: 'REJECTED',
    validationIssues,
    quarantinedItems: [...quarantinedItems, { reason, rawData: rawAiResponse }],
    editHistory: [],
    rawAiResponse,
    createdAt: now
  });

  // 1. Top-level structural checks
  if (!rawAiResponse || typeof rawAiResponse !== 'object' || Array.isArray(rawAiResponse)) {
    validationIssues.push({
      severity: 'ERROR',
      code: 'MALFORMED_PAYLOAD',
      message: 'AI response payload is not a JSON object and was rejected.',
      rawValue: rawAiResponse
    });
    return makeRejectedDraft('Top-level response is not an object');
  }

  const payload = rawAiResponse as Record<string, unknown>;
  if (!Array.isArray(payload.rows)) {
    validationIssues.push({
      severity: 'ERROR',
      code: 'MISSING_REQUIRED_FIELD',
      message: 'Required "rows" array is missing or malformed in the AI response.',
      rawValue: payload.rows
    });
    return makeRejectedDraft('Missing required "rows" array');
  }

  // Check layoutQuality uncertain week/day headings
  const layoutQuality =
    payload.layoutQuality && typeof payload.layoutQuality === 'object'
      ? (payload.layoutQuality as Record<string, unknown>)
      : null;
  const uncertainHeadings: string[] = Array.isArray(layoutQuality?.uncertainHeadings)
    ? layoutQuality.uncertainHeadings.filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    : [];

  if (uncertainHeadings.length > 0) {
    validationIssues.push({
      severity: 'WARNING',
      code: 'UNCERTAIN_HEADING',
      message: `Uncertain week/day column headings detected: ${uncertainHeadings.join(', ')}. Verify column alignment carefully.`,
      rawValue: uncertainHeadings
    });
  }

  // Track valid row numbers and weeks discovered
  const validRowNumbers: number[] = [];
  const rowMappingByRowNumber = new Map<number, RowStudentMapping>();
  const weeksSet = new Set<string>();
  const cellOccurrences = new Map<string, number>();

  // First pass: validate rows, build mappings, validate marks, detect duplicates
  payload.rows.forEach((rawRow, idx) => {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      validationIssues.push({
        severity: 'ERROR',
        code: 'MALFORMED_PAYLOAD',
        message: `Row entry at index ${idx} is not a valid object and was quarantined.`,
        rawValue: rawRow
      });
      quarantinedItems.push({ reason: `Row index ${idx} is not an object`, rawData: rawRow });
      return;
    }

    const rowObj = rawRow as Record<string, unknown>;

    // Validate rowNumber is positive integer
    if (!isValidPositiveRowNumber(rowObj.rowNumber)) {
      validationIssues.push({
        severity: 'ERROR',
        code: 'INVALID_ROW_NUMBER',
        message: `Row at index ${idx} has invalid rowNumber (${JSON.stringify(rowObj.rowNumber)}). Row numbers must be positive integers >= 1.`,
        rawValue: rowObj.rowNumber
      });
      quarantinedItems.push({
        reason: `Invalid rowNumber: ${JSON.stringify(rowObj.rowNumber)}`,
        rawData: rawRow
      });
      return;
    }

    const rowNumber = rowObj.rowNumber;

    // Validate marks array exists
    if (!Array.isArray(rowObj.marks)) {
      validationIssues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        message: `Row #${rowNumber} is missing the required "marks" array and was quarantined.`,
        rowNumber,
        rawValue: rowObj.marks
      });
      quarantinedItems.push({
        reason: `Row #${rowNumber} missing marks array`,
        rawData: rawRow
      });
      return;
    }

    const detectedName =
      typeof rowObj.studentNameDetected === 'string' && rowObj.studentNameDetected.trim()
        ? rowObj.studentNameDetected.trim()
        : null;
    const detectedAdm =
      typeof rowObj.admissionNumberDetected === 'string' && rowObj.admissionNumberDetected.trim()
        ? rowObj.admissionNumberDetected.trim()
        : null;
    const rowUncertaintyNotes =
      typeof rowObj.uncertaintyNotes === 'string' ? rowObj.uncertaintyNotes : null;

    // Detect duplicate rowNumber in payload
    if (rowMappingByRowNumber.has(rowNumber)) {
      validationIssues.push({
        severity: 'ERROR',
        code: 'DUPLICATE_CELL',
        message: `Duplicate rowNumber #${rowNumber} detected in AI response.`,
        rowNumber,
        rawValue: rawRow
      });
    } else {
      validRowNumbers.push(rowNumber);
      const mapping = resolveStudentMapping(rowNumber, detectedName, detectedAdm, context.classStudents);
      rowMappingByRowNumber.set(rowNumber, mapping);
      rowMappings.push(mapping);

      if (!mapping.studentId) {
        validationIssues.push({
          severity: 'WARNING',
          code: 'UNMAPPED_STUDENT',
          message: `Row #${rowNumber} (${detectedName || 'Unnamed'}) could not be mapped reliably to a class student and requires review.`,
          rowNumber
        });
      }
    }

    const mappingForRow = rowMappingByRowNumber.get(rowNumber)!;

    // Validate each mark inside rowObj.marks
    rowObj.marks.forEach((rawMark, markIdx) => {
      if (!rawMark || typeof rawMark !== 'object' || Array.isArray(rawMark)) {
        validationIssues.push({
          severity: 'ERROR',
          code: 'MALFORMED_PAYLOAD',
          message: `Row #${rowNumber}, mark index ${markIdx} is malformed and was quarantined.`,
          rowNumber,
          rawValue: rawMark
        });
        quarantinedItems.push({
          reason: `Malformed mark object at row #${rowNumber}`,
          rawData: rawMark
        });
        return;
      }

      const markObj = rawMark as Record<string, unknown>;

      // Validate week identifier
      const weekCheck = normalizeWeekIdentifier(markObj.week, fallbackWeek);
      if (!weekCheck.valid || !weekCheck.normalized) {
        validationIssues.push({
          severity: 'ERROR',
          code: 'INVALID_WEEK',
          message: `Row #${rowNumber} contains an invalid week identifier (${JSON.stringify(markObj.week)}) and was quarantined.`,
          rowNumber,
          rawValue: markObj.week
        });
        quarantinedItems.push({
          reason: `Invalid week identifier at row #${rowNumber}: ${JSON.stringify(markObj.week)}`,
          rawData: rawMark
        });
        return;
      }
      const weekIdentifier = weekCheck.normalized;

      // Validate weekday name
      const dayOfWeek = normalizeWeekday(markObj.day);
      if (!dayOfWeek) {
        validationIssues.push({
          severity: 'ERROR',
          code: 'INVALID_WEEKDAY',
          message: `Row #${rowNumber} contains an invalid weekday (${JSON.stringify(markObj.day)}) and was quarantined.`,
          rowNumber,
          weekIdentifier,
          dayOfWeek: String(markObj.day),
          rawValue: markObj.day
        });
        quarantinedItems.push({
          reason: `Invalid weekday at row #${rowNumber}: ${JSON.stringify(markObj.day)}`,
          rawData: rawMark
        });
        return;
      }

      weeksSet.add(weekIdentifier);

      // Validate status strictly against permitted set
      const rawStatus = markObj.status;
      let cellStatus: ValidatedAttendanceStatus;
      let reviewRequired = false;
      let reviewReason: string | undefined;

      if (!isValidAttendanceStatus(rawStatus)) {
        validationIssues.push({
          severity: 'ERROR',
          code: 'INVALID_STATUS',
          message: `Row #${rowNumber} (${weekIdentifier} ${dayOfWeek}) has invalid status ${JSON.stringify(rawStatus)}. Quarantined as UNCERTAIN for human review.`,
          rowNumber,
          weekIdentifier,
          dayOfWeek,
          rawValue: rawStatus
        });
        quarantinedItems.push({
          reason: `Invalid attendance status ${JSON.stringify(rawStatus)} at row #${rowNumber} (${weekIdentifier} ${dayOfWeek})`,
          rawData: rawMark
        });
        cellStatus = 'UNCERTAIN';
        reviewRequired = true;
        reviewReason = `Rejected invalid AI status ${JSON.stringify(rawStatus)} — human verification required`;
      } else {
        cellStatus = rawStatus;
        if (cellStatus === 'UNCERTAIN') {
          reviewRequired = true;
          reviewReason = 'Ambiguous or illegible physical mark — verify against register';
          validationIssues.push({
            severity: 'WARNING',
            code: 'AMBIGUOUS_MARK',
            message: `Row #${rowNumber} (${weekIdentifier} ${dayOfWeek}) marked UNCERTAIN and flagged for review.`,
            rowNumber,
            weekIdentifier,
            dayOfWeek
          });
        } else if (cellStatus === 'BLANK') {
          // Blank register cell is NOT converted to ABSENT; flag gently for review if needed
          reviewRequired = true;
          reviewReason = 'Blank cell on physical register (not assumed Absent)';
        }
      }

      const isCorrectionOrOverwritten = Boolean(markObj.isCorrectionOrOverwritten);
      if (isCorrectionOrOverwritten) {
        reviewRequired = true;
        reviewReason =
          reviewReason || 'Overwritten or corrected mark detected on register — human verification required';
        validationIssues.push({
          severity: 'WARNING',
          code: 'OVERWRITTEN_MARK',
          message: `Row #${rowNumber} (${weekIdentifier} ${dayOfWeek}) shows a correction or overwritten stroke and requires verification.`,
          rowNumber,
          weekIdentifier,
          dayOfWeek
        });
      }

      const headingLooksUncertain = uncertainHeadings.some((h) => {
        const lower = h.toLowerCase();
        return lower.includes(weekIdentifier.toLowerCase()) || lower.includes(dayOfWeek.toLowerCase());
      });
      if (headingLooksUncertain) {
        reviewRequired = true;
        reviewReason = reviewReason || 'Column week/day heading marked uncertain';
      }

      if (mappingForRow.reviewRequired) {
        reviewRequired = true;
      }

      const cellKey = `${rowNumber}::${weekIdentifier}::${dayOfWeek}`;
      const priorCount = cellOccurrences.get(cellKey) || 0;
      cellOccurrences.set(cellKey, priorCount + 1);

      const isDuplicate = priorCount > 0;
      let hasConflictingDetection = false;

      if (isDuplicate) {
        reviewRequired = true;
        const priorMatching = cells.filter(
          (existing) =>
            existing.rowNumber === rowNumber &&
            existing.weekIdentifier === weekIdentifier &&
            existing.dayOfWeek === dayOfWeek
        );
        const statusesDisagree = priorMatching.some((existing) => existing.status !== cellStatus);

        validationIssues.push({
          severity: 'ERROR',
          code: 'DUPLICATE_CELL',
          message: `Duplicate cell detected for Row #${rowNumber}, ${weekIdentifier}, ${dayOfWeek}.`,
          rowNumber,
          weekIdentifier,
          dayOfWeek,
          rawValue: rawMark
        });

        if (statusesDisagree) {
          hasConflictingDetection = true;
          cellStatus = 'UNCERTAIN';
          reviewReason = 'Conflicting duplicate detections disagreed — forced to UNCERTAIN for human review';
          validationIssues.push({
            severity: 'ERROR',
            code: 'CONFLICTING_DETECTION',
            message: `Conflicting detections for Row #${rowNumber}, ${weekIdentifier}, ${dayOfWeek}. Marked UNCERTAIN for verification.`,
            rowNumber,
            weekIdentifier,
            dayOfWeek,
            rawValue: rawMark
          });
        } else {
          reviewReason = 'Duplicate AI cell detected for this student/week/day';
        }

        priorMatching.forEach((existing) => {
          existing.isDuplicate = true;
          existing.reviewRequired = true;
          if (statusesDisagree) {
            existing.hasConflictingDetection = true;
            existing.status = 'UNCERTAIN';
            existing.reviewReason =
              'Conflicting duplicate detections disagreed — forced to UNCERTAIN for human review';
          } else {
            existing.reviewReason = 'Duplicate AI cell detected for this student/week/day';
          }
        });
      }

      cells.push({
        id: `cell-${rowNumber}-${weekIdentifier.replace(/\s+/g, '')}-${dayOfWeek}-${markIdx}`,
        studentId: mappingForRow.studentId,
        rowNumber,
        detectedStudentName: detectedName,
        detectedAdmissionNumber: detectedAdm,
        weekIdentifier,
        dayOfWeek,
        status: cellStatus,
        originalAiStatus: cellStatus,
        originalAiWeekIdentifier: weekIdentifier,
        originalAiDayOfWeek: dayOfWeek,
        rawSymbol: typeof markObj.rawSymbol === 'string' ? markObj.rawSymbol : undefined,
        notes:
          (typeof markObj.notes === 'string' && markObj.notes) ||
          rowUncertaintyNotes ||
          null,
        reviewRequired,
        reviewReason,
        reviewedByAdmin: false,
        correctionHistory: [],
        isDuplicate,
        isCorrectionOrOverwritten,
        hasConflictingDetection,
        sourceImageReference: context.sourceImageReference
      });
    });
  });

  // Ensure canonical week ordering
  const weeksDetected = Array.from(weeksSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (weeksDetected.length === 0 && validRowNumbers.length > 0) {
    weeksDetected.push(fallbackWeek);
  }

  // Detect duplicate student mappings across different rows
  const mappedStudentIds = new Map<string, number[]>();
  rowMappings.forEach((m) => {
    if (m.studentId) {
      const list = mappedStudentIds.get(m.studentId) || [];
      list.push(m.rowNumber);
      mappedStudentIds.set(m.studentId, list);
    }
  });
  mappedStudentIds.forEach((rowList, studentId) => {
    if (rowList.length > 1) {
      validationIssues.push({
        severity: 'ERROR',
        code: 'UNMAPPED_STUDENT',
        message: `Multiple physical rows (#${rowList.join(', #')}) were matched to the same student (${studentId}). Please verify mapping.`
      });
      rowMappings.forEach((m) => {
        if (m.studentId === studentId) {
          m.reviewRequired = true;
          m.mappingConfirmed = false;
          m.notes = `Conflict: also assigned to rows #${rowList.join(', #')}`;
        }
      });
    }
  });

  // Detect missing/skipped row numbers in sequence (e.g. Row 1, 2, 4 -> Row #3 missing)
  if (validRowNumbers.length > 0) {
    const sortedRows = [...validRowNumbers].sort((a, b) => a - b);
    const maxRow = sortedRows[sortedRows.length - 1];
    const rowSet = new Set(sortedRows);
    const missingSeqRows: number[] = [];
    for (let r = 1; r <= maxRow; r++) {
      if (!rowSet.has(r)) {
        missingSeqRows.push(r);
      }
    }
    if (missingSeqRows.length > 0) {
      validationIssues.push({
        severity: 'WARNING',
        code: 'MISSING_ROW',
        message: `Row sequence gap detected: Row${missingSeqRows.length > 1 ? 's' : ''} #${missingSeqRows.join(', #')} missing from extraction. Verify page crop and bottom/middle rows.`,
        rowNumber: missingSeqRows[0]
      });
    } else if (context.classStudents.length > validRowNumbers.length) {
      const missingCount = context.classStudents.length - validRowNumbers.length;
      validationIssues.push({
        severity: 'WARNING',
        code: 'MISSING_ROW',
        message: `${validRowNumbers.length} rows detected out of ${context.classStudents.length} active pupils (${missingCount} roster pupil${missingCount > 1 ? 's' : ''} not found on this page or clipped).`
      });
    }
  }

  // Identify missing cells per valid row x detected week x Monday-Friday
  // Rule: Missing AI response is NEVER equivalent to ABSENT. Preserve as UNCERTAIN + isMissingFromAI.
  validRowNumbers.forEach((rowNumber) => {
    const mapping = rowMappingByRowNumber.get(rowNumber)!;
    weeksDetected.forEach((weekIdentifier) => {
      SCHOOL_WEEKDAYS.forEach((dayOfWeek) => {
        const key = `${rowNumber}::${weekIdentifier}::${dayOfWeek}`;
        if (!cellOccurrences.has(key)) {
          validationIssues.push({
            severity: 'WARNING',
            code: 'MISSING_CELL',
            message: `Missing AI response for Row #${rowNumber}, ${weekIdentifier}, ${dayOfWeek}. Flagged for review (never assumed Absent).`,
            rowNumber,
            weekIdentifier,
            dayOfWeek
          });

          cells.push({
            id: `cell-missing-${rowNumber}-${weekIdentifier.replace(/\s+/g, '')}-${dayOfWeek}`,
            studentId: mapping.studentId,
            rowNumber,
            detectedStudentName: mapping.detectedName,
            detectedAdmissionNumber: mapping.detectedAdmissionNumber,
            weekIdentifier,
            dayOfWeek,
            status: 'UNCERTAIN',
            originalAiStatus: 'UNCERTAIN',
            originalAiWeekIdentifier: weekIdentifier,
            originalAiDayOfWeek: dayOfWeek,
            rawSymbol: '?',
            notes: 'Missing from AI response',
            reviewRequired: true,
            reviewReason: 'Missing AI response for this day — verify physical sheet',
            reviewedByAdmin: false,
            correctionHistory: [],
            isMissingFromAI: true,
            sourceImageReference: context.sourceImageReference
          });
        }
      });
    });
  });

  // Determine overall processingStatus
  let processingStatus: DraftProcessingStatus = 'VALIDATED_DRAFT';
  if (validRowNumbers.length === 0 && validationIssues.some((v) => v.severity === 'ERROR')) {
    processingStatus = 'REJECTED';
  } else if (quarantinedItems.length > 0) {
    processingStatus = 'QUARANTINED';
  } else if (
    cells.some((c) => c.reviewRequired || c.status === 'UNCERTAIN') ||
    rowMappings.some((m) => m.reviewRequired || !m.studentId) ||
    validationIssues.length > 0
  ) {
    processingStatus = 'NEEDS_REVIEW';
  }

  return {
    id: draftId,
    classId: context.classId,
    className: context.className,
    attendancePeriod: context.attendancePeriod,
    sourceImageMetadata: context.sourceImageMetadata,
    cells,
    rowMappings,
    weeksDetected,
    processingStatus,
    validationIssues,
    quarantinedItems,
    editHistory: [],
    rawAiResponse,
    createdAt: now
  };
}

/**
 * Updates the AttendanceStatus of a single validated draft cell, records correction history,
 * marks reviewedByAdmin = true, and recalculates review status.
 */
export function updateDraftCellStatus(
  draft: AttendanceSessionDraft,
  cellId: string,
  newStatus: ValidatedAttendanceStatus
): AttendanceSessionDraft {
  const now = new Date().toISOString();
  let newHistoryEntry: DraftEditHistoryEntry | null = null;

  const updatedCells = draft.cells.map((cell) => {
    if (cell.id !== cellId) return cell;

    const correction: CellCorrectionEntry = {
      id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      field: 'status',
      originalAiSuggestion: cell.originalAiStatus,
      previousValue: cell.status,
      newValue: newStatus
    };

    newHistoryEntry = {
      ...correction,
      rowNumber: cell.rowNumber,
      cellId: cell.id,
      weekIdentifier: cell.weekIdentifier,
      dayOfWeek: cell.dayOfWeek,
      reviewedByAdmin: true
    };

    return {
      ...cell,
      status: newStatus,
      isMissingFromAI: false,
      reviewedByAdmin: true,
      reviewedAt: now,
      reviewRequired: newStatus === 'UNCERTAIN' || !cell.studentId,
      reviewReason: newStatus === 'UNCERTAIN' ? 'Marked uncertain by reviewer' : undefined,
      correctionHistory: [...(cell.correctionHistory || []), correction]
    };
  });

  return recalculateDraftStatus({
    ...draft,
    cells: updatedCells,
    editHistory: newHistoryEntry ? [newHistoryEntry, ...(draft.editHistory || [])] : draft.editHistory || []
  });
}

/**
 * Explicitly marks a cell reviewed by administrator without changing its status.
 */
export function markDraftCellReviewed(
  draft: AttendanceSessionDraft,
  cellId: string
): AttendanceSessionDraft {
  const now = new Date().toISOString();
  let newHistoryEntry: DraftEditHistoryEntry | null = null;

  const updatedCells = draft.cells.map((cell) => {
    if (cell.id !== cellId) return cell;

    const correction: CellCorrectionEntry = {
      id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      field: 'reviewed',
      originalAiSuggestion: cell.originalAiStatus,
      previousValue: cell.reviewedByAdmin ? 'Reviewed' : 'Awaiting Review',
      newValue: `Reviewed (${cell.status})`
    };

    newHistoryEntry = {
      ...correction,
      rowNumber: cell.rowNumber,
      cellId: cell.id,
      weekIdentifier: cell.weekIdentifier,
      dayOfWeek: cell.dayOfWeek,
      reviewedByAdmin: true
    };

    return {
      ...cell,
      reviewedByAdmin: true,
      reviewedAt: now,
      correctionHistory: [...(cell.correctionHistory || []), correction]
    };
  });

  return recalculateDraftStatus({
    ...draft,
    cells: updatedCells,
    editHistory: newHistoryEntry ? [newHistoryEntry, ...(draft.editHistory || [])] : draft.editHistory || []
  });
}

/**
 * Reassigns the weekIdentifier and/or dayOfWeek for a cell if the AI misassigned column/week.
 */
export function reassignDraftCellSchedule(
  draft: AttendanceSessionDraft,
  cellId: string,
  newWeekIdentifier: string,
  newDayOfWeek: DayOfWeek
): AttendanceSessionDraft {
  const weekCheck = normalizeWeekIdentifier(newWeekIdentifier);
  if (!weekCheck.valid || !weekCheck.normalized) return draft;
  const normalizedWeek = weekCheck.normalized;

  const targetCell = draft.cells.find((c) => c.id === cellId);
  if (!targetCell) return draft;
  if (targetCell.weekIdentifier === normalizedWeek && targetCell.dayOfWeek === newDayOfWeek) {
    return draft;
  }

  const now = new Date().toISOString();
  const correction: CellCorrectionEntry = {
    id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now,
    field: 'schedule',
    originalAiSuggestion: `${targetCell.originalAiWeekIdentifier || targetCell.weekIdentifier} ${targetCell.originalAiDayOfWeek || targetCell.dayOfWeek}`,
    previousValue: `${targetCell.weekIdentifier} ${targetCell.dayOfWeek}`,
    newValue: `${normalizedWeek} ${newDayOfWeek}`
  };

  const historyEntry: DraftEditHistoryEntry = {
    ...correction,
    rowNumber: targetCell.rowNumber,
    cellId: targetCell.id,
    weekIdentifier: normalizedWeek,
    dayOfWeek: newDayOfWeek,
    reviewedByAdmin: true
  };

  const updatedCells = draft.cells.map((cell) => {
    if (cell.id === cellId) {
      return {
        ...cell,
        weekIdentifier: normalizedWeek,
        dayOfWeek: newDayOfWeek,
        reviewedByAdmin: true,
        reviewedAt: now,
        isDuplicate: false,
        correctionHistory: [...(cell.correctionHistory || []), correction]
      };
    }
    return cell;
  });

  const weeksDetected = Array.from(new Set([...draft.weeksDetected, normalizedWeek])).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  return recalculateDraftStatus({
    ...draft,
    weeksDetected,
    cells: updatedCells,
    editHistory: [historyEntry, ...(draft.editHistory || [])]
  });
}

/**
 * Reassigns or confirms a student identity mapping for a physical register row.
 * Propagates studentId across all cells belonging to that rowNumber and records edit history.
 */
export function updateDraftRowMapping(
  draft: AttendanceSessionDraft,
  rowNumber: number,
  studentId: string | null,
  confidence: RowStudentMapping['mappingConfidence'] = 'MANUAL'
): AttendanceSessionDraft {
  const now = new Date().toISOString();
  const prevMapping = draft.rowMappings.find((m) => m.rowNumber === rowNumber);

  const historyEntry: DraftEditHistoryEntry | null = prevMapping
    ? {
        id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        field: 'studentId',
        rowNumber,
        originalAiSuggestion: prevMapping.detectedName || `Unmapped Row #${rowNumber}`,
        previousValue: prevMapping.studentId || 'Unmapped',
        newValue: studentId || 'Unmapped',
        reviewedByAdmin: Boolean(studentId)
      }
    : null;

  const updatedMappings = draft.rowMappings.map((m) => {
    if (m.rowNumber !== rowNumber) return m;
    return {
      ...m,
      studentId,
      mappingConfidence: studentId ? confidence : ('UNMAPPED' as const),
      mappingConfirmed: Boolean(studentId),
      reviewRequired: !studentId,
      notes: studentId ? 'Confirmed by school administrator' : 'Student mapping cleared — review required'
    };
  });

  const updatedCells = draft.cells.map((cell) => {
    if (cell.rowNumber !== rowNumber) return cell;
    const stillNeedsReview =
      !studentId || cell.status === 'UNCERTAIN' || Boolean(cell.isMissingFromAI) || Boolean(cell.isDuplicate);
    return {
      ...cell,
      studentId,
      reviewedByAdmin: Boolean(studentId) ? cell.reviewedByAdmin : false,
      reviewRequired: stillNeedsReview
    };
  });

  return recalculateDraftStatus({
    ...draft,
    rowMappings: updatedMappings,
    cells: updatedCells,
    editHistory: historyEntry ? [historyEntry, ...(draft.editHistory || [])] : draft.editHistory || []
  });
}

export interface ReviewQueueStats {
  totalCells: number;
  awaitingReview: number;
  uncertainCells: number;
  mappingIssueCells: number;
  reviewedCells: number;
  nextUnresolvedCell: AttendanceCell | null;
}

/**
 * Computes human-review queue metrics across all extracted draft cells without
 * auto-marking any cell as reviewed just because it was viewed.
 */
export function getReviewQueueStats(draft: AttendanceSessionDraft): ReviewQueueStats {
  const dayOrder: Record<DayOfWeek, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4
  };

  const unresolved = draft.cells
    .filter(
      (c) =>
        !c.reviewedByAdmin &&
        (c.reviewRequired || c.status === 'UNCERTAIN' || !c.studentId || c.isMissingFromAI || c.isDuplicate)
    )
    .sort((a, b) => {
      const wkCmp = a.weekIdentifier.localeCompare(b.weekIdentifier, undefined, { numeric: true });
      if (wkCmp !== 0) return wkCmp;
      if (a.rowNumber !== b.rowNumber) return a.rowNumber - b.rowNumber;
      return dayOrder[a.dayOfWeek] - dayOrder[b.dayOfWeek];
    });

  return {
    totalCells: draft.cells.length,
    awaitingReview: unresolved.length,
    uncertainCells: draft.cells.filter((c) => c.status === 'UNCERTAIN').length,
    mappingIssueCells: draft.cells.filter((c) => !c.studentId).length,
    reviewedCells: draft.cells.filter((c) => c.reviewedByAdmin).length,
    nextUnresolvedCell: unresolved[0] || null
  };
}

function recalculateDraftStatus(draft: AttendanceSessionDraft): AttendanceSessionDraft {
  let processingStatus: DraftProcessingStatus = 'VALIDATED_DRAFT';
  if (draft.rowMappings.length === 0 && draft.quarantinedItems.length > 0) {
    processingStatus = 'REJECTED';
  } else if (draft.quarantinedItems.length > 0) {
    processingStatus = 'QUARANTINED';
  } else if (
    draft.cells.some((c) => c.reviewRequired || c.status === 'UNCERTAIN') ||
    draft.rowMappings.some((m) => m.reviewRequired || !m.studentId)
  ) {
    processingStatus = 'NEEDS_REVIEW';
  }
  return { ...draft, processingStatus };
}

/**
 * Built-in test samples (valid multi-week + deliberately malformed) for validation verification.
 */
export function createValidationTestSamples() {
  const validMultiWeekSample = {
    schoolIdentified: 'L.E.A. Primary School, Wuse III, Zone 6, Abuja',
    classIdentified: 'Primary 4A',
    periodIdentified: 'Weeks 1 & 2 - First Term 2026/2027',
    layoutNotes: 'Multi-week physical register sheet (Monday to Friday across Week 1 and Week 2).',
    totalRowsDetected: 3,
    rows: [
      {
        rowNumber: 1,
        // Intentionally placed Chukwuma David Eze (DB student #4) in physical row 1 to demonstrate roster mismatch handling
        studentNameDetected: 'Chukwuma David Eze',
        admissionNumberDetected: 'LEA/2021/0056',
        marks: [
          { week: 'Week 1', day: 'Monday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 1', day: 'Tuesday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 1', day: 'Wednesday', status: 'ABSENT', rawSymbol: '0', notes: 'Fever' },
          { week: 'Week 1', day: 'Thursday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 1', day: 'Friday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 2', day: 'Monday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 2', day: 'Tuesday', status: 'BLANK', rawSymbol: '', notes: 'Empty cell' },
          { week: 'Week 2', day: 'Wednesday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 2', day: 'Thursday', status: 'UNCERTAIN', rawSymbol: '?', notes: 'Smudged ink stroke' },
          { week: 'Week 2', day: 'Friday', status: 'PRESENT', rawSymbol: '/', notes: null }
        ]
      },
      {
        rowNumber: 2,
        studentNameDetected: 'Abubakar Aliyu',
        admissionNumberDetected: 'LEA/2021/0014',
        marks: [
          { week: 'Week 1', day: 'Mon', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 1', day: 'Tue', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 1', day: 'Wed', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 1', day: 'Thu', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 1', day: 'Fri', status: 'ABSENT', rawSymbol: '0', notes: null },
          { week: 'Week 2', day: 'Monday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 2', day: 'Tuesday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 2', day: 'Wednesday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 2', day: 'Thursday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 2', day: 'Friday', status: 'PRESENT', rawSymbol: '/', notes: null }
        ]
      },
      {
        rowNumber: 3,
        // Unmapped / illegible student name to verify review flagging
        studentNameDetected: 'Sadiq Faruk (Faint)',
        admissionNumberDetected: null,
        marks: [
          { week: 'Week 1', day: 'Monday', status: 'PRESENT', rawSymbol: '/', notes: null },
          { week: 'Week 1', day: 'Tuesday', status: 'ABSENT', rawSymbol: '0', notes: null },
          { week: 'Week 1', day: 'Wednesday', status: 'UNCERTAIN', rawSymbol: '?', notes: 'Faint pencil mark' }
          // Thursday & Friday intentionally omitted to demonstrate missing-cell detection
        ]
      }
    ]
  };

  const malformedSample = {
    schoolIdentified: 'L.E.A. Primary School',
    classIdentified: 'Primary 4A',
    totalRowsDetected: 3,
    rows: [
      {
        rowNumber: 0, // Invalid: non-positive row number
        studentNameDetected: 'Bad Row Zero',
        marks: [{ week: 'Week 1', day: 'Monday', status: 'PRESENT', rawSymbol: '/' }]
      },
      {
        rowNumber: 1,
        studentNameDetected: 'Amina Yusuf Balarabe',
        marks: [
          { week: 'Week 1', day: 'Monday', status: 'LATE_EARLY', rawSymbol: 'L' }, // Invalid status
          { week: 'Week 99', day: 'Tuesday', status: 'PRESENT', rawSymbol: '/' }, // Invalid week
          { week: 'Week 1', day: 'Saturday', status: 'PRESENT', rawSymbol: '/' }, // Invalid weekday
          { week: 'Week 1', day: 'Wednesday', status: 'ABSENT', rawSymbol: '0' },
          { week: 'Week 1', day: 'Wednesday', status: 'PRESENT', rawSymbol: '/' }, // Duplicate Wednesday
          { week: 'Week 1', day: 'Friday', status: 'BLANK', rawSymbol: '' }
        ]
      },
      {
        rowNumber: -2, // Invalid negative row number
        studentNameDetected: 'Negative Row',
        marks: 'NOT_AN_ARRAY' // Malformed marks
      }
    ]
  };

  return { validMultiWeekSample, malformedSample };
}
