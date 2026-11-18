import React, { useMemo, useState } from 'react';
import { BarChart3, PieChart as PieChartIcon, TrendingUp, ScanLine, RotateCcw } from 'lucide-react';
import {
  AnalyticsViewMode,
  ClassComparisonMetric,
  DashboardAnalyticsResult,
  PieSegmentMetric
} from '../services/dashboardAnalytics';

interface AttendanceAnalyticsChartsProps {
  analytics: DashboardAnalyticsResult;
  viewMode: Exclude<AnalyticsViewMode, 'numbers'>;
  selectedClassIds: string[];
  onToggleClassComparison: (classId: string) => void;
  onResetFilters: () => void;
  canScan: boolean;
  onNavigateToScan: () => void;
}

const COMPARISON_COLORS = [
  '#059669', // emerald-600
  '#2563eb', // blue-600
  '#d97706', // amber-600
  '#7c3aed', // violet-600
  '#0891b2', // cyan-600
  '#db2777'  // pink-600
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

function describeDonutArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  const clampedEnd = endAngle - startAngle >= 359.99 ? startAngle + 359.99 : endAngle;
  const startOuter = polarToCartesian(cx, cy, outerR, clampedEnd);
  const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const startInner = polarToCartesian(cx, cy, innerR, clampedEnd);
  const endInner = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = clampedEnd - startAngle <= 180 ? '0' : '1';

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${startInner.x} ${startInner.y}`,
    'Z'
  ].join(' ');
}

const EmptyAnalyticsState: React.FC<{
  hasAnySessions: boolean;
  hasActiveFilters: boolean;
  canScan: boolean;
  onResetFilters: () => void;
  onNavigateToScan: () => void;
}> = ({ hasAnySessions, hasActiveFilters, canScan, onResetFilters, onNavigateToScan }) => (
  <div className="bg-white rounded-lg border border-slate-200 p-8 text-center space-y-3">
    <div className="w-11 h-11 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
      <BarChart3 className="w-5 h-5" />
    </div>
    <div className="space-y-1 max-w-md mx-auto">
      <h4 className="text-sm font-bold text-slate-900">
        {hasAnySessions && hasActiveFilters
          ? 'No attendance sessions match these filters'
          : 'No attendance data to chart yet'}
      </h4>
      <p className="text-xs text-slate-500 leading-relaxed">
        {hasAnySessions && hasActiveFilters
          ? 'Try expanding your date range, picking another month or term, or clearing class filters.'
          : 'Once you scan and confirm your first daily register, interactive bar charts, pie breakdowns, and attendance trend lines will appear here.'}
      </p>
    </div>
    <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Filters</span>
        </button>
      )}
      {canScan && !hasAnySessions && (
        <button
          type="button"
          onClick={onNavigateToScan}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
        >
          <ScanLine className="w-3.5 h-3.5" />
          <span>Scan First Register</span>
        </button>
      )}
    </div>
  </div>
);

const InteractiveBarChartCard: React.FC<{
  classComparison: ClassComparisonMetric[];
  selectedClassIds: string[];
  onToggleClassComparison: (classId: string) => void;
}> = ({ classComparison, selectedClassIds, onToggleClassComparison }) => {
  const [barMetric, setBarMetric] = useState<'counts' | 'rate'>('counts');
  const [hoveredClassId, setHoveredClassId] = useState<string | null>(null);

  const activeItem =
    classComparison.find((c) => c.classId === hoveredClassId) ||
    classComparison[0] ||
    null;

  const maxCount = useMemo(() => {
    const peak = Math.max(
      1,
      ...classComparison.map((c) => Math.max(c.presentCount, c.absentCount, c.activeCount))
    );
    return Math.ceil(peak * 1.15);
  }, [classComparison]);

  const chartWidth = Math.max(540, classComparison.length * 92);
  const chartHeight = 250;
  const padLeft = 42;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 46;
  const plotW = chartWidth - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;

  const yTicks = barMetric === 'rate'
    ? [0, 25, 50, 75, 100]
    : [0, Math.round(maxCount * 0.25), Math.round(maxCount * 0.5), Math.round(maxCount * 0.75), maxCount];

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-700" />
            <span>Class Comparison Bar Chart</span>
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Hover any class bar for exact figures · Click a class bar to toggle comparison
          </p>
        </div>

        <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setBarMetric('counts')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              barMetric === 'counts'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Present vs Absent
          </button>
          <button
            type="button"
            onClick={() => setBarMetric('rate')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              barMetric === 'rate'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Attendance %
          </button>
        </div>
      </div>

      {/* Live readout strip */}
      {activeItem && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-md bg-slate-50 border border-slate-200/80 text-xs">
          <div className="font-semibold text-slate-900">
            {activeItem.className}
            <span className="font-normal text-slate-500 ml-2 tabular-nums">
              {activeItem.sessionsCount} session{activeItem.sessionsCount === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 tabular-nums">
            <span className="text-emerald-700 font-semibold">
              Present: {activeItem.presentCount}
            </span>
            <span className="text-rose-700 font-semibold">
              Absent: {activeItem.absentCount}
            </span>
            <span className="text-slate-800 font-bold">
              Rate: {activeItem.attendanceRate}%
            </span>
          </div>
        </div>
      )}

      {classComparison.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-500">
          No classes match the current filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="w-full min-w-[460px] h-60 select-none"
            role="img"
            aria-label="Class attendance bar chart"
          >
            {/* Horizontal grid lines */}
            {yTicks.map((tickVal, idx) => {
              const denom = barMetric === 'rate' ? 100 : maxCount;
              const y = padTop + plotH - (tickVal / denom) * plotH;
              return (
                <g key={`${tickVal}-${idx}`}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={chartWidth - padRight}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeDasharray={tickVal === 0 ? undefined : '3 3'}
                    strokeWidth={1}
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono tabular-nums"
                  >
                    {barMetric === 'rate' ? `${tickVal}%` : tickVal}
                  </text>
                </g>
              );
            })}

            {/* Bars per class */}
            {classComparison.map((cls, index) => {
              const slotW = plotW / classComparison.length;
              const centerX = padLeft + index * slotW + slotW / 2;
              const isHovered = hoveredClassId === cls.classId;
              const isSelected = selectedClassIds.includes(cls.classId);

              if (barMetric === 'rate') {
                const barW = Math.min(44, slotW * 0.54);
                const barH = (cls.attendanceRate / 100) * plotH;
                const y = padTop + plotH - barH;
                const fillColor =
                  cls.attendanceRate >= 85
                    ? '#059669'
                    : cls.attendanceRate >= 65
                    ? '#d97706'
                    : '#e11d48';

                return (
                  <g
                    key={cls.classId}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredClassId(cls.classId)}
                    onMouseLeave={() => setHoveredClassId(null)}
                    onClick={() => onToggleClassComparison(cls.classId)}
                  >
                    <rect
                      x={centerX - slotW * 0.42}
                      y={padTop}
                      width={slotW * 0.84}
                      height={plotH}
                      rx={6}
                      fill={isHovered || isSelected ? '#f8fafc' : 'transparent'}
                    />
                    <rect
                      x={centerX - barW / 2}
                      y={y}
                      width={barW}
                      height={Math.max(2, barH)}
                      rx={4}
                      fill={fillColor}
                      opacity={isHovered ? 1 : 0.88}
                    />
                    <text
                      x={centerX}
                      y={Math.max(padTop + 10, y - 6)}
                      textAnchor="middle"
                      className="fill-slate-700 text-[10px] font-mono font-semibold tabular-nums"
                    >
                      {cls.attendanceRate}%
                    </text>
                    <text
                      x={centerX}
                      y={chartHeight - 16}
                      textAnchor="middle"
                      className={`text-[11px] font-semibold ${
                        isSelected ? 'fill-emerald-800' : 'fill-slate-600'
                      }`}
                    >
                      {cls.className.length > 12 ? `${cls.className.slice(0, 11)}…` : cls.className}
                    </text>
                  </g>
                );
              }

              const singleBarW = Math.min(24, slotW * 0.28);
              const gap = 4;
              const presentH = (cls.presentCount / maxCount) * plotH;
              const absentH = (cls.absentCount / maxCount) * plotH;
              const presentY = padTop + plotH - presentH;
              const absentY = padTop + plotH - absentH;

              return (
                <g
                  key={cls.classId}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredClassId(cls.classId)}
                  onMouseLeave={() => setHoveredClassId(null)}
                  onClick={() => onToggleClassComparison(cls.classId)}
                >
                  <rect
                    x={centerX - slotW * 0.42}
                    y={padTop}
                    width={slotW * 0.84}
                    height={plotH}
                    rx={6}
                    fill={isHovered || isSelected ? '#f8fafc' : 'transparent'}
                  />
                  {/* Present bar */}
                  <rect
                    x={centerX - singleBarW - gap / 2}
                    y={presentY}
                    width={singleBarW}
                    height={Math.max(2, presentH)}
                    rx={3}
                    fill="#059669"
                    opacity={isHovered ? 1 : 0.9}
                  />
                  {/* Absent bar */}
                  <rect
                    x={centerX + gap / 2}
                    y={absentY}
                    width={singleBarW}
                    height={Math.max(2, absentH)}
                    rx={3}
                    fill="#e11d48"
                    opacity={isHovered ? 1 : 0.88}
                  />
                  <text
                    x={centerX - singleBarW / 2 - gap / 2}
                    y={Math.max(padTop + 10, presentY - 5)}
                    textAnchor="middle"
                    className="fill-emerald-800 text-[9px] font-mono font-semibold tabular-nums"
                  >
                    {cls.presentCount}
                  </text>
                  <text
                    x={centerX + singleBarW / 2 + gap / 2}
                    y={Math.max(padTop + 10, absentY - 5)}
                    textAnchor="middle"
                    className="fill-rose-700 text-[9px] font-mono font-semibold tabular-nums"
                  >
                    {cls.absentCount}
                  </text>
                  <text
                    x={centerX}
                    y={chartHeight - 16}
                    textAnchor="middle"
                    className={`text-[11px] font-semibold ${
                      isSelected ? 'fill-emerald-800' : 'fill-slate-600'
                    }`}
                  >
                    {cls.className.length > 12 ? `${cls.className.slice(0, 11)}…` : cls.className}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1 border-t border-slate-100">
        {barMetric === 'counts' ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />
              Present Marks
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-rose-600" />
              Absent Marks
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />
              85%+ Attendance
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-600" />
              65%–84% Attendance
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-rose-600" />
              Below 65%
            </span>
          </>
        )}
      </div>
    </div>
  );
};

const InteractivePieChartCard: React.FC<{
  pieSegments: PieSegmentMetric[];
  attendanceRate: number;
  classComparison: ClassComparisonMetric[];
}> = ({ pieSegments, attendanceRate, classComparison }) => {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const totalCount = useMemo(
    () => pieSegments.reduce((sum, s) => sum + s.count, 0),
    [pieSegments]
  );

  const slices = useMemo(() => {
    let cursor = 0;
    return pieSegments
      .filter((seg) => seg.count > 0)
      .map((seg) => {
        const sweep = totalCount > 0 ? (seg.count / totalCount) * 360 : 0;
        const start = cursor;
        const end = cursor + sweep;
        cursor = end;
        return {
          ...seg,
          startAngle: start,
          endAngle: end
        };
      });
  }, [pieSegments, totalCount]);

  const focusedSegment =
    pieSegments.find((s) => s.key === activeKey) || null;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 space-y-4">
      <div>
        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <PieChartIcon className="w-4 h-4 text-emerald-700" />
          <span>Attendance Share Breakdown</span>
        </h4>
        <p className="text-xs text-slate-500 mt-0.5">
          Hover or tap a segment to inspect exact mark proportions
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
        {/* Donut SVG */}
        <div className="sm:col-span-5 flex justify-center">
          <div className="relative w-48 h-48">
            <svg viewBox="0 0 200 200" className="w-full h-full" role="img" aria-label="Attendance distribution pie chart">
              {totalCount === 0 ? (
                <circle cx={100} cy={100} r={72} fill="none" stroke="#e2e8f0" strokeWidth={24} />
              ) : (
                slices.map((slice) => {
                  const isFocused = activeKey === slice.key;
                  const outerR = isFocused ? 84 : 78;
                  const innerR = 48;
                  return (
                    <path
                      key={slice.key}
                      d={describeDonutArc(100, 100, outerR, innerR, slice.startAngle, slice.endAngle)}
                      fill={slice.color}
                      stroke="#ffffff"
                      strokeWidth={2}
                      className="transition-all duration-150 cursor-pointer"
                      opacity={activeKey && !isFocused ? 0.55 : 1}
                      onMouseEnter={() => setActiveKey(slice.key)}
                      onMouseLeave={() => setActiveKey(null)}
                      onClick={() => setActiveKey((prev) => (prev === slice.key ? null : slice.key))}
                    />
                  );
                })
              )}
            </svg>

            {/* Center KPI overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
              <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
                {focusedSegment ? `${focusedSegment.percentage}%` : `${attendanceRate}%`}
              </span>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-0.5">
                {focusedSegment ? focusedSegment.label : 'Present Rate'}
              </span>
              {focusedSegment && (
                <span className="text-[11px] font-mono text-slate-600 tabular-nums mt-0.5">
                  {focusedSegment.count} marks
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Interactive Legend */}
        <div className="sm:col-span-7 space-y-2">
          {pieSegments.map((seg) => {
            const isFocused = activeKey === seg.key;
            return (
              <button
                key={seg.key}
                type="button"
                onMouseEnter={() => setActiveKey(seg.key)}
                onMouseLeave={() => setActiveKey(null)}
                onClick={() => setActiveKey((prev) => (prev === seg.key ? null : seg.key))}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                  isFocused
                    ? 'border-slate-400 bg-slate-50'
                    : 'border-slate-200/80 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-3 h-3 rounded-xs shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900">{seg.label}</div>
                    <div className="text-[11px] text-slate-500 truncate">{seg.description}</div>
                  </div>
                </div>

                <div className="text-right shrink-0 tabular-nums">
                  <div className="text-xs font-bold text-slate-900">{seg.count}</div>
                  <div className="text-[11px] font-mono text-slate-500">{seg.percentage}%</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-class share quick comparison when comparing 2+ classes */}
      {classComparison.length > 1 && (
        <div className="pt-3 border-t border-slate-100 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Attendance Share by Class
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {classComparison.map((cls) => {
              const total = cls.presentCount + cls.absentCount;
              const pPct = total > 0 ? Math.round((cls.presentCount / total) * 100) : 0;
              const aPct = total > 0 ? 100 - pPct : 0;
              return (
                <div key={cls.classId} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 truncate">{cls.className}</span>
                    <span className="font-mono text-slate-600 tabular-nums">
                      {cls.attendanceRate}% ({cls.presentCount}/{total})
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex">
                    {total > 0 && (
                      <>
                        <div className="bg-emerald-600 h-full" style={{ width: `${pPct}%` }} />
                        <div className="bg-rose-500 h-full" style={{ width: `${aPct}%` }} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const InteractiveTrendGraphCard: React.FC<{
  analytics: DashboardAnalyticsResult;
  selectedClassIds: string[];
}> = ({ analytics, selectedClassIds }) => {
  const { timeSeries, scopedClasses } = analytics;
  const [trendMode, setTrendMode] = useState<'rate' | 'headcount'>('rate');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const activeIndex =
    hoveredIndex !== null && timeSeries[hoveredIndex]
      ? hoveredIndex
      : timeSeries.length > 0
      ? timeSeries.length - 1
      : null;

  const activePoint = activeIndex !== null ? timeSeries[activeIndex] : null;

  // Show multi-class comparison lines if user picked 1–4 specific classes, or <= 4 total classes exist
  const comparedClasses = useMemo(() => {
    if (selectedClassIds.length >= 2) {
      return scopedClasses.slice(0, 5);
    }
    if (selectedClassIds.length === 0 && scopedClasses.length >= 2 && scopedClasses.length <= 4) {
      return scopedClasses;
    }
    return [];
  }, [selectedClassIds, scopedClasses]);

  const showClassLines = trendMode === 'rate' && comparedClasses.length >= 2;

  const maxHeadcount = useMemo(() => {
    const peak = Math.max(
      1,
      ...timeSeries.map((pt) => Math.max(pt.presentCount, pt.absentCount))
    );
    return Math.ceil(peak * 1.15);
  }, [timeSeries]);

  const width = Math.max(560, timeSeries.length * 64);
  const height = 240;
  const padLeft = 42;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const getX = (idx: number) => {
    if (timeSeries.length <= 1) return padLeft + plotW / 2;
    return padLeft + (idx / (timeSeries.length - 1)) * plotW;
  };

  const getY = (val: number, maxVal: number) => {
    return padTop + plotH - (Math.max(0, Math.min(val, maxVal)) / maxVal) * plotH;
  };

  const yTicks =
    trendMode === 'rate'
      ? [0, 25, 50, 75, 100]
      : [0, Math.round(maxHeadcount * 0.5), maxHeadcount];

  const overallLinePath = useMemo(() => {
    if (timeSeries.length === 0) return '';
    return timeSeries
      .map((pt, i) => {
        const x = getX(i);
        const y =
          trendMode === 'rate'
            ? getY(pt.attendanceRate, 100)
            : getY(pt.presentCount, maxHeadcount);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }, [timeSeries, trendMode, maxHeadcount]);

  const overallAreaPath = useMemo(() => {
    if (timeSeries.length <= 1) return '';
    const firstX = getX(0);
    const lastX = getX(timeSeries.length - 1);
    const baseY = padTop + plotH;
    return `${overallLinePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
  }, [overallLinePath, timeSeries.length]);

  const absentLinePath = useMemo(() => {
    if (trendMode !== 'headcount' || timeSeries.length === 0) return '';
    return timeSeries
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.absentCount, maxHeadcount)}`)
      .join(' ');
  }, [timeSeries, trendMode, maxHeadcount]);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-700" />
            <span>Attendance Trend Over Time</span>
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Hover any date point to inspect daily attendance{showClassLines ? ' across selected classes' : ''}
          </p>
        </div>

        <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setTrendMode('rate')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              trendMode === 'rate'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Rate (%)
          </button>
          <button
            type="button"
            onClick={() => setTrendMode('headcount')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              trendMode === 'headcount'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Present / Absent
          </button>
        </div>
      </div>

      {/* Selected date readout bar */}
      {activePoint && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-md bg-slate-50 border border-slate-200/80 text-xs">
          <div className="font-semibold text-slate-900 tabular-nums">
            {activePoint.date}
            <span className="font-normal text-slate-500 ml-2">
              {activePoint.sessionCount} session{activePoint.sessionCount === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 tabular-nums">
            <span className="text-emerald-700 font-semibold">
              Present: {activePoint.presentCount}
            </span>
            <span className="text-rose-700 font-semibold">
              Absent: {activePoint.absentCount}
            </span>
            <span className="text-slate-900 font-bold">
              Rate: {activePoint.attendanceRate}%
            </span>
          </div>
        </div>
      )}

      {timeSeries.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-500">
          No dated sessions available for trend plotting.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full min-w-[460px] h-60 select-none"
            role="img"
            aria-label="Attendance trend graph"
          >
            <defs>
              <linearGradient id="leaRateFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#059669" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#059669" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {/* Horizontal grid lines */}
            {yTicks.map((tickVal, idx) => {
              const denom = trendMode === 'rate' ? 100 : maxHeadcount;
              const y = getY(tickVal, denom);
              return (
                <g key={`${tickVal}-${idx}`}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeDasharray={tickVal === 0 ? undefined : '3 3'}
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono tabular-nums"
                  >
                    {trendMode === 'rate' ? `${tickVal}%` : tickVal}
                  </text>
                </g>
              );
            })}

            {/* Area & lines */}
            {!showClassLines && overallAreaPath && (
              <path d={overallAreaPath} fill="url(#leaRateFill)" />
            )}

            {!showClassLines && overallLinePath && (
              <path
                d={overallLinePath}
                fill="none"
                stroke="#059669"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {absentLinePath && (
              <path
                d={absentLinePath}
                fill="none"
                stroke="#e11d48"
                strokeWidth={2}
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Multi-class comparison lines */}
            {showClassLines &&
              comparedClasses.map((cls, cIdx) => {
                const color = COMPARISON_COLORS[cIdx % COMPARISON_COLORS.length];
                const pts = timeSeries
                  .map((pt, i) => ({ pt, i, cData: pt.byClass[cls.id] }))
                  .filter((item) => Boolean(item.cData));

                if (pts.length === 0) return null;

                const d = pts
                  .map(
                    (item, idx) =>
                      `${idx === 0 ? 'M' : 'L'} ${getX(item.i)} ${getY(item.cData.rate, 100)}`
                  )
                  .join(' ');

                return (
                  <g key={cls.id}>
                    <path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={2.25}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {pts.map((item) => (
                      <circle
                        key={`${cls.id}-${item.pt.date}`}
                        cx={getX(item.i)}
                        cy={getY(item.cData.rate, 100)}
                        r={activeIndex === item.i ? 4.5 : 3}
                        fill={color}
                        stroke="#ffffff"
                        strokeWidth={1.5}
                      />
                    ))}
                  </g>
                );
              })}

            {/* Hover crosshair and interactive points */}
            {timeSeries.map((pt, i) => {
              const x = getX(i);
              const y =
                trendMode === 'rate'
                  ? getY(pt.attendanceRate, 100)
                  : getY(pt.presentCount, maxHeadcount);
              const isActive = activeIndex === i;
              const hitWidth = timeSeries.length > 1 ? plotW / timeSeries.length : plotW;

              return (
                <g
                  key={pt.date}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIndex(i)}
                  onClick={() => setHoveredIndex(i)}
                >
                  {isActive && (
                    <line
                      x1={x}
                      y1={padTop}
                      x2={x}
                      y2={padTop + plotH}
                      stroke="#cbd5e1"
                      strokeWidth={1.25}
                      strokeDasharray="3 3"
                    />
                  )}
                  <rect
                    x={x - hitWidth / 2}
                    y={padTop}
                    width={hitWidth}
                    height={plotH}
                    fill="transparent"
                  />
                  {!showClassLines && (
                    <circle
                      cx={x}
                      cy={y}
                      r={isActive ? 5 : 3.5}
                      fill="#059669"
                      stroke="#ffffff"
                      strokeWidth={1.75}
                    />
                  )}
                  {trendMode === 'headcount' && (
                    <circle
                      cx={x}
                      cy={getY(pt.absentCount, maxHeadcount)}
                      r={isActive ? 4.5 : 3}
                      fill="#e11d48"
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  )}
                  <text
                    x={x}
                    y={height - 14}
                    textAnchor="middle"
                    className={`text-[10px] font-mono tabular-nums ${
                      isActive ? 'fill-slate-900 font-semibold' : 'fill-slate-500'
                    }`}
                  >
                    {pt.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1 border-t border-slate-100">
        {showClassLines ? (
          comparedClasses.map((cls, cIdx) => (
            <span key={cls.id} className="inline-flex items-center gap-1.5 font-medium">
              <span
                className="w-3 h-1 rounded-full"
                style={{ backgroundColor: COMPARISON_COLORS[cIdx % COMPARISON_COLORS.length] }}
              />
              {cls.name}
            </span>
          ))
        ) : trendMode === 'rate' ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-full bg-emerald-600" />
            Overall Attendance Rate (%)
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full bg-emerald-600" />
              Present Pupils
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full bg-rose-600" />
              Absent Pupils
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export const AttendanceAnalyticsCharts: React.FC<AttendanceAnalyticsChartsProps> = ({
  analytics,
  viewMode,
  selectedClassIds,
  onToggleClassComparison,
  onResetFilters,
  canScan,
  onNavigateToScan
}) => {
  if (analytics.filteredSessions.length === 0) {
    return (
      <EmptyAnalyticsState
        hasAnySessions={analytics.availableOptions.minDate !== null}
        hasActiveFilters={analytics.hasActiveFilters}
        canScan={canScan}
        onResetFilters={onResetFilters}
        onNavigateToScan={onNavigateToScan}
      />
    );
  }

  if (viewMode === 'bar') {
    return (
      <InteractiveBarChartCard
        classComparison={analytics.classComparison}
        selectedClassIds={selectedClassIds}
        onToggleClassComparison={onToggleClassComparison}
      />
    );
  }

  if (viewMode === 'pie') {
    return (
      <InteractivePieChartCard
        pieSegments={analytics.pieSegments}
        attendanceRate={analytics.summary.attendanceRate}
        classComparison={analytics.classComparison}
      />
    );
  }

  if (viewMode === 'trend') {
    return (
      <InteractiveTrendGraphCard
        analytics={analytics}
        selectedClassIds={selectedClassIds}
      />
    );
  }

  // 'all' visual overview
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <InteractiveBarChartCard
            classComparison={analytics.classComparison}
            selectedClassIds={selectedClassIds}
            onToggleClassComparison={onToggleClassComparison}
          />
        </div>
        <div className="lg:col-span-5">
          <InteractivePieChartCard
            pieSegments={analytics.pieSegments}
            attendanceRate={analytics.summary.attendanceRate}
            classComparison={analytics.classComparison}
          />
        </div>
      </div>
      <InteractiveTrendGraphCard
        analytics={analytics}
        selectedClassIds={selectedClassIds}
      />
    </div>
  );
};
