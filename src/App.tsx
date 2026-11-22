/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { Header } from './components/Header';
import { Sidebar, NavTab } from './components/Sidebar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { SampleDataBanner } from './components/SampleDataBanner';
import { StaffSignInModal } from './components/StaffSignInModal';
import { OnboardingGuide } from './components/OnboardingGuide';
import { HeadmistressAlertBanner } from './components/HeadmistressAlertBanner';
import { canAccessNavTab, canWriteSchoolRecords } from './lib/authRoles';
import {
  DEFAULT_TUTORIAL_STATE,
  evaluateTutorialProgress,
  loadTutorialGuideState,
  saveTutorialGuideState,
  TUTORIAL_STEPS,
  TutorialGuideState,
  TutorialStepDefinition
} from './services/tutorialGuide';

import { DashboardPage } from './pages/DashboardPage';
import { ScanRegisterPage } from './pages/ScanRegisterPage';
import { StudentsPage } from './pages/StudentsPage';
import { AttendanceRecordsPage } from './pages/AttendanceRecordsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  AppThemeId,
  AttendanceSession,
  AttendanceSessionDraft,
  ClassWorkflowHistoryEntry,
  DefaultScanModePreference,
  HeadmistressAlertState,
  NonSchoolGapRecord,
  SchoolInfo,
  ClassItem,
  StaffProfile,
  Student
} from './types/attendance';
import { initialSchoolInfo } from './data/mockData';
import {
  getStoredClasses,
  saveStoredClasses,
  getStoredStudents,
  saveStoredStudents,
  getStoredAttendanceSessions,
  addStoredAttendanceSession,
  saveStoredAttendanceSessions,
  deleteStoredAttendanceSession,
  clearAllStoredAttendanceRecords,
  clearAllStoredPupilRecords
} from './services/rosterStorage';
import {
  createNonSchoolGapRecord,
  formatReadableDate,
  getDefaultSchoolDate,
  getStoredNonSchoolGaps,
  saveStoredNonSchoolGaps
} from './services/schoolCalendarGaps';
import {
  appendClassToWorkflowHistory,
  applyThemeToDocument,
  getDefaultScanModePreference,
  getStoredStarredStudentIds,
  getStoredTheme,
  getStoredWorkflowHistory,
  saveDefaultScanModePreference,
  saveStoredStarredStudentIds,
  saveStoredTheme,
  saveStoredWorkflowHistory
} from './services/workflowPreferences';
import {
  evaluateDailyClassCompletion,
  evaluateHeadmistressRingAction,
  getStoredHeadmistressAlertState,
  getStoredHeadmistressPrefs,
  HeadmistressAlertPreferences,
  playHeadmistressChime,
  saveStoredHeadmistressAlertState,
  saveStoredHeadmistressPrefs,
  triggerHeadmistressBrowserNotification
} from './services/headmistressAlertService';
import { getSupabaseClient, isSupabaseConfigured } from './lib/supabaseClient';
import {
  confirmAttendanceSessionInSupabase,
  confirmExistingSessionInSupabase,
  confirmSummaryOrNonSchoolSessionInSupabase,
  createClassInSupabase,
  createStudentInSupabase,
  createStudentsBulkInSupabase,
  deleteAllAttendanceSessionsInSupabase,
  deleteAllStudentsInSupabase,
  deleteAttendanceSessionInSupabase,
  deleteClassInSupabase,
  fetchClassesFromSupabase,
  fetchConfirmedSessionsFromSupabase,
  fetchStudentsFromSupabase,
  getCurrentStaffProfile,
  SeedMigrationResult,
  seedLocalDemoRosterToSupabase,
  toggleStudentActiveInSupabase,
  updateClassInSupabase,
  updateStudentInSupabase
} from './services/supabaseAttendanceService';

