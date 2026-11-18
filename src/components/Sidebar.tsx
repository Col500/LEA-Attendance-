import React from 'react';
import {
  LayoutDashboard,
  ScanLine,
  Users,
  ClipboardCheck,
  BarChart3,
  Settings,
  X,
  School,
  UserCheck
} from 'lucide-react';
import { SchoolInfo, StaffProfile, StaffRole } from '../types/attendance';
import { canAccessNavTab, getRoleDisplayLabel } from '../lib/authRoles';

export type NavTab = 'dashboard' | 'scan' | 'students' | 'records' | 'reports' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  school: SchoolInfo;
  userRole?: StaffRole | null;
  staffProfile?: StaffProfile | null;
}

interface NavItemConfig {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  description: string;
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'School overview & daily counts'
  },
  {
    id: 'scan',
    label: 'Scan Register',
    icon: ScanLine,
    description: 'Digitize physical paper sheets'
  },
  {
    id: 'students',
    label: 'Students',
    icon: Users,
    description: 'Class rosters & student directory'
  },
  {
    id: 'records',
    label: 'Attendance Records',
    icon: ClipboardCheck,
    description: 'Daily logs & verification status'
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    description: 'Attendance rates & term insights'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    description: 'School details & system profile'
  }
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
  school,
  userRole,
  staffProfile
}) => {
  const visibleNavItems = userRole
    ? NAV_ITEMS.filter((item) => canAccessNavTab(userRole, item.id))
    : NAV_ITEMS;
  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed md:sticky top-0 md:top-auto inset-y-0 left-0 z-50 w-72 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-200 ease-in-out md:translate-x-0 print:hidden ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
        style={{ minHeight: '100dvh' }}
      >
        {/* Sidebar Brand Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold shadow-xs border border-emerald-600/60 shrink-0">
              <School className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400">
                Primary Education{school.state ? ` · ${school.state}` : ''}
              </div>
              <div className="text-sm font-bold text-white leading-tight">
                {school.name}
              </div>
              {([school.subLocation, school.zone, school.city].filter(Boolean).length > 0 || school.lga) && (
                <div className="text-[11px] text-slate-400">
                  {[school.subLocation, school.zone, school.city].filter(Boolean).join(' · ') || school.lga}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick info chip */}
        <div className="px-4 py-2.5 bg-slate-800/60 border-b border-slate-800/80 text-[11px] text-slate-300 flex items-center justify-between">
          <span className="text-slate-400">Academic Year:</span>
          <span className="font-semibold text-slate-200">{school.academicSession.split(' ')[0]} · {school.currentTerm}</span>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase text-slate-400">
            Main Navigation
          </div>

          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors text-left group ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    isActive ? 'text-white' : 'text-slate-400 group-hover:text-emerald-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded ${
                        isActive ? 'bg-emerald-800 text-white' : 'bg-slate-800 text-emerald-400'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <div className={`text-[11px] truncate ${isActive ? 'text-emerald-100' : 'text-slate-500'}`}>
                    {item.description}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* School Administrator Profile Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="w-8 h-8 rounded-full bg-slate-800 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 border border-slate-700">
              <UserCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-200 truncate">
                {staffProfile?.displayName || school.administratorName.split('(')[0].trim()}
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {staffProfile ? getRoleDisplayLabel(staffProfile.role) : 'School Administrator'}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
