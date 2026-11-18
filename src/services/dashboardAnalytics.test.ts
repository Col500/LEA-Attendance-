import assert from 'node:assert/strict';
import {
  computeDashboardAnalytics,
  createDefaultAnalyticsFilter
} from './dashboardAnalytics';
import {
  evaluateTutorialProgress,
  isSchoolProfilePersonalized
} from './tutorialGuide';
import { AttendanceSession, ClassItem, SchoolInfo, Student } from '../types/attendance';

const sampleSchool: SchoolInfo = {
  id: 'school-1',
  name: 'My Primary School',
  shortName: 'Attendance Portal',
  subLocation: '',
  zone: 'Zone 6',
  city: '',
  state: '',
  lga: '',
  academicSession: '2026/2027',
  currentTerm: 'First Term',
  headTeacher: 'Head Teacher',
  administratorName: 'School Administrator'
};

const sampleClasses: ClassItem[] = [
  { id: 'c1', name: 'Primary 1A', createdAt: '2026-09-01T00:00:00Z' },
  { id: 'c2', name: 'Primary 2A', createdAt: '2026-09-01T00:00:00Z' },
  { id: 'c3', name: 'Primary 3A', createdAt: '2026-09-01T00:00:00Z' }
];

const sampleStudents: Student[] = [
  { id: 's1', studentNumber: 1, fullName: 'Amina Bello', classId: 'c1', active: true, createdAt: '', updatedAt: '' },
  { id: 's2', studentNumber: 2, fullName: 'Chidi Okafor', classId: 'c1', active: true, createdAt: '', updatedAt: '' },
  { id: 's3', studentNumber: 1, fullName: 'Tunde Ade', classId: 'c2', active: true, createdAt: '', updatedAt: '' },
  { id: 's4', studentNumber: 1, fullName: 'Zainab Musa', classId: 'c3', active: false, createdAt: '', updatedAt: '' }
];

const sampleSessions: AttendanceSession[] = [
  {
    id: 'ses-1',
    date: '2026-09-14',
    classId: 'c1',
    classGrade: 'Primary 1A',
    term: 'First Term',
    sessionYear: '2026/2027',
    totalEnrolled: 20,
    presentCount: 18,
    absentCount: 2,
    blankCount: 1,
    uncertainCount: 0,
    reviewStatus: 'Confirmed',
    recordedBy: 'Admin'
  },
  {
    id: 'ses-2',
    date: '2026-09-14',
    classId: 'c2',
    classGrade: 'Primary 2A',
    term: 'First Term',
    sessionYear: '2026/2027',
    totalEnrolled: 20,
    presentCount: 15,
    absentCount: 5,
    blankCount: 0,
    uncertainCount: 1,
    reviewStatus: 'Confirmed',
    recordedBy: 'Admin'
  },
  {
    id: 'ses-3',
    date: '2026-10-05',
    classId: 'c1',
    classGrade: 'Primary 1A',
    term: 'First Term',
    sessionYear: '2026/2027',
    totalEnrolled: 20,
    presentCount: 19,
    absentCount: 1,
    blankCount: 0,
    uncertainCount: 0,
    reviewStatus: 'Confirmed',
    recordedBy: 'Admin'
  },
  {
    id: 'ses-4',
    date: '2027-01-12',
    classId: 'c3',
    classGrade: 'Primary 3A',
    term: 'Second Term',
    sessionYear: '2026/2027',
    totalEnrolled: 20,
    presentCount: 16,
    absentCount: 4,
    reviewStatus: 'Confirmed',
    recordedBy: 'Admin'
  },
  {
    id: 'ses-failed',
    date: '2026-09-14',
    classId: 'c1',
    classGrade: 'Primary 1A',
    term: 'First Term',
    sessionYear: '2026/2027',
    totalEnrolled: 20,
    presentCount: 0,
    absentCount: 20,
    reviewStatus: 'Failed',
    recordedBy: 'Admin'
  }
];

