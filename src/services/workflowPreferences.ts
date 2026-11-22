import {
  AppThemeId,
  ClassItem,
  ClassWorkflowHistoryEntry,
  DefaultScanModePreference
} from '../types/attendance';

export const APP_THEME_STORAGE_KEY = 'lea_app_theme_v1';
export const DEFAULT_SCAN_MODE_STORAGE_KEY = 'lea_default_scan_mode_v1';
export const STARRED_STUDENTS_STORAGE_KEY = 'lea_starred_students_v1';
export const WORKFLOW_HISTORY_STORAGE_KEY = 'lea_class_workflow_history_v1';

export interface ThemeOptionDefinition {
  id: AppThemeId;
  name: string;
  category: 'Classic' | 'Light' | 'Dark';
  description: string;
  previewCanvas: string;
  previewSidebar: string;
  previewCard: string;
  previewAccent: string;
}

export const APP_THEME_OPTIONS: ThemeOptionDefinition[] = [
  {
    id: 'classic',
    name: 'Classic LEA',
    category: 'Classic',
    description: 'Original dark slate sidebar with crisp light workspace and emerald highlights.',
    previewCanvas: '#f1f5f9',
    previewSidebar: '#0f172a',
    previewCard: '#ffffff',
    previewAccent: '#059669'
  },
  {
    id: 'paper',
    name: 'Civic Paper',
    category: 'Light',
    description: 'Warm archival ivory light theme with crisp stone borders and deep forest ink.',
    previewCanvas: '#faf8f4',
    previewSidebar: '#f3efe6',
    previewCard: '#ffffff',
    previewAccent: '#047857'
  },
  {
    id: 'sky',
    name: 'Daylight Sky',
    category: 'Light',
    description: 'Bright cool alabaster-blue light theme built for outdoor mobile visibility.',
    previewCanvas: '#f3f7fc',
    previewSidebar: '#eaf2fb',
    previewCard: '#ffffff',
    previewAccent: '#0284c7'
  },
  {
    id: 'sage',
    name: 'Warm Sage',
    category: 'Light',
    description: 'Soft botanical sage light theme with calm pine typography and teal accents.',
    previewCanvas: '#f2f7f4',
    previewSidebar: '#e7f1eb',
    previewCard: '#ffffff',
    previewAccent: '#0f766e'
  },
  {
    id: 'midnight',
    name: 'Midnight Slate',
    category: 'Dark',
    description: 'Full dark mode matching the deep slate and emerald palette across every screen.',
    previewCanvas: '#090f1d',
    previewSidebar: '#0f172a',
    previewCard: '#111c33',
    previewAccent: '#10b981'
  }
];

export function isValidAppTheme(value: unknown): value is AppThemeId {
  return (
    value === 'classic' ||
    value === 'paper' ||
    value === 'sky' ||
    value === 'sage' ||
    value === 'midnight'
  );
}

export function getStoredTheme(): AppThemeId {
  if (typeof window === 'undefined') return 'classic';
  try {
    const raw = localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isValidAppTheme(raw) ? raw : 'classic';
  } catch {
    return 'classic';
  }
}

export function saveStoredTheme(theme: AppThemeId): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors
  }
}

export function applyThemeToDocument(theme: AppThemeId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  if (theme === 'midnight') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function getDefaultScanModePreference(): DefaultScanModePreference {
  if (typeof window === 'undefined') return 'ask';
  try {
    const raw = localStorage.getItem(DEFAULT_SCAN_MODE_STORAGE_KEY);
    if (raw === 'register' || raw === 'summary' || raw === 'ask') return raw;
    return 'ask';
  } catch {
    return 'ask';
  }
}

export function saveDefaultScanModePreference(pref: DefaultScanModePreference): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DEFAULT_SCAN_MODE_STORAGE_KEY, pref);
  } catch {
    // Ignore
  }
}

export function getStoredStarredStudentIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STARRED_STUDENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveStoredStarredStudentIds(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    const unique = Array.from(new Set(ids));
    localStorage.setItem(STARRED_STUDENTS_STORAGE_KEY, JSON.stringify(unique));
  } catch {
    // Ignore
  }
}

