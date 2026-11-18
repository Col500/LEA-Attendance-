import React from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor?: 'emerald' | 'amber' | 'blue' | 'rose' | 'slate';
  trendText?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  accentColor = 'slate',
  trendText
}) => {
  const colorStyles = {
    emerald: {
      border: 'border-l-4 border-l-emerald-600',
      iconBg: 'bg-emerald-50 text-emerald-700',
      valueColor: 'text-emerald-900',
    },
    amber: {
      border: 'border-l-4 border-l-amber-500',
      iconBg: 'bg-amber-50 text-amber-700',
      valueColor: 'text-amber-900',
    },
    blue: {
      border: 'border-l-4 border-l-blue-600',
      iconBg: 'bg-blue-50 text-blue-700',
      valueColor: 'text-blue-900',
    },
    rose: {
      border: 'border-l-4 border-l-rose-600',
      iconBg: 'bg-rose-50 text-rose-700',
      valueColor: 'text-rose-900',
    },
    slate: {
      border: 'border-l-4 border-l-slate-600',
      iconBg: 'bg-slate-100 text-slate-700',
      valueColor: 'text-slate-900',
    },
  }[accentColor];

  return (
    <div className={`bg-white rounded-lg border border-slate-200 p-4 sm:p-5 shadow-xs ${colorStyles.border} transition-all`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider truncate">
            {title}
          </p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className={`text-2xl sm:text-3xl font-bold tracking-tight ${colorStyles.valueColor}`}>
              {value}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <span>{subtitle}</span>
            {trendText && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-slate-600">{trendText}</span>
              </>
            )}
          </div>
        </div>

        <div className={`p-2.5 rounded-lg shrink-0 ${colorStyles.iconBg}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
