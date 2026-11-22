import assert from 'node:assert/strict';
import {
  AttendanceSession,
  ClassItem,
  ClassWorkflowHistoryEntry,
  NonSchoolGapRecord,
  Student
} from '../types/attendance';
import {
  createNonSchoolGapRecord,
  detectUnlabeledWeekdayGap,
  getDefaultSchoolDate,
  getTargetWeekdayInfo,
  isWeekendDate
} from './schoolCalendarGaps';
import {
  appendClassToWorkflowHistory,
  suggestNextClassToScan
} from './workflowPreferences';
import {
  computeClassPunctualityRankings,
  computeStarredStudentSummaries
} from './studentTrackingMetrics';
import {
  evaluateDailyClassCompletion,
  evaluateHeadmistressRingAction
} from './headmistressAlertService';
import { selectRightmostWeekAndTargetDay } from '../server/googleCloudVisionService';
import {
  matchClassNameToRoster,
  parseSummaryLinesFromVisionText
} from '../server/summaryNoteService';

const SAMPLE_CLASSES: ClassItem[] = [
  { id: 'cls-1a', name: 'Primary 1A', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'cls-2a', name: 'Primary 2A', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'cls-3a', name: 'Primary 3A', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
];

const SAMPLE_STUDENTS: Student[] = [
  {
    id: 'std-ahmed',
    classId: 'cls-3a',
    studentNumber: 1,
    fullName: 'Ahmed Isa',
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  },
  {
    id: 'std-jennifer',
    classId: 'cls-3a',
    studentNumber: 2,
    fullName: 'Jennifer Solomon',
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  }
];

function makeSession(overrides: Partial<AttendanceSession>): AttendanceSession {
  return {
    id: `ses-${Math.random().toString(36).slice(2, 7)}`,
    date: '2026-11-16',
    classId: 'cls-3a',
    classGrade: 'Primary 3A',
    term: 'First Term',
    sessionYear: '2026/2027',
    totalEnrolled: 2,
    presentCount: 2,
    absentCount: 0,
    reviewStatus: 'Confirmed',
    captureMode: 'register',
    recordedBy: 'School Admin',
    ...overrides
  };
}

// 1. Weekend awareness & latest-Friday default
{
  // 2026-11-21 is Saturday, 2026-11-22 is Sunday, 2026-11-20 is Friday
  assert.equal(isWeekendDate('2026-11-21'), true, 'Saturday must be detected as weekend');
  assert.equal(isWeekendDate('2026-11-22'), true, 'Sunday must be detected as weekend');
  assert.equal(isWeekendDate('2026-11-20'), false, 'Friday must be a school weekday');

  const satRef = new Date(2026, 10, 21, 10, 0, 0);
  const sunRef = new Date(2026, 10, 22, 10, 0, 0);
  const tueRef = new Date(2026, 10, 17, 10, 0, 0);
  assert.equal(getDefaultSchoolDate(satRef), '2026-11-20', 'Saturday defaults to latest Friday');
  assert.equal(getDefaultSchoolDate(sunRef), '2026-11-20', 'Sunday defaults to latest Friday');
  assert.equal(getDefaultSchoolDate(tueRef), '2026-11-17', 'Tuesday stays Tuesday');

  const tueInfo = getTargetWeekdayInfo('2026-11-17');
  assert.equal(tueInfo.dayName, 'Tuesday');
  assert.equal(tueInfo.ordinalHint, "1st 'T' after 'M'");
  const thuInfo = getTargetWeekdayInfo('2026-11-19');
  assert.equal(thuInfo.dayName, 'Thursday');
  assert.equal(thuInfo.ordinalHint, "2nd 'T' after 'W'");
}

// 2. Sequential weekday gap detection (ignores weekends & already labeled gaps)
{
  const fridaySession = makeSession({ date: '2026-11-13' }); // Friday
  // Scanning Monday 2026-11-16 right after Friday 2026-11-13 should have NO gap (Sat/Sun ignored)
  const monGap = detectUnlabeledWeekdayGap({
    targetDate: '2026-11-16',
    sessions: [fridaySession],
    existingGaps: []
  });
  assert.equal(monGap, null, 'Friday -> Monday must NOT trigger a gap prompt');

  // Scanning Thursday 2026-11-19 after Monday 2026-11-16 skips Tue 17 and Wed 18
  const monSession = makeSession({ date: '2026-11-16' });
  const thuGap = detectUnlabeledWeekdayGap({
    targetDate: '2026-11-19',
    sessions: [monSession],
    existingGaps: []
  });
  assert.ok(thuGap, 'Monday -> Thursday must detect Tue & Wed gap');
  assert.deepEqual(thuGap.missingWeekdays, ['2026-11-17', '2026-11-18']);
  assert.equal(thuGap.startDate, '2026-11-17');
  assert.equal(thuGap.endDate, '2026-11-18');

  // Once admin types a custom label for Tue-Wed, no further prompt fires
  const labeledGap: NonSchoolGapRecord = createNonSchoolGapRecord({
    startDate: '2026-11-17',
    endDate: '2026-11-18',
    label: 'NUT Teachers Strike',
    source: 'gap-prompt'
  });
  const afterLabelGap = detectUnlabeledWeekdayGap({
    targetDate: '2026-11-19',
    sessions: [monSession],
    existingGaps: [labeledGap]
  });
  assert.equal(afterLabelGap, null, 'Labeled gap must not trigger duplicate prompt');

  // Sequential weekdays (Wed 18 Nov -> Thu 19 Nov) must NEVER trigger a gap
  const wedSession = makeSession({ date: '2026-11-18' });
  const wedToThuGap = detectUnlabeledWeekdayGap({
    targetDate: '2026-11-19',
    sessions: [wedSession],
    existingGaps: []
  });
  assert.equal(wedToThuGap, null, 'Wed 18 Nov -> Thu 19 Nov are sequential and must NOT show gap prompt');

  // Timestamped ISO date on Wed 18 Nov -> Thu 19 Nov must also be sequential (no gap)
  const wedTimestampSession = makeSession({ date: '2026-11-18T10:15:00Z' });
  assert.equal(
    detectUnlabeledWeekdayGap({
      targetDate: '2026-11-19',
      sessions: [wedTimestampSession],
      existingGaps: []
    }),
    null,
    'Timestamped Wed 18 Nov -> Thu 19 Nov must NOT trigger a gap'
  );

  // Mon 16 Nov -> Wed 18 Nov (Tue 17 skipped) MUST show single skipped day Tue 17 Nov
  const monToWedGap = detectUnlabeledWeekdayGap({
    targetDate: '2026-11-18',
    sessions: [monSession],
    existingGaps: []
  });
  assert.ok(monToWedGap, 'Mon -> Wed with Tue skipped must detect Tue');
  assert.deepEqual(monToWedGap.missingWeekdays, ['2026-11-17']);

  // Scanning a 2nd class on the same day (Fri 20 Nov after Tue 17 Nov + Fri 20 Nov) must NOT re-prompt
  const tueSession = makeSession({ date: '2026-11-17' });
  const friSession = makeSession({ date: '2026-11-20' });
  assert.equal(
    detectUnlabeledWeekdayGap({
      targetDate: '2026-11-20',
      sessions: [tueSession, friSession],
      existingGaps: []
    }),
    null,
    'Already scanning on Fri 20 Nov must NOT re-prompt for older gaps'
  );
}

// 3. Default Single-Day Rightmost-Week Selector (disambiguating Tuesday 1st T vs Thursday 2nd T)
{
  const twoWeeks = [
    {
      weekLabel: 'Week 1',
      days: [
        { day: 'Monday' as const, xCenter: 100, dayWidth: 20 },
        { day: 'Tuesday' as const, xCenter: 120, dayWidth: 20 },
        { day: 'Wednesday' as const, xCenter: 140, dayWidth: 20 },
        { day: 'Thursday' as const, xCenter: 160, dayWidth: 20 },
        { day: 'Friday' as const, xCenter: 180, dayWidth: 20 }
      ]
    },
    {
      weekLabel: 'Week 2',
      days: [
        { day: 'Monday' as const, xCenter: 300, dayWidth: 20 },
        { day: 'Tuesday' as const, xCenter: 320, dayWidth: 20 },
        { day: 'Wednesday' as const, xCenter: 340, dayWidth: 20 },
        { day: 'Thursday' as const, xCenter: 360, dayWidth: 20 },
        { day: 'Friday' as const, xCenter: 380, dayWidth: 20 }
      ]
    }
  ];

  const tueSelected = selectRightmostWeekAndTargetDay(twoWeeks, 'Tuesday');
  assert.equal(tueSelected.length, 1);
  assert.equal(tueSelected[0].weekLabel, 'Week 2', 'Must pick rightmost week');
  assert.equal(tueSelected[0].days.length, 1);
  assert.equal(tueSelected[0].days[0].day, 'Tuesday');
  assert.equal(tueSelected[0].days[0].xCenter, 320, 'Tuesday must select 1st T after M in Week 2');

  const thuSelected = selectRightmostWeekAndTargetDay(twoWeeks, 'Thursday');
  assert.equal(thuSelected[0].days[0].day, 'Thursday');
  assert.equal(thuSelected[0].days[0].xCenter, 360, 'Thursday must select 2nd T after W in Week 2');
}

// 4. Summary Note Class Matching & Arithmetic Mismatch Detection
{
  const classRefs = SAMPLE_CLASSES.map((c) => ({ id: c.id, name: c.name, enrolledCount: 30 }));
  assert.equal(matchClassNameToRoster('Pry 3A', classRefs), 'cls-3a');
  assert.equal(matchClassNameToRoster('Primary 2 A', classRefs), 'cls-2a');

  const ocrSample = [
    'Pry 1A: Present 25, Absent 5, Total 30',
    'Primary 2A: Present 20, Absent 3, Total 25'
  ].join('\n');
  const parsed = parseSummaryLinesFromVisionText(ocrSample, classRefs);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].matchedClassId, 'cls-1a');
  assert.equal(parsed[0].presentCount, 25);
  assert.equal(parsed[0].absentCount, 5);
  assert.equal(parsed[0].hasMathMismatch, false);

  assert.equal(parsed[1].matchedClassId, 'cls-2a');
  assert.equal(parsed[1].hasMathMismatch, true, '20 + 3 != 25 must flag arithmetic mismatch');
}

