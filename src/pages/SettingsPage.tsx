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
  EyeOff
} from 'lucide-react';
import { SchoolInfo, StaffProfile } from '../types/attendance';
import { initialSchoolInfo } from '../data/mockData';
import {
  isDeveloperDiagnosticsEnabled,
  setDeveloperDiagnosticsEnabled
} from '../services/rosterStorage';
import { getSupabaseClient, getSupabaseConfigStatus } from '../lib/supabaseClient';
import { getRoleDisplayLabel, resolveLoginIdentifier } from '../lib/authRoles';
import type { SeedMigrationResult } from '../services/supabaseAttendanceService';

interface SettingsPageProps {
  currentSchool: SchoolInfo;
  onUpdateSchool: (updatedSchool: SchoolInfo) => void;
  persistenceMode?: 'local-demo' | 'supabase-live' | 'supabase-needs-auth';
  staffProfile?: StaffProfile | null;
  onAuthChanged?: () => void | Promise<void>;
  onSignOut?: () => void | Promise<void>;
  onSeedLocalRoster?: () => Promise<SeedMigrationResult>;
  highlightedTarget?: string | null;
  focusProfileSignal?: number;
  onStartTutorial?: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  currentSchool,
  onUpdateSchool,
  persistenceMode = 'local-demo',
  staffProfile,
  onAuthChanged,
  onSignOut,
  onSeedLocalRoster,
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
      const { error } = await client.auth.signInWithPassword({
        email: emailToUse,
        password: authPassword
      });
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    // Basic Validation
    if (!formData.name.trim()) {
      setValidationError('School Name is required.');
      return;
    }
    if (!formData.administratorName.trim()) {
      setValidationError('Records Administrator name is required.');
      return;
    }

    onUpdateSchool(formData);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
    }, 3500);
  };

  const handleResetToDefault = () => {
    if (window.confirm('Reset all school profile settings to empty defaults?')) {
      setFormData(initialSchoolInfo);
      onUpdateSchool(initialSchoolInfo);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    }
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

        <button
          type="button"
          onClick={handleResetToDefault}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-xs transition-colors self-start sm:self-auto"
          title="Reset to default school parameters"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
          <span>Reset Defaults</span>
        </button>
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
              <input
                type="text"
                value={formData.administratorName}
                onChange={(e) => handleChange('administratorName', e.target.value)}
                placeholder="e.g. Name of Records Administrator"
                className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
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
          {/* Reserved portrait space for developer picture */}
          <div
            data-developer-photo-slot="true"
            aria-label="Developer photograph placeholder"
            className="w-28 h-32 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-center p-2 shrink-0"
          >
            <div className="w-11 h-11 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center mb-1.5">
              <User className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 leading-tight">
              Developer Photo
            </span>
          </div>

          <div className="space-y-2.5 min-w-0 flex-1">
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

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs">
              <a
                href="tel:+2349150635213"
                className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-emerald-700 tabular-nums"
              >
                <Phone className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>+234 9150635213</span>
              </a>

              <a
                href="mailto:teamcolynn@gmail.com"
                className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-emerald-700"
              >
                <Mail className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>teamcolynn@gmail.com</span>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
