import { AttendanceSession } from '../types/attendance';

export interface DuplicateSessionCheckInput {
  candidateClassId?: string;
  candidateClassName: string;
  candidateDate: string;
  candidatePeriod?: string;
  candidateDraftId?: string;
  existingSessions: AttendanceSession[];
}

export interface DuplicateSessionMatch {
  session: AttendanceSession;
  reason: string;
}

function normalizeText(val: string | undefined | null): string {
  return (val || '').trim().toLowerCase();
}

/**
 * Checks existing attendance sessions for potential duplicates matching the same class
 * and attendance date or reporting period.
 * Ignores 'Failed' attempts and excludes any session already created by the same draft ID
 * (which is handled separately as idempotent draft deduplication).
 */
export function findPotentialDuplicateSessions(
  input: DuplicateSessionCheckInput
): DuplicateSessionMatch[] {
  const {
    candidateClassId,
    candidateClassName,
    candidateDate,
    candidatePeriod,
    candidateDraftId,
    existingSessions
  } = input;

  const normClassName = normalizeText(candidateClassName);
  const normDate = normalizeText(candidateDate);
  const normPeriod = normalizeText(candidatePeriod);

  const matches: DuplicateSessionMatch[] = [];
  const seenIds = new Set<string>();

  for (const session of existingSessions) {
    if (seenIds.has(session.id)) continue;
    if (session.reviewStatus === 'Failed') continue;
    if (candidateDraftId && session.sourceDraftId === candidateDraftId) continue;

    const sameClassId =
      Boolean(candidateClassId) &&
      Boolean(session.classId) &&
      session.classId === candidateClassId;
    const sameClassName =
      Boolean(normClassName) && normalizeText(session.classGrade) === normClassName;

    if (!sameClassId && !sameClassName) continue;

    const sessionDate = normalizeText(session.date);
    const sessionPeriod = normalizeText(session.sessionYear);

    const exactDateMatch = Boolean(normDate) && sessionDate === normDate;
    const exactPeriodMatch =
      Boolean(normPeriod) &&
      Boolean(sessionPeriod) &&
      (sessionPeriod === normPeriod ||
        sessionPeriod.includes(normPeriod) ||
        normPeriod.includes(sessionPeriod));

    if (exactDateMatch || exactPeriodMatch) {
      seenIds.add(session.id);
      const statusLabel = session.reviewStatus === 'Confirmed' ? 'Confirmed session' : `${session.reviewStatus} session`;
      matches.push({
        session,
        reason: exactDateMatch
          ? `${statusLabel} already exists for ${session.classGrade} on ${session.date}`
          : `${statusLabel} already exists for ${session.classGrade} (${session.sessionYear})`
      });
    }
  }

  return matches;
}