function runDashboardAnalyticsTests() {
  const baseFilter = createDefaultAnalyticsFilter(sampleSchool);

  // 1. Excludes Failed sessions and aggregates all classes
  const allResult = computeDashboardAnalytics({
    sessions: sampleSessions,
    classes: sampleClasses,
    students: sampleStudents,
    filter: baseFilter,
    school: sampleSchool
  });
  assert.equal(allResult.summary.totalSessions, 4);
  assert.equal(allResult.summary.presentCount, 18 + 15 + 19 + 16);
  assert.equal(allResult.summary.absentCount, 2 + 5 + 1 + 4);
  assert.equal(allResult.summary.activeStudents, 3);
  assert.equal(allResult.summary.enrolledStudents, 4);
  assert.equal(allResult.timeSeries.length, 3);
  assert.deepEqual(
    allResult.timeSeries.map((t) => t.date),
    ['2026-09-14', '2026-10-05', '2027-01-12']
  );

  // 2. Multi-class comparison filter
  const twoClassResult = computeDashboardAnalytics({
    sessions: sampleSessions,
    classes: sampleClasses,
    students: sampleStudents,
    filter: { ...baseFilter, selectedClassIds: ['c1', 'c2'] },
    school: sampleSchool
  });
  assert.equal(twoClassResult.scopedClasses.length, 2);
  assert.equal(twoClassResult.summary.totalSessions, 3);
  assert.equal(twoClassResult.classComparison.length, 2);

  // 3. Exact date filter
  const exactDateResult = computeDashboardAnalytics({
    sessions: sampleSessions,
    classes: sampleClasses,
    students: sampleStudents,
    filter: { ...baseFilter, timeframeMode: 'date', exactDate: '2026-09-14' },
    school: sampleSchool
  });
  assert.equal(exactDateResult.summary.totalSessions, 2);
  assert.equal(exactDateResult.summary.presentCount, 33);

  // 4. Date range filter
  const rangeResult = computeDashboardAnalytics({
    sessions: sampleSessions,
    classes: sampleClasses,
    students: sampleStudents,
    filter: {
      ...baseFilter,
      timeframeMode: 'range',
      startDate: '2026-09-01',
      endDate: '2026-10-31'
    },
    school: sampleSchool
  });
  assert.equal(rangeResult.summary.totalSessions, 3);

  // 5. Month filter
  const monthResult = computeDashboardAnalytics({
    sessions: sampleSessions,
    classes: sampleClasses,
    students: sampleStudents,
    filter: { ...baseFilter, timeframeMode: 'month', month: '2026-10' },
    school: sampleSchool
  });
  assert.equal(monthResult.summary.totalSessions, 1);
  assert.equal(monthResult.summary.presentCount, 19);

  // 6. Term & Year filters
  const termResult = computeDashboardAnalytics({
    sessions: sampleSessions,
    classes: sampleClasses,
    students: sampleStudents,
    filter: { ...baseFilter, timeframeMode: 'term', term: 'Second Term' },
    school: sampleSchool
  });
  assert.equal(termResult.summary.totalSessions, 1);
  assert.equal(termResult.summary.presentCount, 16);

  const yearResult = computeDashboardAnalytics({
    sessions: sampleSessions,
    classes: sampleClasses,
    students: sampleStudents,
    filter: { ...baseFilter, timeframeMode: 'year', year: '2027' },
    school: sampleSchool
  });
  assert.equal(yearResult.summary.totalSessions, 1);
  assert.equal(yearResult.availableOptions.years.includes('2027'), true);

  // 7. Sequential tutorial completion tests
  assert.equal(isSchoolProfilePersonalized(sampleSchool), false);
  const customSchool: SchoolInfo = {
    ...sampleSchool,
    name: 'Model Primary School Abuja',
    administratorName: 'Collins Onigbinde'
  };
  assert.equal(isSchoolProfilePersonalized(customSchool), true);

  const stepEval0 = evaluateTutorialProgress({
    school: sampleSchool,
    classes: [],
    students: [],
    sessions: [],
    exploredAnalytics: false,
    activeStepIndex: 0
  });
  assert.equal(stepEval0.completedCount, 0);
  assert.equal(stepEval0.recommendedStepIndex, 0);

  const stepEvalDone = evaluateTutorialProgress({
    school: customSchool,
    classes: sampleClasses,
    students: sampleStudents,
    sessions: sampleSessions,
    exploredAnalytics: true,
    activeStepIndex: 3
  });
  assert.equal(stepEvalDone.completedCount, 4);
  assert.equal(stepEvalDone.allCompleted, true);

  console.log('All 8 dashboard analytics & tutorial guide unit assertions passed.');
}

runDashboardAnalyticsTests();
