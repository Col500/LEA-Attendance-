import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Check,
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
  FileEdit,
  XCircle,
  Calendar,
  HelpCircle,
  Download,
  WifiOff
} from 'lucide-react';
import { AttendanceSession, ClassItem, ReviewStatus } from '../types/attendance';
import {
  calculateAttendancePercentage,
  filterAttendanceSessions
} from '../services/attendanceReports';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  confirmExistingSessionInSupabase,
  fetchAttendanceSessionsFiltered,
  fetchScopedSessionsForCsvExport,
  fetchSessionDetailFromSupabase
} from '../services/supabaseAttendanceService';
import {
  buildAttendanceRecordsCsv,
  triggerCsvDownload
} from '../services/attendanceExport';
import { isNetworkOrOfflineError, useOnlineStatus } from '../hooks/useOnlineStatus';

interface AttendanceRecordsPageProps {
  sessions?: AttendanceSession[];
  classes?: ClassItem[];
  isSupabaseLive?: boolean;
  canWrite?: boolean;
  onConfirmSession?: (sessionId: string) => void | Promise<void>;
  initialSelectedSession?: AttendanceSession | null;
  onClearInitialSession?: () => void;
}

export const AttendanceRecordsPage: React.FC<AttendanceRecordsPageProps> = ({
  sessions: propSessions,
  classes: propClasses,
  isSupabaseLive = false,
  canWrite = true,
  onConfirmSession: propOnConfirmSession,
  initialSelectedSession,
  onClearInitialSession
}) => {
  const classesList: ClassItem[] = useMemo(() => propClasses || [], [propClasses]);

  const isOnline = useOnlineStatus();
  const [internalSessions, setInternalSessions] = useState<AttendanceSession[]>(
    propSessions || []
  );
  const [remoteSessions, setRemoteSessions] = useState<AttendanceSession[] | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ type: 'error' | 'info' | 'success'; message: string } | null>(null);

  // Scoped Filters
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('All');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'All' | ReviewStatus>('All');

  // Detail Modal State
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(
    initialSelectedSession || null
  );
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [detailTab, setDetailTab] = useState<'students' | 'cells'>('students');

  useEffect(() => {
    if (propSessions) {
      setInternalSessions(propSessions);
    }
  }, [propSessions]);

  const loadScopedSupabaseSessions = useCallback(async () => {
    if (!isSupabaseLive) return;
    if (!isOnline) {
      setListError(
        'Offline: Internet connectivity lost. Unable to load attendance history from Supabase right now—retry once reconnected.'
      );
      return;
    }
    const client = getSupabaseClient();
    if (!client) return;

    setIsLoadingList(true);
    setListError(null);
    try {
      const rows = await fetchAttendanceSessionsFiltered(client, {
        classId: selectedClassFilter,
        startDate,
        endDate,
        status: selectedStatusFilter,
        limit: 50
      });
      setRemoteSessions(rows);
    } catch (err: any) {
      setListError(
        isNetworkOrOfflineError(err)
          ? 'Network connectivity lost while loading attendance history. Check connection and tap Retry.'
          : err?.message || 'Unable to load attendance history from Supabase.'
      );
    } finally {
      setIsLoadingList(false);
    }
  }, [isSupabaseLive, isOnline, selectedClassFilter, startDate, endDate, selectedStatusFilter]);

  useEffect(() => {
    if (isSupabaseLive) {
      void loadScopedSupabaseSessions();
    } else {
      setRemoteSessions(null);
      setListError(null);
    }
  }, [isSupabaseLive, loadScopedSupabaseSessions]);

  const handleOpenSession = useCallback(
    async (session: AttendanceSession) => {
      setActiveSession(session);
      setDetailError(null);
      setDetailTab(session.records && session.records.length > 0 ? 'students' : 'students');

      // Lazy-load full student & cell breakdown when opening a Supabase session
      if (
        isSupabaseLive &&
        session.persistenceTarget === 'supabase' &&
        (!session.records || session.records.length === 0)
      ) {
        const client = getSupabaseClient();
        if (!client) return;
        setIsLoadingDetail(true);
        try {
          const full = await fetchSessionDetailFromSupabase(client, session.id);
          setActiveSession(full);
        } catch (err: any) {
          setDetailError(err?.message || 'Failed to load individual student attendance details.');
        } finally {
          setIsLoadingDetail(false);
        }
      }
    },
    [isSupabaseLive]
  );

  useEffect(() => {
    if (initialSelectedSession) {
      void handleOpenSession(initialSelectedSession);
    }
  }, [initialSelectedSession, handleOpenSession]);

  // Combine scoped Supabase rows with any client-recorded Failed attempts (or local sessions in demo mode)
  const displayedSessions = useMemo(() => {
    const localSessions = propSessions || internalSessions;
    if (isSupabaseLive && remoteSessions !== null) {
      const localFailed = filterAttendanceSessions(
        localSessions.filter((s) => s.reviewStatus === 'Failed'),
        {
          classId: selectedClassFilter,
          startDate,
          endDate,
          status: selectedStatusFilter
        },
        classesList
      );
      return [...localFailed, ...remoteSessions];
    }

    return filterAttendanceSessions(
      localSessions,
      {
        classId: selectedClassFilter,
        startDate,
        endDate,
        status: selectedStatusFilter
      },
      classesList
    );
  }, [
    isSupabaseLive,
    remoteSessions,
    propSessions,
    internalSessions,
    selectedClassFilter,
    startDate,
    endDate,
    selectedStatusFilter,
    classesList
  ]);

  const handleConfirmSession = async (sessionId: string) => {
    setIsConfirming(true);
    setDetailError(null);
    try {
      if (isSupabaseLive && activeSession?.persistenceTarget === 'supabase') {
        const client = getSupabaseClient();
        if (client) {
          await confirmExistingSessionInSupabase(client, sessionId);
        }
      }
      if (propOnConfirmSession) {
        await propOnConfirmSession(sessionId);
      }

      setInternalSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                reviewStatus: 'Confirmed' as ReviewStatus,
                verifiedBy: 'School Administrator (Confirmed)'
              }
            : s
        )
      );
      if (remoteSessions) {
        setRemoteSessions((prev) =>
          prev
            ? prev.map((s) =>
                s.id === sessionId
                  ? {
                      ...s,
                      reviewStatus: 'Confirmed' as ReviewStatus,
                      verifiedBy: 'Confirmed in Supabase PostgreSQL'
                    }
                  : s
              )
            : null
        );
      }
      if (activeSession && activeSession.id === sessionId) {
        setActiveSession((prev) =>
          prev
            ? {
                ...prev,
                reviewStatus: 'Confirmed' as ReviewStatus,
                verifiedBy: isSupabaseLive
                  ? 'Confirmed in Supabase PostgreSQL'
                  : 'School Administrator (Confirmed)'
              }
            : null
        );
      }
    } catch (err: any) {
      setDetailError(err?.message || 'Unable to confirm session.');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleToggleStudentStatus = (studentId: string) => {
    if (!activeSession || !activeSession.entries || isSupabaseLive) return;

    const updatedEntries = activeSession.entries.map((entry) => {
      if (entry.studentId === studentId) {
        const nextStatus = entry.status === 'Present' ? 'Absent' : 'Present';
        return { ...entry, status: nextStatus as 'Present' | 'Absent' };
      }
      return entry;
    });

    const presentCount = updatedEntries.filter((e) => e.status === 'Present').length;
    const absentCount = updatedEntries.filter((e) => e.status === 'Absent').length;

    const updatedSession = {
      ...activeSession,
      presentCount,
      absentCount,
      entries: updatedEntries
    };

    setActiveSession(updatedSession);
    setInternalSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? updatedSession : s))
    );
  };

  const handleExportFilteredCsv = async () => {
    setExportNotice(null);
    if (!canWrite) {
      setExportNotice({
        type: 'error',
        message: 'Read-only access: Only an authorized School Admin can export attendance records.'
      });
      return;
    }
    if (isSupabaseLive && !isOnline) {
      setExportNotice({
        type: 'error',
        message: 'You are currently offline. Reconnect to export records from Supabase.'
      });
      return;
    }

    setIsExportingCsv(true);
    try {
      let exportSessions: AttendanceSession[] = [];
      if (isSupabaseLive) {
        const client = getSupabaseClient();
        if (!client) throw new Error('Supabase client is unavailable.');
        exportSessions = await fetchScopedSessionsForCsvExport(client, {
          classId: selectedClassFilter,
          startDate,
          endDate,
          status: selectedStatusFilter
        });
      } else {
        exportSessions = displayedSessions;
      }

      const result = buildAttendanceRecordsCsv({
        sessions: exportSessions,
        classes: classesList,
        canWrite,
        confirmedOnly: false
      });

      if (result.rowCount === 0) {
        setExportNotice({
          type: 'info',
          message:
            result.excludedMockCount > 0
              ? 'No official attendance records to export: built-in mock/sample sessions are excluded from CSV exports.'
              : 'No exportable attendance records match the current filters.'
        });
        return;
      }

      const dateSlug = new Date().toISOString().slice(0, 10);
      triggerCsvDownload(result.csvContent, `lea-attendance-records-${dateSlug}.csv`);
      setExportNotice({
        type: 'success',
        message: `Exported ${result.rowCount} record row(s) from ${result.exportedSessionCount} session(s).${
          result.excludedMockCount > 0
            ? ` (${result.excludedMockCount} mock sample session(s) excluded.)`
            : ''
        }`
      });
    } catch (err: any) {
      setExportNotice({
        type: 'error',
        message: isNetworkOrOfflineError(err)
          ? 'Network connectivity lost during CSV export. Reconnect and retry.'
          : err?.message || 'Unable to export attendance records.'
      });
    } finally {
      setIsExportingCsv(false);
    }
  };

  const clearAllFilters = () => {
    setSelectedClassFilter('All');
    setStartDate('');
    setEndDate('');
    setSelectedStatusFilter('All');
    setExportNotice(null);
  };

  const renderStatus = (status: ReviewStatus) => {
    switch (status) {
      case 'Confirmed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            Confirmed
          </span>
        );
      case 'Draft':
      case 'Pending Review':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
            <FileEdit className="w-3 h-3 text-amber-700" />
            {status === 'Draft' ? 'Draft' : 'Draft / Pending'}
          </span>
        );
      case 'Flagged':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3 text-orange-700" />
            Flagged
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
            <XCircle className="w-3 h-3 text-rose-700" />
            Failed
          </span>
        );
      default:
        return <span>{status}</span>;
    }
  };

  const renderRecordStatusBadge = (status: 'PRESENT' | 'ABSENT' | 'BLANK' | 'UNCERTAIN') => {
    switch (status) {
      case 'PRESENT':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold text-[11px]">
            <Check className="w-3 h-3" />
            PRESENT
          </span>
        );
      case 'ABSENT':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-bold text-[11px]">
            <X className="w-3 h-3" />
            ABSENT
          </span>
        );
      case 'BLANK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-bold text-[11px]">
            BLANK
          </span>
        );
      case 'UNCERTAIN':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[11px]">
            <HelpCircle className="w-3 h-3" />
            UNCERTAIN
          </span>
        );
    }
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3.5 flex items-center gap-2 text-xs text-amber-950">
          <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            <strong>Network Connectivity Lost:</strong> Remote history refresh and CSV export require an active connection. Full offline mode is not supported—retry once reconnected.
          </span>
        </div>
      )}

      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-800">
            <ClipboardCheck className="w-4 h-4" />
            <span>Historical Archive</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
            Attendance Records & Session History
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-2xl">
            Inspect confirmed registers, unconfirmed drafts, and flagged or failed sessions. Only Confirmed sessions appear in official school reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {isSupabaseLive && (
            <button
              type="button"
              disabled={isLoadingList || !isOnline}
              onClick={() => void loadScopedSupabaseSessions()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
              <span>Refresh History</span>
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              disabled={isExportingCsv || (isSupabaseLive && !isOnline)}
              onClick={() => void handleExportFilteredCsv()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isExportingCsv ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{isExportingCsv ? 'Exporting...' : 'Export Filtered CSV'}</span>
            </button>
          )}
        </div>
      </div>

      {exportNotice && (
        <div
          className={`rounded-lg border p-3.5 text-xs flex items-center justify-between gap-3 ${
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

      {/* Filter Bar */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Class
            </label>
            <select
              value={selectedClassFilter}
              onChange={(e) => setSelectedClassFilter(e.target.value)}
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Session Status
            </label>
            <select
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value as 'All' | ReviewStatus)}
              className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="All">All Statuses</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Draft">Draft (Unconfirmed)</option>
              <option value="Pending Review">Pending Review</option>
              <option value="Flagged">Flagged (Unresolved)</option>
              <option value="Failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
          <span>
            Showing <strong className="text-slate-800">{displayedSessions.length}</strong> session
            {displayedSessions.length === 1 ? '' : 's'}
            {isSupabaseLive ? ' (scoped Supabase query)' : ' (local storage)'}
          </span>
          {(selectedClassFilter !== 'All' || startDate || endDate || selectedStatusFilter !== 'All') && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-emerald-700 hover:underline font-semibold cursor-pointer"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoadingList && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 flex items-center justify-center gap-2 text-xs sm:text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
          <span>Loading matching attendance sessions from Supabase...</span>
        </div>
      )}

      {/* Error State */}
      {listError && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-900">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{listError}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadScopedSupabaseSessions()}
            className="px-3 py-1.5 rounded bg-white border border-rose-300 text-rose-800 font-semibold hover:bg-rose-100 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoadingList && !listError && displayedSessions.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center space-y-3">
          <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="text-sm font-bold text-slate-800">No Attendance Sessions Found</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            No saved sessions match the selected class, date range, and status filters.
          </p>
          {(selectedClassFilter !== 'All' || startDate || endDate || selectedStatusFilter !== 'All') && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="px-3.5 py-2 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
            >
              Show All Sessions
            </button>
          )}
        </div>
      )}

      {/* Mobile Session Cards (easy tapping on Android phones) */}
      {!isLoadingList && displayedSessions.length > 0 && (
        <div className="md:hidden space-y-3">
          {displayedSessions.map((session) => {
            const rate = calculateAttendancePercentage(session.presentCount, session.absentCount);
            const unresolvedCount = (session.blankCount || 0) + (session.uncertainCount || 0);

            return (
              <button
                key={session.id}
                type="button"
                onClick={() => void handleOpenSession(session)}
                className="w-full text-left bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:border-emerald-400 active:bg-slate-50 space-y-3 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{session.classGrade}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {session.date} · {session.recordedBy}
                    </div>
                  </div>
                  {renderStatus(session.reviewStatus)}
                </div>

                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2 rounded bg-emerald-50 text-emerald-900">
                    <div className="font-bold text-sm">{session.presentCount}</div>
                    <div className="text-[10px]">Present</div>
                  </div>
                  <div className="p-2 rounded bg-rose-50 text-rose-900">
                    <div className="font-bold text-sm">{session.absentCount}</div>
                    <div className="text-[10px]">Absent</div>
                  </div>
                  <div className="p-2 rounded bg-slate-100 text-slate-800">
                    <div className="font-bold text-sm">{unresolvedCount}</div>
                    <div className="text-[10px]">Blank/Unc.</div>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-slate-900">
                    <div className="font-bold text-sm">{rate !== null ? `${rate}%` : 'N/A'}</div>
                    <div className="text-[10px]">Rate</div>
                  </div>
                </div>

                <div className="flex items-center justify-end text-xs font-semibold text-emerald-700 gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  <span>Open Session Details</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Desktop Table */}
      {!isLoadingList && displayedSessions.length > 0 && (
        <div className="hidden md:block bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th scope="col" className="py-3 px-4">Date</th>
                  <th scope="col" className="py-3 px-4">Class</th>
                  <th scope="col" className="py-3 px-4 text-center">Present</th>
                  <th scope="col" className="py-3 px-4 text-center">Absent</th>
                  <th scope="col" className="py-3 px-4 text-center">Blank / Unresolved</th>
                  <th scope="col" className="py-3 px-4 text-center">Attendance %</th>
                  <th scope="col" className="py-3 px-4">Status</th>
                  <th scope="col" className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {displayedSessions.map((session) => {
                  const rate = calculateAttendancePercentage(session.presentCount, session.absentCount);
                  const blanks = session.blankCount || 0;
                  const uncertains = session.uncertainCount || 0;

                  return (
                    <tr
                      key={session.id}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      onClick={() => void handleOpenSession(session)}
                    >
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {session.date}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800 whitespace-nowrap">
                        <div>{session.classGrade}</div>
                        <div className="text-[11px] font-normal text-slate-500">{session.sessionYear}</div>
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-emerald-700 whitespace-nowrap">
                        {session.presentCount}
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-rose-700 whitespace-nowrap">
                        {session.absentCount}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {blanks + uncertains > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                              {blanks} Blank
                            </span>
                            {uncertains > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                                {uncertains} Uncertain
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-medium whitespace-nowrap">
                        {rate !== null ? `${rate}%` : 'N/A'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {renderStatus(session.reviewStatus)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleOpenSession(session);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900 hover:underline px-2 py-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Register Session Inspection Modal / Drawer */}
      {activeSession && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50 flex items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-base sm:text-lg">
                    {activeSession.classGrade} Register Record
                  </h3>
                  {renderStatus(activeSession.reviewStatus)}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Date: <strong>{activeSession.date}</strong> · Period: {activeSession.sessionYear} · Recorded by: {activeSession.recordedBy}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveSession(null);
                  if (onClearInitialSession) onClearInitialSession();
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label="Close session inspector"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
              {activeSession.reviewStatus !== 'Confirmed' && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                    activeSession.reviewStatus === 'Failed'
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block">
                      {activeSession.reviewStatus === 'Failed'
                        ? 'Failed Save Attempt (Not Saved to Official Archive)'
                        : 'Unconfirmed Session — Excluded from Official Attendance Reports'}
                    </strong>
                    <span>
                      {activeSession.failureReason ||
                        'Only sessions marked Confirmed count toward official student totals and percentages.'}
                    </span>
                  </div>
                </div>
              )}

              {detailError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{detailError}</span>
                </div>
              )}

              {/* Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100 text-center">
                  <span className="text-[11px] font-semibold text-emerald-800 uppercase block">Present</span>
                  <span className="text-2xl font-bold text-emerald-700">{activeSession.presentCount}</span>
                </div>
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-100 text-center">
                  <span className="text-[11px] font-semibold text-rose-800 uppercase block">Absent</span>
                  <span className="text-2xl font-bold text-rose-700">{activeSession.absentCount}</span>
                </div>
                <div className="p-3 bg-slate-100 rounded-lg border border-slate-200 text-center">
                  <span className="text-[11px] font-semibold text-slate-700 uppercase block">Blank</span>
                  <span className="text-2xl font-bold text-slate-800">{activeSession.blankCount || 0}</span>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-center">
                  <span className="text-[11px] font-semibold text-amber-900 uppercase block">Uncertain</span>
                  <span className="text-2xl font-bold text-amber-800">{activeSession.uncertainCount || 0}</span>
                </div>
              </div>

              {/* Administrative Notes */}
              {activeSession.notes && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800">
                  <strong className="font-semibold block mb-0.5">Session Remarks:</strong>
                  <span>{activeSession.notes}</span>
                </div>
              )}

              {isLoadingDetail ? (
                <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
                  <span>Loading individual student records...</span>
                </div>
              ) : (
                <>
                  {/* View Toggle when cell-level records exist */}
                  {activeSession.records && activeSession.records.length > 0 && (
                    <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                      <button
                        type="button"
                        onClick={() => setDetailTab('students')}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                          detailTab === 'students'
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        Student Summary ({activeSession.entries?.length || 0})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetailTab('cells')}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                          detailTab === 'cells'
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        Blank / Uncertain & All Cell Marks ({activeSession.records.length})
                      </button>
                    </div>
                  )}

                  {detailTab === 'cells' && activeSession.records && activeSession.records.length > 0 ? (
                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold sticky top-0">
                          <tr>
                            <th className="py-2 px-3">Student / Row</th>
                            <th className="py-2 px-3">Schedule</th>
                            <th className="py-2 px-3">Recorded Mark</th>
                            <th className="py-2 px-3">Review Note</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeSession.records.map((rec) => (
                            <tr
                              key={rec.id}
                              className={
                                rec.status === 'UNCERTAIN' || !rec.studentId
                                  ? 'bg-amber-50/50'
                                  : rec.status === 'BLANK'
                                  ? 'bg-slate-50/70'
                                  : ''
                              }
                            >
                              <td className="py-2 px-3 font-medium text-slate-800">
                                <span>{rec.studentName}</span>
                                {!rec.studentId && (
                                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold">
                                    Unmapped
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                                {rec.weekIdentifier} · {rec.dayOfWeek}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {renderRecordStatusBadge(rec.status)}
                              </td>
                              <td className="py-2 px-3 text-slate-500 text-[11px]">
                                {rec.reviewed ? 'Reviewed by admin' : 'Not reviewed'}
                                {rec.originalAiStatus && rec.originalAiStatus !== rec.status
                                  ? ` (AI: ${rec.originalAiStatus})`
                                  : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : activeSession.entries && activeSession.entries.length > 0 ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          Individual Student Attendance
                        </h4>
                        {!isSupabaseLive && (
                          <span className="text-[11px] text-slate-500">
                            Tap status badge to adjust demo mark
                          </span>
                        )}
                      </div>

                      <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold sticky top-0">
                            <tr>
                              <th className="py-2 px-3 w-12 text-center">S/N</th>
                              <th className="py-2 px-3">Student Name</th>
                              <th className="py-2 px-3 text-center">Summary</th>
                              <th className="py-2 px-3">Breakdown / Remarks</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeSession.entries.map((entry) => {
                              const hasUnresolved = (entry.uncertainMarks || 0) > 0 || (entry.blankMarks || 0) > 0;
                              return (
                                <tr
                                  key={entry.studentId}
                                  className={hasUnresolved ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-slate-50'}
                                >
                                  <td className="py-2 px-3 text-center text-slate-500 font-mono">
                                    {entry.rollNumber}
                                  </td>
                                  <td className="py-2 px-3 font-medium text-slate-800">
                                    {entry.studentName}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <button
                                      type="button"
                                      disabled={isSupabaseLive}
                                      onClick={() => handleToggleStudentStatus(entry.studentId)}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                                        entry.status === 'Present'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : entry.status === 'Absent'
                                          ? 'bg-rose-100 text-rose-800'
                                          : 'bg-slate-200 text-slate-800'
                                      } ${!isSupabaseLive ? 'cursor-pointer hover:opacity-85' : ''}`}
                                    >
                                      {entry.status === 'Present' ? (
                                        <>
                                          <Check className="w-3 h-3" />
                                          <span>Present</span>
                                        </>
                                      ) : entry.status === 'Absent' ? (
                                        <>
                                          <X className="w-3 h-3" />
                                          <span>Absent</span>
                                        </>
                                      ) : (
                                        <span>Blank / Unresolved</span>
                                      )}
                                    </button>
                                  </td>
                                  <td className="py-2 px-3 text-slate-600 text-[11px]">
                                    {entry.remarks || '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-lg text-center text-xs text-slate-500">
                      No individual pupil cell records are attached to this summary entry.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer with confirmation action */}
            <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                {activeSession.verifiedBy ? (
                  <span>
                    Status: <strong className="text-slate-700">{activeSession.verifiedBy}</strong>
                  </span>
                ) : (
                  <span>Not yet confirmed for official reports</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSession(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
                >
                  Close
                </button>

                {canWrite &&
                  activeSession.reviewStatus !== 'Confirmed' &&
                  activeSession.reviewStatus !== 'Failed' && (
                    <button
                      type="button"
                      disabled={isConfirming}
                      onClick={() => void handleConfirmSession(activeSession.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      {isConfirming ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      <span>Confirm & Archive Register</span>
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
