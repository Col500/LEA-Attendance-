import { AttendanceSession, ClassItem, SchoolInfo, Student } from '../types/attendance';

export type AnalyticsViewMode = 'numbers' | 'bar' | 'pie' | 'trend' | 'all';

export type TimeframeMode = 'all' | 'date' | 'range' | 'month' | 'term' | 'year';

export interface DashboardAnalyticsFilter {
  selectedClassIds: string[];
  timeframeMode: TimeframeMode;
  exactDate: string;
  startDate: string;
  endDate: string;
  month: string; // YYYY-MM
  term: string;  // First Term | Second Term | Third Term
  year: string;  // YYYY or sessionYear
}

export interface ClassComparisonMetric {
  classId: string;
  className: string;
  enrolledCount: number;
  activeCount: number;
  sessionsCount: number;
  presentCount: number;
  absentCount: number;
  blankCount: number;
  uncertainCount: number;
  attendanceRate: number;
  absenceRate: number;
}

export interface PieSegmentMetric {
  key: 'present' | 'absent' | 'blank' | 'uncertain';
  label: string;
  count: number;
  percentage: number;
  color: string;
  description: string;
}

export interface TrendClassPoint {
  classId: string;
  className: string;
  present: number;
  absent: number;
  rate: number;
}

export interface TrendPoint {
  date: string;
  label: string;
  sessionCount: number;
  presentCount: number;
  absentCount: number;
  blankCount: number;
  uncertainCount: number;
  attendanceRate: number;
  byClass: Record<string, TrendClassPoint>;
}

export interface AvailableAnalyticsOptions {
  months: Array<{ value: string; label: string }>;
  terms: string[];
  years: string[];
  minDate: string | null;
  maxDate: string | null;
}

export interface DashboardAnalyticsResult {
  filteredSessions: AttendanceSession[];
  scopedClasses: ClassItem[];
  summary: {
    activeStudents: number;
    enrolledStudents: number;
    totalSessions: number;
    presentCount: number;
    absentCount: number;
    blankCount: number;
    uncertainCount: number;
    attendanceRate: number;
    absenceRate: number;
    recordedClassesCount: number;
  };
  classComparison: ClassComparisonMetric[];
  pieSegments: PieSegmentMetric[];
  timeSeries: TrendPoint[];
  availableOptions: AvailableAnalyticsOptions;
  hasActiveFilters: boolean;
}

const MONTH_SHORT_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function formatMonthLabel(yearMonth: string): string {
  const parts = yearMonth.split('-');
  if (parts.length !== 2) return yearMonth;
  const year = parts[0];
  const monthIndex = parseInt(parts[1], 10) - 1;
  if (isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) return yearMonth;
  return `${MONTH_SHORT_NAMES[monthIndex]} ${year}`;
}

export function formatShortDateLabel(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11 || isNaN(day)) return isoDate;
  return `${day} ${MONTH_SHORT_NAMES[monthIdx]}`;
}

export function createDefaultAnalyticsFilter(school?: SchoolInfo): DashboardAnalyticsFilter {
  const today = new Date();
  const isoToday = today.toISOString().split('T')[0];
  const currentMonth = isoToday.slice(0, 7);
  const currentYear = isoToday.slice(0, 4);

  return {
    selectedClassIds: [],
    timeframeMode: 'all',
    exactDate: isoToday,
    startDate: '',
    endDate: isoToday,
    month: currentMonth,
    term: school?.currentTerm || 'First Term',
    year: currentYear
  };
}

function resolveSessionClassId(
  session: AttendanceSession,
  classes: ClassItem[]
): string | null {
  if (session.classId && classes.some((c) => c.id === session.classId)) {
    return session.classId;
  }
  const byName = classes.find(
    (c) => c.name.trim().toLowerCase() === session.classGrade.trim().toLowerCase()
  );
  return byName?.id || null;
}

function matchesTimeframe(
  session: AttendanceSession,
  filter: DashboardAnalyticsFilter
): boolean {
  const dateStr = session.date || '';

  switch (filter.timeframeMode) {
    case 'all':
      return true;
    case 'date':
      return !filter.exactDate || dateStr === filter.exactDate;
    case 'range': {
      if (filter.startDate && dateStr < filter.startDate) return false;
      if (filter.endDate && dateStr > filter.endDate) return false;
      return true;
    }
    case 'month':
      return !filter.month || dateStr.startsWith(filter.month);
    case 'term':
      return (
        !filter.term ||
        session.term.trim().toLowerCase() === filter.term.trim().toLowerCase()
      );
    case 'year': {
      if (!filter.year) return true;
      if (/^\d{4}$/.test(filter.year)) {
        return dateStr.startsWith(filter.year);
      }
      return Boolean(
        dateStr.startsWith(filter.year) ||
          (session.sessionYear && session.sessionYear.includes(filter.year))
      );
    }
    default:
      return true;
  }
}

