-- ============================================================================
-- LEA Attendance Assistant - Initial PostgreSQL / Supabase Migration
-- Creates: profiles, classes, students, attendance_sessions, attendance_records
-- Security: Strict Row Level Security (RLS), zero anonymous access, atomic confirmation RPC
-- ============================================================================

create extension if not exists "pgcrypto";

-- Shared updated_at timestamp trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. PROFILES (Linked 1-to-1 with Supabase Auth users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'teacher' check (role in ('admin', 'teacher', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Automatically provision a profile row when a new auth user signs up
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
    'teacher'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper function to inspect caller role without triggering recursive RLS evaluation
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 2. CLASSES
-- ----------------------------------------------------------------------------
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  class_teacher text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_classes_updated_at on public.classes;
create trigger trg_classes_updated_at
  before update on public.classes
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. STUDENTS
-- ----------------------------------------------------------------------------
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  student_number integer not null check (student_number > 0),
  full_name text not null,
  admission_number text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_student_number_per_class unique (class_id, student_number)
);

create index if not exists idx_students_class_id on public.students(class_id);

drop trigger if exists trg_students_updated_at on public.students;
create trigger trg_students_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. ATTENDANCE_SESSIONS
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  attendance_date date,
  attendance_period text not null,
  source_type text not null check (source_type in ('google-cloud-vision', 'gemini-vision', 'manual', 'validation-sample')),
  status text not null default 'CONFIRMED' check (status in ('DRAFT', 'CONFIRMED', 'FLAGGED')),
  source_draft_id text unique,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists idx_attendance_sessions_class_id on public.attendance_sessions(class_id);
create index if not exists idx_attendance_sessions_date on public.attendance_sessions(attendance_date desc);

-- ----------------------------------------------------------------------------
-- 5. ATTENDANCE_RECORDS
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  attendance_session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid references public.students(id) on delete restrict,
  row_number integer check (row_number is null or row_number > 0),
  week_identifier text not null default 'Week 1',
  day_of_week text not null check (day_of_week in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')),
  status text not null check (status in ('PRESENT', 'ABSENT', 'BLANK', 'UNCERTAIN')),
  original_ai_status text check (original_ai_status in ('PRESENT', 'ABSENT', 'BLANK', 'UNCERTAIN')),
  reviewed boolean not null default false,
  corrected_by uuid references public.profiles(id) on delete set null,
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint uq_record_session_student_week_day unique (attendance_session_id, student_id, week_identifier, day_of_week)
);

create index if not exists idx_attendance_records_session on public.attendance_records(attendance_session_id);
create index if not exists idx_attendance_records_student on public.attendance_records(student_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Zero anonymous public access. Only authenticated school staff with profiles.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

-- Explicitly revoke anonymous privileges on all school tables
revoke all on public.profiles from anon;
revoke all on public.classes from anon;
revoke all on public.students from anon;
revoke all on public.attendance_sessions from anon;
revoke all on public.attendance_records from anon;

-- Grant table privileges to authenticated role (subject to RLS policies below)
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update on public.attendance_sessions to authenticated;
grant select, insert, update on public.attendance_records to authenticated;

-- PROFILES policies
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "profiles_update_own_display_name" on public.profiles;
create policy "profiles_update_own_display_name"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_user_role());

-- CLASSES policies
drop policy if exists "classes_select_authenticated_staff" on public.classes;
create policy "classes_select_authenticated_staff"
  on public.classes for select to authenticated
  using (public.current_user_role() in ('admin', 'teacher', 'viewer'));

drop policy if exists "classes_write_staff" on public.classes;
create policy "classes_write_staff"
  on public.classes for all to authenticated
  using (public.current_user_role() in ('admin', 'teacher'))
  with check (public.current_user_role() in ('admin', 'teacher'));

-- STUDENTS policies
drop policy if exists "students_select_authenticated_staff" on public.students;
create policy "students_select_authenticated_staff"
  on public.students for select to authenticated
  using (public.current_user_role() in ('admin', 'teacher', 'viewer'));

drop policy if exists "students_write_staff" on public.students;
create policy "students_write_staff"
  on public.students for all to authenticated
  using (public.current_user_role() in ('admin', 'teacher'))
  with check (public.current_user_role() in ('admin', 'teacher'));

-- ATTENDANCE_SESSIONS policies
drop policy if exists "sessions_select_authenticated_staff" on public.attendance_sessions;
create policy "sessions_select_authenticated_staff"
  on public.attendance_sessions for select to authenticated
  using (public.current_user_role() in ('admin', 'teacher', 'viewer'));

drop policy if exists "sessions_insert_staff" on public.attendance_sessions;
create policy "sessions_insert_staff"
  on public.attendance_sessions for insert to authenticated
  with check (
    public.current_user_role() in ('admin', 'teacher')
    and created_by = auth.uid()
  );

drop policy if exists "sessions_update_staff" on public.attendance_sessions;
create policy "sessions_update_staff"
  on public.attendance_sessions for update to authenticated
  using (public.current_user_role() in ('admin', 'teacher'))
  with check (public.current_user_role() in ('admin', 'teacher'));

-- ATTENDANCE_RECORDS policies
drop policy if exists "records_select_authenticated_staff" on public.attendance_records;
create policy "records_select_authenticated_staff"
  on public.attendance_records for select to authenticated
  using (public.current_user_role() in ('admin', 'teacher', 'viewer'));

drop policy if exists "records_insert_staff" on public.attendance_records;
create policy "records_insert_staff"
  on public.attendance_records for insert to authenticated
  with check (public.current_user_role() in ('admin', 'teacher'));

drop policy if exists "records_update_staff" on public.attendance_records;
create policy "records_update_staff"
  on public.attendance_records for update to authenticated
  using (public.current_user_role() in ('admin', 'teacher'))
  with check (public.current_user_role() in ('admin', 'teacher'));

-- ============================================================================
-- ATOMIC MULTI-RECORD CONFIRMATION RPC
-- Saves attendance_sessions + all attendance_records inside one PostgreSQL TX.
-- SECURITY INVOKER ensures caller's auth.uid() and RLS policies remain enforced.
-- ============================================================================
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
  if v_role not in ('admin', 'teacher') then
    raise exception 'Insufficient permissions (role=%). Admin or teacher profile required.', coalesce(v_role, 'none') using errcode = '42501';
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

grant execute on function public.confirm_attendance_session(uuid, date, text, text, text, text, text, jsonb) to authenticated;
