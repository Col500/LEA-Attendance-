import { AttendanceSession, AttendanceSessionDraft, ClassItem, Student } from '../types/attendance';
import { sampleAttendanceSessions } from '../data/mockData';

export const CLASSES_STORAGE_KEY = 'lea_classes_v1';
export const STUDENTS_STORAGE_KEY = 'lea_students_v1';
export const SESSIONS_STORAGE_KEY = 'lea_attendance_sessions_v1';
export const DRAFTS_STORAGE_KEY = 'lea_attendance_drafts_v1';

export const CLEAN_SLATE_VERSION_KEY = 'lea_clean_slate_v2';

export const initialSampleClasses: ClassItem[] = [];

export const initialSampleStudents: Student[] = [];

function clearLegacyMockBrowserSeedOnce(): void {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(CLEAN_SLATE_VERSION_KEY) === '1') return;
    localStorage.setItem(CLEAN_SLATE_VERSION_KEY, '1');

    const rawClasses = localStorage.getItem(CLASSES_STORAGE_KEY);
    if (rawClasses && rawClasses.includes('"cls-p1a"')) {
      localStorage.removeItem(CLASSES_STORAGE_KEY);
    }
    const rawStudents = localStorage.getItem(STUDENTS_STORAGE_KEY);
    if (rawStudents && rawStudents.includes('"std-101"')) {
      localStorage.removeItem(STUDENTS_STORAGE_KEY);
    }
    const rawSessions = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (rawSessions && rawSessions.includes('"ses-2026-10-09-p4a"')) {
      localStorage.removeItem(SESSIONS_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors
  }
}

export function getStoredClasses(): ClassItem[] {
  clearLegacyMockBrowserSeedOnce();
  try {
    const raw = localStorage.getItem(CLASSES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error reading classes from localStorage', err);
  }

  return initialSampleClasses;
}

export function saveStoredClasses(classes: ClassItem[]): void {
  try {
    localStorage.setItem(CLASSES_STORAGE_KEY, JSON.stringify(classes));
  } catch (err) {
    console.error('Error writing classes to localStorage', err);
  }
}

export function getStoredStudents(): Student[] {
  clearLegacyMockBrowserSeedOnce();
  try {
    const raw = localStorage.getItem(STUDENTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error reading students from localStorage', err);
  }

  return initialSampleStudents;
}

export function saveStoredStudents(students: Student[]): void {
  try {
    localStorage.setItem(STUDENTS_STORAGE_KEY, JSON.stringify(students));
  } catch (err) {
    console.error('Error writing students to localStorage', err);
  }
}

export function resetToSampleRoster(): { classes: ClassItem[]; students: Student[] } {
  saveStoredClasses(initialSampleClasses);
  saveStoredStudents(initialSampleStudents);
  return {
    classes: initialSampleClasses,
    students: initialSampleStudents
  };
}

function sanitizeSessionForStorage(session: AttendanceSession): AttendanceSession {
  if (!('registerImageUri' in session) || session.registerImageUri === undefined) {
    return session;
  }
  const { registerImageUri: _omit, ...cleaned } = session;
  return cleaned;
}

export function getStoredAttendanceSessions(): AttendanceSession[] {
  clearLegacyMockBrowserSeedOnce();
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(sanitizeSessionForStorage);
      }
    }
  } catch (err) {
    console.error('Error reading attendance sessions from localStorage', err);
  }

  return sampleAttendanceSessions;
}

export function saveStoredAttendanceSessions(sessions: AttendanceSession[]): void {
  try {
    const sanitized = sessions.map(sanitizeSessionForStorage);
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (err) {
    console.error('Error writing attendance sessions to localStorage', err);
  }
}

export function addStoredAttendanceSession(newSession: AttendanceSession): AttendanceSession[] {
  const current = getStoredAttendanceSessions();
  // Filter out any existing session with the exact same ID if updating
  const filtered = current.filter((s) => s.id !== newSession.id);
  const updated = [sanitizeSessionForStorage(newSession), ...filtered];
  saveStoredAttendanceSessions(updated);
  return updated;
}

export function updateStoredAttendanceSession(updatedSession: AttendanceSession): AttendanceSession[] {
  const current = getStoredAttendanceSessions();
  const cleanSession = sanitizeSessionForStorage(updatedSession);
  const updated = current.map((s) => (s.id === cleanSession.id ? cleanSession : s));
  saveStoredAttendanceSessions(updated);
  return updated;
}

export function resetToSampleSessions(): AttendanceSession[] {
  saveStoredAttendanceSessions(sampleAttendanceSessions);
  return sampleAttendanceSessions;
}

export function getStoredSessionDrafts(): AttendanceSessionDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Error reading session drafts from localStorage', err);
  }
  return [];
}

export function saveStoredSessionDraft(draft: AttendanceSessionDraft): AttendanceSessionDraft[] {
  const current = getStoredSessionDrafts().filter((d) => d.id !== draft.id);
  const updated = [draft, ...current].slice(0, 20);
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Error writing session draft to localStorage', err);
  }
  return updated;
}

export function deleteStoredSessionDraft(draftId: string): AttendanceSessionDraft[] {
  const updated = getStoredSessionDrafts().filter((d) => d.id !== draftId);
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Error deleting session draft from localStorage', err);
  }
  return updated;
}

export const DEV_DIAGNOSTICS_STORAGE_KEY = 'lea_dev_diagnostics_v1';

export function isDeveloperDiagnosticsEnabled(): boolean {
  try {
    return localStorage.getItem(DEV_DIAGNOSTICS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setDeveloperDiagnosticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DEV_DIAGNOSTICS_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (err) {
    console.error('Error saving developer diagnostics preference', err);
  }
}
