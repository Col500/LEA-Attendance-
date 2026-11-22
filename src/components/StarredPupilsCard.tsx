import React from 'react';
import { Star, CheckCircle2, XCircle, CalendarOff, Info } from 'lucide-react';
import { StarredStudentSummary } from '../services/studentTrackingMetrics';

interface StarredPupilsCardProps {
  summaries: StarredStudentSummary[];
  title?: string;
  subtitle?: string;
  compact?: boolean;
  onUnstar?: (studentId: string) => void;
  onManageStudents?: () => void;
}

export const StarredPupilsCard: React.FC<StarredPupilsCardProps> = ({
  summaries,
  title = 'Starred Pupils',
  subtitle = 'Direct register scan metrics only (summary note scans excluded)',
  compact = false,
  onUnstar,
  onManageStudents
}) => {
  if (summaries.length === 0) {
    if (compact) return null;
    return (
      <section className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
              <span>{title}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Star any pupil in the Students directory to see their live daily status and attendance ratio here after direct register scans.
            </p>
          </div>
          {onManageStudents && (
            <button
              type="button"
              onClick={onManageStudents}
              className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              Open Students
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3.5 sm:px-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500 fill-amber-400 shrink-0" />
            <span>{title}</span>
            <span className="text-xs font-normal text-slate-500 tabular-nums">
              · {summaries.length} tracked
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        {onManageStudents && (
          <button
            type="button"
            onClick={onManageStudents}
            className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            Manage Stars
          </button>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {summaries.map((item) => {
          const isPresent = item.todayStatus === 'PRESENT';
          const isAbsent = item.todayStatus === 'ABSENT';
          const isNonSchool = item.todayStatus === 'NON_SCHOOL_DAY';

          return (
            <div
              key={item.studentId}
              className="px-4 py-3 sm:px-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
            >
              <div className="min-w-0 flex items-start gap-2.5">
                <div className="mt-0.5 shrink-0">
                  {isPresent ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : isAbsent ? (
                    <XCircle className="w-4 h-4 text-rose-600" />
                  ) : isNonSchool ? (
                    <CalendarOff className="w-4 h-4 text-amber-600" />
                  ) : (
                    <Info className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 leading-snug">
                    {isPresent || isAbsent ? (
                      <span>
                        {item.studentName}{' '}
                        <span className={isPresent ? 'text-emerald-700' : 'text-rose-700'}>
                          is {isPresent ? 'Present' : 'Absent'} today
                        </span>
                      </span>
                    ) : (
                      <span>{item.studentName}</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{item.className}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">Row #{item.studentNumber}</span>
                    {!isPresent && !isAbsent && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{item.todayStatusLabel}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 pl-6 sm:pl-0 shrink-0">
                <div className="text-left sm:text-right">
                  <div className="text-xs sm:text-sm font-bold text-slate-900 tabular-nums font-mono">
                    {item.totalRecordedDays > 0 && item.attendancePercentage !== null
                      ? `Present ${item.presentDays}/${item.totalRecordedDays} days (${item.attendancePercentage.toFixed(1)}%)`
                      : '0/0 register days'}
                  </div>
                  {item.totalRecordedDays > 0 && (
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      Absent {item.absentDays} {item.absentDays === 1 ? 'day' : 'days'}
                    </div>
                  )}
                </div>

                {onUnstar && (
                  <button
                    type="button"
                    onClick={() => onUnstar(item.studentId)}
                    className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-amber-500 hover:bg-amber-50 cursor-pointer"
                    title={`Unstar ${item.studentName}`}
                    aria-label={`Unstar ${item.studentName}`}
                  >
                    <Star className="w-4 h-4 fill-amber-400" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