// --- Adaptive Next-Class Workflow Route Learning ---

export const MIN_LEARNED_WORKFLOW_DAYS = 5;

export function getStoredWorkflowHistory(): ClassWorkflowHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(WORKFLOW_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ClassWorkflowHistoryEntry =>
        Boolean(entry && typeof entry.date === 'string' && Array.isArray(entry.classIds))
    );
  } catch {
    return [];
  }
}

export function saveStoredWorkflowHistory(history: ClassWorkflowHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Retain rolling last 30 school days
    const trimmed = [...history]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);
    localStorage.setItem(WORKFLOW_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore
  }
}

export function appendClassToWorkflowHistory(
  history: ClassWorkflowHistoryEntry[],
  date: string,
  classId: string
): ClassWorkflowHistoryEntry[] {
  if (!date || !classId) return history;
  const existingIdx = history.findIndex((h) => h.date === date);
  if (existingIdx === -1) {
    return [...history, { date, classIds: [classId] }].slice(-30);
  }

  const entry = history[existingIdx];
  if (entry.classIds.includes(classId)) {
    return history;
  }

  const next = [...history];
  next[existingIdx] = {
    ...entry,
    classIds: [...entry.classIds, classId]
  };
  return next;
}

export interface NextClassSuggestion {
  nextClass: ClassItem | null;
  source: 'learned' | 'sequential' | 'complete';
  learnedDaysCount: number;
}

/**
 * Suggests the next unscanned class after confirming `currentClassId`.
 * - Once the admin has scanned on >= 5 school days (~1 week), uses observed class-to-class
 *   transition frequency to follow the admin's natural classroom route.
 * - Otherwise advances sequentially through the school's class list.
 */
export function suggestNextClassToScan(params: {
  currentClassId: string;
  classes: ClassItem[];
  scannedTodayClassIds: Set<string>;
  history: ClassWorkflowHistoryEntry[];
}): NextClassSuggestion {
  const { currentClassId, classes, scannedTodayClassIds, history } = params;
  const learnedDaysCount = history.filter((h) => h.classIds.length >= 2).length;

  const remaining = classes.filter(
    (c) => c.id !== currentClassId && !scannedTodayClassIds.has(c.id)
  );
  if (remaining.length === 0) {
    return { nextClass: null, source: 'complete', learnedDaysCount };
  }

  const remainingById = new Map(remaining.map((c) => [c.id, c]));

  // Activate learned transition graph after ~1 school week (>= 5 multi-class scan days)
  if (learnedDaysCount >= MIN_LEARNED_WORKFLOW_DAYS) {
    const transitionCounts = new Map<string, number>();
    for (const entry of history) {
      for (let i = 0; i < entry.classIds.length - 1; i++) {
        if (entry.classIds[i] === currentClassId) {
          const targetId = entry.classIds[i + 1];
          if (remainingById.has(targetId)) {
            transitionCounts.set(targetId, (transitionCounts.get(targetId) || 0) + 1);
          }
        }
      }
    }

    let bestId: string | null = null;
    let bestScore = 0;
    for (const [candidateId, score] of transitionCounts.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestId = candidateId;
      }
    }

    if (bestId && remainingById.has(bestId)) {
      return {
        nextClass: remainingById.get(bestId)!,
        source: 'learned',
        learnedDaysCount
      };
    }
  }

  // Sequential fallback: pick the next unscanned class after currentClassId, wrapping around
  const currentIdx = classes.findIndex((c) => c.id === currentClassId);
  if (currentIdx !== -1) {
    for (let offset = 1; offset < classes.length; offset++) {
      const candidate = classes[(currentIdx + offset) % classes.length];
      if (remainingById.has(candidate.id)) {
        return {
          nextClass: candidate,
          source: 'sequential',
          learnedDaysCount
        };
      }
    }
  }

  return {
    nextClass: remaining[0],
    source: 'sequential',
    learnedDaysCount
  };
}
