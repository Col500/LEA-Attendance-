-- ============================================================================
-- LEA Attendance Assistant - Strict 3-Role RBAC & Admin-Only Write Policies
-- Roles:
--   'admin'       -> Full read & write access (classes, students, sessions, confirmation)
--   'headteacher' -> Read-only access to metrics, reports, history, and student roster
--   'visitor'     -> Read-only access to metrics, reports, and attendance history
-- New auth users default to 'visitor' (read-only), never 'admin' or 'teacher'.
-- ============================================================================

-- 1. Extend role constraint to support admin, headteacher, visitor (+ legacy teacher/viewer)
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'headteacher', 'visitor', 'teacher', 'viewer'));

alter table public.profiles
  alter column role set default 'visitor';

-- 2. Default newly provisioned users to 'visitor' (strict least-privilege)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'staff'), '@', 1)),
    'visitor'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 3. Read policies: allow all authenticated school profiles (admin, headteacher, visitor, teacher, viewer)
drop policy if exists "classes_select_authenticated_staff" on public.classes;
create policy "classes_select_authenticated_staff"
  on public.classes for select to authenticated
  using (public.current_user_role() in ('admin', 'headteacher', 'visitor', 'teacher', 'viewer'));

drop policy if exists "students_select_authenticated_staff" on public.students;
create policy "students_select_authenticated_staff"
  on public.students for select to authenticated
  using (public.current_user_role() in ('admin', 'headteacher', 'visitor', 'teacher', 'viewer'));

drop policy if exists "sessions_select_authenticated_staff" on public.attendance_sessions;
create policy "sessions_select_authenticated_staff"
  on public.attendance_sessions for select to authenticated
  using (public.current_user_role() in ('admin', 'headteacher', 'visitor', 'teacher', 'viewer'));

drop policy if exists "records_select_authenticated_staff" on public.attendance_records;
create policy "records_select_authenticated_staff"
  on public.attendance_records for select to authenticated
  using (public.current_user_role() in ('admin', 'headteacher', 'visitor', 'teacher', 'viewer'));

-- 4. Strict ADMIN-ONLY write policies (headteacher & visitor are read-only at database level)
drop policy if exists "classes_write_staff" on public.classes;
create policy "classes_write_admin_only"
  on public.classes for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "students_write_staff" on public.students;
create policy "students_write_admin_only"
  on public.students for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "sessions_insert_staff" on public.attendance_sessions;
create policy "sessions_insert_admin_only"
  on public.attendance_sessions for insert to authenticated
  with check (
    public.current_user_role() = 'admin'
    and created_by = auth.uid()
  );

drop policy if exists "sessions_update_staff" on public.attendance_sessions;
create policy "sessions_update_admin_only"
  on public.attendance_sessions for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "records_insert_staff" on public.attendance_records;
create policy "records_insert_admin_only"
  on public.attendance_records for insert to authenticated
  with check (public.current_user_role() = 'admin');

drop policy if exists "records_update_staff" on public.attendance_records;
create policy "records_update_admin_only"
  on public.attendance_records for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- 5. Enforce admin-only role inside atomic session confirmation RPC
create or replace function public.confirm_attendance_session(
  p_class_id uuid,
  p_attendance_date date,
  p_attendance_period text,
  p_source_type text,
  p_status text,
  p_source_draft_id text,
  p_notes text,
  p_records jsonb
)
returns public.attendance_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_session public.attendance_sessions;
begin
  if v_uid is null then
    raise exception 'Authentication required to confirm attendance session.' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role <> 'admin' then
    raise exception 'Read-only access (role=%). Only an authorized School Admin can confirm attendance sessions.', coalesce(v_role, 'none') using errcode = '42501';
  end if;

  if p_source_draft_id is not null and exists (
    select 1 from public.attendance_sessions where source_draft_id = p_source_draft_id
  ) then
    raise exception 'DUPLICATE_DRAFT_CONFIRMATION: This review draft (%) has already been confirmed.', p_source_draft_id using errcode = '23505';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'Cannot confirm an empty attendance session without attendance records.' using errcode = '22023';
  end if;

  insert into public.attendance_sessions (
    class_id,
    attendance_date,
    attendance_period,
    source_type,
    status,
    source_draft_id,
    notes,
    created_by,
    confirmed_at
  )
  values (
    p_class_id,
    p_attendance_date,
    p_attendance_period,
    p_source_type,
    case when p_status in ('CONFIRMED', 'FLAGGED') then p_status else 'CONFIRMED' end,
    p_source_draft_id,
    p_notes,
    v_uid,
    now()
  )
  returning * into v_session;

  insert into public.attendance_records (
    attendance_session_id,
    student_id,
    row_number,
    week_identifier,
    day_of_week,
    status,
    original_ai_status,
    reviewed,
    corrected_by,
    corrected_at
  )
  select
    v_session.id,
    nullif(rec ->> 'student_id', '')::uuid,
    (rec ->> 'row_number')::integer,
    coalesce(nullif(rec ->> 'week_identifier', ''), 'Week 1'),
    rec ->> 'day_of_week',
    rec ->> 'status',
    nullif(rec ->> 'original_ai_status', ''),
    coalesce((rec ->> 'reviewed')::boolean, false),
    case
      when coalesce((rec ->> 'was_corrected')::boolean, false) then v_uid
      else null
    end,
    case
      when coalesce((rec ->> 'was_corrected')::boolean, false) then now()
      else null
    end
  from jsonb_array_elements(p_records) as rec;

  return v_session;
end;
$$;
