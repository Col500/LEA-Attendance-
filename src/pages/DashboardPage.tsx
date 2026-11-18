import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Users,
  CalendarCheck,
  UserCheck,
  UserX,
  ScanLine,
  ArrowRight,
  Clock,
  CheckCircle2,
  ChevronRight,
  BarChart3,
  PieChart,
  TrendingUp,
  LayoutGrid,
  Hash,
  RotateCcw,
  SlidersHorizontal
} from 'lucide-react';
import { StatCard } from '../components/StatCard';
import { AttendanceAnalyticsCharts } from '../components/AttendanceAnalyticsCharts';
import { schoolInfo } from '../data/mockData';
import {
  AttendanceSession,
  ClassItem,
  ReviewStatus,
  SchoolInfo,
  StaffRole,
  Student
} from '../types/attendance';
import {
  AnalyticsViewMode,
  computeDashboardAnalytics,
  createDefaultAnalyticsFilter,
  DashboardAnalyticsFilter,
  TimeframeMode
} from '../services/dashboardAnalytics';

interface DashboardPageProps {
  students: Student[];
  classes: ClassItem[];
  sessions?: AttendanceSession[];
  school?: SchoolInfo;
  isSupabaseLive?: boolean;
  userRole?: StaffRole | null;
  canScan?: boolean;
  onNavigateToScan: () => void;
  onNavigateToRecords: () => void;
  onNavigateToReports?: () => void;
  onNavigateToStudents: () => void;
  onOpenSessionDetail: (session: AttendanceSession) => void;
  onAnalyticsViewUsed?: () => void;
  openAnalyticsSignal?: number;
  highlightedTarget?: string | null;
}

const VIEW_MODE_OPTIONS: Array<{
  id: AnalyticsViewMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'numbers', label: 'Numbers', icon: Hash },
  { id: 'bar', label: 'Bar Charts', icon: BarChart3 },
  { id: 'pie', label: 'Pie Charts', icon: PieChart },
  { id: 'trend', label: 'Trend Graph', icon: TrendingUp },
  { id: 'all', label: 'All Charts', icon: LayoutGrid }
];