export function deriveAvailableAnalyticsOptions(
  sessions: AttendanceSession[],
  school?: SchoolInfo
): AvailableAnalyticsOptions {
  const validSessions = sessions.filter((s) => s.reviewStatus !== 'Failed');
  const monthSet = new Set<string>();
  const termSet = new Set<string>(['First Term', 'Second Term', 'Third Term']);
  const yearSet = new Set<string>();

  if (school?.currentTerm) {
    termSet.add(school.currentTerm);
  }

  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const session of validSessions) {
    if (!session.date) continue;
    if (session.date.length >= 7) {
      monthSet.add(session.date.slice(0, 7));
    }
    if (session.date.length >= 4) {
      yearSet.add(session.date.slice(0, 4));
    }
    if (session.term?.trim()) {
      termSet.add(session.term.trim());
    }
    if (!minDate || session.date < minDate) minDate = session.date;
    if (!maxDate || session.date > maxDate) maxDate = session.date;
  }

  if (yearSet.size === 0) {
    yearSet.add(new Date().toISOString().slice(0, 4));
  }

  const months = Array.from(monthSet)
    .sort((a, b) => b.localeCompare(a))
    .map((value) => ({
      value,
      label: formatMonthLabel(value)
    }));

  const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  const terms = Array.from(termSet);

  return {
    months,
    terms,
    years,
    minDate,
    maxDate
  };
}