// 5. Adaptive Next-Class Auto-Advance (Sequential < 5 days, Learned >= 5 days)
{
  // Day 1: sequential fallback (1A -> 2A)
  const seqSuggestion = suggestNextClassToScan({
    currentClassId: 'cls-1a',
    classes: SAMPLE_CLASSES,
    scannedTodayClassIds: new Set(['cls-1a']),
    history: []
  });
  assert.equal(seqSuggestion.source, 'sequential');
  assert.equal(seqSuggestion.nextClass?.id, 'cls-2a');

  // After 5 school days where admin always walks 1A -> 3A -> 2A
  let history: ClassWorkflowHistoryEntry[] = [];
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
    history = appendClassToWorkflowHistory(history, d, 'cls-1a');
    history = appendClassToWorkflowHistory(history, d, 'cls-3a');
    history = appendClassToWorkflowHistory(history, d, 'cls-2a');
  }

  const learnedSuggestion = suggestNextClassToScan({
    currentClassId: 'cls-1a',
    classes: SAMPLE_CLASSES,
    scannedTodayClassIds: new Set(['cls-1a']),
    history
  });
  assert.equal(learnedSuggestion.source, 'learned');
  assert.equal(learnedSuggestion.nextClass?.id, 'cls-3a', 'Must follow learned 1A -> 3A transition');
}

