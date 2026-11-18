# LEA Attendance Assistant — Supabase Database Setup, Auth & Role Provisioning

## 1. Environment Variables Classification

### Browser-Safe (Public) Variables
Set these in `.env` (or in your hosting provider's build/environment settings):
- `VITE_SUPABASE_URL` — Your Supabase project URL (`https://<project-ref>.supabase.co`).
- `VITE_SUPABASE_ANON_KEY` — Your Supabase public anon/publishable key.

**Why these are safe in the browser:** PostgreSQL **Row Level Security (RLS)** is enabled on all 5 tables (`profiles`, `classes`, `students`, `attendance_sessions`, `attendance_records`) and `anon` privileges are revoked. Without an authenticated staff JWT session, `anon` queries return 0 rows or permission denied.

### Server-Side ONLY Secrets (NEVER prefix with `VITE_`)
- `SUPABASE_SERVICE_ROLE_KEY` — Bypasses RLS. Never put this in frontend React code, `.env` `VITE_*` vars, or client storage.
- `GEMINI_API_KEY` — Server-side Express API key.
- `GOOGLE_APPLICATION_CREDENTIALS` / `credentials/*.json` — Server-side Google Cloud Vision service account key.

---

## 2. Applying the SQL Migrations

1. Create a free project in **Supabase** (https://supabase.com/dashboard).
2. Open **SQL Editor** in your Supabase Dashboard.
3. Run `supabase/migrations/001_initial_schema.sql` first.
4. Run `supabase/migrations/002_strict_roles_and_admin_only_writes.sql` so only the `admin` role can add, edit, or confirm school records, while `headteacher` and `visitor` roles are strictly read-only at the database level.

---

## 3. Provisioning the 3 School Logins Safely (No Hardcoded Passwords!)

You do **not** need personal email addresses for your users, and you should **never** store passwords inside application code.

1. In Supabase Dashboard, go to **Authentication → Providers → Email** and **turn OFF "Allow new users to sign up"** so no stranger on the internet can register an account.
2. Go to **Authentication → Users → Add user → Create new user**, check **Auto Confirm User**, and create these 3 accounts with strong passwords that you share privately with each person:
   - **School Admin** (Read & Write):
     - Email in Supabase: `admin@lea-wuse3.school` *(users can simply type `admin` in the app's Username box)*
   - **Head Teacher** (Read-Only Metrics, Reports & Records):
     - Email in Supabase: `headteacher@lea-wuse3.school` *(users can simply type `headteacher` in the app's Username box)*
   - **Visitor / Inspector** (Read-Only Reports & History):
     - Email in Supabase: `inspector@lea-wuse3.school` *(users can simply type `inspector` in the app's Username box)*
3. In **SQL Editor**, assign each account's exact database role:
   ```sql
   update public.profiles
   set role = 'admin', display_name = 'School Administrator'
   where id = (select id from auth.users where email = 'admin@lea-wuse3.school');

   update public.profiles
   set role = 'headteacher', display_name = 'Head Teacher'
   where id = (select id from auth.users where email = 'headteacher@lea-wuse3.school');

   update public.profiles
   set role = 'visitor', display_name = 'School Inspector'
   where id = (select id from auth.users where email = 'inspector@lea-wuse3.school');
   ```
   *(If you already created an account using your personal email such as `yourname@gmail.com`, set its `role = 'admin'` the exact same way—users can sign in with either a short username or full email.)*

---

## 4. Verification & RLS Policy Testing Checklist

1. Unauthenticated (`anon`) `SELECT * FROM students` or `attendance_records` fails with permission denied (`42501`).
2. Signed-in `headteacher` or `visitor` can read Dashboard metrics, Reports, and Attendance History, but any `INSERT` / `UPDATE` / `DELETE` or `confirm_attendance_session` call fails with `42501` at the database RLS layer.
3. Signed-in `admin` can add/edit students, scan registers, and confirm attendance sessions atomically.
4. Signing out clears local session state and returns immediately to the protected Sign-In screen.
