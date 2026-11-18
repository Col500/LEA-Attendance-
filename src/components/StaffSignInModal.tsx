import React, { useState } from 'react';
import { Lock, LogIn, X, CheckCircle2, AlertCircle, Loader2, ShieldCheck, School } from 'lucide-react';
import { getSupabaseClient, getSupabaseConfigStatus } from '../lib/supabaseClient';
import { resolveLoginIdentifier } from '../lib/authRoles';

interface StaffSignInModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onAuthChanged?: () => void | Promise<void>;
  schoolName: string;
  /** When true, locks the screen behind authentication (no dismiss/demo bypass). */
  isProtectedGate?: boolean;
  sessionNotice?: string | null;
}

export const StaffSignInModal: React.FC<StaffSignInModalProps> = ({
  isOpen,
  onClose,
  onAuthChanged,
  schoolName,
  isProtectedGate = false,
  sessionNotice
}) => {
  const supabaseStatus = getSupabaseConfigStatus();
  const [identifier, setIdentifier] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client) {
      setMessage({
        ok: false,
        text: 'Authentication service is unavailable. Refresh the page and try again.'
      });
      return;
    }

    const emailToUse = resolveLoginIdentifier(identifier);
    if (!emailToUse || !authPassword.trim()) {
      setMessage({ ok: false, text: 'Enter both your username (or email) and password.' });
      return;
    }

    setIsBusy(true);
    setMessage(null);
    try {
      const { error } = await client.auth.signInWithPassword({
        email: emailToUse,
        password: authPassword
      });
      if (error) {
        const lower = (error.message || '').toLowerCase();
        if (lower.includes('invalid login credentials')) {
          throw new Error('Incorrect username/email or password. Please verify your credentials.');
        }
        throw error;
      }

      setMessage({ ok: true, text: 'Signed in. Loading school portal...' });
      if (onAuthChanged) {
        await onAuthChanged();
      }
      setAuthPassword('');
      if (!isProtectedGate && onClose) {
        onClose();
      }
    } catch (err: any) {
      setMessage({
        ok: false,
        text: err?.message || 'Sign in failed. Please check your username and password.'
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
        isProtectedGate ? 'bg-slate-900' : 'bg-slate-950/65 backdrop-blur-xs'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-signin-modal-title"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
              {isProtectedGate ? (
                <School className="w-5 h-5 text-white" />
              ) : (
                <Lock className="w-4 h-4 text-white" />
              )}
            </div>
            <div className="min-w-0">
              <h2 id="staff-signin-modal-title" className="text-sm font-bold truncate">
                LEA Attendance Portal · Sign In
              </h2>
              <p className="text-[11px] text-slate-300 truncate">{schoolName}</p>
            </div>
          </div>

          {!isProtectedGate && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
              aria-label="Close sign in window"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {sessionNotice && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>{sessionNotice}</span>
            </div>
          )}

          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-950">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="leading-relaxed">
                Sign in with your assigned role username or email.
              </p>
              <p className="text-[11px] text-emerald-800">
                Role logins: <strong>admin</strong> (Read & Write), <strong>headteacher</strong> (Read-Only), <strong>inspector</strong> (Read-Only).
              </p>
            </div>
          </div>

          {!supabaseStatus.configured ? (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              Database configuration was not detected yet. Refresh the browser page once.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Username or Email
                </label>
                <input
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin, headteacher, inspector, or email"
                  required
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Enter your assigned password"
                  required
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {message && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                    message.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  {message.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{message.text}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isBusy}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </form>
          )}

          <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 text-center">
            Public registration is disabled. New staff logins are provisioned only by the administrator.
          </div>
        </div>
      </div>
    </div>
  );
};
