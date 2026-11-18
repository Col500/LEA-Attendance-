import type { StaffRole } from '../types/attendance';

export type ProtectedTab =
  | 'dashboard'
  | 'scan'
  | 'students'
  | 'records'
  | 'reports'
  | 'settings';

export const SCHOOL_LOGIN_DOMAIN = 'lea-wuse3.school';

/**
 * Resolves either a full email or a short school username ('admin', 'headteacher', 'visitor')
 * into its Supabase Auth email identifier. No passwords are stored or hardcoded here.
 */
export function resolveLoginIdentifier(identifier: string): string {
  const cleaned = identifier.trim().toLowerCase();
  if (!cleaned) return '';
  if (cleaned.includes('@')) {
    return cleaned;
  }
  const safeSlug = cleaned.replace(/[^a-z0-9._-]/g, '');
  if (!safeSlug) return '';
  return `${safeSlug}@${SCHOOL_LOGIN_DOMAIN}`;
}

export function isAdminRole(role?: StaffRole | null): boolean {
  return role === 'admin';
}

export function canWriteSchoolRecords(role?: StaffRole | null): boolean {
  return role === 'admin';
}

export function canAccessNavTab(role: StaffRole | null | undefined, tab: ProtectedTab): boolean {
  if (!role) return false;
  if (role === 'admin') {
    return true;
  }
  if (role === 'headteacher') {
    // Head Teacher: read-only metrics, reports, history, and student directory
    return tab === 'dashboard' || tab === 'reports' || tab === 'records' || tab === 'students';
  }
  // Visitor / Inspector / legacy read-only roles: overview metrics, reports, and history
  return tab === 'dashboard' || tab === 'reports' || tab === 'records';
}

export function getRoleDisplayLabel(role?: StaffRole | null): string {
  switch (role) {
    case 'admin':
      return 'School Admin (Read & Write)';
    case 'headteacher':
      return 'Head Teacher (Read-Only)';
    case 'visitor':
    case 'viewer':
      return 'Visitor / Inspector (Read-Only)';
    case 'teacher':
      return 'Staff Viewer (Read-Only)';
    default:
      return 'Unauthenticated';
  }
}
