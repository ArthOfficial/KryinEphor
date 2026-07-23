# EduNex / SaaSSchool Final Audit Report

Audit date: 2026-06-14  
Scope: frontend linking, backend behavior, Supabase schema/migrations, Edge Functions, multi-tenancy, AuthN/AuthZ, security, browser console/network behavior.

## Executive Summary

The app builds, logs in with `admin@admin.com / 12341234`, and routes the account as `superadmin`. The critical production blocker is not the Vite build. The blocker is the live backend/data model: school provisioning and user creation both fail with `Edge Function returned a non-2xx status code`, existing non-superadmin users are shown as platform-core users with no school, and the checked-in schema/security story is inconsistent.

I reproduced the reported Edge Function error in Chrome on `http://127.0.0.1:4173`:

- Login succeeded and redirected to `/super-admin`.
- `/database` showed `0` schools.
- Creating a normal audit school/admin failed in the modal with `Edge Function returned a non-2xx status code`.
- Console showed `Admin creation failed`, stack at `src/pages/SuperAdminDatabase.tsx`, and `School creation flow failed`.
- `/users` showed `5 users across 0 schools and platform core`, including admin/teacher accounts that should not be platform-core.
- Add User defaulted to `Admin` + `Platform Core` and failed with the same generic Edge Function error.

I also made scoped fixes so the frontend extracts real Supabase Edge Function response bodies, and the Edge Functions reject non-superadmin users without a school. Build passes after these fixes. Lint still fails due to existing quality issues.

## Evidence Collected

- `npm run build`: passes.
- `npm run lint`: fails with 22 errors and 1 warning, mostly `no-explicit-any`, plus `SystemAlerts.tsx` component creation during render.
- Browser/Chrome audit: login, dashboard, database, users, finance, alerts, settings, dashboard routes.
- Supabase CLI: installed CLI is `2.76.15`; linked project ref is `qgefjcuulsofevmxfqxe`.
- Supabase remote function listing failed with `401 Unauthorized`, so live Supabase MCP/CLI inspection was not available in this session.
- AgentShield scan: grade `B (86/100)`, no hardcoded secrets found, but high findings in local Claude/ECC config around missing deny list and unrestricted agent tool definitions.

## Fixes Applied

Files changed:

- `src/lib/functionErrors.ts`: added Supabase Functions error extractor for `FunctionsHttpError`, `FunctionsRelayError`, and `FunctionsFetchError`.
- `src/pages/SuperAdminDatabase.tsx`: school/admin update and creation now show the real Edge Function response body when Supabase returns non-2xx.
- `src/pages/UserManagement.tsx`: add/update/reset user flows now show real function response messages.
- `src/pages/SuperAdminDashboard.tsx`: admin update flow now extracts real function response messages.
- `supabase/functions/create_tenant_admin/index.ts`: now requires `SUPABASE_ANON_KEY`, rejects `admin/teacher/student/parent/accountant/receptionist` without a school, and writes role/school to `app_metadata` instead of user-editable metadata.
- `supabase/functions/update_admin/index.ts`: now requires `SUPABASE_ANON_KEY`, rejects non-superadmin role updates to blank school, and syncs role/school into `app_metadata`.
- `supabase/migrations/20260614060000_harden_edge_function_errors_and_roles.sql`: changes `handle_new_user()` to read role/school from `raw_app_meta_data`, not `raw_user_meta_data`.

## Critical Issues

### 1. Edge Function error is real but hidden by frontend

Severity: Critical  
Area: Backend / Frontend linking

The UI was using `fnError.message`, which only returns Supabase's generic `Edge Function returned a non-2xx status code`. For `FunctionsHttpError`, the real function body must be read from `error.context.json()`. This made every backend failure look identical.

Status: frontend fixed locally. Edge Functions still need deployment and live verification.

### 2. User/school data is already inconsistent

Severity: Critical  
Area: Multi-tenancy / AuthZ

Browser evidence: `/users` shows 5 users, 0 schools, and all users grouped under platform core. Non-superadmin roles such as admin and teacher must have `school_id`; otherwise they are not safely tenant-scoped.

Likely impact:

- Tenant isolation is unenforceable for those accounts.
- Role checks depending on `school_id` fail or behave unpredictably.
- School creation/admin provisioning can fail due to missing tenant context or constraints.

### 3. Base schema claims RLS but contains zero policies

Severity: Critical  
Area: Database / RLS

