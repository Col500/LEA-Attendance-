import {
  AttendanceSession,
  ClassItem,
  HeadmistressAlertState,
  NonSchoolGapRecord
} from '../types/attendance';
import { resolveClassMatch } from './attendanceReports';
import { buildNonSchoolDateMap } from './schoolCalendarGaps';

export const HEADMISTRESS_ALERT_STATE_KEY = 'lea_headmistress_alert_state_v1';
export const HEADMISTRESS_ALERT_PREFS_KEY = 'lea_headmistress_alert_prefs_v1';

export interface HeadmistressAlertPreferences {
  enabled: boolean;
  soundEnabled: boolean;
  browserNotificationsEnabled: boolean;
}

export const DEFAULT_HEADMISTRESS_PREFS: HeadmistressAlertPreferences = {
  enabled: true,
  soundEnabled: true,
  browserNotificationsEnabled: true
};

export interface DailyCompletionStatus {
  date: string;
  completedClassIds: string[];
  pendingClassIds: string[];
  completedCount: number;
  totalClasses: number;
  isAllComplete: boolean;
  isNonSchoolDay: boolean;
}

export type HeadmistressRingAction = 'NONE' | 'RING_COMPLETION' | 'RING_1PM_REMINDER';

export function evaluateDailyClassCompletion(params: {
  date: string;
  classes: ClassItem[];
  sessions: AttendanceSession[];
  nonSchoolGaps?: NonSchoolGapRecord[];
}): DailyCompletionStatus {
  const { date, classes, sessions, nonSchoolGaps = [] } = params;
  const nonSchoolMap = buildNonSchoolDateMap(sessions, nonSchoolGaps);
  const isNonSchoolDay = nonSchoolMap.has(date);

  const todaysConfirmed = sessions.filter(
    (s) => s.date === date && s.reviewStatus === 'Confirmed'
  );

  const completedClassIds: string[] = [];
  const pendingClassIds: string[] = [];

  for (const cls of classes) {
    const hasConfirmed =
      isNonSchoolDay ||
      todaysConfirmed.some((s) => resolveClassMatch(s, cls.id, classes));
    if (hasConfirmed) {
      completedClassIds.push(cls.id);
    } else {
      pendingClassIds.push(cls.id);
    }
  }

  return {
    date,
    completedClassIds,
    pendingClassIds,
    completedCount: completedClassIds.length,
    totalClasses: classes.length,
    isAllComplete: classes.length > 0 && pendingClassIds.length === 0 && !isNonSchoolDay,
    isNonSchoolDay
  };
}

/**
 * Pure two-ring state machine for the Headmistress notification:
 * - Ring #1 ('RING_COMPLETION'): fires as soon as all active classes are confirmed today.
 * - Ring #2 ('RING_1PM_REMINDER'): fires at or after 1:00 PM (13:00 local time) ONLY IF
 *   all classes are complete, Ring #1 already fired (or was ready), and the Headmistress
 *   has NOT yet attended to (acknowledged/opened) the first notification.
 */
export function evaluateHeadmistressRingAction(params: {
  date: string;
  now: Date;
  isAllComplete: boolean;
  alertState: HeadmistressAlertState | null;
}): HeadmistressRingAction {
  const { date, now, isAllComplete, alertState } = params;
  if (!isAllComplete) return 'NONE';

  const sameDayState = alertState && alertState.date === date ? alertState : null;

  // Ring #1: Immediate alert when all classes finish scanning
  if (!sameDayState || !sameDayState.firstNotifiedAt) {
    return 'RING_COMPLETION';
  }

  // If the Headmistress already attended to Ring #1, stay silent!
  if (sameDayState.attendedAt) {
    return 'NONE';
  }

  // Ring #2: 1:00 PM follow-up reminder if still unattended
  const isAtOrAfter1Pm = now.getHours() >= 13;
  if (isAtOrAfter1Pm && !sameDayState.onePmNotifiedAt) {
    return 'RING_1PM_REMINDER';
  }

  return 'NONE';
}

export function getStoredHeadmistressPrefs(): HeadmistressAlertPreferences {
  if (typeof window === 'undefined') return DEFAULT_HEADMISTRESS_PREFS;
  try {
    const raw = localStorage.getItem(HEADMISTRESS_ALERT_PREFS_KEY);
    if (!raw) return DEFAULT_HEADMISTRESS_PREFS;
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.enabled !== false,
      soundEnabled: parsed?.soundEnabled !== false,
      browserNotificationsEnabled: parsed?.browserNotificationsEnabled !== false
    };
  } catch {
    return DEFAULT_HEADMISTRESS_PREFS;
  }
}

export function saveStoredHeadmistressPrefs(prefs: HeadmistressAlertPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HEADMISTRESS_ALERT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore
  }
}

export function getStoredHeadmistressAlertState(): HeadmistressAlertState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(HEADMISTRESS_ALERT_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.date === 'string') {
      return {
        date: parsed.date,
        firstNotifiedAt: parsed.firstNotifiedAt || null,
        attendedAt: parsed.attendedAt || null,
        onePmNotifiedAt: parsed.onePmNotifiedAt || null
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveStoredHeadmistressAlertState(state: HeadmistressAlertState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HEADMISTRESS_ALERT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore
  }
}

/**
 * Plays a distinctive, pleasant multi-tone school chime synthesized via Web Audio API.
 * Requires no external MP3 assets and works offline on mobile browsers.
 */
export function playHeadmistressChime(variant: 'completion' | 'reminder' = 'completion'): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    // Distinctive ascending warm chime (C5 -> E5 -> G5 -> C6) for completion; gentle double-bell for 1 PM reminder
    const notes =
      variant === 'completion'
        ? [
            { freq: 523.25, start: 0.0, dur: 0.32, gain: 0.22 },
            { freq: 659.25, start: 0.16, dur: 0.34, gain: 0.22 },
            { freq: 783.99, start: 0.32, dur: 0.38, gain: 0.24 },
            { freq: 1046.5, start: 0.5, dur: 0.65, gain: 0.26 }
          ]
        : [
            { freq: 659.25, start: 0.0, dur: 0.3, gain: 0.22 },
            { freq: 783.99, start: 0.18, dur: 0.36, gain: 0.24 },
            { freq: 659.25, start: 0.55, dur: 0.3, gain: 0.22 },
            { freq: 1046.5, start: 0.75, dur: 0.65, gain: 0.26 }
          ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const harmonic = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      harmonic.type = 'triangle';
      harmonic.frequency.setValueAtTime(note.freq * 2, now + note.start);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(0.18, now + note.start);

      gainNode.gain.setValueAtTime(0.0001, now + note.start);
      gainNode.gain.exponentialRampToValueAtTime(note.gain, now + note.start + 0.025);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);

      osc.connect(gainNode);
      harmonic.connect(harmonicGain);
      harmonicGain.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now + note.start);
      harmonic.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.04);
      harmonic.stop(now + note.start + note.dur + 0.04);
    }

    // Close AudioContext after chime finishes to avoid leaking audio hardware handles
    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 1800);

    return true;
  } catch {
    return false;
  }
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function triggerHeadmistressBrowserNotification(title: string, body: string): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    new Notification(title, {
      body,
      tag: 'lea-headmistress-daily-complete'
    });
    return true;
  } catch {
    return false;
  }
}
