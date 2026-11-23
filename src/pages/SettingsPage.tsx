import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  School,
  Calendar,
  UserCheck,
  Save,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Loader2,
  Database,
  Lock,
  LogOut,
  Upload,
  Compass,
  Phone,
  Mail,
  User,
  Info,
  Eye,
  EyeOff,
  Palette,
  ScanLine,
  Award,
  BellRing,
  Volume2,
  CalendarOff,
  Trash2,
  Search
} from 'lucide-react';
import {
  AppThemeId,
  AttendanceSession,
  ClassItem,
  ClassWorkflowHistoryEntry,
  DefaultScanModePreference,
  NonSchoolGapRecord,
  SchoolInfo,
  StaffProfile,
  Student
} from '../types/attendance';
import { initialSchoolInfo } from '../data/mockData';
import {
  isDeveloperDiagnosticsEnabled,
  setDeveloperDiagnosticsEnabled
} from '../services/rosterStorage';
import {
  APP_THEME_OPTIONS,
  MIN_LEARNED_WORKFLOW_DAYS
} from '../services/workflowPreferences';
import {
  ClassPunctualityQueryResult,
  computeClassPunctualityRankings
} from '../services/studentTrackingMetrics';
import {
  DEFAULT_HEADMISTRESS_PREFS,
  HeadmistressAlertPreferences,
  playHeadmistressChime,
  requestBrowserNotificationPermission
} from '../services/headmistressAlertService';
import { formatReadableDate } from '../services/schoolCalendarGaps';
import { getSupabaseClient, getSupabaseConfigStatus } from '../lib/supabaseClient';
import { getRoleDisplayLabel, resolveLoginIdentifier } from '../lib/authRoles';
import type { SeedMigrationResult } from '../services/supabaseAttendanceService';

type AdminHonorific = '' | 'Mr.' | 'Mrs.';

function parseAdministratorTitle(fullName: string): {
  title: AdminHonorific;
  baseName: string;
} {
  const leading = (fullName || '').replace(/^\s+/, '');
  const mrsMatch = leading.match(/^mrs\.?(?:\s+(.*))?$/i);
  if (mrsMatch) {
    return { title: 'Mrs.', baseName: mrsMatch[1] ?? '' };
  }
  const mrMatch = leading.match(/^mr\.?(?:\s+(.*))?$/i);
  if (mrMatch) {
    return { title: 'Mr.', baseName: mrMatch[1] ?? '' };
  }
  return { title: '', baseName: fullName || '' };
}

function combineAdministratorName(title: AdminHonorific, baseName: string): string {
  const cleanedName = baseName.replace(/^(mr|mrs)\.?\s+/i, '').trim();
  if (!cleanedName) return '';
  return title ? `${title} ${cleanedName}` : cleanedName;
}

