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
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
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
        className={`fixed md:sticky top-0 md:top-auto inset-y-0 left-0 z-50 w-72 border-r flex flex-col transition-all duration-200 ease-in-out md:translate-x-0 print:hidden ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
        style={{
          minHeight: '100dvh',
          backgroundColor: 'var(--app-sidebar-bg)',
          borderColor: 'var(--app-sidebar-border)',
          color: 'var(--app-sidebar-text)'
        }}
      >
        {/* Sidebar Brand Header */}
        <div
          className="p-4 sm:p-5 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--app-sidebar-border)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-lg text-white flex items-center justify-center font-bold shadow-xs shrink-0"
              style={{ backgroundColor: 'var(--app-accent)' }}
            >
              <School className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div
                className="text-xs font-semibold truncate"
                style={{ color: 'var(--app-sidebar-active-text)' }}
              >
                Primary Education{school.state ? ` · ${school.state}` : ''}
              </div>
              <div
                className="text-sm font-bold leading-tight truncate"
                style={{ color: 'var(--app-sidebar-text)' }}
              >
                {school.name}
              </div>
              {([school.subLocation, school.zone, school.city].filter(Boolean).length > 0 || school.lga) && (
                <div
                  className="text-[11px] truncate"
                  style={{ color: 'var(--app-sidebar-muted)' }}
                >
                  {[school.subLocation, school.zone, school.city].filter(Boolean).join(' · ') || school.lga}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            className="md:hidden p-2 rounded-lg hover:opacity-80 cursor-pointer"
            style={{ color: 'var(--app-sidebar-muted)' }}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick info chip */}
        <div
          className="px-4 py-2.5 border-b text-[11px] flex items-center justify-between"
          style={{
            backgroundColor: 'var(--app-sidebar-surface)',
            borderColor: 'var(--app-sidebar-border)',
            color: 'var(--app-sidebar-text)'
          }}
        >
          <span style={{ color: 'var(--app-sidebar-muted)' }}>Academic Year:</span>
          <span className="font-semibold">
            {school.academicSession.split(' ')[0]} · {school.currentTerm}
          </span>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div
            className="px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: 'var(--app-sidebar-muted)' }}
          >
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
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors text-left group cursor-pointer ${
                  isActive ? 'font-semibold shadow-xs' : 'font-medium hover:opacity-95'
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: 'var(--app-accent)',
                        color: '#ffffff'
                      }
                    : {
                        color: 'var(--app-sidebar-text)'
                      }
                }
              >
                <Icon
                  className="w-5 h-5 shrink-0 transition-colors"
                  style={
                    isActive
                      ? { color: '#ffffff' }
                      : { color: 'var(--app-sidebar-muted)' }
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="truncate">{item.label}</span>
                  </div>
                  <div
                    className="text-[11px] truncate"
                    style={
                      isActive
                        ? { color: 'rgba(255,255,255,0.85)' }
                        : { color: 'var(--app-sidebar-muted)' }
                    }
                  >
                    {item.description}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* School Administrator Profile Footer */}
        <div
          className="p-3 border-t"
          style={{
            borderColor: 'var(--app-sidebar-border)',
            backgroundColor: 'var(--app-sidebar-surface)'
          }}
        >
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 border"
              style={{
                backgroundColor: 'var(--app-sidebar-bg)',
                borderColor: 'var(--app-sidebar-border)',
                color: 'var(--app-sidebar-active-text)'
              }}
            >
              <UserCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="text-xs font-semibold truncate"
                style={{ color: 'var(--app-sidebar-text)' }}
              >
                {staffProfile?.displayName || school.administratorName.split('(')[0].trim()}
              </div>
              <div
                className="text-[10px] truncate"
                style={{ color: 'var(--app-sidebar-muted)' }}
              >
                {staffProfile ? getRoleDisplayLabel(staffProfile.role) : 'School Administrator'}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
