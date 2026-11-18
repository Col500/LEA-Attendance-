import React from 'react';
import { Menu, School, Calendar, MapPin, LogIn, LogOut } from 'lucide-react';
import { SchoolInfo, StaffProfile } from '../types/attendance';

interface HeaderProps {
  onToggleMobileMenu: () => void;
  activeTabName: string;
  school: SchoolInfo;
  persistenceMode?: 'local-demo' | 'supabase-live' | 'supabase-needs-auth';
  staffProfile?: StaffProfile | null;
  onOpenSignIn?: () => void;
  onSignOut?: () => void | Promise<void>;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileMenu,
  activeTabName,
  school,
  persistenceMode = 'local-demo',
  staffProfile,
  onOpenSignIn,
  onSignOut
}) => {
  // Format current date nicely
  const formattedToday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date());

  return (
    <header className="sticky top-0 z-30 bg-slate-900 text-white shadow-sm border-b border-slate-800 print:hidden">
      <div className="px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Mobile Menu button + Brand titles */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="md:hidden inline-flex items-center justify-center p-2 -ml-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="hidden sm:flex w-10 h-10 rounded-lg bg-emerald-700 text-white items-center justify-center font-bold text-lg shrink-0 border border-emerald-600/50">
              <School className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <h1 className="text-sm sm:text-lg font-bold text-white tracking-tight truncate">
                  LEA Attendance Assistant
                </h1>
                {school.state && (
                  <span className="hidden lg:inline text-xs font-medium text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60 shrink-0">
                    {school.state}
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-300 truncate flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">
                  {[school.name, school.subLocation, school.zone, school.city]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Right: Sign-in shortcut + Academic session & date metadata */}
        <div className="flex items-center gap-3 shrink-0 text-right">
          {persistenceMode === 'supabase-needs-auth' && onOpenSignIn && (
            <button
              type="button"
              onClick={onOpenSignIn}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Staff Sign In</span>
            </button>
          )}

          {persistenceMode === 'supabase-live' && staffProfile && onSignOut && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/70 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}

          <div className="hidden md:flex flex-col items-end text-xs text-slate-300">
            <div className="flex items-center gap-1.5 text-slate-200 font-medium">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
              <span>{formattedToday}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              <span>{school.currentTerm}</span>
              <span className="mx-1 text-slate-600">·</span>
              <span>{school.academicSession}</span>
            </div>
          </div>

          <div className="md:hidden text-xs text-slate-300 font-medium">
            <span className="text-emerald-400">{activeTabName}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

