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
    <header
      className="sticky top-0 z-30 shadow-sm border-b print:hidden transition-colors duration-150"
      style={{
        backgroundColor: 'var(--app-header-bg)',
        borderColor: 'var(--app-header-border)',
        color: 'var(--app-header-text)'
      }}
    >
      <div className="px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Mobile Menu button + Brand titles */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="md:hidden inline-flex items-center justify-center p-2 -ml-1 rounded-lg hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-emerald-500 shrink-0 cursor-pointer"
            style={{ color: 'var(--app-header-subtext)' }}
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="hidden sm:flex w-10 h-10 rounded-lg text-white items-center justify-center font-bold text-lg shrink-0"
              style={{ backgroundColor: 'var(--app-accent)' }}
            >
              <School className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <h1
                  className="text-sm sm:text-lg font-bold tracking-tight truncate"
                  style={{ color: 'var(--app-header-text)' }}
                >
                  LEA Attendance Assistant
                </h1>
                {school.state && (
                  <span
                    className="hidden lg:inline text-xs font-medium shrink-0"
                    style={{ color: 'var(--app-header-accent)' }}
                  >
                    · {school.state}
                  </span>
                )}
              </div>
              <p
                className="text-[11px] sm:text-xs truncate flex items-center gap-1 mt-0.5"
                style={{ color: 'var(--app-header-subtext)' }}
              >
                <MapPin
                  className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0"
                  style={{ color: 'var(--app-header-accent)' }}
                />
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-bold shadow-xs cursor-pointer"
              style={{ backgroundColor: 'var(--app-accent)' }}
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
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-85 cursor-pointer"
                style={{
                  borderColor: 'var(--app-header-border)',
                  color: 'var(--app-header-text)'
                }}
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}

          <div
            className="hidden md:flex flex-col items-end text-xs"
            style={{ color: 'var(--app-header-subtext)' }}
          >
            <div
              className="flex items-center gap-1.5 font-medium"
              style={{ color: 'var(--app-header-text)' }}
            >
              <Calendar
                className="w-3.5 h-3.5"
                style={{ color: 'var(--app-header-accent)' }}
              />
              <span>{formattedToday}</span>
            </div>
            <div className="text-[11px] mt-0.5 opacity-80">
              <span>{school.currentTerm}</span>
              <span className="mx-1">·</span>
              <span>{school.academicSession}</span>
            </div>
          </div>

          <div className="md:hidden text-xs font-semibold">
            <span style={{ color: 'var(--app-header-accent)' }}>{activeTabName}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

