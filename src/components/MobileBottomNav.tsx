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
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-lg print:hidden transition-colors duration-150"
      style={{
        backgroundColor: 'var(--app-nav-bg)',
        borderColor: 'var(--app-nav-border)'
      }}
      aria-label="Mobile Navigation"
    >
      <div className="flex items-center justify-around max-w-lg mx-auto">
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors cursor-pointer ${
            activeTab === 'dashboard' ? 'font-semibold' : 'opacity-80 hover:opacity-100'
          }`}
          style={{
            color: activeTab === 'dashboard' ? 'var(--app-nav-active)' : 'var(--app-nav-text)'
          }}
        >
          <LayoutDashboard className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Dashboard</span>
        </button>

        {canScan && (
          <button
            type="button"
            onClick={() => onSelectTab('scan')}
            className={`relative flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors cursor-pointer ${
              activeTab === 'scan' ? 'font-semibold' : 'opacity-80 hover:opacity-100'
            }`}
            style={{
              color: activeTab === 'scan' ? 'var(--app-nav-active)' : 'var(--app-nav-text)'
            }}
          >
            <ScanLine className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Scan</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onSelectTab('records')}
          className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors cursor-pointer ${
            activeTab === 'records' ? 'font-semibold' : 'opacity-80 hover:opacity-100'
          }`}
          style={{
            color: activeTab === 'records' ? 'var(--app-nav-active)' : 'var(--app-nav-text)'
          }}
        >
          <ClipboardCheck className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Records</span>
        </button>

        {canViewStudents ? (
          <button
            type="button"
            onClick={() => onSelectTab('students')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors cursor-pointer ${
              activeTab === 'students' ? 'font-semibold' : 'opacity-80 hover:opacity-100'
            }`}
            style={{
              color: activeTab === 'students' ? 'var(--app-nav-active)' : 'var(--app-nav-text)'
            }}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Students</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSelectTab('reports')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors cursor-pointer ${
              activeTab === 'reports' ? 'font-semibold' : 'opacity-80 hover:opacity-100'
            }`}
            style={{
              color: activeTab === 'reports' ? 'var(--app-nav-active)' : 'var(--app-nav-text)'
            }}
          >
            <BarChart3 className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Reports</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenMoreMenu}
          className={`flex flex-col items-center justify-center py-1.5 px-2 min-w-[56px] rounded-lg transition-colors cursor-pointer ${
            activeTab === 'reports' || activeTab === 'settings'
              ? 'font-semibold'
              : 'opacity-80 hover:opacity-100'
          }`}
          style={{
            color:
              activeTab === 'reports' || activeTab === 'settings'
                ? 'var(--app-nav-active)'
                : 'var(--app-nav-text)'
          }}
        >
          <MoreHorizontal className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">More</span>
        </button>
      </div>
    </nav>
  );
};