export function computeDashboardAnalytics(params: {
  sessions: AttendanceSession[];
  classes: ClassItem[];
  students: Student[];
  filter: DashboardAnalyticsFilter;
  school?: SchoolInfo;
}): DashboardAnalyticsResult {
  const { sessions, classes, students, filter, school } = params;

  const validSessions = sessions.filter(
    (s) => s.reviewStatus !== 'Failed' && !s.isNonSchoolDay
  );
  const selectedSet = new Set(filter.selectedClassIds);
  const hasClassFilter = selectedSet.size > 0;

  const scopedClasses = hasClassFilter
    ? classes.filter((c) => selectedSet.has(c.id))
    : classes;

  const scopedStudents = hasClassFilter
    ? students.filter((s) => selectedSet.has(s.classId))
    : students;

  const activeStudents = scopedStudents.filter((s) => s.active).length;
  const enrolledStudents = scopedStudents.length;

  const filteredSessions = validSessions.filter((session) => {
    if (hasClassFilter) {
      const matchedId = resolveSessionClassId(session, classes);
      if (!matchedId || !selectedSet.has(matchedId)) {
        return false;
      }
    }
    return matchesTimeframe(session, filter);
  });

  let presentCount = 0;
  let absentCount = 0;
  let blankCount = 0;
  let uncertainCount = 0;
  const recordedClassIds = new Set<string>();

  for (const session of filteredSessions) {
    presentCount += session.presentCount || 0;
    absentCount += session.absentCount || 0;
    blankCount += session.blankCount || 0;
    uncertainCount += session.uncertainCount || 0;
    const cid = resolveSessionClassId(session, classes);
    if (cid) recordedClassIds.add(cid);
  }

  const markedTotal = presentCount + absentCount;
  const attendanceRate = markedTotal > 0 ? Math.round((presentCount / markedTotal) * 100) : 0;
  const absenceRate = markedTotal > 0 ? Math.round((absentCount / markedTotal) * 100) : 0;

  // Per-class comparison metrics
  const classComparison: ClassComparisonMetric[] = scopedClasses.map((cls) => {
    const classStudents = students.filter((s) => s.classId === cls.id);
    const classActive = classStudents.filter((s) => s.active).length;
    const classSessions = filteredSessions.filter(
      (s) => resolveSessionClassId(s, classes) === cls.id
    );

    let cPresent = 0;
    let cAbsent = 0;
    let cBlank = 0;
    let cUncertain = 0;

    for (const s of classSessions) {
      cPresent += s.presentCount || 0;
      cAbsent += s.absentCount || 0;
      cBlank += s.blankCount || 0;
      cUncertain += s.uncertainCount || 0;
    }

    const cMarked = cPresent + cAbsent;
    const cRate = cMarked > 0 ? Math.round((cPresent / cMarked) * 100) : 0;
    const cAbsRate = cMarked > 0 ? Math.round((cAbsent / cMarked) * 100) : 0;

    return {
      classId: cls.id,
      className: cls.name,
      enrolledCount: classStudents.length,
      activeCount: classActive,
      sessionsCount: classSessions.length,
      presentCount: cPresent,
      absentCount: cAbsent,
      blankCount: cBlank,
      uncertainCount: cUncertain,
      attendanceRate: cRate,
      absenceRate: cAbsRate
    };
  });

  // Pie / donut distribution across filtered marks
  const pieTotalMarks = presentCount + absentCount + blankCount + uncertainCount;
  const rawSegments: Array<Omit<PieSegmentMetric, 'percentage'>> = [
    {
      key: 'present',
      label: 'Present',
      count: presentCount,
      color: '#059669',
      description: 'Verified present marks'
    },
    {
      key: 'absent',
      label: 'Absent',
      count: absentCount,
      color: '#e11d48',
      description: 'Marked absent marks'
    },
    {
      key: 'blank',
      label: 'Blank / Holiday',
      count: blankCount,
      color: '#94a3b8',
      description: 'Unmarked or holiday columns'
    },
    {
      key: 'uncertain',
      label: 'Uncertain',
      count: uncertainCount,
      color: '#d97706',
      description: 'Flagged for manual check'
    }
  ];

  const pieSegments: PieSegmentMetric[] = rawSegments
    .filter((seg) => seg.count > 0 || seg.key === 'present' || seg.key === 'absent')
    .map((seg) => ({
      ...seg,
      percentage: pieTotalMarks > 0 ? Math.round((seg.count / pieTotalMarks) * 100) : 0
    }));

  // Chronological trend graph aggregation by date
  const byDateMap = new Map<
    string,
    {
      sessionCount: number;
      presentCount: number;
      absentCount: number;
      blankCount: number;
      uncertainCount: number;
      classBuckets: Map<string, { className: string; present: number; absent: number }>;
    }
  >();

  for (const session of filteredSessions) {
    if (!session.date) continue;
    let bucket = byDateMap.get(session.date);
    if (!bucket) {
      bucket = {
        sessionCount: 0,
        presentCount: 0,
        absentCount: 0,
        blankCount: 0,
        uncertainCount: 0,
        classBuckets: new Map()
      };
      byDateMap.set(session.date, bucket);
    }

    bucket.sessionCount += 1;
    bucket.presentCount += session.presentCount || 0;
    bucket.absentCount += session.absentCount || 0;
    bucket.blankCount += session.blankCount || 0;
    bucket.uncertainCount += session.uncertainCount || 0;

    const cid = resolveSessionClassId(session, classes) || session.classGrade;
    const cname =
      classes.find((c) => c.id === cid)?.name || session.classGrade || 'Class';
    const existingClass = bucket.classBuckets.get(cid) || {
      className: cname,
      present: 0,
      absent: 0
    };
    existingClass.present += session.presentCount || 0;
    existingClass.absent += session.absentCount || 0;
    bucket.classBuckets.set(cid, existingClass);
  }

  const timeSeries: TrendPoint[] = Array.from(byDateMap.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, bucket]) => {
      const marked = bucket.presentCount + bucket.absentCount;
      const rate = marked > 0 ? Math.round((bucket.presentCount / marked) * 100) : 0;
      const byClass: Record<string, TrendClassPoint> = {};

      bucket.classBuckets.forEach((val, cid) => {
        const cMarked = val.present + val.absent;
        byClass[cid] = {
          classId: cid,
          className: val.className,
          present: val.present,
          absent: val.absent,
          rate: cMarked > 0 ? Math.round((val.present / cMarked) * 100) : 0
        };
      });

      return {
        date,
        label: formatShortDateLabel(date),
        sessionCount: bucket.sessionCount,
        presentCount: bucket.presentCount,
        absentCount: bucket.absentCount,
        blankCount: bucket.blankCount,
        uncertainCount: bucket.uncertainCount,
        attendanceRate: rate,
        byClass
      };
    });

  const availableOptions = deriveAvailableAnalyticsOptions(sessions, school);
  const hasActiveFilters =
    filter.selectedClassIds.length > 0 || filter.timeframeMode !== 'all';

  return {
    filteredSessions,
    scopedClasses,
    summary: {
      activeStudents,
      enrolledStudents,
      totalSessions: filteredSessions.length,
      presentCount,
      absentCount,
      blankCount,
      uncertainCount,
      attendanceRate,
      absenceRate,
      recordedClassesCount: recordedClassIds.size
    },
    classComparison,
    pieSegments,
    timeSeries,
    availableOptions,
    hasActiveFilters
  };
}