// 6. Starred Pupil Numeric Ratios & Settings Punctuality Query (Direct Register Only)
{
  const directMon = makeSession({
    date: '2026-11-16',
    captureMode: 'register',
    records: [
      { id: 'rec-1', studentId: 'std-ahmed', rowNumber: 1, studentName: 'Ahmed Isa', weekIdentifier: 'Week 1', dayOfWeek: 'Monday', status: 'PRESENT', reviewed: true },
      { id: 'rec-2', studentId: 'std-jennifer', rowNumber: 2, studentName: 'Jennifer Solomon', weekIdentifier: 'Week 1', dayOfWeek: 'Monday', status: 'ABSENT', reviewed: true }
    ]
  });
  const directTue = makeSession({
    date: '2026-11-17',
    captureMode: 'register',
    records: [
      { id: 'rec-3', studentId: 'std-ahmed', rowNumber: 1, studentName: 'Ahmed Isa', weekIdentifier: 'Week 1', dayOfWeek: 'Tuesday', status: 'PRESENT', reviewed: true },
      { id: 'rec-4', studentId: 'std-jennifer', rowNumber: 2, studentName: 'Jennifer Solomon', weekIdentifier: 'Week 1', dayOfWeek: 'Tuesday', status: 'PRESENT', reviewed: true }
    ]
  });
  // Summary scan on Wed must NOT alter pupil ratios
  const summaryWed = makeSession({
    date: '2026-11-18',
    captureMode: 'summary',
    presentCount: 2,
    absentCount: 0
  });
  // Non-school day on Thu must be excluded from denominators
  const nonSchoolThu = makeSession({
    date: '2026-11-19',
    captureMode: 'register',
    isNonSchoolDay: true,
    nonSchoolReason: 'Public Holiday',
    presentCount: 0,
    absentCount: 0
  });

  const allSessions = [directMon, directTue, summaryWed, nonSchoolThu];

  const starred = computeStarredStudentSummaries({
    students: SAMPLE_STUDENTS,
    classes: SAMPLE_CLASSES,
    sessions: allSessions,
    starredIds: ['std-ahmed', 'std-jennifer'],
    targetDate: '2026-11-17'
  });

  assert.equal(starred.length, 2);
  const ahmed = starred.find((s) => s.studentId === 'std-ahmed')!;
  const jennifer = starred.find((s) => s.studentId === 'std-jennifer')!;
  assert.equal(ahmed.todayStatus, 'PRESENT');
  assert.equal(ahmed.ratioText, 'Present 2/2 days (100.0%)');
  assert.equal(jennifer.todayStatus, 'PRESENT');
  assert.equal(jennifer.ratioText, 'Present 1/2 days (50.0%)');

  const punctuality = computeClassPunctualityRankings({
    classId: 'cls-3a',
    students: SAMPLE_STUDENTS,
    classes: SAMPLE_CLASSES,
    sessions: allSessions
  });
  assert.equal(punctuality.directRegisterSessionCount, 2);
  assert.equal(punctuality.excludedSummarySessionCount, 1);
  assert.equal(punctuality.excludedNonSchoolSessionCount, 1);
  assert.equal(punctuality.mostPunctual[0].studentId, 'std-ahmed');
  assert.equal(punctuality.mostAbsent[0].studentId, 'std-jennifer');
  assert.equal(punctuality.mostAbsent[0].absentDays, 1);
}