`supabase/schema.sql` says RLS is enabled on 54 tables with 211 policies, but `rg "CREATE POLICY" supabase/schema.sql` returns no policies. The comment says policies are applied by migrations, but the migrations only patch selected policies and do not represent a full reproducible 211-policy security baseline.

Impact: fresh environments can be built with tables but without complete RLS unless there are untracked SQL operations.

### 4. Auth trigger trusted user-editable metadata for role and school

Severity: Critical  
Area: AuthN/AuthZ / Supabase security

`handle_new_user()` in the base schema reads:

- `NEW.raw_user_meta_data ->> 'role'`
- `NEW.raw_user_meta_data ->> 'school_id'`

Supabase user metadata is user-editable and must not be used for authorization attributes. This can create privilege/tenant assignment risks if any signup path allows metadata injection.

Status: migration added to read `raw_app_meta_data`; Edge Function creation updated to write role/school into `app_metadata`.

### 5. Add User UI allows invalid default role/school combination

Severity: High  
Area: Frontend / AuthZ

The Add User modal defaults to `Admin` and `Platform Core`. That is invalid for tenant SaaS: only `superadmin/owner` should be platform-level. Admin, teacher, student, parent, accountant, and receptionist need a school.

Status: backend Edge Function locally hardened. UI should also disable `Platform Core` unless role is `superadmin`.

### 6. School creation is not atomic

Severity: High  
Area: Backend / Data integrity

`SuperAdminDatabase.tsx` inserts a school directly from the browser, then calls `create_tenant_admin`, then tries to delete the school if function creation fails. This is a distributed transaction implemented in the client.

Problems:

- If school insert succeeds and rollback delete fails, orphan schools remain.
- Client code performs tenant provisioning mutations directly.
- RLS can block cleanup.
- Logs can say creation failed while partial records remain.

Fix direction: move school + admin + membership provisioning into one server-side Edge Function or Postgres RPC using a transaction.

### 7. `create_tenant_admin` does not create membership for platform-level users but allowed platform-level admin

Severity: High  
Area: Multi-tenancy

Before the local fix, `create_tenant_admin` accepted `role = admin` with no `schoolId`, created a profile with no `school_id`, and skipped membership creation. That matches the existing observed "Core admins/teachers" problem.

Status: locally hardened.

### 8. `update_admin` allowed role/school drift

Severity: High  
Area: AuthZ

`update_admin` updated profile role/school and auth user fields separately. It did not previously reject blank school for non-superadmin roles. It also did not keep app metadata aligned with role/school changes.

Status: locally hardened, but should be verified after deployment.

### 9. Direct profile updates bypass Edge Function policy

Severity: High  
Area: AuthZ

`UserManagement.tsx` updates `profiles` directly before calling `update_admin` for email/password. That means role, school, active status, and metadata permissions can be changed through client-side table writes if RLS permits them. Authorization must be enforced server-side, not only by React routes.

Fix direction: all role/school/status/permissions updates should go through `update_admin` or a dedicated admin RPC.

### 10. Attendance insert path is broken against schema

Severity: High  
Area: Frontend / Database

`AttendancePage.tsx` inserts:

```ts
{ student_id, status, date }
```

But `supabase/schema.sql` defines `attendance.school_id` and `attendance.class_id` as `NOT NULL`. With the checked-in schema, creating a new attendance record from the UI will fail unless an untracked trigger/default exists.

### 11. Route authorization is client-side only

Severity: High  
Area: AuthZ

`ProtectedRoute` hides routes by local role state, but data access still depends entirely on RLS/Edge Function checks. This is acceptable only if RLS and server checks are complete. Current schema/migration evidence does not prove that.

### 12. `setup.sql` is unsafe and conflicts with later migrations

Severity: High  
Area: Database / Security

`supabase/setup.sql` creates `system_logs` with:

- `WITH CHECK (true)` for authenticated insert.
- anon insert policy with `WITH CHECK (true)`.
- FK directly to `auth.users`.

Later migrations try to remove or replace these patterns. Keeping this setup script around is dangerous because running it manually can reintroduce insecure policies.

### 13. Migration syntax and safety concerns

Severity: High  
Area: Database migrations

`20260610_phase1_tenant_isolation.sql` uses `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS`, which is not valid PostgreSQL syntax for table constraints. It also performs broad backfills and `ALTER COLUMN SET NOT NULL`, which can fail or lock on real data.

`20260610_phase0_hotfix.sql` deletes non-superadmin profiles with null `school_id`. That is data-destructive and should not be in an emergency migration without a backup, explicit review, and dry-run counts.

