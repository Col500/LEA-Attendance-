import React from 'react';
import { BellRing, CheckCircle2, Volume2 } from 'lucide-react';

interface HeadmistressAlertBannerProps {
  visible: boolean;
  isReminder: boolean;
  totalClasses: number;
  dateLabel: string;
  onInspectAttendance: () => void;
  onMarkAttended: () => void;
  onReplayChime: () => void;
}

export const HeadmistressAlertBanner: React.FC<HeadmistressAlertBannerProps> = ({
  visible,
  isReminder,
  totalClasses,
  dateLabel,
  onInspectAttendance,
  onMarkAttended,
  onReplayChime
}) => {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-emerald-800 text-white border-b border-emerald-700 px-3 py-3 sm:px-6 print:hidden"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-emerald-700 text-emerald-100 flex items-center justify-center shrink-0">
            <BellRing className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-bold leading-snug">
              {isReminder
                ? `1:00 PM Reminder — All ${totalClasses} classes have been scanned for ${dateLabel}`
                : `All ${totalClasses} classes have been scanned for ${dateLabel}`}
            </div>
            <p className="text-xs text-emerald-100 mt-0.5">
              {isReminder
                ? 'Tap below to inspect today’s attendance summary and mark this notification as reviewed.'
                : 'Attendance records are ready for the Headmistress to review.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onReplayChime}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-900 text-emerald-100 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            title="Play Chime"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Chime</span>
          </button>

          <button
            type="button"
            onClick={onInspectAttendance}
            className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-white text-emerald-900 hover:bg-emerald-50 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Check Today’s Attendance</span>
          </button>

          <button
            type="button"
            onClick={onMarkAttended}
            className="min-h-[40px] px-3 py-1.5 rounded-lg border border-emerald-500/70 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