// 7. Headmistress Two-Ring Notification State Machine
{
  const date = '2026-11-17';
  const sessionsComplete = SAMPLE_CLASSES.map((c) =>
    makeSession({ date, classId: c.id, classGrade: c.name })
  );

  const completion = evaluateDailyClassCompletion({
    date,
    classes: SAMPLE_CLASSES,
    sessions: sessionsComplete
  });
  assert.equal(completion.isAllComplete, true);
  assert.equal(completion.completedCount, 3);

  // Ring #1 at 10:30 AM when all classes finish
  const ring1 = evaluateHeadmistressRingAction({
    date,
    now: new Date(2026, 10, 17, 10, 30),
    isAllComplete: true,
    alertState: null
  });
  assert.equal(ring1, 'RING_COMPLETION');

  // At 12:15 PM (before 1:00 PM) with unattended Ring #1 -> stay quiet
  const before1Pm = evaluateHeadmistressRingAction({
    date,
    now: new Date(2026, 10, 17, 12, 15),
    isAllComplete: true,
    alertState: {
      date,
      firstNotifiedAt: '2026-11-17T10:30:00Z',
      attendedAt: null,
      onePmNotifiedAt: null
    }
  });
  assert.equal(before1Pm, 'NONE');

  // At 1:00 PM (13:00) with unattended Ring #1 -> Ring #2 fires!
  const at1PmUnattended = evaluateHeadmistressRingAction({
    date,
    now: new Date(2026, 10, 17, 13, 0),
    isAllComplete: true,
    alertState: {
      date,
      firstNotifiedAt: '2026-11-17T10:30:00Z',
      attendedAt: null,
      onePmNotifiedAt: null
    }
  });
  assert.equal(at1PmUnattended, 'RING_1PM_REMINDER');

  // At 1:05 PM if Headmistress ALREADY attended to Ring #1 -> stay silent!
  const at1PmAttended = evaluateHeadmistressRingAction({
    date,
    now: new Date(2026, 10, 17, 13, 5),
    isAllComplete: true,
    alertState: {
      date,
      firstNotifiedAt: '2026-11-17T10:30:00Z',
      attendedAt: '2026-11-17T10:45:00Z',
      onePmNotifiedAt: null
    }
  });
  assert.equal(at1PmAttended, 'NONE', 'Must NOT ring at 1:00 PM if Ring #1 was already attended');
}

console.log('All new workflow feature tests passed!');