### 14. Base schema uses `SECURITY DEFINER` functions in public schema

Severity: Medium/High  
Area: Database security

The project has public `SECURITY DEFINER` functions. Some set `search_path`, but `refresh_dashboard_metrics()` in base schema shows `SECURITY DEFINER` without locked `search_path`; Phase 0 later alters it. Ensure every deployed privileged function has `SET search_path = public` or a private schema, and avoid privileged functions in exposed schemas.

### 15. Missing complete role model in frontend route map

Severity: Medium  
Area: Product / AuthZ

Current roles include:

- `superadmin`
- `admin`
- `teacher`
- `student`
- `parent`
- `receptionist`
- `accountant`

The user asked for parent, teacher, admin, superadmin/owner and others. `owner` is not modeled separately. If owner means platform superadmin, rename clearly; if owner differs from superadmin, add it to DB role seeds, TypeScript `UserRole`, routes, Edge Function valid roles, and RLS.

## Frontend Audit

Working:

- Landing page renders cleanly.
- Login modal opens.
- Login with provided admin credentials succeeds.
- `/super-admin`, `/database`, `/users`, `/finance`, `/alerts`, `/settings`, and `/dashboard` render.

Problems:

- Generic Edge Function errors hid backend root causes. Fixed locally.
- Header shows `Administrator - Westwood Academy` while database has 0 schools visible.
- `/attendance` redirects to `/` for superadmin because route allows only admin/teacher. This may be intentional, but dashboard quick actions include attendance-like workflows for superadmin.
- Buttons like Google/GitHub login are visible but appear nonfunctional placeholders.
- Finance and dashboard show mostly zero/empty data, suggesting missing seed/tenant data or RLS blockage.
- System Alerts shows stale metric alert with very high age.
- Lint failure indicates frontend quality gates are not production-clean.

## Backend Audit

Edge Functions are better than direct service-role use in the browser, but the backend boundary is incomplete.

Problems:

- School creation starts with direct browser insert into `schools`.
- User profile edits directly update `profiles` from the client.
- Function errors were not surfaced.
- Edge Functions need stronger schema validation for email, password length/strength, role enum, school UUID format, and payload shape.
- CORS defaults to `*` if `ALLOWED_ORIGIN` is missing.
- `create_tenant_admin` creates auth user, profile, then membership in multiple steps. Membership failure is logged as non-fatal, which can create users without active tenant membership.
- `update_admin` updates profile first, then auth user, then attempts manual rollback. This is not truly transactional.

## Database Audit

Strengths:

- Schema has tenant keys on many tables.
- Indexes exist for many `school_id` columns.
- Roles and permissions tables exist.
- There are attempts to patch tenant isolation.

Problems:

- Base schema has no policies despite claiming RLS/policies.
- `setup.sql` can reintroduce dangerous logging policies.
- Some migrations are not safe to run blindly on production.
- No automated migration verification is present.
- No tests prove RLS behavior by role.
- Views such as `invoice_aggregates` / `school_summary_metrics` should be checked for `security_invoker = true` or access revoked; source search did not confirm secure view definitions in checked-in SQL.
- `profiles.school_id` base FK uses `ON DELETE SET NULL`, conflicting with tenant-required users; later migration changes to `RESTRICT`.

## Multi-Tenancy Audit

Current risk is high.

The live browser state already shows broken tenant assignment: non-superadmin users exist in platform core. In a school SaaS this is a core isolation failure, not cosmetic data.

Required invariant:

- `superadmin/owner`: `school_id` may be null.
- `admin`, `teacher`, `student`, `parent`, `accountant`, `receptionist`: `school_id` must be non-null.
- Every tenant-scoped data table must have `school_id`.
- Every tenant-scoped RLS policy must include school filtering and role/self rules.
- Every Edge Function must verify caller role and school before using service role.

## AuthN/AuthZ Audit

Problems:

- Auth role is loaded from `profiles.role`; this is fine only if profile writes are tightly protected.
- Previous trigger read authorization fields from user metadata; fixed locally in migration.
- UserManagement can update role/school/permissions directly.
- Roles exist in multiple places: `src/config/roles.ts`, Edge Function `VALID_ROLES`, DB seed roles, frontend `ROLE_CONFIG`. Drift is likely.
- `superadmin` route access works, but server-side enforcement must be the real source of truth.

Recommended role model:

