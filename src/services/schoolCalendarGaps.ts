import { AttendanceSession, DayOfWeek, NonSchoolGapRecord } from '../types/attendance';

export const NON_SCHOOL_GAPS_STORAGE_KEY = 'lea_non_school_gaps_v1';

const WEEKDAY_NAMES: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEKDAY_LETTERS: Record<DayOfWeek, { letter: string; ordinalHint: string; index: number }> = {
  Monday: { letter: 'M', ordinalHint: "1st column ('M')", index: 0 },
  Tuesday: { letter: 'T', ordinalHint: "1st 'T' after 'M'", index: 1 },
  Wednesday: { letter: 'W', ordinalHint: "3rd column ('W')", index: 2 },
  Thursday: { letter: 'T', ordinalHint: "2nd 'T' after 'W'", index: 3 },
  Friday: { letter: 'F', ordinalHint: "5th column ('F')", index: 4 }
};

/**
 * Formats a local Date into YYYY-MM-DD without UTC timezone drift.
 */
export function formatLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses a YYYY-MM-DD string safely into a local noon Date object (avoids DST shifts).
 */
export function parseIsoDateLocal(isoDate: string): Date | null {
  const m = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

/**
 * Returns true if the given ISO date falls on Saturday or Sunday (no school by default).
 */
export function isWeekendDate(isoDate: string): boolean {
  const dt = parseIsoDateLocal(isoDate);
  if (!dt) return false;
  const dow = dt.getDay();
  return dow === 0 || dow === 6;
}

/**
 * Returns the default school date: today if Monday–Friday, or the most recent Friday if Saturday/Sunday.
 */
export function getDefaultSchoolDate(referenceDate: Date = new Date()): string {
  const dt = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    12,
    0,
    0,
    0
  );
  const dow = dt.getDay();
  if (dow === 6) {
    // Saturday -> Friday
    dt.setDate(dt.getDate() - 1);
  } else if (dow === 0) {
    // Sunday -> Friday
    dt.setDate(dt.getDate() - 2);
  }
  return formatLocalIsoDate(dt);
}

/**
 * Returns weekday targeting metadata for single-day register scanning (M, T, W, T, F).
 */
export function getTargetWeekdayInfo(isoDate: string): {
  isWeekend: boolean;
  dayName: DayOfWeek;
  headerLetter: string;
  ordinalHint: string;
  columnIndex: number;
  formattedDate: string;
} {
  const dt = parseIsoDateLocal(isoDate) || parseIsoDateLocal(getDefaultSchoolDate())!;
  const dow = dt.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const dayName: DayOfWeek = dow >= 1 && dow <= 5 ? WEEKDAY_NAMES[dow - 1] : 'Friday';
  const meta = WEEKDAY_LETTERS[dayName];
  const formattedDate = dt.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  return {
    isWeekend,
    dayName,
    headerLetter: meta.letter,
    ordinalHint: meta.ordinalHint,
    columnIndex: meta.index,
    formattedDate
  };
}

export const DISMISSED_GAP_KEYS_STORAGE_KEY = 'lea_dismissed_gap_keys_v1';

/**
 * Extracts a strict YYYY-MM-DD calendar date from an ISO date or timestamp string.
 */
