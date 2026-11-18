import React from 'react';
import { LayoutDashboard, ScanLine, Users, ClipboardCheck, MoreHorizontal, BarChart3 } from 'lucide-react';
import { NavTab } from './Sidebar';
import type { StaffRole } from '../types/attendance';
import { canAccessNavTab } from '../lib/authRoles';

interface MobileBottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenMoreMenu: () => void;
  userRole?: StaffRole | null;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenMoreMenu,
  userRole
}) => {
  const canScan = !userRole || canAccessNavTab(userRole, 'scan');
  const canViewStudents = !userRole || canAccessNavTab(userRole, 'students');
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-2 py-1 shadow-lg print:hidden"
      aria-label="Mobile Navigation"
    >
      <div className="flex items-center justify-around max-w-lg mx-auto">
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors ${
            activeTab === 'dashboard' ? 'text-emerald-700 font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <LayoutDashboard className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Dashboard</span>
        </button>

        {canScan && (
          <button
            type="button"
            onClick={() => onSelectTab('scan')}
            className={`relative flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors ${
              activeTab === 'scan' ? 'text-emerald-700 font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <div className="relative">
              <ScanLine className="w-5 h-5 mb-0.5" />
              <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <span className="text-[10px]">Scan</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onSelectTab('records')}
          className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors ${
            activeTab === 'records' ? 'text-emerald-700 font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ClipboardCheck className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Records</span>
        </button>

        {canViewStudents ? (
          <button
            type="button"
            onClick={() => onSelectTab('students')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors ${
              activeTab === 'students' ? 'text-emerald-700 font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Students</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSelectTab('reports')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors ${
              activeTab === 'reports' ? 'text-emerald-700 font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Reports</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenMoreMenu}
          className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors ${
            activeTab === 'reports' || activeTab === 'settings'
              ? 'text-emerald-700 font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <MoreHorizontal className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">More</span>
        </button>
      </div>
    </nav>
  );
};