export default function App() {
  const supabaseConfigured = isSupabaseConfigured();

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedSessionForDetail, setSelectedSessionForDetail] = useState<AttendanceSession | null>(null);

  // Classes, Students & Sessions State:
  // When Supabase is configured, NEVER preload local demo records prior to authentication.
  const [classes, setClasses] = useState<ClassItem[]>(() =>
    supabaseConfigured ? [] : getStoredClasses()
  );
  const [students, setStudents] = useState<Student[]>(() =>
    supabaseConfigured ? [] : getStoredStudents()
  );
  const [sessions, setSessions] = useState<AttendanceSession[]>(() =>
    supabaseConfigured ? [] : getStoredAttendanceSessions()
  );

  // Supabase Remote Persistence & Staff Profile State
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(() => supabaseConfigured);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isSyncingRemote, setIsSyncingRemote] = useState(false);
  const wasAuthenticatedRef = React.useRef(false);

  const persistenceMode: 'local-demo' | 'supabase-live' | 'supabase-needs-auth' = !supabaseConfigured
    ? 'local-demo'
    : staffProfile
    ? 'supabase-live'
    : 'supabase-needs-auth';

  const canWrite = !supabaseConfigured || canWriteSchoolRecords(staffProfile?.role);

  // Theme, Scanning Preferences, Starred Pupils, Non-School Gaps & Adaptive Workflow State
  const [appTheme, setAppTheme] = useState<AppThemeId>(() => getStoredTheme());
  const [defaultScanMode, setDefaultScanMode] = useState<DefaultScanModePreference>(() =>
    getDefaultScanModePreference()
  );
  const [starredStudentIds, setStarredStudentIds] = useState<string[]>(() =>
    getStoredStarredStudentIds()
  );
  const [nonSchoolGaps, setNonSchoolGaps] = useState<NonSchoolGapRecord[]>(() =>
    getStoredNonSchoolGaps()
  );
  const [workflowHistory, setWorkflowHistory] = useState<ClassWorkflowHistoryEntry[]>(() =>
    getStoredWorkflowHistory()
  );
  const [headmistressPrefs, setHeadmistressPrefs] = useState<HeadmistressAlertPreferences>(() =>
    getStoredHeadmistressPrefs()
  );
  const [headmistressAlertState, setHeadmistressAlertState] =
    useState<HeadmistressAlertState | null>(() => getStoredHeadmistressAlertState());

  useEffect(() => {
    applyThemeToDocument(appTheme);
    saveStoredTheme(appTheme);
  }, [appTheme]);

  const handleChangeTheme = useCallback((nextTheme: AppThemeId) => {
    setAppTheme(nextTheme);
  }, []);

  const handleChangeDefaultScanMode = useCallback((pref: DefaultScanModePreference) => {
    setDefaultScanMode(pref);
    saveDefaultScanModePreference(pref);
  }, []);

  const handleToggleStarStudent = useCallback((studentId: string) => {
    setStarredStudentIds((prev) => {
      const next = prev.includes(studentId)
        ? prev.filter((id) => id !== studentId)
        : [...prev, studentId];
      saveStoredStarredStudentIds(next);
      return next;
    });
  }, []);

  const handleAddNonSchoolGap = useCallback(
    (params: { startDate: string; endDate: string; label: string; source: NonSchoolGapRecord['source'] }) => {
      const record = createNonSchoolGapRecord(params);
      setNonSchoolGaps((prev) => {
        const next = [record, ...prev];
        saveStoredNonSchoolGaps(next);
        return next;
      });
      return record;
    },
    []
  );

  const handleDeleteNonSchoolGap = useCallback((gapId: string) => {
    setNonSchoolGaps((prev) => {
      const next = prev.filter((g) => g.id !== gapId);
      saveStoredNonSchoolGaps(next);
      return next;
    });
  }, []);

  const handleRecordWorkflowClassScan = useCallback((date: string, classId: string) => {
    if (!date || !classId) return;
    setWorkflowHistory((prev) => {
      const next = appendClassToWorkflowHistory(prev, date, classId);
      saveStoredWorkflowHistory(next);
      return next;
    });
  }, []);

  const handleResetWorkflowHistory = useCallback(() => {
    setWorkflowHistory([]);
    saveStoredWorkflowHistory([]);
  }, []);

  const handleUpdateHeadmistressPrefs = useCallback((next: HeadmistressAlertPreferences) => {
    setHeadmistressPrefs(next);
    saveStoredHeadmistressPrefs(next);
  }, []);

  const syncFromSupabase = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) {
      setIsCheckingAuth(false);
      return;
    }

    setIsSyncingRemote(true);
    setRemoteError(null);
    try {
      const profile = await getCurrentStaffProfile(client);

      if (!profile) {
        setStaffProfile(null);
        setClasses([]);
        setStudents([]);
        setSessions([]);
        setSelectedSessionForDetail(null);
        if (wasAuthenticatedRef.current) {
          setSessionNotice((prev) => prev || 'Your session expired or ended. Please sign in again.');
        }
        wasAuthenticatedRef.current = false;
        return;
      }

      wasAuthenticatedRef.current = true;
      setSessionNotice(null);
      setStaffProfile(profile);
      setActiveTab((prev) => (canAccessNavTab(profile.role, prev) ? prev : 'dashboard'));

      const [remoteClasses, remoteStudents, remoteSessions] = await Promise.all([
        fetchClassesFromSupabase(client),
        fetchStudentsFromSupabase(client),
        fetchConfirmedSessionsFromSupabase(client)
      ]);

      setClasses(remoteClasses);
      setStudents(remoteStudents);
      setSessions(remoteSessions);
    } catch (err: any) {
      setRemoteError(
        err?.message || 'Failed to synchronize records from Supabase. Retry or sign in again.'
      );
    } finally {
      setIsSyncingRemote(false);
      setIsCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setIsCheckingAuth(false);
      return;
    }

    void syncFromSupabase();
    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setStaffProfile(null);
        setClasses([]);
        setStudents([]);
        setSessions([]);
        setSelectedSessionForDetail(null);
        setActiveTab('dashboard');
        setIsCheckingAuth(false);
        if (wasAuthenticatedRef.current) {
          setSessionNotice((prev) => prev || 'Your session ended or expired. Sign in again to continue.');
        }
        wasAuthenticatedRef.current = false;
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void syncFromSupabase();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [syncFromSupabase]);

  // Live Supabase Realtime listener so Headmistress receives immediate completion alert when Admin finishes scanning
  useEffect(() => {
    if (persistenceMode !== 'supabase-live') return;
    const client = getSupabaseClient();
    if (!client) return;

    const channel = client
      .channel('lea-attendance-sessions-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_sessions' },
        () => {
          void syncFromSupabase();
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [persistenceMode, syncFromSupabase]);

  // Headmistress Two-Ring Completion Alert Watcher:
  // Ring #1: immediately when all active classes are confirmed for today
  // Ring #2: at 1:00 PM (13:00 local) ONLY if the Headmistress has not yet attended to Ring #1
  const todaySchoolDate = getDefaultSchoolDate();
  const dailyCompletion = useMemo(
    () =>
      evaluateDailyClassCompletion({
        date: todaySchoolDate,
        classes,
        sessions,
        nonSchoolGaps
      }),
    [todaySchoolDate, classes, sessions, nonSchoolGaps]
  );

  const isHeadmistressRecipient =
    persistenceMode === 'local-demo' || staffProfile?.role === 'headteacher';

  const evaluateAndFireHeadmistressRing = useCallback(() => {
    if (!headmistressPrefs.enabled || !isHeadmistressRecipient) return;
    if (!dailyCompletion.isAllComplete) return;

    const now = new Date();
    const action = evaluateHeadmistressRingAction({
      date: todaySchoolDate,
      now,
      isAllComplete: dailyCompletion.isAllComplete,
      alertState: headmistressAlertState
    });

    if (action === 'NONE') return;

    const nowIso = now.toISOString();
    const baseState: HeadmistressAlertState =
      headmistressAlertState && headmistressAlertState.date === todaySchoolDate
        ? headmistressAlertState
        : {
            date: todaySchoolDate,
            firstNotifiedAt: null,
            attendedAt: null,
            onePmNotifiedAt: null
          };

    const nextState: HeadmistressAlertState =
      action === 'RING_COMPLETION'
        ? { ...baseState, firstNotifiedAt: nowIso }
        : { ...baseState, onePmNotifiedAt: nowIso };

    setHeadmistressAlertState(nextState);
    saveStoredHeadmistressAlertState(nextState);

    if (headmistressPrefs.soundEnabled) {
      playHeadmistressChime(action === 'RING_1PM_REMINDER' ? 'reminder' : 'completion');
    }

    if (headmistressPrefs.browserNotificationsEnabled) {
      const datePretty = formatReadableDate(todaySchoolDate);
      const title =
        action === 'RING_1PM_REMINDER'
          ? '1:00 PM Attendance Reminder'
          : 'All Classes Scanned Today';
      const body = `All ${dailyCompletion.totalClasses} classes have confirmed attendance for ${datePretty}. Tap to review.`;
      triggerHeadmistressBrowserNotification(title, body);
    }
  }, [
    headmistressPrefs,
    isHeadmistressRecipient,
    dailyCompletion.isAllComplete,
    dailyCompletion.totalClasses,
    todaySchoolDate,
    headmistressAlertState
  ]);

  useEffect(() => {
    evaluateAndFireHeadmistressRing();
    const interval = window.setInterval(() => {
      evaluateAndFireHeadmistressRing();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [evaluateAndFireHeadmistressRing]);

  const handleMarkHeadmistressAlertAttended = useCallback(() => {
    const nowIso = new Date().toISOString();
    setHeadmistressAlertState((prev) => {
      const next: HeadmistressAlertState = {
        date: todaySchoolDate,
        firstNotifiedAt:
          prev && prev.date === todaySchoolDate ? prev.firstNotifiedAt || nowIso : nowIso,
        attendedAt: nowIso,
        onePmNotifiedAt:
          prev && prev.date === todaySchoolDate ? prev.onePmNotifiedAt : null
      };
      saveStoredHeadmistressAlertState(next);
      return next;
    });
  }, [todaySchoolDate]);

  const showHeadmistressBanner = Boolean(
    headmistressPrefs.enabled &&
      isHeadmistressRecipient &&
      dailyCompletion.isAllComplete &&
      headmistressAlertState &&
      headmistressAlertState.date === todaySchoolDate &&
      headmistressAlertState.firstNotifiedAt &&
      !headmistressAlertState.attendedAt
  );

  const handleSignOut = async () => {
    wasAuthenticatedRef.current = false;
    setSessionNotice('You have been signed out safely.');
    setStaffProfile(null);
    setClasses([]);
    setStudents([]);
    setSessions([]);
    setSelectedSessionForDetail(null);
    setActiveTab('dashboard');
    setRemoteError(null);
    setMobileMenuOpen(false);
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
  };

  const handleSeedLocalRoster = async (): Promise<SeedMigrationResult> => {
    const client = getSupabaseClient();
    if (!client || !staffProfile || !canWriteSchoolRecords(staffProfile.role)) {
      throw new Error('Only a signed-in School Admin can migrate local roster data.');
    }

    const localClasses = getStoredClasses();
    const localStudents = getStoredStudents();
    const result = await seedLocalDemoRosterToSupabase(client, localClasses, localStudents);
    await syncFromSupabase();
    return result;
  };

  // Attendance Sessions Handlers
  const handleSaveConfirmedSession = async (
    newSession: AttendanceSession,
    draft?: AttendanceSessionDraft
  ) => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can confirm and save registers.');
    }

    const draftIdToCheck = draft?.id || newSession.sourceDraftId;
    if (draftIdToCheck && sessions.some((s) => s.sourceDraftId === draftIdToCheck)) {
      throw new Error(
        `Draft "${draftIdToCheck}" has already been confirmed. Duplicate confirmation prevented.`
      );
    }

    const client = getSupabaseClient();
    const targetClassObj = classes.find(
      (c) =>
        (draft?.classId && c.id === draft.classId) ||
        (newSession.classId && c.id === newSession.classId) ||
        c.name.toLowerCase() === newSession.classGrade.toLowerCase()
    );

    if (persistenceMode === 'supabase-live' && client) {
      if (!targetClassObj) {
        throw new Error(
          `Class "${newSession.classGrade}" does not exist in Supabase yet. Migrate or create the class in Students & Classes first.`
        );
      }

      try {
        const savedSession = draft
          ? await confirmAttendanceSessionInSupabase(client, {
              draft,
              sessionSummary: newSession,
              classId: targetClassObj.id,
              selectedDate: newSession.date,
              modelUsed: draft.sourceImageMetadata.modelUsed || 'google-cloud-vision'
            })
          : await confirmSummaryOrNonSchoolSessionInSupabase(client, {
              sessionSummary: newSession,
              classId: targetClassObj.id
            });

        setSessions((prev) => [savedSession, ...prev.filter((s) => s.id !== savedSession.id)]);
        if (!newSession.isNonSchoolDay) {
          handleRecordWorkflowClassScan(newSession.date, targetClassObj.id);
        }
        return;
      } catch (err: any) {
        // Record failed save attempt visibly for Attendance History while preserving review draft
        const failedSession: AttendanceSession = {
          ...newSession,
          id: `failed-${Date.now()}`,
          classId: targetClassObj.id,
          reviewStatus: 'Failed',
          failureReason: err?.message || 'Database confirmation failed.',
          notes: err?.message || 'Database confirmation failed. Review draft preserved.'
        };
        setSessions((prev) => [failedSession, ...prev]);
        throw err;
      }
    }

    if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to save records.');
    }

    // Local browser demonstration fallback
    const enrichedSession: AttendanceSession = {
      ...newSession,
      classId: newSession.classId || targetClassObj?.id
    };
    const updated = addStoredAttendanceSession(enrichedSession);
    setSessions(updated);
    if (!newSession.isNonSchoolDay && enrichedSession.classId) {
      handleRecordWorkflowClassScan(newSession.date, enrichedSession.classId);
    }
  };

  const handleConfirmSessionFromRecords = async (sessionId: string) => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can confirm attendance sessions.');
    }

    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      await confirmExistingSessionInSupabase(client, sessionId);
    } else if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to confirm sessions.');
    }

    const updated = sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            reviewStatus: 'Confirmed' as const,
            verifiedBy:
              persistenceMode === 'supabase-live'
                ? 'Confirmed in Supabase PostgreSQL'
                : `${currentSchool.administratorName} (Confirmed)`
          }
        : s
    );
    setSessions(updated);
    if (persistenceMode !== 'supabase-live') {
      saveStoredAttendanceSessions(updated);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can delete attendance records.');
    }

    const client = getSupabaseClient();
    const target = sessions.find((s) => s.id === sessionId);
    if (persistenceMode === 'supabase-live' && client) {
      if (!target || target.persistenceTarget === 'supabase' || !target.id.startsWith('failed-')) {
        await deleteAttendanceSessionInSupabase(client, sessionId);
      }
    } else if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to delete records.');
    }

    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (selectedSessionForDetail?.id === sessionId) {
      setSelectedSessionForDetail(null);
    }
    if (persistenceMode !== 'supabase-live') {
      deleteStoredAttendanceSession(sessionId);
    }
  };

  const handleDeleteAllAttendanceRecords = async () => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can delete attendance records.');
    }

    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      await deleteAllAttendanceSessionsInSupabase(client);
    } else if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to delete records.');
    }

    clearAllStoredAttendanceRecords();
    setSessions([]);
    setSelectedSessionForDetail(null);
  };

  const handleDeleteAllPupils = async (options?: { alsoDeleteClasses?: boolean }) => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can delete pupil records.');
    }

    let sessionsCleared = true;
    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      const res = await deleteAllStudentsInSupabase(client, options);
      sessionsCleared = res.sessionsCleared;
    } else if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to delete pupil records.');
    }

    clearAllStoredPupilRecords(options);
    setStudents([]);
    if (sessionsCleared) {
      setSessions([]);
      setSelectedSessionForDetail(null);
    }
    setStarredStudentIds([]);
    saveStoredStarredStudentIds([]);
    if (options?.alsoDeleteClasses) {
      setClasses([]);
      setWorkflowHistory([]);
      saveStoredWorkflowHistory([]);
    }
    return { studentsDeleted: true, sessionsCleared, classesDeleted: Boolean(options?.alsoDeleteClasses) };
  };

  // Roster Management Handlers (Supabase when authenticated & live, localStorage fallback otherwise)
  const handleAddStudent = async (
    studentData: Omit<Student, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can add students.');
    }
    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      const created = await createStudentInSupabase(client, studentData);
      setStudents((prev) => [created, ...prev]);
      return;
    }
    if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to save changes.');
    }

    const now = new Date().toISOString();
    const newStudent: Student = {
      ...studentData,
      id: `std-${Date.now()}`,
      createdAt: now,
      updatedAt: now
    };
    const updated = [newStudent, ...students];
    setStudents(updated);
    saveStoredStudents(updated);
  };

  const handleBulkAddStudents = async (
    studentsList: Array<Omit<Student, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Student[]> => {
    if (studentsList.length === 0) return [];
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can enroll students.');
    }
    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      const created = await createStudentsBulkInSupabase(client, studentsList);
      setStudents((prev) => [...created, ...prev]);
      return created;
    }
    if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to save changes.');
    }

    const baseTime = Date.now();
    const now = new Date().toISOString();
    const createdLocal: Student[] = studentsList.map((item, idx) => ({
      ...item,
      id: `std-${baseTime}-${idx}`,
      createdAt: now,
      updatedAt: now
    }));
    setStudents((prev) => {
      const updated = [...createdLocal, ...prev];
      saveStoredStudents(updated);
      return updated;
    });
    return createdLocal;
  };

  const handleEditStudent = async (updatedStudent: Student) => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can edit students.');
    }
    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      const saved = await updateStudentInSupabase(client, updatedStudent);
      setStudents((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
      return;
    }
    if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to save changes.');
    }

    const updated = students.map((s) => (s.id === updatedStudent.id ? updatedStudent : s));
    setStudents(updated);
    saveStoredStudents(updated);
  };

  const handleToggleStudentActive = async (studentId: string) => {
    if (supabaseConfigured && !canWrite) {
      setRemoteError('Read-only access: Only the School Admin login can change student status.');
      return;
    }
    const target = students.find((s) => s.id === studentId);
    if (!target) return;

    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      try {
        const saved = await toggleStudentActiveInSupabase(client, studentId, !target.active);
        setStudents((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
      } catch (err: any) {
        setRemoteError(err?.message || 'Unable to update student active status.');
      }
      return;
    }
    if (supabaseConfigured) {
      setRemoteError('Your authentication session is inactive. Sign in as School Admin to save changes.');
      return;
    }

    const now = new Date().toISOString();
    const updated = students.map((s) =>
      s.id === studentId ? { ...s, active: !s.active, updatedAt: now } : s
    );
    setStudents(updated);
    saveStoredStudents(updated);
  };

  const handleAddClass = async (classData: {
    name: string;
    classTeacher?: string;
    notes?: string;
  }): Promise<ClassItem> => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can add classes.');
    }
    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      const created = await createClassInSupabase(client, classData);
      setClasses((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    }
    if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to save changes.');
    }

    const now = new Date().toISOString();
    const newClass: ClassItem = {
      id: `cls-${Date.now()}`,
      name: classData.name,
      classTeacher: classData.classTeacher,
      notes: classData.notes,
      createdAt: now,
      updatedAt: now
    };
    const updated = [...classes, newClass];
    setClasses(updated);
    saveStoredClasses(updated);
    return newClass;
  };

  const handleEditClass = async (updatedClass: ClassItem) => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can edit classes.');
    }
    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      const saved = await updateClassInSupabase(client, updatedClass);
      setClasses((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      return;
    }
    if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to save changes.');
    }

    const now = new Date().toISOString();
    const updated = classes.map((c) =>
      c.id === updatedClass.id ? { ...updatedClass, updatedAt: now } : c
    );
    setClasses(updated);
    saveStoredClasses(updated);
  };

  const handleDeleteClass = async (classId: string) => {
    if (supabaseConfigured && !canWrite) {
      throw new Error('Read-only access: Only the School Admin login can delete classes.');
    }
    const client = getSupabaseClient();
    if (persistenceMode === 'supabase-live' && client) {
      await deleteClassInSupabase(client, classId);
      setClasses((prev) => prev.filter((c) => c.id !== classId));
      return;
    }
    if (supabaseConfigured) {
      throw new Error('Your authentication session is inactive. Sign in as School Admin to save changes.');
    }

    const updated = classes.filter((c) => c.id !== classId);
    setClasses(updated);
    saveStoredClasses(updated);
  };

  // Active School State with local persistence (clears legacy seeded school profile once)
  const [currentSchool, setCurrentSchool] = useState<SchoolInfo>(() => {
    try {
      const saved = localStorage.getItem('lea_active_school_profile');
      if (saved) {
        const parsed = JSON.parse(saved) as SchoolInfo;
        if (parsed.id === 'lea-wuse-3' || parsed.subLocation === 'Wuse III') {
          localStorage.removeItem('lea_active_school_profile');
          return initialSchoolInfo;
        }
        return parsed;
      }
    } catch {
      // Fallback
    }
    return initialSchoolInfo;
  });

  const handleUpdateSchool = (updated: SchoolInfo) => {
    setCurrentSchool(updated);
    try {
      localStorage.setItem('lea_active_school_profile', JSON.stringify(updated));
    } catch {
      // Ignore
    }
  };

  // Sequential Interactive Tutorial State
  const [tutorialState, setTutorialState] = useState<TutorialGuideState>(() =>
    loadTutorialGuideState()
  );
  const [highlightedTarget, setHighlightedTarget] = useState<string | null>(null);
  const [focusProfileSignal, setFocusProfileSignal] = useState<number>(0);
  const [autoOpenBulkScanSignal, setAutoOpenBulkScanSignal] = useState<number>(0);
  const [openAnalyticsSignal, setOpenAnalyticsSignal] = useState<number>(0);

  const tutorialEvaluation = useMemo(
    () =>
      evaluateTutorialProgress({
        school: currentSchool,
        classes,
        students,
        sessions,
        exploredAnalytics: tutorialState.exploredAnalytics,
        activeStepIndex: tutorialState.activeStepIndex
      }),
    [currentSchool, classes, students, sessions, tutorialState.exploredAnalytics, tutorialState.activeStepIndex]
  );

  // Persist tutorial changes
  useEffect(() => {
    saveTutorialGuideState(tutorialState);
  }, [tutorialState]);

  // Auto-advance active step when the currently viewed step becomes completed
  useEffect(() => {
    const currentStep = tutorialEvaluation.steps[tutorialState.activeStepIndex];
    if (
      currentStep?.completed &&
      tutorialState.activeStepIndex < TUTORIAL_STEPS.length - 1
    ) {
      const nextIdx = tutorialEvaluation.steps.findIndex((s) => !s.completed);
      if (nextIdx !== -1 && nextIdx !== tutorialState.activeStepIndex) {
        setTutorialState((prev) => ({
          ...prev,
          activeStepIndex: nextIdx
        }));
      }
    }
  }, [tutorialEvaluation, tutorialState.activeStepIndex]);

  const handleExecuteTutorialStep = useCallback(
    (step: TutorialStepDefinition, index: number) => {
      setTutorialState((prev) => ({
        ...prev,
        dismissed: false,
        collapsed: false,
        activeStepIndex: index
      }));

      setHighlightedTarget(step.targetHighlightId);
      setActiveTab(step.targetTab);
      setMobileMenuOpen(false);

      if (step.id === 'profile') {
        setFocusProfileSignal((n) => n + 1);
      } else if (step.id === 'enroll') {
        setAutoOpenBulkScanSignal((n) => n + 1);
      } else if (step.id === 'analytics') {
        setOpenAnalyticsSignal((n) => n + 1);
        setTutorialState((prev) => ({ ...prev, exploredAnalytics: true }));
      }
    },
    []
  );

  const handleRestartTutorial = useCallback(() => {
    setTutorialState({
      ...DEFAULT_TUTORIAL_STATE,
      activeStepIndex: 0
    });
    setHighlightedTarget(TUTORIAL_STEPS[0].targetHighlightId);
    setActiveTab('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Tab label map for responsive header
  const tabTitles: Record<NavTab, string> = {
    dashboard: 'Dashboard',
    scan: 'Scan Register',
    students: 'Students Directory',
    records: 'Attendance Records',
    reports: 'Reports & Analytics',
    settings: 'Settings'
  };

  const handleSelectTab = (tab: NavTab) => {
    setFocusProfileSignal(0);
    setAutoOpenBulkScanSignal(0);
    setOpenAnalyticsSignal(0);
    if (supabaseConfigured && !canAccessNavTab(staffProfile?.role, tab)) {
      setActiveTab('dashboard');
      setMobileMenuOpen(false);
      return;
    }
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const handleOpenSessionFromDashboard = (session: AttendanceSession) => {
    setSelectedSessionForDetail(session);
    handleSelectTab('records');
  };

  const openStaffSignIn = () => {
    setMobileMenuOpen(false);
    if (canAccessNavTab(staffProfile?.role, 'settings')) {
      setActiveTab('settings');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Protected Auth Loading Gate: verify Supabase session before mounting any school data
  if (supabaseConfigured && isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 max-w-sm w-full text-center space-y-3 shadow-xl">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mx-auto" />
          <div className="text-sm font-bold text-white">Checking School Authentication</div>
          <p className="text-xs text-slate-300">
            Verifying your staff session before loading school records...
          </p>
        </div>
      </div>
    );
  }

  // Protected Sign-In Lock Screen: zero student, class, or attendance components mounted when signed out
  if (supabaseConfigured && !staffProfile) {
    return (
      <div className="min-h-screen bg-slate-900">
        <StaffSignInModal
          isOpen={true}
          isProtectedGate={true}
          onAuthChanged={syncFromSupabase}
          schoolName={currentSchool.name}
          sessionNotice={sessionNotice}
        />
      </div>
    );
  }

  const canAccessActiveTab =
    !supabaseConfigured || canAccessNavTab(staffProfile?.role, activeTab);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col font-sans antialiased selection:bg-emerald-200 selection:text-emerald-900 transition-colors">
      {/* Headmistress Two-Ring Completion Alert Banner */}
      <HeadmistressAlertBanner
        visible={showHeadmistressBanner}
        isReminder={Boolean(headmistressAlertState?.onePmNotifiedAt)}
        totalClasses={dailyCompletion.totalClasses}
        dateLabel={formatReadableDate(todaySchoolDate)}
        onInspectAttendance={() => {
          handleMarkHeadmistressAlertAttended();
          handleSelectTab('dashboard');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onMarkAttended={handleMarkHeadmistressAlertAttended}
        onReplayChime={() =>
          playHeadmistressChime(headmistressAlertState?.onePmNotifiedAt ? 'reminder' : 'completion')
        }
      />

      {/* Persistence / Sample Mode Status Banner */}
      <SampleDataBanner
        persistenceMode={persistenceMode}
        staffProfile={staffProfile}
        onNavigateToSettings={openStaffSignIn}
      />

      {/* Actionable Remote Database Error Banner */}
      {remoteError && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 sm:px-6">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-rose-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{remoteError}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isSyncingRemote}
                onClick={() => void syncFromSupabase()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-rose-300 text-rose-800 font-semibold hover:bg-rose-100 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncingRemote ? 'animate-spin' : ''}`} />
                <span>Retry Sync</span>
              </button>
              <button
                type="button"
                onClick={() => setRemoteError(null)}
                className="p-1 text-rose-600 hover:text-rose-900 cursor-pointer"
                aria-label="Dismiss database error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Top Header */}
      <Header
        onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
        activeTabName={tabTitles[activeTab]}
        school={currentSchool}
        persistenceMode={persistenceMode}
        staffProfile={staffProfile}
        onOpenSignIn={openStaffSignIn}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 flex w-full min-w-0">
        {/* Navigation Sidebar (Desktop + Mobile Drawer) */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          isOpenMobile={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          school={currentSchool}
          userRole={staffProfile?.role}
          staffProfile={staffProfile}
        />

        {/* Main Content Area */}
        <main className="flex-1 w-full min-w-0 px-3 py-3 sm:p-6 lg:p-8 pb-24 md:pb-8">
          {canWrite && (
            <OnboardingGuide
              guideState={tutorialState}
              evaluation={tutorialEvaluation}
              onExecuteStep={handleExecuteTutorialStep}
              onSelectStepIndex={(idx) =>
                setTutorialState((prev) => ({ ...prev, activeStepIndex: idx }))
              }
              onToggleCollapse={() =>
                setTutorialState((prev) => ({ ...prev, collapsed: !prev.collapsed }))
              }
              onDismiss={() =>
                setTutorialState((prev) => ({
                  ...prev,
                  dismissed: true,
                  completedBannerDismissed: true
                }))
              }
              onRestart={handleRestartTutorial}
            />
          )}

          {!canAccessActiveTab && (
            <div className="max-w-lg mx-auto mt-8 bg-white rounded-xl border border-rose-200 p-6 text-center space-y-3 shadow-xs">
              <ShieldAlert className="w-8 h-8 text-rose-600 mx-auto" />
              <h2 className="text-base font-bold text-slate-900">Access Restricted</h2>
              <p className="text-xs text-slate-600">
                Your current role does not have permission to open this screen.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          )}

          {canAccessActiveTab && activeTab === 'dashboard' && (
            <DashboardPage
              students={students}
              classes={classes}
              sessions={sessions}
              school={currentSchool}
              isSupabaseLive={persistenceMode === 'supabase-live'}
              userRole={staffProfile?.role}
              canScan={!supabaseConfigured || canAccessNavTab(staffProfile?.role, 'scan')}
              starredStudentIds={starredStudentIds}
              nonSchoolGaps={nonSchoolGaps}
              onToggleStarStudent={handleToggleStarStudent}
              onNavigateToScan={() => handleSelectTab('scan')}
              onNavigateToRecords={() => handleSelectTab('records')}
              onNavigateToReports={() => handleSelectTab('reports')}
              onNavigateToStudents={() => handleSelectTab('students')}
              onOpenSessionDetail={handleOpenSessionFromDashboard}
              onAnalyticsViewUsed={() =>
                setTutorialState((prev) =>
                  prev.exploredAnalytics ? prev : { ...prev, exploredAnalytics: true }
                )
              }
              openAnalyticsSignal={openAnalyticsSignal}
              highlightedTarget={highlightedTarget}
            />
          )}

          {canAccessActiveTab && activeTab === 'scan' && (
            <ScanRegisterPage
              onNavigateToRecords={() => handleSelectTab('records')}
              onNavigateToDashboard={() => handleSelectTab('dashboard')}
              school={currentSchool}
              classes={classes}
              students={students}
              existingSessions={sessions}
              isSupabaseLive={persistenceMode === 'supabase-live'}
              defaultScanMode={defaultScanMode}
              onChangeDefaultScanMode={handleChangeDefaultScanMode}
              nonSchoolGaps={nonSchoolGaps}
              onAddNonSchoolGap={handleAddNonSchoolGap}
              starredStudentIds={starredStudentIds}
              workflowHistory={workflowHistory}
              onInspectExistingSession={(existingSession) => {
                setSelectedSessionForDetail(existingSession);
                handleSelectTab('records');
              }}
              onSaveConfirmedSession={handleSaveConfirmedSession}
              highlightedTarget={highlightedTarget}
            />
          )}

          {canAccessActiveTab && activeTab === 'students' && (
            <StudentsPage
              students={students}
              classes={classes}
              sessions={sessions}
              nonSchoolGaps={nonSchoolGaps}
              starredStudentIds={starredStudentIds}
              onToggleStarStudent={handleToggleStarStudent}
              canWrite={canWrite}
              onAddStudent={handleAddStudent}
              onBulkAddStudents={handleBulkAddStudents}
              onEditStudent={handleEditStudent}
              onToggleStudentActive={handleToggleStudentActive}
              onAddClass={handleAddClass}
              onEditClass={handleEditClass}
              onDeleteClass={handleDeleteClass}
              onDeleteAllPupils={handleDeleteAllPupils}
              autoOpenBulkScanSignal={autoOpenBulkScanSignal}
              highlightedTarget={highlightedTarget}
            />
          )}

          {canAccessActiveTab && activeTab === 'records' && (
            <AttendanceRecordsPage
              sessions={sessions}
              classes={classes}
              canWrite={canWrite}
              isSupabaseLive={persistenceMode === 'supabase-live'}
              onConfirmSession={handleConfirmSessionFromRecords}
              onDeleteSession={handleDeleteSession}
              onDeleteAllSessions={handleDeleteAllAttendanceRecords}
              initialSelectedSession={selectedSessionForDetail}
              onClearInitialSession={() => setSelectedSessionForDetail(null)}
            />
          )}

          {canAccessActiveTab && activeTab === 'reports' && (
            <ReportsPage
              sessions={sessions}
              classes={classes}
              students={students}
              school={currentSchool}
              starredStudentIds={starredStudentIds}
              nonSchoolGaps={nonSchoolGaps}
              canWrite={canWrite}
              isSupabaseLive={persistenceMode === 'supabase-live'}
            />
          )}

          {canAccessActiveTab && activeTab === 'settings' && (
            <SettingsPage
              currentSchool={currentSchool}
              onUpdateSchool={handleUpdateSchool}
              persistenceMode={persistenceMode}
              staffProfile={staffProfile}
              classes={classes}
              students={students}
              sessions={sessions}
              appTheme={appTheme}
              onChangeTheme={handleChangeTheme}
              defaultScanMode={defaultScanMode}
              onChangeDefaultScanMode={handleChangeDefaultScanMode}
              workflowHistory={workflowHistory}
              onResetWorkflowHistory={handleResetWorkflowHistory}
              nonSchoolGaps={nonSchoolGaps}
              onDeleteNonSchoolGap={handleDeleteNonSchoolGap}
              headmistressPrefs={headmistressPrefs}
              onUpdateHeadmistressPrefs={handleUpdateHeadmistressPrefs}
              onAuthChanged={syncFromSupabase}
              onSignOut={handleSignOut}
              onSeedLocalRoster={handleSeedLocalRoster}
              onDeleteAllPupils={handleDeleteAllPupils}
              highlightedTarget={highlightedTarget}
              focusProfileSignal={focusProfileSignal}
              onStartTutorial={handleRestartTutorial}
            />
          )}
        </main>
      </div>

      {/* Mobile Android Bottom Navigation */}
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenMoreMenu={() => setMobileMenuOpen(true)}
        userRole={staffProfile?.role}
      />
    </div>
  );
}