export const DashboardPage: React.FC<DashboardPageProps> = ({
  students,
  classes,
  sessions = [],
  school,
  userRole,
  canScan = true,
  onNavigateToScan,
  onNavigateToRecords,
  onNavigateToReports,
  onNavigateToStudents,
  onOpenSessionDetail,
  onAnalyticsViewUsed,
  openAnalyticsSignal = 0,
  highlightedTarget
}) => {
  const activeSchool = school || schoolInfo;
  const analyticsSectionRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<AnalyticsViewMode>('numbers');
  const [showFiltersPanel, setShowFiltersPanel] = useState<boolean>(false);
  const [filter, setFilter] = useState<DashboardAnalyticsFilter>(() =>
    createDefaultAnalyticsFilter(activeSchool)
  );

  // Switch straight to interactive visual charts when guided by the tutorial
  useEffect(() => {
    if (!openAnalyticsSignal) return;
    setViewMode('all');
    setShowFiltersPanel(true);
    analyticsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onAnalyticsViewUsed?.();
  }, [openAnalyticsSignal, onAnalyticsViewUsed]);

  // Helper map for class names
  const classMap = useMemo(() => {
    const map = new Map<string, string>();
    classes.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [classes]);

  // Compute filtered analytics across classes & timeframe
  const analytics = useMemo(
    () =>
      computeDashboardAnalytics({
        sessions,
        classes,
        students,
        filter,
        school: activeSchool
      }),
    [sessions, classes, students, filter, activeSchool]
  );

  const handleSelectViewMode = (mode: AnalyticsViewMode) => {
    setViewMode(mode);
    if (mode !== 'numbers') {
      onAnalyticsViewUsed?.();
    }
  };

  const handleToggleClassComparison = (classId: string) => {
    setFilter((prev) => {
      const exists = prev.selectedClassIds.includes(classId);
      const nextIds = exists
        ? prev.selectedClassIds.filter((id) => id !== classId)
        : [...prev.selectedClassIds, classId];
      return {
        ...prev,
        selectedClassIds: nextIds
      };
    });
  };

  const handleResetFilters = () => {
    setFilter(createDefaultAnalyticsFilter(activeSchool));
  };

  const scopeLabel = useMemo(() => {
    if (filter.selectedClassIds.length === 0) return 'All Classes';
    if (filter.selectedClassIds.length === 1) {
      return classMap.get(filter.selectedClassIds[0]) || 'Selected Class';
    }
    return `${filter.selectedClassIds.length} Classes Compared`;
  }, [filter.selectedClassIds, classMap]);

  const timeframeLabel = useMemo(() => {
    switch (filter.timeframeMode) {
      case 'date':
        return filter.exactDate || 'Specific Date';
      case 'range':
        return `${filter.startDate || 'Start'} – ${filter.endDate || 'End'}`;
      case 'month':
        return (
          analytics.availableOptions.months.find((m) => m.value === filter.month)?.label ||
          filter.month
        );
      case 'term':
        return filter.term;
      case 'year':
        return filter.year;
      default:
        return `${activeSchool.currentTerm} · ${activeSchool.academicSession}`;
    }
  }, [filter, analytics.availableOptions.months, activeSchool]);

  // Latest date submission progress
  const latestDateInSessions = useMemo(() => {
    if (sessions.length === 0) return new Date().toISOString().split('T')[0];
    return sessions[0].date;
  }, [sessions]);

  const submittedClassesCount = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const hasToday = sessions.some((s) => s.date === todayStr);
    const targetDate = hasToday ? todayStr : latestDateInSessions;

    const allTodaySessions = sessions.filter(
      (s) => s.date === targetDate && s.reviewStatus !== 'Failed'
    );
    const classNamesWithSession = new Set(allTodaySessions.map((s) => s.classGrade));
    return classes.filter((c) => classNamesWithSession.has(c.name)).length;
  }, [classes, sessions, latestDateInSessions]);

  const completionPercent =
    classes.length > 0 ? Math.round((submittedClassesCount / classes.length) * 100) : 0;

  const renderStatus = (status: ReviewStatus) => {
    switch (status) {
      case 'Confirmed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            Confirmed
          </span>
        );
      case 'Draft':
      case 'Pending Review':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
            {status === 'Draft' ? 'Draft' : 'Pending Review'}
          </span>
        );
      case 'Flagged':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-800">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-600" />
            Flagged
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-800">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
            Failed
          </span>
        );
      default:
        return <span>{status}</span>;
    }
  };

  const greetingPrefix =
    userRole === 'headteacher' || userRole === 'visitor' || userRole === 'viewer'
      ? 'Welcome,'
      : 'Good morning,';
  const greetingSubject =
    userRole === 'headteacher'
      ? 'Head Teacher (Read-Only Metrics)'
      : userRole === 'visitor' || userRole === 'viewer'
      ? 'School Visitor / Inspector (Read-Only)'
      : activeSchool.administratorName &&
        activeSchool.administratorName.trim().toLowerCase() !== 'school administrator'
      ? activeSchool.administratorName
      : 'School Administrator';

  return (
    <div className="w-full min-w-0 space-y-5 sm:space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Call to Action */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl p-4 sm:p-7 text-white shadow-sm border border-slate-700/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-5">
          <div className="space-y-1.5 max-w-2xl min-w-0">
            <div className="text-xs font-semibold tracking-wider text-emerald-400 uppercase">
              Physical Register Digitization
            </div>
            <h2 className="text-base sm:text-lg font-medium text-slate-200 leading-snug">
              <span>{greetingPrefix} </span>
              <span className="font-semibold text-orange-400">
                {greetingSubject}
              </span>
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {canScan ? 'Recording attendance for ' : 'Viewing attendance metrics for '}
              <strong className="text-white font-medium">{activeSchool.name}</strong>.
              Currently tracking{' '}
              <strong className="text-white font-medium tabular-nums">
                {analytics.summary.activeStudents} active students
              </strong>{' '}
              across{' '}
              <strong className="text-white font-medium tabular-nums">
                {classes.length} classes
              </strong>
              .
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {canScan ? (
              <button
                type="button"
                onClick={onNavigateToScan}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900 active:scale-98 cursor-pointer"
              >
                <ScanLine className="w-5 h-5" />
                <span>Scan Attendance Register</span>
              </button>
            ) : (
              onNavigateToReports && (
                <button
                  type="button"
                  onClick={onNavigateToReports}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-sm transition-all cursor-pointer"
                >
                  <span>Open Attendance Reports</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Administrative Summary + Minimalist Interactive Visual Data Analysis */}
      <section
        id="administrative-summary"
        ref={analyticsSectionRef}
        data-tutorial-target="dashboard-analytics"
        className={`space-y-4 rounded-xl transition-all ${
          highlightedTarget === 'dashboard-analytics'
            ? 'ring-2 ring-emerald-500/40 p-2 sm:p-3 bg-emerald-50/20'
            : ''
        }`}
      >
        {/* Section Header & Segmented View Switcher */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                Administrative Summary
              </h3>
              <span className="text-xs font-semibold text-emerald-800">
                ({scopeLabel})
              </span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-500 tabular-nums">{timeframeLabel}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Switcher */}
            <div
              role="tablist"
              aria-label="Administrative Summary visualization mode"
              className="inline-flex flex-wrap items-center gap-0.5 p-1 bg-slate-200/70 rounded-lg"
            >
              {VIEW_MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = viewMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleSelectViewMode(option.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Filter Drawer Toggle */}
            <button
              type="button"
              onClick={() => setShowFiltersPanel((prev) => !prev)}
              aria-expanded={showFiltersPanel}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                showFiltersPanel || analytics.hasActiveFilters
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filters</span>
              {analytics.hasActiveFilters && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
              )}
            </button>
          </div>
        </div>

        {/* Minimalist Collapsible Filter Bar */}
        {showFiltersPanel && (
          <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Multi-class comparison selector */}
              <div className="lg:col-span-7 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    Compare Classes
                  </span>
                  {filter.selectedClassIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setFilter((prev) => ({ ...prev, selectedClassIds: [] }))
                      }
                      className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                  )}
                </div>

                {classes.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No classes enrolled yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setFilter((prev) => ({ ...prev, selectedClassIds: [] }))
                      }
                      className={`px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                        filter.selectedClassIds.length === 0
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      All Classes ({classes.length})
                    </button>

                    {classes.map((cls) => {
                      const active = filter.selectedClassIds.includes(cls.id);
                      return (
                        <button
                          key={cls.id}
                          type="button"
                          onClick={() => handleToggleClassComparison(cls.id)}
                          className={`px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                            active
                              ? 'bg-emerald-700 text-white border-emerald-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {cls.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Timeframe selector */}
              <div className="lg:col-span-5 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="analytics-timeframe-mode"
                    className="text-[11px] font-bold uppercase tracking-wider text-slate-600"
                  >
                    Time Period
                  </label>
                  {analytics.hasActiveFilters && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset All</span>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="analytics-timeframe-mode"
                    value={filter.timeframeMode}
                    onChange={(e) =>
                      setFilter((prev) => ({
                        ...prev,
                        timeframeMode: e.target.value as TimeframeMode
                      }))
                    }
                    className="py-1.5 px-2.5 text-xs font-medium border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="all">All Time</option>
                    <option value="date">Specific Date</option>
                    <option value="range">Date Range</option>
                    <option value="month">By Month</option>
                    <option value="term">By Term</option>
                    <option value="year">By Year</option>
                  </select>

                  {filter.timeframeMode === 'date' && (
                    <input
                      type="date"
                      aria-label="Filter by exact date"
                      value={filter.exactDate}
                      onChange={(e) =>
                        setFilter((prev) => ({ ...prev, exactDate: e.target.value }))
                      }
                      className="py-1.5 px-2.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 tabular-nums"
                    />
                  )}

                  {filter.timeframeMode === 'range' && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        type="date"
                        aria-label="Start date"
                        value={filter.startDate}
                        onChange={(e) =>
                          setFilter((prev) => ({ ...prev, startDate: e.target.value }))
                        }
                        className="py-1.5 px-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 tabular-nums"
                      />
                      <span className="text-xs text-slate-400">to</span>
                      <input
                        type="date"
                        aria-label="End date"
                        value={filter.endDate}
                        onChange={(e) =>
                          setFilter((prev) => ({ ...prev, endDate: e.target.value }))
                        }
                        className="py-1.5 px-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 tabular-nums"
                      />
                    </div>
                  )}

                  {filter.timeframeMode === 'month' && (
                    analytics.availableOptions.months.length > 0 ? (
                      <select
                        aria-label="Select month"
                        value={filter.month}
                        onChange={(e) =>
                          setFilter((prev) => ({ ...prev, month: e.target.value }))
                        }
                        className="py-1.5 px-2.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900"
                      >
                        {!analytics.availableOptions.months.some(
                          (m) => m.value === filter.month
                        ) && (
                          <option value={filter.month}>{filter.month}</option>
                        )}
                        {analytics.availableOptions.months.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="month"
                        aria-label="Select month"
                        value={filter.month}
                        onChange={(e) =>
                          setFilter((prev) => ({ ...prev, month: e.target.value }))
                        }
                        className="py-1.5 px-2.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 tabular-nums"
                      />
                    )
                  )}

                  {filter.timeframeMode === 'term' && (
                    <select
                      aria-label="Select term"
                      value={filter.term}
                      onChange={(e) =>
                        setFilter((prev) => ({ ...prev, term: e.target.value }))
                      }
                      className="py-1.5 px-2.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900"
                    >
                      {analytics.availableOptions.terms.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  )}

                  {filter.timeframeMode === 'year' && (
                    <select
                      aria-label="Select year"
                      value={filter.year}
                      onChange={(e) =>
                        setFilter((prev) => ({ ...prev, year: e.target.value }))
                      }
                      className="py-1.5 px-2.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 tabular-nums"
                    >
                      {analytics.availableOptions.years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Visualization Area */}
        {viewMode === 'numbers' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
            <StatCard
              title="Total Students"
              value={analytics.summary.activeStudents}
              subtitle={
                filter.selectedClassIds.length === 0
                  ? `${classes.length} Classes`
                  : scopeLabel
              }
              trendText={
                analytics.summary.enrolledStudents > analytics.summary.activeStudents
                  ? `${analytics.summary.enrolledStudents} enrolled`
                  : 'Active Roster'
              }
              icon={Users}
              accentColor="blue"
            />

            <StatCard
              title="Attendance Sessions"
              value={analytics.summary.totalSessions}
              subtitle={timeframeLabel}
              trendText="Registers Logged"
              icon={CalendarCheck}
              accentColor="slate"
            />

            <StatCard
              title="Students Present"
              value={analytics.summary.presentCount}
              subtitle={`${analytics.summary.recordedClassesCount} Classes Recorded`}
              trendText={`${analytics.summary.attendanceRate}% Rate`}
              icon={UserCheck}
              accentColor="emerald"
            />

            <StatCard
              title="Students Absent"
              value={analytics.summary.absentCount}
              subtitle="Requires Follow-up"
              trendText={
                analytics.summary.absentCount > 0
                  ? `${analytics.summary.absenceRate}% Absence`
                  : 'None Reported'
              }
              icon={UserX}
              accentColor="rose"
            />
          </div>
        ) : (
          <AttendanceAnalyticsCharts
            analytics={analytics}
            viewMode={viewMode}
            selectedClassIds={filter.selectedClassIds}
            onToggleClassComparison={handleToggleClassComparison}
            onResetFilters={handleResetFilters}
            canScan={canScan}
            onNavigateToScan={onNavigateToScan}
          />
        )}
      </section>

      {/* Today's Class Submission Progress */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Today&apos;s Register Submissions
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {classes.length > 0
                ? `${submittedClassesCount} of ${classes.length} classes recorded`
                : 'No classes configured yet'}
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded tabular-nums">
            {completionPercent}% Completed
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-100 h-2.5 rounded-full my-4 overflow-hidden">
          <div
            className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300"
            style={{ width: `${completionPercent}%` }}
          />
        </div>

        {classes.length === 0 ? (
          <div className="py-6 text-center space-y-2.5">
            <p className="text-xs text-slate-500">
              Add a class or scan the student details page of a register to get started.
            </p>
            <button
              type="button"
              onClick={onNavigateToStudents}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
            >
              <span>Go to Students &amp; Classes</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 pt-1">
            {classes.map((cls) => {
              const allTodaySessions = sessions.filter(
                (s) => s.date === latestDateInSessions && s.reviewStatus !== 'Failed'
              );
              const session = allTodaySessions.find((s) => s.classGrade === cls.name);
              const isSubmitted = !!session;
              const isSelected = filter.selectedClassIds.includes(cls.id);
              const countInClass = students.filter(
                (s) => s.classId === cls.id && s.active
              ).length;

              return (
                <button
                  key={cls.id}
                  type="button"
                  onClick={() => handleToggleClassComparison(cls.id)}
                  className={`p-2.5 rounded-lg border text-xs text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'ring-2 ring-emerald-600 border-emerald-500 bg-emerald-50/60'
                      : isSubmitted
                      ? 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50/70'
                      : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60'
                  }`}
                  title="Click to include or remove class in Administrative Summary filter"
                >
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span className="truncate">{cls.name}</span>
                    {isSubmitted ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 truncate tabular-nums">
                    {countInClass} active pupils
                  </div>
                  <div className="text-[11px] mt-1 font-medium tabular-nums">
                    {isSubmitted ? (
                      <span className="text-emerald-700 font-semibold">
                        {session?.presentCount} Present
                      </span>
                    ) : (
                      <span className="text-slate-400">Awaiting Sheet</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Attendance Sessions Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Recent Attendance Sessions
            </h3>
          </div>

          <button
            type="button"
            onClick={onNavigateToRecords}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline self-start sm:self-auto cursor-pointer"
          >
            <span>View all records</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {sessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 space-y-2">
            <div>No attendance sessions recorded yet.</div>
            {canScan && (
              <button
                type="button"
                onClick={onNavigateToScan}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
              >
                <ScanLine className="w-3.5 h-3.5" />
                <span>Scan Register</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th scope="col" className="py-3 px-4">Date</th>
                  <th scope="col" className="py-3 px-4">Class</th>
                  <th scope="col" className="py-3 px-4 text-center">Present</th>
                  <th scope="col" className="py-3 px-4 text-center">Absent</th>
                  <th scope="col" className="py-3 px-4 text-center">Rate</th>
                  <th scope="col" className="py-3 px-4">Recorded By</th>
                  <th scope="col" className="py-3 px-4">Review Status</th>
                  <th scope="col" className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {sessions.slice(0, 5).map((session) => {
                  const total = session.presentCount + session.absentCount;
                  const rate = total > 0 ? Math.round((session.presentCount / total) * 100) : 0;

                  return (
                    <tr key={session.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap tabular-nums">
                        {session.date}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800 whitespace-nowrap">
                        {session.classGrade}
                      </td>
                      <td className="py-3 px-4 text-center font-semibold text-emerald-700 whitespace-nowrap tabular-nums">
                        {session.presentCount}
                      </td>
                      <td className="py-3 px-4 text-center font-semibold text-rose-700 whitespace-nowrap tabular-nums">
                        {session.absentCount}
                      </td>
                      <td className="py-3 px-4 text-center font-medium whitespace-nowrap tabular-nums">
                        {rate}%
                      </td>
                      <td className="py-3 px-4 text-slate-600 truncate max-w-[160px]">
                        {session.recordedBy}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {renderStatus(session.reviewStatus)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenSessionDetail(session)}
                          className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 hover:underline px-2 py-1 rounded cursor-pointer"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