export function normalizeIsoDateOnly(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function isoDateToUtcMs(isoDate: string): number | null {
  const norm = normalizeIsoDateOnly(isoDate);
  if (!norm) return null;
  const [y, m, d] = norm.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToIsoDate(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lists all Monday–Friday ISO dates strictly between startExclusive and endExclusive
 * using exact UTC calendar-day arithmetic (immune to DST or local timezone shifts).
 * Sequential days (e.g., Wed 18 Nov -> Thu 19 Nov) always return [].
 * Weekend-only spans (e.g., Fri 13 Nov -> Mon 16 Nov) always return [].
 */
export function getSchoolWeekdaysStrictlyBetween(
  startExclusiveIso: string,
  endExclusiveIso: string
): string[] {
  const startMs = isoDateToUtcMs(startExclusiveIso);
  const endMs = isoDateToUtcMs(endExclusiveIso);
  if (startMs === null || endMs === null || startMs >= endMs) return [];

  const result: string[] = [];
  let cursorMs = startMs + ONE_DAY_MS;
  let guard = 0;

  while (cursorMs < endMs && guard < 365) {
    const dow = new Date(cursorMs).getUTCDay();
    if (dow >= 1 && dow <= 5) {
      result.push(utcMsToIsoDate(cursorMs));
    }
    cursorMs += ONE_DAY_MS;
    guard++;
  }

  return result;
}

/**
 * Lists all Monday–Friday ISO dates inclusively between startIso and endIso.
 */
export function getSchoolWeekdaysInclusive(startIso: string, endIso: string): string[] {
  const startMs = isoDateToUtcMs(startIso);
  const endMs = isoDateToUtcMs(endIso);
  if (startMs === null || endMs === null || startMs > endMs) return [];

  const result: string[] = [];
  let cursorMs = startMs;
  let guard = 0;

  while (cursorMs <= endMs && guard < 365) {
    const dow = new Date(cursorMs).getUTCDay();
    if (dow >= 1 && dow <= 5) {
      result.push(utcMsToIsoDate(cursorMs));
    }
    cursorMs += ONE_DAY_MS;
    guard++;
  }
  return result;
}

export interface DetectedWeekdayGap {
  previousRecordedDate: string;
  targetDate: string;
  startDate: string;
  endDate: string;
  missingWeekdays: string[];
}

/**
 * Checks whether scanning on `targetDate` skips at least one sequential school weekday (Mon–Fri)
 * after the latest recorded attendance or labeled non-school day.
 *
 * Rules:
 * - Sequential school days (e.g. Wed 18 Nov -> Thu 19 Nov) NEVER trigger a gap.
 * - Weekends (Saturday & Sunday) NEVER trigger a gap (Fri -> Mon is sequential).
 * - If attendance or a gap is already recorded on or after `targetDate` (e.g. scanning the
 *   2nd class on the same day, or back-filling an earlier date), returns null.
 */
export function detectUnlabeledWeekdayGap(params: {
  targetDate: string;
  sessions: AttendanceSession[];
  existingGaps: NonSchoolGapRecord[];
}): DetectedWeekdayGap | null {
  const { sessions, existingGaps } = params;
  const targetIso = normalizeIsoDateOnly(params.targetDate);
  if (!targetIso || isWeekendDate(targetIso)) {
    return null;
  }

  const labeledDates = new Set<string>();
  const allRecordedDates: string[] = [];

  for (const s of sessions) {
    if (s.reviewStatus === 'Failed') continue;
    const normDate = normalizeIsoDateOnly(s.date);
    if (!normDate) continue;
    allRecordedDates.push(normDate);
    if (s.isNonSchoolDay) {
      labeledDates.add(normDate);
    }
  }

  for (const gap of existingGaps) {
    const gapDates =
      Array.isArray(gap.dates) && gap.dates.length > 0
        ? gap.dates
        : getSchoolWeekdaysInclusive(gap.startDate, gap.endDate);
    for (const rawD of gapDates) {
      const normD = normalizeIsoDateOnly(rawD);
      if (!normD) continue;
      labeledDates.add(normD);
      allRecordedDates.push(normD);
    }
  }

  if (allRecordedDates.length === 0) {
    return null;
  }

  allRecordedDates.sort();
  const latestRecordedDate = allRecordedDates[allRecordedDates.length - 1];

  // If admin is scanning on the same day as (or earlier than) the latest recorded date,
  // do NOT prompt about gaps — only prompt when advancing past the latest recorded school day.
  if (targetIso <= latestRecordedDate) {
    return null;
  }

  const betweenWeekdays = getSchoolWeekdaysStrictlyBetween(latestRecordedDate, targetIso);
  const unlabeled = betweenWeekdays.filter((d) => !labeledDates.has(d));

  if (unlabeled.length === 0) {
    return null;
  }

  return {
    previousRecordedDate: latestRecordedDate,
    targetDate: targetIso,
    startDate: unlabeled[0],
    endDate: unlabeled[unlabeled.length - 1],
    missingWeekdays: unlabeled
  };
}

/**
 * Builds a Set of all ISO dates explicitly confirmed as Non-School Days (from gap records or sessions).
 */
export function buildNonSchoolDateMap(
  sessions: AttendanceSession[],
  gaps: NonSchoolGapRecord[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const gap of gaps) {
    const dates =
      Array.isArray(gap.dates) && gap.dates.length > 0
        ? gap.dates
        : getSchoolWeekdaysInclusive(gap.startDate, gap.endDate);
    for (const d of dates) {
      const normD = normalizeIsoDateOnly(d);
      if (normD) map.set(normD, gap.label);
    }
  }
  for (const s of sessions) {
    const normD = normalizeIsoDateOnly(s.date);
    if (s.isNonSchoolDay && normD && s.reviewStatus !== 'Failed') {
      map.set(normD, s.nonSchoolReason || 'Non-School Day');
    }
  }
  return map;
}

export function createNonSchoolGapRecord(params: {
  startDate: string;
  endDate: string;
  label: string;
  source: NonSchoolGapRecord['source'];
}): NonSchoolGapRecord {
  const cleanedLabel = params.label.trim() || 'Non-School Day';
  const dates = getSchoolWeekdaysInclusive(params.startDate, params.endDate);
  return {
    id: `gap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    startDate: dates[0] || params.startDate,
    endDate: dates[dates.length - 1] || params.endDate,
    dates: dates.length > 0 ? dates : [params.startDate],
    label: cleanedLabel,
    source: params.source,
    createdAt: new Date().toISOString()
  };
}

export function getStoredNonSchoolGaps(): NonSchoolGapRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(NON_SCHOOL_GAPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredNonSchoolGaps(gaps: NonSchoolGapRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(NON_SCHOOL_GAPS_STORAGE_KEY, JSON.stringify(gaps));
  } catch {
    // Ignore storage quota errors
  }
}

export function getStoredDismissedGapKeys(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DISMISSED_GAP_KEYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function saveStoredDismissedGapKeys(keys: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DISMISSED_GAP_KEYS_STORAGE_KEY, JSON.stringify(keys.slice(-50)));
  } catch {
    // Ignore storage quota errors
  }
}

export function formatReadableDate(isoDate: string): string {
  const dt = parseIsoDateLocal(isoDate);
  if (!dt) return isoDate;
  return dt.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}
