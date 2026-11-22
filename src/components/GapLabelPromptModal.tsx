import React, { useState, useEffect } from 'react';
import { CalendarOff, X, CheckCircle2 } from 'lucide-react';
import { DetectedWeekdayGap, formatReadableDate } from '../services/schoolCalendarGaps';

interface GapLabelPromptModalProps {
  gap: DetectedWeekdayGap | null;
  onSaveLabel: (label: string) => void;
  onSkip: () => void;
}

export const GapLabelPromptModal: React.FC<GapLabelPromptModalProps> = ({
  gap,
  onSaveLabel,
  onSkip
}) => {
  const [typedLabel, setTypedLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTypedLabel('');
    setError(null);
  }, [gap?.startDate, gap?.endDate]);

  if (!gap) return null;

  const isSingleDay = gap.startDate === gap.endDate;
  const dateRangePhrase = isSingleDay
    ? formatReadableDate(gap.startDate)
    : `${formatReadableDate(gap.startDate)} to ${formatReadableDate(gap.endDate)}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = typedLabel.trim();
    if (!trimmed) {
      setError('Please type a label for this non-school period (for example: Strike, Mid-Term Break, or Public Holiday).');
      return;
    }
    onSaveLabel(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gap-label-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <CalendarOff className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="gap-label-modal-title"
                className="text-sm font-bold text-slate-900 dark:text-slate-100"
              >
                Unrecorded School Days Detected
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {gap.missingWeekdays.length}{' '}
                {gap.missingWeekdays.length === 1 ? 'school weekday' : 'school weekdays'} (weekends excluded)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Close gap prompt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2 tabular-nums">
            <span>
              Last recorded:{' '}
              <strong className="text-slate-900 dark:text-white">
                {formatReadableDate(gap.previousRecordedDate)}
              </strong>
            </span>
            <span>
              Scanning for:{' '}
              <strong className="text-slate-900 dark:text-white">
                {formatReadableDate(gap.targetDate)}
              </strong>
            </span>
          </div>

          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            {isSingleDay ? (
              <>
                There was no attendance scanned on{' '}
                <span className="font-semibold text-slate-900 dark:text-white">{dateRangePhrase}</span>.
                What would you like to label this skipped school day?
              </>
            ) : (
              <>
                There was no attendance scanned from{' '}
                <span className="font-semibold text-slate-900 dark:text-white">{dateRangePhrase}</span>.
                What would you like to label the gap?
              </>
            )}
          </p>

          <div className="space-y-1.5">
            <label
              htmlFor="gap-label-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Gap Label (Non-School Reason)
            </label>
            <input
              id="gap-label-input"
              type="text"
              autoFocus
              value={typedLabel}
              onChange={(e) => {
                setTypedLabel(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Type reason (e.g. Strike, Mid-Term Break, Public Holiday)"
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {error && (
              <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Saturdays and Sundays are automatically excluded. Saving this label records these dates as non-school days so attendance percentages stay accurate.
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onSkip}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Skip for Now
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Save Gap Label</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
