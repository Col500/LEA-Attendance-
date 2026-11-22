import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Printer,
  AlertCircle,
  Info,
  Loader2,
  RefreshCw,
  Calendar,
  ShieldCheck,
  Download,
  WifiOff
} from 'lucide-react';
import { schoolInfo } from '../data/mockData';
import {
  AttendanceSession,
  ClassItem,
  NonSchoolGapRecord,
  SchoolInfo,
  Student
} from '../types/attendance';
import { StarredPupilsCard } from '../components/StarredPupilsCard';
import { computeStarredStudentSummaries } from '../services/studentTrackingMetrics';
import { getDefaultSchoolDate } from '../services/schoolCalendarGaps';
import {
  ATTENDANCE_FORMULA_EXPLANATION,
  AttendanceReportResult,
  computeStudentAttendanceReport,
  filterAttendanceSessions
} from '../services/attendanceReports';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  fetchAttendanceReportFromSupabase,
  fetchScopedSessionsForCsvExport
} from '../services/supabaseAttendanceService';
import {
  buildAttendanceRecordsCsv,
  isMockSampleSession,
  triggerCsvDownload
} from '../services/attendanceExport';
import { isNetworkOrOfflineError, useOnlineStatus } from '../hooks/useOnlineStatus';

interface ReportsPageProps {
  sessions?: AttendanceSession[];
  classes?: ClassItem[];
  students?: Student[];
  school?: SchoolInfo;
  starredStudentIds?: string[];
  nonSchoolGaps?: NonSchoolGapRecord[];
  canWrite?: boolean;
  isSupabaseLive?: boolean;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  sessions: propSessions,
  classes: propClasses,
  students: propStudents = [],
  school,
  starredStudentIds = [],
  nonSchoolGaps = [],
  canWrite = false,
  isSupabaseLive = false
}) => {
  const activeSchool = school || schoolInfo;
  const isOnline = useOnlineStatus();
  const classesList: ClassItem[] = useMemo(() => propClasses || [], [propClasses]);

  const [selectedClassId, setSelectedClassId] = useState<string>('All');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [remoteReport, setRemoteReport] = useState<AttendanceReportResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ type: 'error' | 'info' | 'success'; message: string } | null>(null);

  const loadSupabaseReport = useCallback(async () => {
    if (!isSupabaseLive) return;
    if (!isOnline) {
      setLoadError(
        'Offline: Internet connectivity lost. Unable to query Supabase reports right now—retry once reconnected.'
      );
      return;
    }
    const client = getSupabaseClient();
    if (!client) return;

    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await fetchAttendanceReportFromSupabase(client, {
        classId: selectedClassId,
        startDate,
        endDate,
        classes: classesList
      });
      setRemoteReport(result);
    } catch (err: any) {
      setLoadError(
        isNetworkOrOfflineError(err)
          ? 'Network connection lost while loading attendance report. Check connectivity and tap Retry.'
          : err?.message || 'Unable to load attendance report from Supabase.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [isSupabaseLive, isOnline, selectedClassId, startDate, endDate, classesList]);

  useEffect(() => {
    if (isSupabaseLive) {
      void loadSupabaseReport();
    } else {
      setRemoteReport(null);
      setLoadError(null);
    }
  }, [isSupabaseLive, loadSupabaseReport]);

  const localReport = useMemo<AttendanceReportResult>(() => {
    const sourceSessions = propSessions || [];
    return computeStudentAttendanceReport({
      sessions: sourceSessions,
      students: propStudents,
      classes: classesList,
      classId: selectedClassId,
      startDate,
      endDate
    });
  }, [propSessions, propStudents, classesList, selectedClassId, startDate, endDate]);

  const report = isSupabaseLive && remoteReport ? remoteReport : localReport;

  const starredSummaries = useMemo(
    () =>
      computeStarredStudentSummaries({
        students: propStudents,
        classes: classesList,
        sessions: propSessions || [],
        starredIds: starredStudentIds,
        targetDate: getDefaultSchoolDate(),
        nonSchoolGaps,
        filterClassId: selectedClassId === 'All' ? undefined : selectedClassId
      }),
    [propStudents, classesList, propSessions, starredStudentIds, nonSchoolGaps, selectedClassId]
  );

  const selectedClassName = useMemo(() => {
    if (selectedClassId === 'All') return 'All Classes';
    return classesList.find((c) => c.id === selectedClassId)?.name || 'Selected Class';
  }, [selectedClassId, classesList]);

  const reportingPeriodLabel = useMemo(() => {
    if (startDate && endDate) return `${startDate} to ${endDate}`;
    if (startDate) return `From ${startDate}`;
    if (endDate) return `Up to ${endDate}`;
    return `All Recorded Dates (${activeSchool.currentTerm}, ${activeSchool.academicSession})`;
  }, [startDate, endDate, activeSchool]);

  const generatedTimestampLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date()),
    []
  );

  const containsMockDemoSessions = useMemo(() => {
    if (isSupabaseLive) return false;
    const sourceSessions = propSessions || [];
    return sourceSessions.some((s) => isMockSampleSession(s));
  }, [isSupabaseLive, propSessions]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = async () => {
    setExportNotice(null);
    if (!canWrite) {
      setExportNotice({
        type: 'error',
        message: 'Read-only access: Only an authorized School Admin can export official CSV files.'
      });
      return;
    }

    if (isSupabaseLive && !isOnline) {
      setExportNotice({
        type: 'error',
        message:
          'You are currently offline. CSV export requires connectivity to fetch confirmed attendance records from Supabase.'
      });
      return;
    }

    setIsExportingCsv(true);
    try {
      let exportSessions: AttendanceSession[] = [];
      if (isSupabaseLive) {
        const client = getSupabaseClient();
        if (!client) {
          throw new Error('Supabase client is unavailable.');
        }
        exportSessions = await fetchScopedSessionsForCsvExport(client, {
          classId: selectedClassId,
          startDate,
          endDate,
          confirmedOnly: true
        });
      } else {
        exportSessions = filterAttendanceSessions(
          propSessions || [],
          {
            classId: selectedClassId,
            startDate,
            endDate,
            status: 'Confirmed'
          },
          classesList
        );
      }

      const result = buildAttendanceRecordsCsv({
        sessions: exportSessions,
        classes: classesList,
        students: propStudents,
        canWrite,
        confirmedOnly: true
      });

      if (result.rowCount === 0) {
        setExportNotice({
          type: 'info',
          message:
            result.excludedMockCount > 0
              ? 'No official attendance records to export: built-in mock/sample records are excluded from official CSV exports. Confirm a scanned or real session first.'
              : 'No confirmed official attendance records match the current class and date filters.'
        });
        return;
      }

      const safeSlug = selectedClassName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const dateSlug = new Date().toISOString().slice(0, 10);
      triggerCsvDownload(result.csvContent, `lea-attendance-${safeSlug}-${dateSlug}.csv`);

      setExportNotice({
        type: 'success',
        message: `Exported ${result.rowCount} official record row(s) across ${result.exportedSessionCount} confirmed session(s).${
          result.excludedMockCount > 0
            ? ` (${result.excludedMockCount} mock sample session(s) excluded.)`
            : ''
        }`
      });
    } catch (err: any) {
      setExportNotice({
        type: 'error',
        message: isNetworkOrOfflineError(err)
          ? 'Network connection lost while preparing CSV export. Reconnect and retry.'
          : err?.message || 'Unable to export attendance records to CSV.'
      });
    } finally {
      setIsExportingCsv(false);
    }
  };

  const clearFilters = () => {
    setSelectedClassId('All');
    setStartDate('');
    setEndDate('');
    setExportNotice(null);
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Official Print-Only Report Header */}
      <div className="hidden print:block border-b-2 border-slate-900 pb-4 mb-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            {[activeSchool.lga, activeSchool.state ? `${activeSchool.state} State` : '']
              .filter(Boolean)
              .join(' · ') && (
              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-600">
                {[activeSchool.lga, activeSchool.state ? `${activeSchool.state} State` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
            <h1 className="text-xl font-bold text-slate-950">
              {activeSchool.name}
              {[activeSchool.subLocation, activeSchool.zone].filter(Boolean).length > 0
                ? ` (${[activeSchool.subLocation, activeSchool.zone].filter(Boolean).join(', ')})`
                : ''}
            </h1>
            <p className="text-xs text-slate-700 font-medium">
              Official Confirmed Student Attendance Summary Report
            </p>
          </div>
          <div className="text-right text-xs text-slate-700">
            <div>
              <strong>Generated:</strong> {generatedTimestampLabel}
            </div>
            <div>
              <strong>Session:</strong> {activeSchool.academicSession}
            </div>
            <div>
              <strong>Term:</strong> {activeSchool.currentTerm}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-300 text-xs text-slate-800">
          <div>
            <span className="text-slate-500">Class Scope:</span>{' '}
            <strong>{selectedClassName}</strong>
          </div>
          <div>
            <span className="text-slate-500">Reporting Period:</span>{' '}
            <strong>{reportingPeriodLabel}</strong>
          </div>
          <div>
            <span className="text-slate-500">Confirmed Sessions:</span>{' '}
            <strong>{report.confirmedSessionCount}</strong>
          </div>
        </div>

        {containsMockDemoSessions && (
          <div className="text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded">
            Demonstration Mode Notice: Sample mock sessions are shown for layout preview and are excluded from official CSV exports.
          </div>
        )}
      </div>

      {/* Offline Connectivity Warning (Only shown when offline) */}
      {!isOnline && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3.5 flex items-center justify-between gap-3 text-xs text-amber-950 print:hidden">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong>Network Connectivity Lost:</strong> Live report refresh and CSV export are paused while offline. Full offline mode is not supported—retry once reconnected.
            </span>
          </div>
        </div>
      )}

      {/* Page Title & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-800">
            <BarChart3 className="w-4 h-4" />
            <span>Official Confirmed Attendance Reports</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
            Attendance Reports
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Student-level attendance totals computed strictly from Confirmed register sessions for {activeSchool.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {isSupabaseLive && (
            <button
              type="button"
              disabled={isLoading || !isOnline}
              onClick={() => void loadSupabaseReport()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              disabled={isExportingCsv || (isSupabaseLive && !isOnline)}
              onClick={() => void handleExportCsv()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-700 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isExportingCsv ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>{isExportingCsv ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-xs cursor-pointer"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {/* Export Status / Authorization / Empty Feedback */}
      {exportNotice && (
        <div
          className={`rounded-lg border p-3.5 text-xs flex items-center justify-between gap-3 print:hidden ${
            exportNotice.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : exportNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <span>{exportNotice.message}</span>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            className="font-semibold hover:underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* On-Screen Report Metadata Strip (Visible on screen & clean in print) */}
      <div className="bg-white rounded-lg border border-slate-200 p-3.5 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            School: <strong className="text-slate-900">{activeSchool.name}</strong>
          </span>
          <span>
            Class: <strong className="text-slate-900">{selectedClassName}</strong>
          </span>
          <span>
            Period: <strong className="text-slate-900">{reportingPeriodLabel}</strong>
          </span>
        </div>
        <span className="text-slate-500">Generated: {generatedTimestampLabel}</span>
      </div>

      {/* Filter Bar: Class + Start Date + End Date */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-3 print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Class
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="All">All Classes</option>
              {classesList.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            <span>
              {isSupabaseLive
                ? 'Scoped live query: Confirmed sessions and selected class records only'
                : 'Local session mode: Confirmed sessions and selected class records only'}
            </span>
          </div>
          {(selectedClassId !== 'All' || startDate || endDate) && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-emerald-700 hover:underline font-semibold cursor-pointer"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Explicit Formula & Exclusion Notice */}
      <div className="bg-slate-50 rounded-lg border border-slate-200 p-3.5 text-xs text-slate-700 flex items-start gap-2.5 print:bg-white">
        <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5 print:hidden" />
        <div className="space-y-1">
          <p className="leading-relaxed">
            <strong className="text-slate-900">How Attendance % is Calculated:</strong>{' '}
            {ATTENDANCE_FORMULA_EXPLANATION}
          </p>
          {report.excludedUnconfirmedCount > 0 && (
            <p className="text-amber-800 font-medium">
              Note: {report.excludedUnconfirmedCount} unconfirmed (Draft, Flagged, or Failed) session
              {report.excludedUnconfirmedCount === 1 ? ' was' : 's were'} found in this range and automatically excluded from official totals.
            </p>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 flex items-center justify-center gap-2 text-xs sm:text-sm text-slate-600 print:hidden">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
          <span>Generating confirmed attendance report from Supabase...</span>
        </div>
      )}

      {/* Error State */}
      {loadError && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-900 print:hidden">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            disabled={!isOnline}
            onClick={() => void loadSupabaseReport()}
            className="px-3 py-1.5 rounded bg-white border border-rose-300 text-rose-800 font-semibold hover:bg-rose-100 cursor-pointer disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {/* Report Summary Totals */}
      {!isLoading && !loadError && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-3.5 shadow-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
                Confirmed Sessions
              </span>
              <span className="text-2xl font-bold text-slate-900 mt-1 block">
                {report.confirmedSessionCount}
              </span>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-3.5 shadow-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800 block">
                Present Marks
              </span>
              <span className="text-2xl font-bold text-emerald-700 mt-1 block">
                {report.totalPresent}
              </span>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-3.5 shadow-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-800 block">
                Absent Marks
              </span>
              <span className="text-2xl font-bold text-rose-700 mt-1 block">
                {report.totalAbsent}
              </span>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-3.5 shadow-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 block">
                Blank / Unrecorded
              </span>
              <span className="text-2xl font-bold text-slate-800 mt-1 block">
                {report.totalBlank}
              </span>
              {report.totalUncertain > 0 && (
                <span className="text-[11px] text-amber-800 block mt-0.5">
                  +{report.totalUncertain} Uncertain (excluded)
                </span>
              )}
            </div>

            <div className="col-span-2 sm:col-span-1 bg-white rounded-lg border border-slate-200 p-3.5 shadow-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
                Attendance Rate
              </span>
              <span className="text-2xl font-bold text-emerald-700 mt-1 block">
                {report.overallPercentage !== null ? `${report.overallPercentage}%` : 'N/A'}
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                {report.totalPresent + report.totalAbsent > 0
                  ? `${report.totalPresent} / ${report.totalPresent + report.totalAbsent} marks`
                  : 'No definitive marks'}
              </span>
            </div>
          </div>

          {/* Starred Pupils Summary (Direct Register Only — Numbers & Percentages Only) */}
          {starredSummaries.length > 0 && (
            <StarredPupilsCard
              summaries={starredSummaries}
              title="Starred Pupils Summary"
              subtitle="Computed strictly from confirmed direct register sessions (non-school days & summary scans excluded)"
              compact
            />
          )}

          {/* Empty State or Student-Level Table */}
          {report.confirmedSessionCount === 0 && report.studentRows.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-200 p-8 text-center space-y-2">
              <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="text-sm font-bold text-slate-800">
                No Confirmed Attendance Records in Selected Range
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Only confirmed sessions contribute to official student attendance reports. Adjust the class or date range, or confirm pending sessions under Attendance Records.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    Student-Level Attendance Totals
                  </h3>
                  <p className="text-xs text-slate-500">
                    {report.studentRows.length} student{report.studentRows.length === 1 ? '' : 's'} shown
                    {report.unmappedRecordCount > 0 &&
                      ` · ${report.unmappedRecordCount} unmapped row record(s) excluded from student totals`}
                  </p>
                </div>
              </div>

              {report.studentRows.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Confirmed sessions exist in this range, but they contain only summary counts without individual student attendance records.
                </div>
              ) : (
                <>
                  {/* Mobile Student Cards */}
                  <div className="md:hidden print:hidden divide-y divide-slate-100">
                    {report.studentRows.map((row) => (
                      <div key={row.studentId} className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-900 text-sm">
                              {row.studentNumber > 0 ? `#${row.studentNumber} · ` : ''}
                              {row.studentName}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.className} · {row.totalSessions} confirmed session
                              {row.totalSessions === 1 ? '' : 's'}
                            </div>
                          </div>
                          <span className="text-sm font-bold text-emerald-700">
                            {row.attendancePercentage !== null ? `${row.attendancePercentage}%` : 'N/A'}
                          </span>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div className="p-1.5 rounded bg-emerald-50 text-emerald-900">
                            <div className="font-bold">{row.presentCount}</div>
                            <div className="text-[10px]">Present</div>
                          </div>
                          <div className="p-1.5 rounded bg-rose-50 text-rose-900">
                            <div className="font-bold">{row.absentCount}</div>
                            <div className="text-[10px]">Absent</div>
                          </div>
                          <div className="p-1.5 rounded bg-slate-100 text-slate-800">
                            <div className="font-bold">{row.blankCount}</div>
                            <div className="text-[10px]">Blank</div>
                          </div>
                          <div className="p-1.5 rounded bg-amber-50 text-amber-900">
                            <div className="font-bold">{row.uncertainCount}</div>
                            <div className="text-[10px]">Uncertain</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop & Print Table */}
                  <div className="hidden md:block print:block overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                        <tr>
                          <th scope="col" className="py-3 px-4 w-14 text-center">S/N</th>
                          <th scope="col" className="py-3 px-4">Student Name</th>
                          <th scope="col" className="py-3 px-4">Class</th>
                          <th scope="col" className="py-3 px-4 text-center">Sessions</th>
                          <th scope="col" className="py-3 px-4 text-center">Present</th>
                          <th scope="col" className="py-3 px-4 text-center">Absent</th>
                          <th scope="col" className="py-3 px-4 text-center">Blank / Unrecorded</th>
                          <th scope="col" className="py-3 px-4 text-center">Uncertain (Excl.)</th>
                          <th scope="col" className="py-3 px-4 text-right">Attendance %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {report.studentRows.map((row) => (
                          <tr key={row.studentId} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 text-center font-mono text-slate-500">
                              {row.studentNumber > 0 ? row.studentNumber : '—'}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {row.studentName}
                            </td>
                            <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                              {row.className}
                            </td>
                            <td className="py-3 px-4 text-center font-medium">
                              {row.totalSessions}
                            </td>
                            <td className="py-3 px-4 text-center font-bold text-emerald-700">
                              {row.presentCount}
                            </td>
                            <td className="py-3 px-4 text-center font-bold text-rose-700">
                              {row.absentCount}
                            </td>
                            <td className="py-3 px-4 text-center font-medium text-slate-700">
                              {row.blankCount}
                            </td>
                            <td className="py-3 px-4 text-center text-amber-800">
                              {row.uncertainCount > 0 ? row.uncertainCount : '0'}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-900 whitespace-nowrap">
                              {row.attendancePercentage !== null ? `${row.attendancePercentage}%` : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