interface SettingsPageProps {
  currentSchool: SchoolInfo;
  onUpdateSchool: (updatedSchool: SchoolInfo) => void;
  persistenceMode?: 'local-demo' | 'supabase-live' | 'supabase-needs-auth';
  staffProfile?: StaffProfile | null;
  classes?: ClassItem[];
  students?: Student[];
  sessions?: AttendanceSession[];
  appTheme?: AppThemeId;
  onChangeTheme?: (theme: AppThemeId) => void;
  defaultScanMode?: DefaultScanModePreference;
  onChangeDefaultScanMode?: (pref: DefaultScanModePreference) => void;
  workflowHistory?: ClassWorkflowHistoryEntry[];
  onResetWorkflowHistory?: () => void;
  nonSchoolGaps?: NonSchoolGapRecord[];
  onDeleteNonSchoolGap?: (gapId: string) => void;
  headmistressPrefs?: HeadmistressAlertPreferences;
  onUpdateHeadmistressPrefs?: (prefs: HeadmistressAlertPreferences) => void;
  onAuthChanged?: () => void | Promise<void>;
  onSignOut?: () => void | Promise<void>;
  onSeedLocalRoster?: () => Promise<SeedMigrationResult>;
  onDeleteAllPupils?: (options?: { alsoDeleteClasses?: boolean }) =>
    | void
    | { studentsDeleted: boolean; sessionsCleared: boolean; classesDeleted: boolean }
    | Promise<void | { studentsDeleted: boolean; sessionsCleared: boolean; classesDeleted: boolean }>;
  highlightedTarget?: string | null;
  focusProfileSignal?: number;
  onStartTutorial?: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  currentSchool,
  onUpdateSchool,
  persistenceMode = 'local-demo',
  staffProfile,
  classes = [],
  students = [],
  sessions = [],
  appTheme = 'classic',
  onChangeTheme,
  defaultScanMode = 'ask',
  onChangeDefaultScanMode,
  workflowHistory = [],
  onResetWorkflowHistory,
  nonSchoolGaps = [],
  onDeleteNonSchoolGap,
  headmistressPrefs = DEFAULT_HEADMISTRESS_PREFS,
  onUpdateHeadmistressPrefs,
  onAuthChanged,
  onSignOut,
  onSeedLocalRoster,
  onDeleteAllPupils,
  highlightedTarget,
  focusProfileSignal,
  onStartTutorial
}) => {
  const schoolNameInputRef = useRef<HTMLInputElement>(null);
  const profileSectionRef = useRef<HTMLDivElement>(null);
  // Local form state for all profile fields
  const [formData, setFormData] = useState<SchoolInfo>(currentSchool);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [devDiagnosticsEnabled, setDevDiagnosticsEnabled] = useState<boolean>(() =>
    isDeveloperDiagnosticsEnabled()
  );

  // Supabase Auth & Explicit Migration UI State
  const supabaseStatus = getSupabaseConfigStatus();
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSeedingRoster, setIsSeedingRoster] = useState(false);
  const [seedMessage, setSeedMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmingResetDefaults, setConfirmingResetDefaults] = useState(false);

  // On-Demand Per-Student Punctuality Lookup State (Settings ONLY, Direct Register ONLY)
  const [punctualityClassId, setPunctualityClassId] = useState<string>(() =>
    classes.length === 1 ? classes[0].id : 'All'
  );
  const [punctualityStartDate, setPunctualityStartDate] = useState<string>('');
  const [punctualityEndDate, setPunctualityEndDate] = useState<string>('');
  const [punctualityResult, setPunctualityResult] = useState<ClassPunctualityQueryResult | null>(null);

  // Headmistress Chime & Notification Permission Test Feedback
  const [chimeFeedback, setChimeFeedback] = useState<string | null>(null);

  const learnedWorkflowDays = workflowHistory.filter((h) => h.classIds.length >= 2).length;

  const handleRunPunctualityQuery = (e: React.FormEvent) => {
    e.preventDefault();
    const res = computeClassPunctualityRankings({
      classId: punctualityClassId,
      students,
      classes,
      sessions,
      startDate: punctualityStartDate || undefined,
      endDate: punctualityEndDate || undefined,
      nonSchoolGaps
    });
    setPunctualityResult(res);
  };

  const handleTestChimeAndEnable = async () => {
    const chimePlayed = playHeadmistressChime('completion');
    const perm = await requestBrowserNotificationPermission();
    if (perm === 'granted') {
      setChimeFeedback(
        chimePlayed
          ? 'Chime played and browser notifications are enabled for this device.'
          : 'Browser notifications enabled (device audio may require unmuting).'
      );
    } else if (perm === 'denied') {
      setChimeFeedback(
        'Chime played. Browser notifications are currently blocked in your browser site settings — live in-app banner & chime will still work.'
      );
    } else {
      setChimeFeedback(
        chimePlayed
          ? 'Chime played. Live in-app alert banner is active whenever the app is open.'
          : 'Live in-app alert banner is active whenever the app is open.'
      );
    }
  };

  // Database pupil reset inline confirmation state
  const [confirmingPupilReset, setConfirmingPupilReset] = useState(false);
  const [resetAlsoDeleteClasses, setResetAlsoDeleteClasses] = useState(false);
  const [isResettingPupils, setIsResettingPupils] = useState(false);
  const [pupilResetMessage, setPupilResetMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const canAdminResetDb =
    Boolean(onDeleteAllPupils) &&
    (persistenceMode === 'local-demo' || staffProfile?.role === 'admin');

  const handleSupabaseAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client) {
      setAuthMessage({ ok: false, text: 'Supabase environment variables are not configured yet.' });
      return;
    }
    const emailToUse = resolveLoginIdentifier(authEmail);
    if (!emailToUse || !authPassword.trim()) {
      setAuthMessage({ ok: false, text: 'Enter both username (or email) and password.' });
      return;
    }

    setIsAuthBusy(true);
    setAuthMessage(null);
    try {
      let { error } = await client.auth.signInWithPassword({
        email: emailToUse,
        password: authPassword
      });
      if (
        error &&
        (error.message || '').toLowerCase().includes('invalid login credentials') &&
        authPassword !== authPassword.trim()
      ) {
        const retryRes = await client.auth.signInWithPassword({
          email: emailToUse,
          password: authPassword.trim()
        });
        error = retryRes.error;
      }
      if (error) throw error;
      setAuthMessage({ ok: true, text: 'Signed in successfully. Loading school records...' });
      if (onAuthChanged) {
        await onAuthChanged();
      }
      setAuthPassword('');
    } catch (err: any) {
      setAuthMessage({ ok: false, text: err?.message || 'Authentication failed.' });
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleSeedClick = async () => {
    if (!onSeedLocalRoster) return;
    setIsSeedingRoster(true);
    setSeedMessage(null);
    try {
      const res = await onSeedLocalRoster();
      setSeedMessage({
        ok: true,
        text: `Migration complete: created ${res.classesCreated} classes & ${res.studentsCreated} students (skipped ${res.classesSkipped} existing classes & ${res.studentsSkipped} existing students).`
      });
    } catch (err: any) {
      setSeedMessage({
        ok: false,
        text: err?.message || 'Unable to migrate local roster. Ensure your profile has teacher or admin role.'
      });
    } finally {
      setIsSeedingRoster(false);
    }
  };

  // Sync if currentSchool changes externally
  useEffect(() => {
    setFormData(currentSchool);
  }, [currentSchool]);

  // Focus & scroll to school/administrator name fields when triggered by tutorial
  useEffect(() => {
    if (!focusProfileSignal) return;
    profileSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => {
      schoolNameInputRef.current?.focus();
    }, 180);
    return () => clearTimeout(timer);
  }, [focusProfileSignal]);

  const handleChange = (field: keyof SchoolInfo, value: string | number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value
    }));
    setValidationError(null);
  };

  const parsedAdmin = parseAdministratorTitle(formData.administratorName);

  const handleAdminTitleChange = (nextTitle: AdminHonorific) => {
    const base = parsedAdmin.baseName;
    const nextCombined = base.trim()
      ? combineAdministratorName(nextTitle, base)
      : nextTitle
      ? `${nextTitle} `
      : '';
    handleChange('administratorName', nextCombined);
  };

  const handleAdminBaseNameChange = (nextBaseName: string) => {
    const cleaned = nextBaseName.replace(/^(mr|mrs)\.?\s+/i, '');
    const nextCombined = parsedAdmin.title
      ? cleaned
        ? `${parsedAdmin.title} ${cleaned}`
        : `${parsedAdmin.title} `
      : cleaned;
    handleChange('administratorName', nextCombined);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    // Basic Validation
    if (!formData.name.trim()) {
      setValidationError('School Name is required.');
      return;
    }
    const finalAdminName = combineAdministratorName(parsedAdmin.title, parsedAdmin.baseName);
    if (!finalAdminName) {
      setValidationError('Records Administrator name is required.');
      return;
    }

    const normalizedFormData: SchoolInfo = {
      ...formData,
      administratorName: finalAdminName
    };
    setFormData(normalizedFormData);
    onUpdateSchool(normalizedFormData);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
    }, 3500);
  };

  const handleResetToDefault = () => {
    if (!confirmingResetDefaults) {
      setConfirmingResetDefaults(true);
      return;
    }
    setConfirmingResetDefaults(false);
    setFormData(initialSchoolInfo);
    onUpdateSchool(initialSchoolInfo);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page Title & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-800">
            <Settings className="w-4 h-4" />
            <span>Institutional Settings</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
            School Profile & System Settings
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Manage school name, term parameters, and database authentication.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {confirmingResetDefaults && (
            <button
              type="button"
              onClick={() => setConfirmingResetDefaults(false)}
              className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleResetToDefault}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg shadow-xs transition-colors cursor-pointer ${
              confirmingResetDefaults
                ? 'bg-rose-700 hover:bg-rose-800 text-white border-rose-700'
                : 'text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border-slate-300'
            }`}
            title="Reset to default school parameters"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{confirmingResetDefaults ? 'Confirm Reset' : 'Reset Defaults'}</span>
          </button>
        </div>
      </div>

      {/* Supabase PostgreSQL & Staff Auth Card (Top of Settings for direct Sign-In access) */}
      <div id="staff-signin" className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 rounded-lg text-emerald-800">
              <Database className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Supabase PostgreSQL Database & Staff Authentication
              </h3>
              <p className="text-xs text-slate-500">
                Row-Level-Security protected storage for classes, students, and confirmed attendance sessions
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full self-start sm:self-auto ${
              persistenceMode === 'supabase-live'
                ? 'bg-emerald-100 text-emerald-800'
                : persistenceMode === 'supabase-needs-auth'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-amber-100 text-amber-900'
            }`}
          >
            {persistenceMode === 'supabase-live' ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Connected & Synced</span>
              </>
            ) : persistenceMode === 'supabase-needs-auth' ? (
              <>
                <Lock className="w-3.5 h-3.5" />
                <span>Sign-In Required (RLS Active)</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Local Browser Storage Mode</span>
              </>
            )}
          </span>
        </div>

        {!supabaseStatus.configured ? (
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
            <div className="font-semibold text-slate-900">
              Remote PostgreSQL Not Yet Configured
            </div>
            <p className="leading-relaxed">
              The application safely runs in Local Browser Demonstration Mode until you set <code className="font-mono bg-white px-1 py-0.5 border border-slate-200 rounded">VITE_SUPABASE_URL</code> and <code className="font-mono bg-white px-1 py-0.5 border border-slate-200 rounded">VITE_SUPABASE_ANON_KEY</code> in <code className="font-mono bg-white px-1 py-0.5 border border-slate-200 rounded">.env</code> and run the SQL migration in <code className="font-mono bg-white px-1 py-0.5 border border-slate-200 rounded">supabase/migrations/001_initial_schema.sql</code>.
            </p>
          </div>
        ) : persistenceMode === 'supabase-live' && staffProfile ? (
          <div className="space-y-3 text-xs">
            <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-bold text-emerald-950">
                  Signed in as {staffProfile.displayName}
                </div>
                <div className="text-[11px] text-emerald-800 mt-0.5">
                  Access Level: <strong>{getRoleDisplayLabel(staffProfile.role)}</strong>
                  {staffProfile.email ? ` · ${staffProfile.email}` : ''}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onSeedLocalRoster && (
                  <button
                    type="button"
                    disabled={isSeedingRoster}
                    onClick={handleSeedClick}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {isSeedingRoster ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>Migrate Local Sample Roster to Supabase</span>
                  </button>
                )}
                {onSignOut && (
                  <button
                    type="button"
                    onClick={() => void onSignOut()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-rose-50 border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                )}
              </div>
            </div>

            {seedMessage && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  seedMessage.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {seedMessage.text}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSupabaseAuthSubmit} className="space-y-3 text-xs bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-800">
                Staff Sign-In (Admin Provisioned Accounts Only)
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                autoComplete="username"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="admin, headteacher, inspector, or email"
                required
                className="px-3 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-xs"
              />
              <div className="relative">
                <input
                  type={showAuthPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Password"
                  required
                  className="w-full pl-3 pr-9 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowAuthPassword((prev) => !prev)}
                  aria-label={showAuthPassword ? 'Hide password' : 'Show password'}
                  title={showAuthPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
                >
                  {showAuthPassword ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {authMessage && (
              <div
                className={`p-2.5 rounded border text-[11px] ${
                  authMessage.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {authMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={isAuthBusy}
              className="px-4 py-2 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              {isAuthBusy ? 'Authenticating...' : 'Sign In to Connect Database'}
            </button>
          </form>
        )}
      </div>

      {savedSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs font-medium flex items-center gap-2.5 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>School profile and institutional configuration saved successfully. Headers and registers updated.</span>
        </div>
      )}

      {validationError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-medium flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* 1. School Information (Fully Editable) */}
        <div
          ref={profileSectionRef}
          data-tutorial-target="settings-profile"
          className={`bg-white rounded-lg border p-5 shadow-xs space-y-4 transition-all ${
            highlightedTarget === 'settings-profile'
              ? 'border-emerald-500 ring-2 ring-emerald-500/30'
              : 'border-slate-200'
          }`}
        >
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 pb-2 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <School className="w-4 h-4 text-emerald-700" />
              <span>1. School Identity & Location</span>
            </div>
            <span className="text-xs font-normal text-slate-400">All fields editable</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* School Name */}
            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Official School Name <span className="text-rose-600">*</span>
              </label>
              <input
                ref={schoolNameInputRef}
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="e.g. Primary School Name"
                className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Zone */}
            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Zone / Area
              </label>
              <input
                type="text"
                value={formData.zone}
                onChange={(e) => handleChange('zone', e.target.value)}
                placeholder="e.g. Zone / Ward"
                className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* 2. Academic Calendar Configuration (Fully Editable) */}
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 pb-2 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-700" />
              <span>2. Academic Calendar & Term Settings</span>
            </div>
            <span className="text-xs font-normal text-slate-400">All fields editable</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Academic Session
              </label>
              <input
                type="text"
                value={formData.academicSession}
                onChange={(e) => handleChange('academicSession', e.target.value)}
                placeholder="e.g. 2026/2027 Academic Session"
                className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Current Term
              </label>
              <select
                value={formData.currentTerm}
                onChange={(e) => handleChange('currentTerm', e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="First Term">First Term</option>
                <option value="Second Term">Second Term</option>
                <option value="Third Term">Third Term</option>
              </select>
            </div>
          </div>
        </div>

        {/* 3. Administrative Officers & Contacts (Fully Editable) */}
        <div
          className={`bg-white rounded-lg border p-5 shadow-xs space-y-4 transition-all ${
            highlightedTarget === 'settings-profile'
              ? 'border-emerald-500 ring-2 ring-emerald-500/30'
              : 'border-slate-200'
          }`}
        >
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 pb-2 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-700" />
              <span>3. Administrative Officers & Contact Info</span>
            </div>
            <span className="text-xs font-normal text-slate-400">All fields editable</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Name of Records Administrator <span className="text-rose-600">*</span>
              </label>
              <div className="flex items-stretch gap-2">
                <select
                  aria-label="Administrator title"
                  value={parsedAdmin.title}
                  onChange={(e) => handleAdminTitleChange(e.target.value as AdminHonorific)}
                  className="w-24 shrink-0 px-2.5 py-2 text-xs sm:text-sm border border-slate-300 rounded-md bg-white text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Title</option>
                  <option value="Mr.">Mr.</option>
                  <option value="Mrs.">Mrs.</option>
                </select>
                <input
                  type="text"
                  value={parsedAdmin.baseName}
                  onChange={(e) => handleAdminBaseNameChange(e.target.value)}
                  placeholder="e.g. Ibrahim Musa"
                  className="flex-1 min-w-0 px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              {parsedAdmin.title && parsedAdmin.baseName.trim() && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Dashboard greeting:{' '}
                  <strong className="text-slate-800">
                    {parsedAdmin.title} {parsedAdmin.baseName.trim().split(/\s+/)[0]}
                  </strong>
                  {' · '}
                  Records:{' '}
                  <strong className="text-slate-800">
                    {combineAdministratorName(parsedAdmin.title, parsedAdmin.baseName)}
                  </strong>
                </p>
              )}
            </div>

            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Absentee Alert Threshold (%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="5"
                  max="50"
                  value={formData.absenceAlertThreshold || 15}
                  onChange={(e) => handleChange('absenceAlertThreshold', Number(e.target.value))}
                  className="w-24 px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-slate-500 text-xs">
                  Flag class if daily absence exceeds this percentage
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-slate-500">
            Saved changes immediately update application headers, sidebar, and registers.
          </p>

          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm rounded-lg shadow-sm transition-all active:scale-98 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Save Profile Settings</span>
          </button>
        </div>
      </form>

      {/* 4. APPEARANCE & THEME SWITCHER (Classic + 3 Light + 1 Dark) */}
      {onChangeTheme && (
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                4. Appearance &amp; Theme
              </h3>
            </div>
            <span className="text-xs text-slate-500">3 Light · 1 Dark · Classic</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {APP_THEME_OPTIONS.map((opt) => {
              const active = appTheme === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeTheme(opt.id)}
                  className={`text-left p-3.5 rounded-xl border-2 transition-all cursor-pointer space-y-2.5 ${
                    active
                      ? 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50/40'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  {/* Miniature visual theme swatch */}
                  <div
                    className="h-12 rounded-lg border border-slate-300/60 overflow-hidden flex"
                    style={{ backgroundColor: opt.previewCanvas }}
                  >
                    <div
                      className="w-8 h-full shrink-0"
                      style={{ backgroundColor: opt.previewSidebar }}
                    />
                    <div className="flex-1 p-1.5 flex flex-col justify-between">
                      <div
                        className="h-3 rounded-xs w-3/4 border border-black/5"
                        style={{ backgroundColor: opt.previewCard }}
                      />
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-10 rounded-xs"
                          style={{ backgroundColor: opt.previewAccent }}
                        />
                        <span
                          className="h-2.5 flex-1 rounded-xs border border-black/5"
                          style={{ backgroundColor: opt.previewCard }}
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">{opt.name}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {opt.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                      {opt.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 5. SCANNING MODE DEFAULT & ADAPTIVE CLASS ROUTE LEARNING */}
      {onChangeDefaultScanMode && (
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <ScanLine className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              5. Default Scan Mode &amp; Adaptive Class Order
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-800 mb-2">
                When opening Scan, default to:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(
                  [
                    { id: 'ask', label: 'Ask every time', desc: 'Show Register & Summary choices' },
                    { id: 'register', label: 'Scan from Register', desc: 'Direct single-day sheet scan' },
                    { id: 'summary', label: 'Scan from Summary', desc: 'Handwritten notebook totals' }
                  ] as const
                ).map((choice) => {
                  const selected = defaultScanMode === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => onChangeDefaultScanMode(choice.id)}
                      className={`min-h-[44px] text-left p-3 rounded-xl border transition-all cursor-pointer ${
                        selected
                          ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950'
                          : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{choice.label}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{choice.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">
                  Adaptive Next-Class Workflow Learning
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  {learnedWorkflowDays >= MIN_LEARNED_WORKFLOW_DAYS
                    ? `Active — learned from ${learnedWorkflowDays} school days of scans. Auto-advances following your preferred classroom order.`
                    : `Observing your scanning sequence (${learnedWorkflowDays} of ${MIN_LEARNED_WORKFLOW_DAYS} school days recorded). Advances sequentially until a 1-week pattern is learned.`}
                </p>
              </div>
              {onResetWorkflowHistory && workflowHistory.length > 0 && (
                <button
                  type="button"
                  onClick={onResetWorkflowHistory}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs cursor-pointer shrink-0"
                >
                  Reset Learned Order
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 6. ON-DEMAND PER-STUDENT PUNCTUALITY & ABSENCE LOOKUP (Settings ONLY, Direct Register ONLY) */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              6. Per-Student Punctuality &amp; Absence Lookup
            </h3>
          </div>
          <span className="text-[11px] font-medium text-slate-500">
            Direct Register Scans Only
          </span>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          Query the most punctual and most absent pupils for any class. Metrics are computed on demand strictly from confirmed <strong>Direct Register</strong> scans (Written Summary scans and Non-School Days are excluded).
        </p>

        <form onSubmit={handleRunPunctualityQuery} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Class</label>
            <select
              value={punctualityClassId}
              onChange={(e) => setPunctualityClassId(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 text-xs sm:text-sm"
            >
              <option value="All">All Classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">From Date (Optional)</label>
            <input
              type="date"
              value={punctualityStartDate}
              onChange={(e) => setPunctualityStartDate(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 text-xs sm:text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">To Date (Optional)</label>
            <input
              type="date"
              value={punctualityEndDate}
              onChange={(e) => setPunctualityEndDate(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 text-xs sm:text-sm tabular-nums"
            />
          </div>

          <button
            type="submit"
            className="min-h-[42px] px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Search className="w-4 h-4" />
            <span>Query Punctuality</span>
          </button>
        </form>

        {punctualityResult && (
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span>
                <strong className="text-slate-800">{punctualityResult.directRegisterSessionCount}</strong> direct register{' '}
                {punctualityResult.directRegisterSessionCount === 1 ? 'session' : 'sessions'} analyzed
              </span>
              {punctualityResult.excludedSummarySessionCount > 0 && (
                <span>
                  · {punctualityResult.excludedSummarySessionCount} summary-note{' '}
                  {punctualityResult.excludedSummarySessionCount === 1 ? 'scan' : 'scans'} excluded
                </span>
              )}
              {punctualityResult.excludedNonSchoolSessionCount > 0 && (
                <span>
                  · {punctualityResult.excludedNonSchoolSessionCount} non-school{' '}
                  {punctualityResult.excludedNonSchoolSessionCount === 1 ? 'day' : 'days'} excluded
                </span>
              )}
            </div>

            {punctualityResult.allRanked.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 text-center">
                No confirmed direct register sessions with pupil marks were found for this filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Most Punctual Pupils */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-emerald-100/70 border-b border-emerald-200 text-xs font-bold text-emerald-950">
                    Most Punctual Pupils (Top {Math.min(5, punctualityResult.mostPunctual.length)})
                  </div>
                  <div className="divide-y divide-emerald-100">
                    {punctualityResult.mostPunctual.slice(0, 5).map((row, idx) => (
                      <div key={row.studentId} className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">
                            {idx + 1}. {row.studentName}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {row.className} · Row #{row.studentNumber}
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums shrink-0">
                          <div className="font-bold text-emerald-800">
                            {row.attendancePercentage !== null ? `${row.attendancePercentage.toFixed(1)}%` : 'N/A'}
                          </div>
                          <div className="text-[11px] text-slate-600">
                            {row.presentDays}/{row.totalRecordedDays} days
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Most Absent Pupils */}
                <div className="rounded-xl border border-rose-200 bg-rose-50/40 overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-rose-100/70 border-b border-rose-200 text-xs font-bold text-rose-950">
                    Most Absent Pupils ({punctualityResult.mostAbsent.length > 0 ? `Top ${Math.min(5, punctualityResult.mostAbsent.length)}` : 'None'})
                  </div>
                  {punctualityResult.mostAbsent.length === 0 ? (
                    <div className="p-4 text-xs text-slate-600 text-center">
                      Zero absences recorded in direct register scans for this filter.
                    </div>
                  ) : (
                    <div className="divide-y divide-rose-100">
                      {punctualityResult.mostAbsent.slice(0, 5).map((row, idx) => (
                        <div key={row.studentId} className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 truncate">
                              {idx + 1}. {row.studentName}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {row.className} · Row #{row.studentNumber}
                            </div>
                          </div>
                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div className="font-bold text-rose-800">
                              {row.absentDays} {row.absentDays === 1 ? 'day' : 'days'} absent
                            </div>
                            <div className="text-[11px] text-slate-600">
                              Present {row.presentDays}/{row.totalRecordedDays} ({row.attendancePercentage?.toFixed(1)}%)
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 7. HEADMISTRESS TWO-RING COMPLETION ALERTS */}
      {onUpdateHeadmistressPrefs && (
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                7. Headmistress Completion Alerts &amp; Chime
              </h3>
            </div>
            <span className="text-[11px] font-medium text-slate-500">Two-Ring Schedule</span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            <strong>Ring #1</strong> sounds immediately on the Headmistress’s phone as soon as all classes have been scanned for the day.{' '}
            <strong>Ring #2</strong> sounds at <strong>1:00 PM</strong> only if the first alert has not yet been attended to.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <label className="flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50/70 cursor-pointer">
              <span className="font-semibold text-slate-800">Enable Alerts</span>
              <input
                type="checkbox"
                checked={headmistressPrefs.enabled}
                onChange={(e) =>
                  onUpdateHeadmistressPrefs({ ...headmistressPrefs, enabled: e.target.checked })
                }
                className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-600"
              />
            </label>

            <label className="flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50/70 cursor-pointer">
              <span className="font-semibold text-slate-800">Special Chime</span>
              <input
                type="checkbox"
                checked={headmistressPrefs.soundEnabled}
                onChange={(e) =>
                  onUpdateHeadmistressPrefs({ ...headmistressPrefs, soundEnabled: e.target.checked })
                }
                className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-600"
              />
            </label>

            <label className="flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50/70 cursor-pointer">
              <span className="font-semibold text-slate-800">Phone Notification</span>
              <input
                type="checkbox"
                checked={headmistressPrefs.browserNotificationsEnabled}
                onChange={(e) =>
                  onUpdateHeadmistressPrefs({
                    ...headmistressPrefs,
                    browserNotificationsEnabled: e.target.checked
                  })
                }
                className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-600"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleTestChimeAndEnable()}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <Volume2 className="w-4 h-4" />
              <span>Test Chime &amp; Enable Alerts</span>
            </button>
            {chimeFeedback && (
              <span className="text-xs text-slate-600">{chimeFeedback}</span>
            )}
          </div>
        </section>
      )}

      {/* 8. RECORDED NON-SCHOOL GAPS & HOLIDAYS */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <CalendarOff className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              8. Recorded Non-School Days &amp; Labeled Gaps
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">Weekends auto-excluded</span>
        </div>

        {nonSchoolGaps.length === 0 ? (
          <p className="text-xs text-slate-500">
            No custom non-school gaps recorded yet. When you skip school weekdays between scans or confirm a holiday note on a register sheet, it will appear here and be excluded from attendance percentages.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {nonSchoolGaps.map((gap) => (
              <div key={gap.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="font-bold text-slate-900">{gap.label}</div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    {gap.startDate === gap.endDate
                      ? formatReadableDate(gap.startDate)
                      : `${formatReadableDate(gap.startDate)} – ${formatReadableDate(gap.endDate)}`}
                    {' · '}
                    {gap.dates.length} school {gap.dates.length === 1 ? 'day' : 'days'}
                  </div>
                </div>
                {onDeleteNonSchoolGap && (
                  <button
                    type="button"
                    onClick={() => onDeleteNonSchoolGap(gap.id)}
                    className="min-h-[38px] min-w-[38px] rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer"
                    aria-label={`Delete ${gap.label}`}
                    title="Remove non-school gap"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 9. DATABASE RESET — DELETE ALL PUPIL RECORDS (ADMIN ONLY) */}
      {canAdminResetDb && onDeleteAllPupils && (
        <section className="bg-white rounded-xl border border-rose-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-rose-100">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-700" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-rose-900">
                9. Reset Pupil Records in Database
              </h3>
            </div>
            <span className="text-[11px] font-medium text-rose-700">
              {students.length} enrolled · {classes.length} classes
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Permanently delete all pupil records (and any linked attendance sessions) from the database so you can start enrolling classes from the beginning.
          </p>

          {pupilResetMessage && (
            <div
              className={`p-3 rounded-lg text-xs flex items-start gap-2 border ${
                pupilResetMessage.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {pupilResetMessage.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700" />
              )}
              <span>{pupilResetMessage.text}</span>
            </div>
          )}

          {!confirmingPupilReset ? (
            <button
              type="button"
              onClick={() => {
                setPupilResetMessage(null);
                setResetAlsoDeleteClasses(false);
                setConfirmingPupilReset(true);
              }}
              className="min-h-[42px] px-4 py-2 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete All Pupil Records</span>
            </button>
          ) : (
            <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 space-y-3 text-xs">
              <div className="font-bold text-rose-950">
                Confirm permanent deletion of all {students.length} pupil{' '}
                {students.length === 1 ? 'record' : 'records'}
                {sessions.length > 0 ? ` and ${sessions.length} linked attendance sessions` : ''}?
              </div>

              <label className="flex items-start gap-2 cursor-pointer text-slate-800">
                <input
                  type="checkbox"
                  checked={resetAlsoDeleteClasses}
                  onChange={(e) => setResetAlsoDeleteClasses(e.target.checked)}
                  disabled={isResettingPupils}
                  className="mt-0.5 w-4 h-4 rounded text-rose-700 focus:ring-rose-500"
                />
                <span>Also delete all {classes.length} classes (start completely empty)</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isResettingPupils}
                  onClick={async () => {
                    setIsResettingPupils(true);
                    setPupilResetMessage(null);
                    try {
                      const res = await onDeleteAllPupils({ alsoDeleteClasses: resetAlsoDeleteClasses });
                      setConfirmingPupilReset(false);
                      setPupilResetMessage({
                        ok: true,
                        text:
                          res && !res.sessionsCleared
                            ? 'All pupil records have been deleted from the database! (Old attendance session logs remain until you run supabase/migrations/003_admin_delete_attendance.sql in Supabase SQL Editor.)'
                            : resetAlsoDeleteClasses
                            ? 'All pupil records, attendance sessions, and classes have been deleted from the database.'
                            : 'All pupil records (and linked attendance sessions) have been deleted from the database. Your class list is ready for fresh enrollment.'
                      });
                    } catch (err: any) {
                      setPupilResetMessage({
                        ok: false,
                        text: err?.message || 'Unable to delete pupil records from database.'
                      });
                    } finally {
                      setIsResettingPupils(false);
                    }
                  }}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isResettingPupils ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm Delete All</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={isResettingPupils}
                  onClick={() => setConfirmingPupilReset(false)}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Interactive Tutorial Launcher */}
      {onStartTutorial && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 shrink-0">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">
                Interactive App Tutorial
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Walk through setting your name, scanning your first class student roster, scanning attendance, and using interactive analytics.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onStartTutorial}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shrink-0 self-start sm:self-auto cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Launch Guided Tour</span>
          </button>
        </div>
      )}

      {/* Developer Diagnostics Switch */}
      <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 flex items-center justify-between gap-4 text-xs">
        <div>
          <div className="font-semibold text-slate-800">
            Developer Diagnostics & Test Samples
          </div>
          <p className="text-[11px] text-slate-500">
            Keep disabled during normal school administration. Enable only to inspect raw AI JSON or benchmark sample sheets.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={devDiagnosticsEnabled}
          onClick={() => {
            const next = !devDiagnosticsEnabled;
            setDevDiagnosticsEnabled(next);
            setDeveloperDiagnosticsEnabled(next);
          }}
          className={`px-3 py-1.5 rounded-md font-semibold text-xs border transition-colors shrink-0 cursor-pointer ${
            devDiagnosticsEnabled
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
          }`}
        >
          {devDiagnosticsEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {/* About Section */}
      <section
        aria-label="About Application Developer"
        className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4"
      >
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Info className="w-4 h-4 text-emerald-700" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
            About
          </h3>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          {/* Developer portrait */}
          <div
            data-developer-photo-slot="true"
            className="w-28 h-36 sm:w-32 sm:h-40 rounded-xl overflow-hidden border border-slate-200 bg-white shadow-xs shrink-0 self-center sm:self-auto"
          >
            <img
              src="/assets/aistudio/file_00000000aa2081f4b9e0cb2c2d52e45c_0bfe2c0d.png"
              alt="Onigbinde Collins Oluwasegun"
              className="w-full h-full object-cover object-top"
              loading="lazy"
            />
          </div>

          <div className="space-y-2.5 min-w-0 flex-1 text-center sm:text-left">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                Developed By
              </div>
              <h4 className="text-base sm:text-lg font-bold text-slate-900 mt-0.5">
                Onigbinde Collins Oluwasegun
              </h4>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
                NYSC Corps Member · <span className="font-mono font-semibold text-slate-800">FC/25C/2127</span> · Abuja Electricity Distribution Company
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-5 gap-y-2 pt-1 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 tabular-nums select-text">
                <Phone className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>+234 9150635213</span>
              </span>

              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 select-text">
                <Mail className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>teamcolynn@gmail.com</span>
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
