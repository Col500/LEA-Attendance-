import { AttendanceSession, ClassItem, SchoolInfo, Student } from '../types/attendance';
import { NavTab } from '../components/Sidebar';

export type TutorialStepId = 'profile' | 'enroll' | 'scan' | 'analytics';

export interface TutorialStepDefinition {
  id: TutorialStepId;
  stepNumber: number;
  title: string;
  shortTitle: string;
  description: string;
  actionLabel: string;
  targetTab: NavTab;
  targetHighlightId: string;
}

export interface TutorialGuideState {
  dismissed: boolean;
  collapsed: boolean;
  activeStepIndex: number;
  exploredAnalytics: boolean;
  completedBannerDismissed: boolean;
}

export interface TutorialStepStatus {
  definition: TutorialStepDefinition;
  completed: boolean;
  isCurrent: boolean;
}

export interface TutorialEvaluation {
  steps: TutorialStepStatus[];
  completedCount: number;
  totalSteps: number;
  allCompleted: boolean;
  recommendedStepIndex: number;
}

export const TUTORIAL_STORAGE_KEY = 'lea_tutorial_guide_state_v1';

export const TUTORIAL_STEPS: TutorialStepDefinition[] = [
  {
    id: 'profile',
    stepNumber: 1,
    title: 'Set Your School & Records Administrator Name',
    shortTitle: 'Your Profile',
    description:
      'Enter your official school name, zone, academic term, and your name as the Records Administrator so every scanned report is properly attributed.',
    actionLabel: 'Open & Set My Name',
    targetTab: 'settings',
    targetHighlightId: 'settings-profile'
  },
  {
    id: 'enroll',
    stepNumber: 2,
    title: 'Enroll Students by Scanning Each Class Register',
    shortTitle: 'Enroll Classes',
    description:
      'Snap or upload one clear photo of the student names page per class. Cloud Vision extracts the entire class roster at once—no manual typing one-by-one.',
    actionLabel: 'Launch Register Roster Scan',
    targetTab: 'students',
    targetHighlightId: 'students-roster-scan'
  },
  {
    id: 'scan',
    stepNumber: 3,
    title: 'Scan Your First Daily Attendance Register',
    shortTitle: 'First Scan',
    description:
      'Select a class and capture or upload the marked register sheet. Extraction starts automatically and verifies ticks and absents on your device.',
    actionLabel: 'Scan First Attendance',
    targetTab: 'scan',
    targetHighlightId: 'scan-register-capture'
  },
  {
    id: 'analytics',
    stepNumber: 4,
    title: 'Explore Visual Attendance Charts & Filters',
    shortTitle: 'View Analytics',
    description:
      'Switch Administrative Summary from Numbers to Bar Charts, Pie Charts, or Trend Graphs and compare classes across dates, months, terms, or years.',
    actionLabel: 'Open Interactive Charts',
    targetTab: 'dashboard',
    targetHighlightId: 'dashboard-analytics'
  }
];

export const DEFAULT_TUTORIAL_STATE: TutorialGuideState = {
  dismissed: false,
  collapsed: false,
  activeStepIndex: 0,
  exploredAnalytics: false,
  completedBannerDismissed: false
};

export function loadTutorialGuideState(): TutorialGuideState {
  try {
    const raw = localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!raw) return DEFAULT_TUTORIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<TutorialGuideState>;
    const idx =
      typeof parsed.activeStepIndex === 'number' &&
      parsed.activeStepIndex >= 0 &&
      parsed.activeStepIndex < TUTORIAL_STEPS.length
        ? parsed.activeStepIndex
        : 0;
    return {
      dismissed: Boolean(parsed.dismissed),
      collapsed: Boolean(parsed.collapsed),
      activeStepIndex: idx,
      exploredAnalytics: Boolean(parsed.exploredAnalytics),
      completedBannerDismissed: Boolean(parsed.completedBannerDismissed)
    };
  } catch {
    return DEFAULT_TUTORIAL_STATE;
  }
}

export function saveTutorialGuideState(state: TutorialGuideState): void {
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota issues
  }
}

export function isSchoolProfilePersonalized(school: SchoolInfo): boolean {
  const name = school.name.trim();
  const admin = school.administratorName.trim();

  const hasCustomSchool =
    Boolean(name) && name.toLowerCase() !== 'my primary school';
  const hasCustomAdmin =
    Boolean(admin) && admin.toLowerCase() !== 'school administrator';

  return hasCustomSchool && hasCustomAdmin;
}

export function evaluateTutorialProgress(params: {
  school: SchoolInfo;
  classes: ClassItem[];
  students: Student[];
  sessions: AttendanceSession[];
  exploredAnalytics: boolean;
  activeStepIndex: number;
}): TutorialEvaluation {
  const {
    school,
    classes,
    students,
    sessions,
    exploredAnalytics,
    activeStepIndex
  } = params;

  const profileDone = isSchoolProfilePersonalized(school);
  const enrollDone = classes.length > 0 && students.length > 0;
  const scanDone = sessions.some((s) => s.reviewStatus !== 'Failed');
  const analyticsDone = exploredAnalytics && scanDone;

  const completionByStep: Record<TutorialStepId, boolean> = {
    profile: profileDone,
    enroll: enrollDone,
    scan: scanDone,
    analytics: analyticsDone
  };

  const firstIncompleteIdx = TUTORIAL_STEPS.findIndex(
    (step) => !completionByStep[step.id]
  );

  const recommendedStepIndex =
    firstIncompleteIdx === -1 ? TUTORIAL_STEPS.length - 1 : firstIncompleteIdx;

  const clampedCurrent = Math.max(
    0,
    Math.min(TUTORIAL_STEPS.length - 1, activeStepIndex)
  );

  const steps: TutorialStepStatus[] = TUTORIAL_STEPS.map((definition, index) => ({
    definition,
    completed: completionByStep[definition.id],
    isCurrent: index === clampedCurrent
  }));

  const completedCount = steps.filter((s) => s.completed).length;

  return {
    steps,
    completedCount,
    totalSteps: TUTORIAL_STEPS.length,
    allCompleted: completedCount === TUTORIAL_STEPS.length,
    recommendedStepIndex
  };
}
