-- ============================================================================
-- LEA Attendance Assistant - Admin-Only Delete Policies for Attendance Records
-- Allows authenticated School Admin users to delete saved attendance sessions
-- (cascading to attendance_records) while keeping Head Teacher & Visitor read-only.
-- ============================================================================

grant delete on public.attendance_sessions to authenticated;
grant delete on public.attendance_records to authenticated;

drop policy if exists "sessions_delete_admin_only" on public.attendance_sessions;
create policy "sessions_delete_admin_only"
  on public.attendance_sessions for delete to authenticated
  using (public.current_user_role() = 'admin');

drop policy if exists "records_delete_admin_only" on public.attendance_records;
create policy "records_delete_admin_only"
  on public.attendance_records for delete to authenticated
  using (public.current_user_role() = 'admin');
