import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { StaffProfile } from '../types/attendance';

interface SampleDataBannerProps {
  persistenceMode?: 'local-demo' | 'supabase-live' | 'supabase-needs-auth';
  staffProfile?: StaffProfile | null;
  onNavigateToSettings?: () => void;
}

export const SampleDataBanner: React.FC<SampleDataBannerProps> = ({
  persistenceMode = 'local-demo',
  onNavigateToSettings
}) => {
  const [expanded, setExpanded] = useState(false);

  if (persistenceMode === 'supabase-live') {
    return null;
  }

  if (persistenceMode === 'supabase-needs-auth') {
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 sm:px-6 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 max-w-7xl mx-auto text-xs text-blue-950">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-blue-700 shrink-0" />
            <span>
              <strong className="uppercase tracking-wide mr-1.5">Supabase Configured · Sign In Required:</strong>
              Row Level Security protects student records from anonymous access. Currently showing local demonstration data.
            </span>
          </div>
          {onNavigateToSettings && (
            <button
              type="button"
              onClick={onNavigateToSettings}
              className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white font-semibold text-[11px] cursor-pointer"
            >
              Sign In Now
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200/80 px-4 py-2.5 sm:px-6 print:hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 max-w-7xl mx-auto">
        <div className="flex items-start sm:items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 sm:mt-0" />
          <div className="text-xs text-amber-900 leading-snug">
            <span className="font-bold uppercase tracking-wide text-amber-800 mr-1.5">
              Demonstration Mode:
            </span>
            <span>
              All student profiles and register attendance statistics are local browser demonstration records (Supabase env not configured).
            </span>
            {expanded && (
              <span className="block mt-1 text-amber-800 text-[11px]">
                Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to persist classes, students, and confirmed attendance sessions to PostgreSQL without losing local data.
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="self-start sm:self-center text-[11px] font-semibold text-amber-800 hover:text-amber-950 flex items-center gap-1 focus:outline-none cursor-pointer"
        >
          <span>{expanded ? 'Less info' : 'Learn more'}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