- `owner` or `superadmin`: platform-wide, no school required.
- `admin`: one school, can manage school-level users/settings.
- `teacher`: one school, class/attendance/homework permissions.
- `student`: one school, self-owned academic data.
- `parent`: one school, linked to students only through `parent_student`.
- `accountant`: one school, finance permissions.
- `receptionist`: one school, visitors/inquiries permissions.

## Security Audit

Findings:

- No hardcoded Supabase service role in browser code found.
- Private env files exist under `PRIVATE/`; Vite uses `envDir: './PRIVATE'`, so care is required to ensure only `VITE_` variables are exposed.
- Password reset flow references `reset-password`, but no local `supabase/functions/reset-password` exists. The client-side `VITE_SECURITY_CODE` flow is weak and should be removed.
- CORS `ALLOWED_ORIGIN || '*'` is unsafe for production Edge Functions.
- AgentShield found no hardcoded secrets in scanned Claude config, but found high configuration risks: no deny list and unrestricted agent tool definitions.
- UI does not use `dangerouslySetInnerHTML`, which reduces obvious XSS risk. React escaping should protect simple malicious school names, but server-side validation should still reject script-like names/subdomains.

## SQL Editor Guidance

Do not run random SQL in Supabase SQL Editor to "see what happens." Use read-only diagnostic SQL first, then apply reviewed migrations.

Recommended read-only SQL to run and why:

```sql
-- Confirm non-superadmin users with missing tenant context.
select id, email, role, school_id
from public.profiles
where role <> 'superadmin' and school_id is null;
```

```sql
-- Confirm current RLS state and policy coverage.
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

```sql
-- List policies actually deployed.
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

```sql
-- Check risky permissive insert policies.
select tablename, policyname, with_check
from pg_policies
where schemaname = 'public'
  and (with_check = 'true' or with_check is null)
order by tablename;
```

```sql
-- Check functions that run with elevated privileges.
select n.nspname as schema, p.proname, p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef = true
order by p.proname;
```

```sql
-- Check views for security_invoker.
select schemaname, viewname, definition
from pg_views
where schemaname = 'public'
order by viewname;
```

```sql
-- Confirm deployed Edge Function-created users have memberships.
select p.id, p.email, p.role, p.school_id, m.id as membership_id, m.status
from public.profiles p
left join public.memberships m on m.user_id = p.id and m.school_id = p.school_id
where p.role <> 'superadmin'
order by p.email;
```

Only after reviewing those results should you apply the new migration:

```sql
-- Apply only as a reviewed migration, not as ad hoc SQL:
-- supabase/migrations/20260614060000_harden_edge_function_errors_and_roles.sql
```

Why: it changes the auth trigger to stop trusting user-editable metadata for role and school.

## 30-Day Remediation Plan

1. Deploy updated Edge Functions and migration.
2. Run the read-only SQL diagnostics above.
3. Fix existing profiles so only superadmin/owner users have null `school_id`.
4. Move school provisioning fully server-side.
5. Move all user/role/permission edits server-side.
6. Replace password reset with Supabase Auth recovery or a server-generated OTP.
7. Make RLS policy coverage reproducible in migrations.
8. Add tests for each role and tenant boundary.
9. Fix lint failures.
10. Add CI: build, lint, migration validation, RLS tests.

## 90-Day Enterprise Readiness Roadmap

1. Canonicalize roles in one shared DB enum/table plus generated frontend types.
2. Add audit logging server-side with immutable policies.
3. Add tenant-aware integration tests using two schools and all roles.
4. Add rate limiting for Edge Functions.
5. Add backup/restore runbooks.
6. Add observability for Edge Function status, error body, and request IDs.
7. Add deployment gates for Supabase migrations and function deploys.
8. Add security review for all privileged functions and views.

## Production Readiness Score

- Frontend: 5/10
- Backend: 4/10
- Database: 4/10
- Multi-tenancy: 3/10
- AuthN/AuthZ: 4/10
- Security: 4/10
- DevOps: 3/10
- Testing: 1/10
- Overall: 3.5/10

CTO recommendation: do not onboard real schools yet. The app is usable as a prototype, but production launch should wait until Edge Function deployment is verified, tenant data is repaired, RLS is reproducible, and role/school mutations are server-only.

## Verification Status

- Build: passing.
- Lint: failing, pre-existing issues remain.
- Browser: login and route smoke tested; school/user creation failures reproduced.
- Supabase live MCP/CLI: attempted, but remote function list returned `401 Unauthorized`; no credit-consuming external changes were made through Supabase MCP/CLI.
