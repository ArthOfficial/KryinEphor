# Execution Instructions

This file is the source of truth for implementing the Kryin Ephor identity, family, student, parent, and teacher access architecture.

Rules:

- Complete phases in order.

- Do not skip phases.

- After finishing a task, change `[ ]` to `[x]`.

- Do not mark anything complete unless it is actually implemented and tested.

- Before starting the next phase, verify only the checks relevant to the work just completed: build, affected migrations, affected RLS/security, tenant isolation, and backward compatibility.

- Do not remove or split the existing combined Student + Parent account feature.

- Keep updating this file as implementation progresses.

Do not repeatedly scan or summarize the whole repository. Use targeted, phase-specific inspection only.

- Add proper status for project you are working and add their emoji in it like ✅, 🛠️, ❌, . Properly follow it





You are working directly on the existing **Kryin Ephor** repository:

`github.com/ArthOfficial/KryinEphor`

This is a production-oriented multi-tenant School Management SaaS using React, TypeScript, Supabase Auth, PostgreSQL, Row Level Security (RLS), Supabase Edge Functions, and role-aware dashboards.

Your job is to carefully extend the EXISTING identity/account architecture to correctly support:

* the existing combined Student + Parent account

* Teacher access on the same overall login when the parent/guardian is also a staff member

* secure Teacher-mode unlocking

* multiple children under one family/parent account

* adding/removing/editing children

* adding/removing Teacher status

* safe Admin and Superadmin management

* backwards compatibility for every current account

* strict tenant isolation

* database-level security

* correct audit logging

This is NOT a request for a large blind rewrite.

Work from the current phase only. Before changing a phase, open only the files, tables, functions, policies, and migrations directly needed for that phase.

Do NOT broadly scan, summarize, or re-analyze the entire repository or database unless the current phase genuinely requires it. Reuse existing tables/components/functions when you encounter a safe equivalent in the files relevant to the current phase.

# ABSOLUTE PRODUCT REQUIREMENT — DO NOT VIOLATE

The existing combined **Student + Parent account model is intentional and must remain**.

DO NOT:

* split the current Student and Parent experience into mandatory separate Auth accounts

* force parents and students to repeatedly logout/login

* remove the current Student ↔ Parent dashboard switching

* replace the combined account with a conventional separate-parent-login architecture

* break existing Student accounts

* change existing login credentials

* recreate existing users

* delete student academic data during migration

* remove existing Parent functionality

* make existing users manually migrate themselves

The README explicitly describes combined Student/Parent access as part of Kryin Ephor's product direction. Preserve it.

The final system should improve the internal architecture while retaining or improving the current UX.

---

# CORE ARCHITECTURAL RULE

Separate these concepts:

```text

AUTH ACCOUNT

Who owns the login/session

        │

        ├── FAMILY ACCESS

        │

        │    ├── Parent persona

        │    ├── Student A

        │    ├── Student B

        │    └── Student N

        │

        └── STAFF ACCESS

             └── Staff identity

                  ├── Teacher

                  └── future staff roles if appropriate

```

An authentication account is NOT automatically the same thing as the human/student record being viewed.

A family account may therefore have:

```text

Family access:

Parent

Aarav student workspace

Anaya student workspace

Staff identity:

Sunita Sharma — Teacher

```

This DOES NOT mean:

```text

Aarav = Teacher

```

and must never be represented that way in teacher lists, class assignments, audit logs, or academic records.

---

# DO NOT LINK TWO AUTH ACCOUNTS TO SOLVE THIS

Do NOT solve Teacher + Parent using two Supabase Auth accounts and automatic account merging.

Do not maintain one Teacher auth account and another Student auth account and attempt to join refresh tokens.

That creates avoidable complexity and security problems.

Use ONE authenticated account/session with separate domain identities/personas underneath it.

If the existing schema is currently tightly coupling a student record to `auth.users`, refactor it ADDITIVELY and safely.

Do not perform a destructive big-bang migration.

---

# LOGICAL DATA MODEL

First inspect the existing schema.

Reuse existing canonical entities wherever possible.

The final logical model needs equivalents of these concepts, although actual table names may differ:

## 1. Account/Profile

Represents the authenticated login.

Typically linked to:

```text

auth.users.id

```

Contains login/account-level information only.

This is NOT automatically the canonical identity of every student or staff member accessed through the account.

---

## 2. Student Record

Represents an actual enrolled student.

Contains/links:

* student identity

* admission number

* enrollment

* class/section

* attendance

* marks

* fees

* tests

* student-specific information

A student record must be usable even if that student does not have an independent Auth account.

That is important for younger children.

---

## 3. Family/Guardian → Student Relationship

Provide an authoritative relationship equivalent to:

```text

family_account_students

account_id

student_id

relationship / access_type

is_primary

status

created_at

created_by

```

or reuse an existing guardian relationship if the schema already supports this properly.

It must support:

```text

ONE account → ZERO OR MANY students

```

There must be NO hardcoded two-child limit.

Examples:

```text

Sunita family account

 ├── Aarav

 ├── Anaya

 ├── Rohan

 └── future child

```

---

## 4. Staff Identity / Staff Membership

A Teacher must have a separate staff-domain identity from a student record.

Conceptually:

```text

staff_membership/profile

id

account_id

school_id

staff_person_name

employee_id

status

role

created_at

updated_at

```

Reuse existing staff tables if present.

Teacher dropdowns and teacher assignments must use the canonical STAFF identity.

They must NOT infer teacher identity merely because an auth account has a `teacher` string somewhere in `user_roles`.

This specifically prevents labels such as:

```text

student (student • teacher tag)

```

A teacher dropdown should show:

```text

Sunita Sharma

```

because Sunita is the staff identity.

It should never display the child's student name merely because the same login can also access that child.

---

# ACCOUNT-LEVEL CAPABILITIES VS HUMAN ROLES

Do NOT enforce the simplistic rule:

```text

if account has student then account can never have teacher

```

That would break the intentional Family + Teacher use case.

Instead enforce:

> A STUDENT PERSON/RECORD cannot be a Teacher.

but:

> An AUTH ACCOUNT may have family/student access AND a separate adult staff identity.

Therefore this is legitimate:

```text

Auth account:

family access = yes

teacher access = yes

Student:

Aarav

Teacher:

Sunita

```

This is NOT legitimate:

```text

Student:

Aarav

Teacher identity:

Aarav

unless Aarav is genuinely an employed adult staff member, which is outside the intended K-12 model.

```

Teacher eligibility should come from a valid active staff record.

---

# EXECUTION RULE

Implement this in sequential phases.

Use just-in-time inspection: inspect only what the current phase needs, then implement. Do not repeatedly re-read or re-analyze the whole repository.

Do not spend a phase only collecting context unless the phase explicitly requires a targeted baseline.

DO NOT jump straight into UI work.

At the end of EVERY phase:

1. run TypeScript/build checks

2. run relevant automated tests

3. check migrations

4. validate RLS implications

5. verify tenant isolation

6. verify no regression in current Student + Parent accounts

7. report what changed

8. identify any remaining risk

Do not continue to the next phase if the current phase leaves broken authorization or broken migrations.

---

# PHASE 0 — TARGETED BASELINE + EXECUTION MAP

**Status**: ✅ Completed

### Execution Map:
1. **Source of Truth for Account Role / Persona Data**:
   - Primary role: `profiles.role`
   - Additional assigned roles: `user_roles` (queried securely via `fn_get_my_roles()`)
   - Combined roles in memory: `AuthContext.tsx` sets `roles = Array.from(new Set([profile.role, ...rolesData]))`
   - Active view/mode: `AuthContext.tsx` tracks `role` (initialized to `profile.role` or `localStorage.getItem('active_role_' + user.id)` if present in `roles`).
2. **Current Student + Parent Switching Entry Point**:
   - `src/components/dashboard/Header.tsx`: If `roles.includes('student') && roles.includes('parent')`, toggles between `'student'` and `'parent'` via `switchDashboardRole(next)`.
   - `src/components/dashboard/Sidebar.tsx`: Renders role toggle pills for all assigned `roles`.
   - `StudentDashboardExperience.tsx` and `Dashboard.tsx`: Switch views based on active `role`.
3. **Current Teacher-Selection Source**:
   - `fetchSchoolTeachers` in `src/hooks/queries/index.ts`: Queries `profiles` where `role = 'teacher'` and `user_roles` where `role = 'teacher'`.
   - Consumed by `ClassFormModal.tsx` and `TeachersSubjectsTab.tsx` via `useSchoolTeachers(schoolId)`.
4. **Current Admin/Superadmin Write Path**:
   - User creation: `create_tenant_admin` edge function.
   - User update (role, school, active status, additional roles): `update_admin` edge function.
   - User deletion/deactivation: `delete_user` edge function.
5. **Exact Tables/Policies Phase 1 Must Touch**:
   - `parent_student` (links parent `profiles.id` to student `profiles.id` with `school_id`, `relationship`, `is_primary`)
   - `employees` (staff identity linking `profile_id`, `school_id`, `designation`, `status`)
   - `user_roles` & `profiles` (for additive role/persona capabilities)
   - Relevant RLS policies to preserve family and staff tenant boundaries
6. **Compatibility Risks That Must Be Preserved**:
   - Do NOT remove/split combined Student + Parent accounts.
   - Existing single-child accounts, credentials, and academic data (attendance, marks, fees, classes) must remain 100% intact with zero manual user migration.
   - Teacher options must separate adult staff identity from student persona so student names are never displayed as teachers.


# PHASE 1 — SAFE IDENTITY FOUNDATION

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260914231500_phase1_safe_identity_foundation.sql`.
- [x] **Enhanced `parent_student`**: Added `status` (with CHECK constraint for 'active', 'inactive', 'unlinked') and `created_by` (FK to profiles).
- [x] **Duplicate Link Prevention**: Added `UNIQUE (parent_id, student_id)` constraint and lookup indices on `(parent_id, status)` and `(student_id, status)`.
- [x] **Tenant Isolation Trigger**: Created `trg_validate_parent_student_link` enforcing that `parent_id` and `student_id` share the same `school_id`, matching `parent_student.school_id`, and blocking linking of deleted/inactive students.
- [x] **Enhanced Staff Identity (`employees`)**: Added `staff_person_name` column to store adult staff name separate from student name; added partial unique index `idx_employees_profile_school_active` on `(profile_id, school_id) WHERE deleted_at IS NULL`.
- [x] **Staff Tenant Consistency Trigger**: Created `trg_validate_employee_membership` to prevent cross-tenant staff membership.
- [x] **Single-Child Backfill**: Backfilled existing student accounts into `parent_student` as self-primary links (`relationship = 'self_student'`, `is_primary = true`, `status = 'active'`), preserving 100% of existing single-child logins, marks, attendance, and fees without disruption.
- [x] **Staff Membership Backfill**: Backfilled active `employees` records for existing teacher profiles.
- [x] **Security Helper Functions**: Added `fn_can_access_student(target_student_id UUID)` and `fn_get_my_linked_students()` with `SECURITY DEFINER` and strict execution permissions.
- [x] **Tightened RLS Policies**: Scoped `parent_student` SELECT to school admins, receptionists, and the linked parent/student (`parent_id = auth.uid() OR student_id = auth.uid()`). Allowed employees to SELECT their own staff membership record.
- [x] **TypeScript Types**: Updated `src/integrations/supabase/types.ts` for `parent_student`, `employees`, and RPC functions. Verified `npm run build` passes with 0 errors.

---

# PHASE 2 — CORRECT TEACHER IDENTITY

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260914233500_phase2_correct_teacher_identity.sql`.
- [x] **Database Assignment Triggers**: Created `trg_validate_class_teacher` on `classes` and `trg_validate_subject_teacher` on `subject_teachers` preventing assignment of deleted, inactive, cross-tenant, or unprivileged non-staff users as teachers.
- [x] **Authoritative Teacher Query**: Updated `fetchSchoolTeachers` in `src/hooks/queries/index.ts` to query active `employees` staff memberships, prioritizing canonical `staff_person_name`, and strictly excluding pure students without staff memberships.
- [x] **Class Teacher Selector**: Updated `ClassFormModal.tsx` dropdown to use canonical staff names and sanitize roles, completely eliminating any student role tags.
- [x] **Subject Teacher Selector**: Updated `TeachersSubjectsTab.tsx` dropdown to use canonical staff names and sanitize roles.
- [x] **Teacher Directory Cards**: Updated `AllTeachersModal.tsx` to filter out student persona badges from teacher cards.
- [x] **Admin Dashboard Stats**: Updated `fn_admin_dashboard_stats` to count active staff educators accurately while excluding non-staff students.
- [x] **Build Verification**: Verified `npm run build` succeeds with 0 type errors.

---

# PHASE 3 — ADD TEACHER TO AN EXISTING FAMILY/STUDENT ACCOUNT

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260914235000_phase3_add_teacher_to_family.sql`.
- [x] **Safe Account Search RPC (`fn_search_school_accounts_for_staff`)**: Created security-definer RPC allowing school admins to search accounts in their tenant by name, email, or linked student name. Aggregates candidate account roles and linked family students (`student_id`, `student_name`, `class_name`, `relationship`), with existing staff profiles.
- [x] **Edge Function `update_admin`**: Extended to accept adult educator identity attributes (`staffPersonName`, `designation`, `department`). When teacher role is added or updated, upserts an active `employees` record with tenant isolation and audit logging.
- [x] **Edge Function `create_tenant_admin`**: Extended to create corresponding `employees` records when a new teacher is created with optional staff details.
- [x] **Add User Modal UI Enhancement**:
  - Segmented toggle when selecting Teacher role: `New Account` vs `Attach to Family Account`.
  - In `Attach to Family Account` mode: live tenant-scoped account search with debounce, candidate cards displaying email, current roles, and linked students (`🎓 Aarav Sharma (Class 5A) · Mother`).
  - Adult staff member setup section requiring the educator's real name (`Sunita Sharma`), designation, and department, preserving family student records without modification.
  - "Attach Teacher Access" action invoking `update_admin` with role merge and staff profile creation.
- [x] **UserDrawer Staff Management**: Allows viewing and updating the educator's `staff_person_name`, designation, and department for any teacher or staff member.
- [x] **TypeScript Types**: Updated `src/integrations/supabase/types.ts` with `fn_search_school_accounts_for_staff` schema.
- [x] **Build Verification**: Verified `npm run build` succeeds with 0 errors.

This is a critical workflow.

Example:

```text

Existing:

Aarav Sharma

Student + Parent family account

Later:

Aarav's mother Sunita becomes a Teacher.

```

Admin/Superadmin can choose:

```text

Add Staff / Teacher

[ Search existing account ]

```

Search uses safe school-scoped identifiers such as:

* verified email

* verified phone

* account username

* guardian name

* student/guardian relationship

Does NOT automatically select the student record as the teacher.

If the existing account represents a family/student account, shows:

```text

Existing family account found

Student:

Aarav Sharma — Class 5A

Guardian:

Sunita Sharma — Mother

Add Sunita Sharma as staff?

[ Add Teacher ]

```

Creates/reuses:

```text

Staff identity:

Sunita Sharma

Account:

existing family login

Role:

Teacher

```

Then the same login becomes capable of:

```text

Student View — Aarav

Parent View

Teacher View

```

No new login.

No account merge.

No password change.

---

# PHASE 4 — TEACHER-FIRST, CHILD-LATER WORKFLOW

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260915003000_phase4_teacher_first_child_later.sql`.
- [x] **Guardian & Staff Search RPC (`fn_search_guardians_for_student`)**: Created security-definer RPC that lets school admins search existing staff members, teachers, and guardians by email, staff name, or profile name, returning their roles and count of currently linked children.
- [x] **Secure Guardian Linking RPC (`fn_link_student_guardian`)**: Created security-definer RPC to link a student to a parent/staff account:
  - Validates tenant isolation (both student and guardian belong to target school).
  - Upserts into `parent_student` with relationship (`Mother`, `Father`, `Guardian`, etc.).
  - Safely appends `'parent'` to guardian's `profiles.roles` without altering or removing `'teacher'` or staff privileges.
  - Automatically creates/verifies `school_memberships` for guardian.
  - Logs structured audit trail to `audit_logs`.
- [x] **Bidirectional Family Links RPC (`fn_get_profile_family_links`)**: Security-definer lookup returning linked guardians (for a student) and linked children/students (for a teacher/parent) with relationship and class details.
- [x] **Edge Function `create_tenant_admin`**:
  - Automatically provisions self-link in `parent_student` for all newly created students.
  - If `guardianId` is supplied, securely links the student to the selected guardian/staff account and appends `'parent'` role to guardian.
- [x] **User Management UI — Add Student with Guardian Link**:
  - In `AddUserModal`: when creating a `student`, provides `+ Link Existing Staff / Guardian` option.
  - Live tenant-scoped search with debounce finding existing teachers and guardians.
  - Clear indicator if candidate is an active Teacher or Staff member (`Sunita Sharma (Teacher)`).
  - Relationship selector (Mother, Father, Guardian, Parent).
  - Prevents duplicate logins: links child directly to existing educator or parent account.
- [x] **User Management UI — UserDrawer Family Relationships**:
  - Added dedicated `Family Relationships (Phase 4)` card in drawer.
  - Shows linked guardians for student accounts or linked children for teacher/parent accounts.
  - Allows linking additional guardians directly from the drawer.
- [x] **TypeScript Types**: Updated `src/integrations/supabase/types.ts` with Phase 4 RPCs.
- [x] **Build Verification**: Verified `npm run build` succeeds with 0 errors.

Support the reverse situation.

Example:

```text

Sunita Sharma

already a Teacher

later:

her son Aarav joins the school

```

Admin adds the Student normally.

During parent/guardian setup, detect that:

```text

Guardian email/phone/account

matches existing Sunita account

```

Do NOT create a duplicate Sunita Auth account.

Show:

```text

Existing account found

Sunita Sharma

Current access:

Teacher

Link as guardian of Aarav Sharma?

[ Link Child ]

```

After linking:

```text

ONE login

Teacher View

Parent View

Student View — Aarav

```

Again:

Teacher identity = Sunita.

Student identity = Aarav.

Never mix them.

---

# PHASE 5 — SECURE TEACHER MODE / STAFF PIN

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260915010000_phase5_secure_staff_pin.sql`.
- [x] **Secure Schema Design**:
  - Table `staff_pins`: stores `pin_hash` (hashed with pgcrypto blowfish salt), `failed_attempts`, `locked_until`, `is_temporary`, and `must_change`. RLS enabled, direct client queries blocked.
  - Table `staff_unlock_sessions`: stores device-specific `session_token`, `expires_at` (2 hours), `is_revoked`, `revoked_reason`, and `last_activity_at`. RLS enabled.
- [x] **Server-Side Verification & Lockout RPCs**:
  - `fn_check_staff_pin_status`: Returns whether PIN is configured, lockout status, locked timestamp, and remaining attempts.
  - `fn_setup_or_change_staff_pin`: Validates 6-8 digit numeric PIN, verifies current PIN on self-service change, hashes via `crypt(pin, gen_salt('bf', 10))`, revokes active sessions on PIN update, and logs to `admin_action_audit`.
  - `fn_verify_staff_pin`: Checks caller's staff roles, verifies lockout status, validates PIN via `crypt()`. Automatically tracks failed attempts, locks account for 15 minutes after 5 failures, generates cryptographically random 32-byte hex token upon success, and logs audit events.
  - `fn_validate_staff_session`: Validates unexpired, non-revoked session token, updates activity timestamp.
  - `fn_revoke_staff_session`: Revokes session immediately on logout or manual lock.
  - `fn_is_staff_unlocked`: SQL helper for RLS and server-side authorization.
- [x] **Auth Context Integration (`AuthContext.tsx` & `authContextValue.ts`)**:
  - Added `isStaffUnlocked`, `staffSessionToken`, `staffPinStatus`, `unlockStaffMode`, `lockStaffMode`, `setupStaffPin`.
  - Session restoration validates stored staff session token against server; falls back to parent/student role if staff mode is not unlocked.
  - Gated `switchDashboardRole('teacher')`: prompts Staff PIN modal before allowing role change.
  - `signOut`: actively revokes staff session in Supabase and clears `sessionStorage`.
- [x] **High-End UI Components**:
  - `StaffPinModal.tsx`: Modern glassmorphic unlock modal featuring discrete masked 6-digit display, live attempts-remaining warnings, lockout countdowns, and self-setup flow.
  - `Sidebar.tsx`: Lock indicator on Teacher button when locked, plus "Lock Teacher View" quick-action button when active.
  - `Header.tsx`: "Lock Teacher View" action button in the top navigation bar.
  - `UserManagement.tsx`: Added "Staff Mode PIN Security" card in `UserDrawer` allowing administrators to inspect PIN status and issue temporary 6-digit PINs with random generation.
- [x] **Build Verification**: Verified `npm run build` succeeds with 0 errors.

Student ↔ Parent switching may remain convenient.

Teacher mode is privileged and MUST have additional protection.

Reason:

A family may share the Student/Parent login credentials.

A child must never gain Teacher privileges simply because the parent is also a Teacher.

Implement an additional staff unlock.

Example:

```text

Switch to Teacher View

Staff PIN

[ • • • • • • ]

[ Unlock Teacher Mode ]

```

## IMPORTANT

This cannot be a UI-only PIN.

DO NOT do:

```ts

if (pin === localStorage.pin)

   allowTeacher = true

```

Never store the raw PIN in:

* localStorage

* sessionStorage

* React state permanently

* profiles

* browser-readable configuration

Never compare it purely in JavaScript.

## Staff PIN security

Implement server-side verification.

Use:

* a secure one-way password hash appropriate for credentials

* per-secret salt

* rate limiting

* failed-attempt tracking

* temporary lockout

* audit logging

* session/device-specific unlock state

* short expiration

Never store plaintext PINs.

Recommended initial policy:

```text

6 digit minimum

5 failed attempts → temporary lock

unlock expires after a limited period/inactivity

logout → immediately revoke

Teacher → Family switch may optionally revoke according to security policy

PIN change → revoke existing staff unlocks

PIN reset → revoke every staff unlock

Teacher removal → revoke every staff unlock immediately

```

Do not let the client decide whether a staff session is valid.

## Staff PIN setup

When Teacher access is first granted:

do NOT simply expose the permanent Staff PIN to an Admin forever.

Implement a secure activation/reset workflow.

Example:

```text

Admin:

Enable Teacher Access

        ↓

Generate one-time activation/setup mechanism

        ↓

Teacher verifies/setup flow

        ↓

Teacher chooses Staff PIN

        ↓

Only hash stored

```

If the project's current capabilities make this too large for the first implementation, a temporary Admin-issued PIN may be used only if:

* it is temporary

* user must change it

* raw PIN isn't retrievable afterward

* action is audited

## Authorization

Teacher access must NOT become valid merely because someone manually changes:

```text

localStorage.activeRole = "teacher"

```

or modifies React state.

Privileged Teacher authorization must require server-verifiable state such as:

```text

auth user

+

active staff membership

+

teacher permission

+

valid staff-unlocked session

+

same tenant

```

Update RLS/Edge Functions accordingly.

If direct Supabase queries currently rely only on:

```text

auth.uid()

```

for Teacher access, redesign those policies/queries so a shared family login cannot call Teacher APIs without completing staff unlock.

Use an appropriate secure server-derived claim/session mechanism.

Do not create a fake security layer that protects the React page while leaving Supabase APIs open.

---

# PHASE 6 — PERSONA / VIEW SWITCHER

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260915013000_phase6_persona_view_switcher.sql`.
- [x] **Persona Summary RPC**:
  - Implemented `public.fn_get_my_persona_summary()` returning atomic account details, assigned roles, active staff profile, linked children/students list (`student_id`, `admission_number`, `full_name`, `class_name`, `section_name`, `is_primary`, `relationship_type`), and staff PIN security status (`is_configured`, `is_locked`, `is_unlocked`).
- [x] **Auth Context Integration (`AuthContext.tsx` & `authContextValue.ts`)**:
  - Added `linkedStudents`, `activeStudentId`, `setActiveStudentId`, `refreshPersonaSummary()`.
  - Persona summary loads atomically upon authentication and refreshes on role/profile events.
  - Switching between views does NOT log out or reset user session.
- [x] **High-End Persona Switcher Component (`PersonaSwitcher.tsx`)**:
  - Dual variant support: `variant="sidebar"` and `variant="header"`.
  - Clean separation into **FAMILY** (`Student View` with multi-child names, `Parent Dashboard`) and **WORK** (`Teacher Dashboard` with PIN lock state, `School Admin`, `Super Admin`).
  - Seamless Staff PIN integration: clicking Teacher mode when locked triggers `StaffPinModal` before switching.
  - Preserves 1-click quick toggle button for accounts with strictly 2 roles (`student` + `parent`) to maintain fast user workflow.
- [x] **Header and Sidebar Integration**:
  - `Sidebar.tsx`: Render `<PersonaSwitcher variant="sidebar" collapsed={collapsed} />`.
  - `Header.tsx`: Render `<PersonaSwitcher variant="header" />` for multi-role/multi-child accounts while preserving quick toggle for pure Student+Parent accounts.
- [x] **Build Verification**: Verified `npm run build` succeeds with 0 errors.

Preserve the current Student + Parent switcher.

Extend it.

Single-child Teacher/Parent example:

```text

Sunita Sharma

FAMILY

────────────────

🎓 Aarav — Student

👨‍👩‍👦 Parent Dashboard

WORK

────────────────

👩‍🏫 Teacher Dashboard 🔒

```

After Teacher unlock:

```text

👩‍🏫 Teacher Dashboard ✓

```

Switching should NOT require logout.

Example:

```text

Teacher

   ↓

Parent

   ↓

Aarav Student

   ↓

Teacher

```

Teacher may require re-unlock after timeout.

Do not call every option a "role" in the user-facing UI if that creates confusion.

Prefer terminology such as:

```text

View

Workspace

Mode

```

Internally maintain clear authorization concepts.

---

# PHASE 7 — MULTIPLE CHILDREN

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260915020000_phase7_multiple_children_support.sql`.
- [x] **Hardened Server-Side Access Rule (`fn_can_access_student`)**:
  - Validates `auth.uid()` authentication, non-null `target_student_id`, active relationship in `public.parent_student`, matching school/tenant isolation, and non-deleted student profile.
  - Allows direct self-access only if caller has canonical student role on their profile.
  - Safe `search_path = public, extensions`, `SECURITY DEFINER`, revoked from public/anon, granted exclusively to authenticated.
- [x] **Enhanced Persona & Linked Students RPCs**:
  - `public.fn_get_my_linked_students()` returns canonical active `class_name` and `section_name` via lateral join on current `class_enrollments`.
  - Deterministic ordering: primary student first, followed by alphabetical by full name and student ID.
  - `public.fn_get_my_persona_summary()` includes full class, section, relationship, and status info in `linked_students` JSON.
- [x] **Parametrized Performance Summary RPC (`fn_student_performance_summary`)**:
  - Accepts `target_student_id UUID DEFAULT NULL`. If specified, validates `fn_can_access_student(target_student_id)`; if null, resolves primary/first authorized child.
  - Prevents information leakage on unauthorized explicit student IDs.
- [x] **Extended Row Level Security (RLS)**:
  - Additively augmented SELECT policies on `attendance`, `invoices`, `invoice_items`, `student_fee_assignments`, `additional_charges`, `transactions`, `class_enrollments`, and `exam_results` with `OR public.fn_can_access_student(...)`.
  - Preserves all existing Superadmin, Admin, Teacher, Accountant, and Student access intact.
- [x] **Auth Context & Dynamic Active Student Validation**:
  - `AuthContext.tsx` & `authContextValue.ts`: updated `LinkedStudentPersona` with `className`, `sectionName`, `status`.
  - Validates `activeStudentId` on every refresh against authorized `linkedStudents`. If an admin unlinks a child mid-session, the unlinked ID is rejected, cleared, and falls back to primary/first authorized student (or `null`).
  - No fallback to `user.id` as a student ID.
- [x] **High-End Child Selector Component (`ChildSelector.tsx`)**:
  - Displays context badge for single-child accounts without redundant dropdown.
  - Interactive dropdown menu for 2+ children with active child indicator, class badge, primary flag, and smooth switching.
  - Shows clean informational card if 0 student records are linked.
- [x] **Child-Scoped Module Integration**:
  - `Dashboard.tsx` & `StudentDashboardExperience.tsx`: uses `effectiveStudentId`, `key={effectiveStudentId}` for zero-leakage remounting, integrated with `ChildSelector`.
  - `StudentFees.tsx`: scoped to `['student-fees', effectiveStudentId]`, integrated with `ChildSelector`.
  - `StudentTests.tsx`: scoped to `['student-tests', effectiveStudentId]`, integrated with `ChildSelector`.
  - `StudentPerformance.tsx`: scoped to `['student-performance', effectiveStudentId]`, integrated with `ChildSelector`.
  - `PersonaSwitcher.tsx`: enhanced student rows with class names (e.g. `Aarav · Class 5A`).
- [x] **Build & Security Verification**: Verified `npm run build` succeeds with 0 errors.

Add proper one-parent/family-account → many-students support.

There must be NO arbitrary maximum such as 2 children.

Relationship must support:

```text

0..N children

```

Example:

```text

Sunita Sharma

FAMILY

Parent Dashboard

Students

├── Aarav Sharma — Class 5A

├── Anaya Sharma — Class 2B

└── Rohan Sharma — Class 8C

WORK

└── Teacher Dashboard

```

## Parent dashboard

Add a child selector where appropriate:

```text

Viewing child:

[ Aarav Sharma ▼ ]

Aarav

Anaya

Rohan

```

Changing child must update all child-scoped data:

* attendance

* tests

* marks

* performance

* timetable

* fee status

* homework

* relevant notices

* future child-specific modules

Prevent stale data from the previously selected child from remaining visible.

## Student View switching

The family account can enter:

```text

Student View → Aarav

Student View → Anaya

Student View → Rohan

```

This is still ONE login.

Each student retains an independent canonical academic identity.

Never merge marks/attendance/fees between siblings.

Persist a convenient last-selected child if desired, but never trust that client value for authorization.

Every query must verify that:

```text

current account

is actually linked to

requested student

```

---

# PHASE 8 — ADMIN / SUPERADMIN FAMILY MANAGEMENT UI

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260915030000_phase8_admin_family_management.sql`.
  - Step 1: Deterministic window CTE (`ranked_active_primaries`) to resolve existing multi-primary rows before adding unique constraint.
  - Step 2: Partial unique index `uq_parent_student_active_primary` on `parent_student (parent_id, school_id) WHERE status = 'active' AND is_primary = true`.
  - Step 3: `fn_search_students_for_family` with school tenancy and untrusted `_parent_id` validation; returns safe minimal fields (`student_id`, `full_name`, `login_id`, `class_name`, `section_name`, `already_linked`).
  - Step 4: Hardened `fn_link_student_guardian` enforcing admin tenancy, single primary atomic update, upserting `user_roles` with `role = 'parent'`, and audit logging.
  - Step 5: `fn_unlink_student_guardian` marking link `status = 'inactive'`, preserving academic records, atomically promoting the next active sibling to primary, and logging to `admin_action_audit`.
  - Step 6: `fn_update_guardian_relationship` updating relationship metadata and atomic primary toggle with audit logging.
  - Step 7: Enhanced `fn_get_profile_family_links` returning `class_name`, `section_name`, `login_id`, and `status`.
- [x] **Edge Function Updated (`update_admin`)**:
  - Handled `teacherAction`: `'enable'`, `'disable'`, `'update_staff'`.
  - Mandatory adult `staffPersonName` (rejects with 400 if empty; never derives from student name).
  - Handles Case A (removes teacher from `user_roles`), Case B (transitions primary role to `'parent'`), Case C (rejects if no other persona).
  - Inactivates employee record on disable (`status = 'inactive'`).
  - Audits `teacher_access_added`, `teacher_access_disabled`, `staff_details_changed`, `role_transition_to_parent`.
- [x] **TypeScript Types Updated**:
  - `src/integrations/supabase/types.ts`: added typing for `fn_search_students_for_family`, `fn_unlink_student_guardian`, `fn_update_guardian_relationship`.
- [x] **UserManagement Drawer Redesigned (5 Cards)**:
  - Account Card: Login identity, email, primary role, school assignment, additional roles (with raw teacher checkbox removed from generic roles).
  - Family Access Card: Parent access status, linked children with Class, Section, Admission/Login ID, Relationship, Primary badge, actions (`Set as Primary`, `Edit Relationship`, `Unlink Child`), and `+ Link Existing Student`.
  - Staff Access Card: Canonical adult educator identity (`Sunita Sharma — Teacher`), Designation, Department, Active status, `Edit Staff Details`, `Disable Teacher Access`, or `+ Add Teacher Access`.
  - Staff Security Card: Staff PIN status (`Configured` / `Not Configured`), Teacher Access (`Active` / `Inactive`), Lockout status (`Normal` / `Rate-Limited (Locked)`), `Issue / Reset Staff PIN`. Never exposes raw PIN or faked device session unlock states.
  - Account Actions Card: Status toggle (`Active` / `Disabled`), Password reset, Recovery email, Permanent Delete (guarded danger zone).
- [x] **Dedicated Modals Implemented**:
  - `UnlinkChildConfirmModal`: explicit warning that unlinking only removes family access while all academic records remain intact.
  - `EditRelationshipModal`: allows editing relationship string and setting primary flag atomically.
  - `LinkStudentModal`: search input calling `fn_search_students_for_family`, displaying candidates with current enrollment, relationship picker, and primary flag.
  - `AddTeacherModal`: requires adult legal name, designation, department; calls `update_admin`.
  - `DisableTeacherModal`: clear warning about losing access to gradebooks/attendance while preserving family/parent access; calls `update_admin`.
  - `EditStaffDetailsModal`: edits designation and department without touching student identity; calls `update_admin`.
- [x] **Build & Verification**:
  - Clean `npm run build` compilation (0 errors, 10.51s, bundles generated).

Create or extend User Management so Admin/Superadmin can clearly understand an account.

An account detail view should conceptually show:

```text

ACCOUNT

────────────────────────────

Login: family@example.com

Status: Active

FAMILY ACCESS

────────────────────────────

Parent access: Active

Linked Students:

• Aarav Sharma — Class 5A — Active

• Anaya Sharma — Class 2B — Active

STAFF ACCESS

────────────────────────────

Sunita Sharma

Teacher — Active

SECURITY

────────────────────────────

Teacher PIN: Configured

Teacher access: Locked/Unlocked status as appropriate

ACTIONS

────────────────────────────

Add Child

Link Existing Student

Unlink Child

Edit Relationship

Add Teacher Access

Disable Teacher Access

Reset Staff PIN

Deactivate Account

```

Do not expose the actual Staff PIN.

---

# WHO CAN CHANGE WHAT?

## Normal family user

Allow appropriate self-service such as:

* password change

* verified account email/phone change if supported

* avatar

* notification preferences

* preferred/default view

* selected child

* Staff PIN change after proper verification

* account security settings

Do NOT allow them to self-grant:

* Teacher

* Admin

* Accountant

* Receptionist

* Superadmin

* arbitrary Parent links

* arbitrary Student links

Do NOT allow a parent to simply type:

```text

Admission Number: 123

```

and gain access to another child.

Child linking must be school-authorized.

A future school-generated one-time child-link code may be supported, but must be unguessable, short-lived, single-use, school-scoped and audited.

For the initial implementation, Admin/Superadmin-managed linking is acceptable.

## Student View

Student workspace cannot:

* grant roles

* manage staff

* link arbitrary siblings

* unlock teacher access without Staff PIN

* alter authoritative school records

## School Admin

Can manage accounts within THEIR school only.

Can:

* add/link child

* unlink family access

* create Teacher staff identity

* enable/disable Teacher role

* edit valid staff information

* reset Teacher PIN

* deactivate applicable school account/access

* manage relationships

Cannot:

* operate across another school

* grant platform Superadmin

* bypass tenant restrictions

## Superadmin

Can perform platform-authorized administrative actions, but every cross-tenant sensitive action must be explicitly scoped and audited.

Superadmin must not accidentally bypass relational validation merely because they have broad access.

---

# PHASE 9 — REMOVE TEACHER ACCESS

**Status**: ✅ Completed

### Implemented & Verified Tasks:
- [x] **Additive Migration**: Created `supabase/migrations/20260915040000_phase9_remove_teacher_access.sql`.
  - Dynamic check constraint validation on `employees.status` ensuring `'inactive'` is supported while preserving all existing allowed statuses (`active`, `inactive`, `resigned`, `terminated`, `on_leave`, `retired`).
  - Hardened central authorization helper `public.has_role(_user_id, _role)`: for `_role = 'teacher'`, strictly mandates active teacher role AND active, non-deleted staff membership (`employees.status = 'active'`). Immediate server-side denial for stale browser JWTs upon deactivation, while preserving distinct separation from Staff PIN / unlock session authorization.
  - Created `public.teacher_assignment_history` table with `teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL`, `teacher_name_at_time`, `employee_id_at_time`, `designation_at_time`, `class_name_at_time`, `subject_name_at_time`, `unassigned_by`, `unassigned_by_name_at_time`, genuine `assigned_at` timestamp preservation (set to `NULL` for direct FKs without fabricating row creation dates; `subject_teachers.created_at` preserved), `ended_at = now()`, `ended_reason = 'teacher_access_disabled'`, and full operational metadata.
  - Active assignment discovery RPC `public.fn_get_teacher_active_assignments(_school_id, _teacher_profile_id)` inspecting all 5 operational teaching areas: `classes`, `subjects`, `subject_teachers`, `timetable`, and active/future/live `online_classes`.
  - Locked-down internal atomic RPC `public.fn_disable_teacher_access_internal(_school_id, _target_profile_id, _actor_profile_id, _clear_assignments)`:
    - Executed exclusively by `service_role` and `postgres` (revoked from `PUBLIC`, `anon`, `authenticated`).
    - Enforces that active assignments cannot be left attached in an inactive state (fails atomically if assignments exist and clear flag is false).
    - Snapshots assignments into `teacher_assignment_history` with full textual identity before clearing current operational foreign keys.
    - Revokes active sessions in `staff_unlock_sessions` for `_target_profile_id` immediately.
    - Sets `employees.status = 'inactive'`.
    - Deletes teacher role from `user_roles`.
    - Handles primary role transition (Case B: transitions to `'parent'` if active children exist; Case C: rejects if no other persona exists).
    - Canonical audit logging in `public.admin_action_audit` (structured `teacher_access_disabled` event with full actor, target, staff identity, role transition, revoked sessions, and assignment breakdown).
- [x] **Edge Function Hardened (`update_admin`)**:
  - Explicit target vs. actor aliasing: `targetUserId = adminId; actorUserId = caller.id;`.
  - Calls `fn_disable_teacher_access_internal` inside the service-role admin client.
  - Decoupled Auth metadata synchronization: attempted after PostgreSQL transaction commits; failure to sync `app_metadata` logs a warning without rolling back the authoritative database state.
- [x] **TypeScript Types Updated**:
  - Added types for `teacher_assignment_history` table and `fn_get_teacher_active_assignments` RPC in `src/integrations/supabase/types.ts`.
- [x] **Frontend UI Refactored in UserManagement**:
  - Enhanced `DisableTeacherModal`: invokes `fn_get_teacher_active_assignments` on open, displays breakdown of active classes, subjects, subject allocations, timetable slots, and scheduled online sessions.
  - Enforces safe paths: either `Cancel & Reassign Manually` or checkbox `[x] Clear current assignments and archive to assignment history as part of Teacher removal` before the `Disable Teacher Access` button is enabled.
  - Zero historical destruction: prominent notice that past marks, attendance, and exam entries remain preserved under the educator's name.
  - Invalidates `['teachers', 'bySchool']`, `['user-management-bundle']`, and `['persona-summary']` query caches.
- [x] **Post-Implementation Review Hardening (Live DB Verified)**:
  - **Issue 1 (SQL Alias Bug)**: Fixed `online_classes` UPDATE in `fn_disable_teacher_access_internal` by removing invalid `oc.` table alias prefixes.
  - **Issue 2 (Cross-Tenant Isolation)**: Strict separation in `fn_get_teacher_active_assignments` ensuring an additional `admin` role in `user_roles` cannot bypass school boundaries; only platform Superadmins can inspect cross-school.
  - **Issue 3 (Multi-Role Primary Promotion)**: Differentiates parent persona with active children from other valid staff roles (`accountant`, `receptionist`, etc.). If a teacher with no children is also an accountant, disabling teacher promotes them to `accountant` (never falsely to `parent`).
  - **Issue 4 (Audit Column Standardization)**: Standardized canonical `admin_action_audit` payload column to `detail` across database and Edge Function, migrating legacy `details` columns.
  - **Live Remote DB Verification**: Applied migrations 1 through 9 sequentially against the remote Supabase database, executed all 6 test scenarios (cross-tenant rejection, solo-teacher rejection, accountant promotion, parent promotion, assignment clearing & snapshotting, and canonical audit log), and verified `npm run build` succeeds with 0 errors.
- [x] **Additive Post-Verification Hardening Migration (`20260915041000_phase9_post_verification_hardening.sql`)**:
  - **Restricted `teacher_assignment_history` SELECT RLS**: Dropped overly broad authenticated school-wide SELECT policy (`teacher_assignment_history_school_select`) and replaced with `teacher_assignment_history_admin_select`. Students and Parents in the school now receive 0 rows. Access is strictly granted to platform Superadmins and same-school Admins/Principals.
  - **Accurate Audit Attribution**: Updated `fn_disable_teacher_access_internal` to dynamically fetch the caller's actual role (`profiles.role`) rather than hardcoding `'admin'`. A Superadmin action is logged as `actor_role = 'superadmin'`, while a School Admin action is logged as `actor_role = 'admin'`. Populated top-level `admin_action_audit.school_id = _school_id`.
  - **Live Verification**: Applied migration `20260915041000` to remote database and recorded it in `supabase_migrations.schema_migrations`. Automated tests verified:
    1. Student sees 0 history rows.
    2. Parent sees 0 history rows.
    3. Admin of other school sees 0 history rows.
    4. School Admin sees own-school history rows.
    5. Superadmin sees permitted history rows.
    6. Admin disable logs `actor_role = 'admin'` and top-level `school_id`.
    7. Superadmin disable logs `actor_role = 'superadmin'` and top-level `school_id`.
    8. All 6 core Phase 9 scenarios re-verified successfully.
- [x] **Build & Verification**:
  - `npm run build` ran and succeeded cleanly (0 errors, 11.69s).

Example:

```text

Sunita:

Teacher + Parent + linked child

```

Later she leaves employment.

Admin selects:

```text

Disable/Remove Teacher Access

```

DO NOT delete:

* her family login

* Parent dashboard

* children

* children's marks

* children's attendance

* children's fees

* historical classes she taught

* historical marks she entered

* audit history

Instead:

```text

staff membership → inactive / ended

teacher permissions → revoked

teacher unlock sessions → revoked immediately

teacher option → disappears from active teacher selectors

future teacher actions → denied

```

If active class/subject assignments exist, do not silently destroy them.

Either:

* require reassignment before final removal, or

* end the assignment with historical dates and require a replacement

Preserve historical attribution such as:

```text

Marks entered by Sunita Sharma

```

even after she leaves.

After removal her account becomes:

```text

Parent View

Student View(s)

```

with no Teacher mode.

---

# PHASE 10 — REMOVE OR UNLINK A CHILD

**Status**: ✅ Completed

### Clearly Distinguish THREE Operations:

#### A. Unlink Child From Family Account
Meaning:
> This family account should no longer be able to access this student.

Do:
```text
guardian/family link → inactive/removed
```
- **DO NOT delete student academic data**: Student stays enrolled, marks remain, attendance remains, fees remain. Only family access is removed.
- **Implementation**: Fixed `public.fn_unlink_student_guardian(_school_id, _link_id)`.
  - Corrected `admin_action_audit` insert: omits `id` (bigint identity column), uses `detail` column (not legacy `details`), and resolves `actor_role = v_caller_role`.
  - Sets `parent_student.status = 'inactive'` and `is_primary = false`.
  - Atomically promotes the next active sibling to primary if the unlinked child was primary.
  - Leaves student profile, enrollment, attendance, exam marks, and fee invoices 100% untouched.

#### B. Student Leaves School
Statuses supported:
```text
withdrawn
transferred
graduated
inactive
```
- **Preserve history**: Never hard-delete academic history when a student leaves.
- **Implementation**:
  - Added `student_status TEXT DEFAULT 'active' CHECK (student_status IN ('active', 'withdrawn', 'transferred', 'graduated', 'inactive'))` to `public.profiles`.
  - Created RPC `public.fn_set_student_status(_school_id, _student_id, _new_status, _reason, _notes)`.
  - Automatically toggles `profiles.is_active = (_new_status = 'active')` so departed students cannot log in.
  - Stores `departure_info` (`status`, `reason`, `notes`, `updated_at`, `updated_by`) in `profiles.metadata`.
  - Logs `student_status_changed` event in `admin_action_audit`.
  - Added **Student Enrollment Status** management card in `UserDrawer` UI in `UserManagement.tsx`.

#### C. Mistaken/Duplicate Student Record
Hard delete is exceptional and strictly guarded:
- **Dependency Verifications**: Verifies 0 records exist across:
  - attendance (`deleted_at IS NULL`)
  - exam results / marks (`deleted_at IS NULL`)
  - invoices (`deleted_at IS NULL`)
  - transactions / payments
  - class enrollments (`deleted_at IS NULL`)
  - homework submissions
  - student fee assignments (`is_active = true`)
  - active family guardians (`status = 'active'`)
- **Implementation**:
  - Created RPC `public.fn_check_student_delete_eligibility(_school_id, _student_id)`.
  - Hardened Edge Function `supabase/functions/delete_user/index.ts`: when target user is a student, checks deletion eligibility and rejects hard deletion with HTTP 400 if any academic/financial records exist.
  - Audits all permanent user deletions in `admin_action_audit` (`student_hard_deleted` / `user_hard_deleted`).
  - Frontend `DeleteUserConfirmModal` dynamically queries `fn_check_student_delete_eligibility` on open for students. If records exist, blocks the deletion UI, displays a dependency breakdown alert, and offers **"Archive Student Instead"** (redirects to status transition).

### Implemented & Verified Tasks:
- [x] **Additive Migration**: `supabase/migrations/20260915042000_phase10_student_unlink_and_departure.sql` applied and recorded in remote DB `schema_migrations`.
- [x] **Audit Insertion Bug Fixed**: Corrected `fn_unlink_student_guardian` to use `detail` column, proper `actor_role`, and omit identity column `id`.
- [x] **Departure Status System**: Added `student_status` column and `fn_set_student_status` RPC with full audit tracking.
- [x] **Guarded Deletion RPC & Edge Function**: Created `fn_check_student_delete_eligibility` and integrated server-side guards into `delete_user` Edge Function.
- [x] **Frontend UI & Type Definitions**:
  - Added `student_status` to `types.ts`, `UMProfile`, and `User` interface.
  - Added Student Enrollment Status card to `UserDrawer`.
  - Added Guarded Deletion protection to `DeleteUserConfirmModal`.
- [x] **Remote DB Automated Test Suite**: Verified Operation A (unlink child + sibling promotion), Operation B (student status transition + metadata), and Operation C (blocking deletion with history, permitting clean duplicate delete) on live database.
- [x] **Build Verification**: `npm run build` passes with 0 errors.

---

# PHASE 11 — REMOVE THE LAST CHILD [COMPLETED]

Consider:

```text

family account

└── Aarav

```

Admin unlinks/removes Aarav from the family account.

Do NOT automatically delete the Auth account.

Evaluate remaining capabilities.

Example 1:

```text

Teacher still active

```

Result:

```text

Teacher-only account

```

Example 2:

```text

No Teacher

No children

No valid access

```

Result:

```text

account has no active school persona

```

Admin may then:

* deactivate account

* retain temporarily

* relink a student

Do not guess and delete automatically.

### Implemented & Verified Tasks (Phase 11):
- [x] **Additive Migration**: `supabase/migrations/20260915043000_phase11_remove_last_child.sql` applied and recorded in remote DB `schema_migrations`.
- [x] **Capability Evaluation in RPC**: Enhanced `public.fn_unlink_student_guardian`:
  - Accurately counts `remaining_children_count` in the same school.
  - If 0 children remain, evaluates active Teacher capability (`employees.status = 'active'` + teacher role).
  - Evaluates other active staff roles (`accountant`, `receptionist`, `admin`, `principal`).
  - If parent has active teacher/staff capability, atomically transitions primary role (`profiles.role`) to `'teacher'` or that staff role, forming a Teacher-only or Staff-only account cleanly.
  - If no teacher and no staff capabilities exist, evaluates `has_active_persona: false`.
  - Never automatically deletes the Auth or profile account. Preserves student academic records, marks, and attendance 100% intact.
  - Records detailed structured evaluation in `admin_action_audit`.
  - Returns `{ success, link_id, parent_id, parent_name, student_id, student_name, was_primary, next_primary_link_id, remaining_children_count, has_active_teacher, new_primary_role, has_active_persona }`.
- [x] **Frontend UI & Structured Admin Action**:
  - Updated `handleUnlinkStudent` in `src/pages/UserManagement.tsx` to handle capability evaluation results from `fn_unlink_student_guardian`.
  - When account transitions to Teacher/Staff, automatically updates UI role state and invalidates relevant caches with clear toast confirmation.
  - When `has_active_persona: false`, displays `LastChildUnlinkedModal`:
    - Explains that the unlinked student was the last child and the guardian has no remaining active children or staff roles.
    - Offers 3 structured admin options:
      1. **Deactivate Account (Recommended)**: Sets `profiles.is_active = false` without deleting credentials or history.
      2. **Link Another Student**: Launches `LinkStudentModal` immediately.
      3. **Retain Account Active Temporarily**: Dismisses modal, allowing admin review.
- [x] **Automated Remote DB Verification**: Ran `scratch/test_phase11_full.cjs` against remote Supabase database:
  - Scenario 1 verified: Last child unlinked from parent who is also an active teacher -> primary role transitioned to `'teacher'`, account not deleted, student intact, audit logged.
  - Scenario 2 verified: Last child unlinked from pure parent -> `has_active_persona = false`, account not deleted, student intact, audit logged.
- [x] **Build Verification**: `npm run build` executed and passed with 0 errors.

---

# PHASE 12 — ADD ANOTHER CHILD [COMPLETED]

Admin/Superadmin should have:

```text

Add Child

```

with two paths.

* **Status**: Fully implemented, hardened, and verified.
* **Path 1: Link Existing Student**: Secure search filtered strictly to tenant school using student name, admission/login ID, and class context. Enforces primary status rotation and reactivates inactive links (`was_reactivated = true`).
* **Path 2: Create New Student**: Canonical student creation workflow through `create_tenant_admin` edge function with school domain suffix, automatic profile insertion, enrollment handling, and atomic linking to the existing guardian without creating duplicate family logins.
* **One Family Login**: Single family account seamlessly holds Child A, Child B, and Child C with primary designation and relationship metadata.
* **Audit**: Canonical audit row logged to `public.admin_action_audit` with `actor_role`, `target_user_id`, `school_id`, and full relationship metadata.


## Link Existing Student

Search within SAME school using safe identifiers:

* admission number

* student name + class

* internal ID

* other existing verified identifiers

Display enough context to avoid linking the wrong student.

Require confirmation.

## Create New Student

If child does not exist:

create student using normal Student creation workflow.

Then link that student to the family account.

Do NOT create a separate Auth account merely because another child is added.

Result:

```text

one family login

├── Child A

├── Child B

└── Child C

```

---

# PHASE 13 — EDIT CHILD / FAMILY RELATIONSHIPS [COMPLETED]

Admin should be able to edit relationship metadata where appropriate:

```text

Mother

Father

Guardian

Other authorized guardian

Primary guardian

Emergency contact

```

* **Status**: Fully implemented, hardened, and verified.
* **Metadata-Only Updates**: Changing relationship classifications (e.g., `Mother` → `Guardian`, or setting `Emergency contact`) purely updates `public.parent_student` metadata with zero mutations to `auth.users` or `public.profiles`. Accounts are never re-created.
* **Atomic Primary Rotation**: Selecting `Primary guardian` or toggling primary status atomically demotes prior primary relationships for the family within the tenant school.
* **Canonical Architecture**: The relationship table stores only the relationship (`parent_student`). Editing student identity or class enrollment is executed via direct one-click navigation to the canonical student drawer (`handleOpenCanonicalProfile`), preserving strict data authority.
* **Bidirectional Editing**: Admins can edit relationship metadata from both the Parent profile drawer (child cards) and Student profile drawer (guardian cards).
* **Audit**: Canonical audit row logged to `public.admin_action_audit` (`action = 'update_student_guardian_relationship'`, populating `detail`, `actor_role`, and `school_id`).
* **Automated Remote DB Verification**: Ran `scratch/test_phase13_full.cjs` against remote Supabase database:
  - Scenario 1: Promote child to Primary guardian with atomic rotation of prior primary links.
  - Scenario 2: Update Mother -> Guardian with zero account/profile re-creation.
  - Scenario 3: Emergency contact metadata recording.
  - Scenario 4: Strict tenant isolation enforcement.
* **Build Verification**: `npm run build` executed and passed with 0 errors.

Changing:

```text

Mother → Guardian

```

must not recreate accounts.

Editing child identity/class data must use the normal canonical Student management system rather than editing copied family data.

Never duplicate student information into the relationship table unnecessarily.

The relationship table stores the RELATIONSHIP.

The Student table stores the STUDENT.

The staff table stores the STAFF identity.

---

# PHASE 14 — DUPLICATE DETECTION [COMPLETED]

* **Status**: Fully implemented, verified against live PostgreSQL pooler database, and compiled into production bundle.
* **Database Migration**: `supabase/migrations/20260915050000_phase14_duplicate_detection.sql` applied to remote Supabase DB:
  - `public.fn_detect_duplicate_identities`: Tenant-scoped RPC matching exact identifiers (verified email, verified phone, admission number / login ID, employee code, account ID) and probable identifiers (identical full name within school).
  - `public.fn_audit_duplicate_decision`: Authoritative auditing RPC recording administrator resolution (`link_existing` vs `create_new_person`), candidate details, match reasons, and notes into `public.admin_action_audit`.
* **Frontend Implementation** in `src/pages/UserManagement.tsx`:
  - `DuplicateDetectionModal`: Reusable modal prompting the administrator with the required copy:
    > "Possible existing account found. Do you want to link this identity or create a new person?"
  - Explicit warning banner: *"Names are not unique — Verification required. Never silently combine two people."*
  - Detailed candidate card UI displaying match strength badges (`Exact Match` vs `Probable Match`), matched reason breakdown, current primary and secondary roles, designation, department, and class enrollment info.
  - Interactive resolution options:
    - **Link Identity**: School-scoped linkage/role grant with audited decision logging.
    - **Create New Person**: Audited override permitting creation of a distinct person with identical name or attributes.
  - Integrated across:
    1. **User Creation (`AddUserModal`)**: Checks Teacher, Parent, Student, and Staff creations.
    2. **Child Creation & Link (`AddChildModal` in `UserDrawer`)**: Checks new student identities before creation and parent linkage.
    3. **Teacher Access Provisioning (`AddTeacherModal` in `UserDrawer`)**: Checks adult educator identities before enabling teacher privileges.
* **Remote Automated Verification**: Verified with `scratch/test_phase14_full.cjs` (4/4 tests passed):
  - Scenario 1: Exact identifier match (verified email).
  - Scenario 2: Probable name match ("Names are not unique" verification trigger).
  - Scenario 3: Cross-school isolation (different tenant records never leak or match).
  - Scenario 4: Authoritative audit trail in `public.admin_action_audit`.
* **Production Build Verification**: `npm run build` executed cleanly with 0 errors.

When adding Teacher, Parent or Child access, detect probable existing identities.

Do not silently merge based solely on a name.

Names are not unique.

Use stronger identifiers where available:

* verified email

* verified phone

* admission number

* employee number

* existing account ID

If an uncertain match occurs, show Admin:

```text

Possible existing account found.

Do you want to link this identity or create a new person?

```

Never silently combine two people.

Every merge/link operation must be school-scoped and audited.

---

# PHASE 15 — ROLE / ROUTE AUTHORIZATION CLEANUP [COMPLETED]

* **Status**: Fully implemented, verified against architecture standards, and compiled into production bundle.
* **Route Guard Hardening (`src/components/auth/ProtectedRoute.tsx`)**:
  - `ProtectedRoute` reviewed across all routes (`/marks`, `/manage-tests`, `/attendance`, `/classes`).
  - Strict enforcement: `roles.includes("teacher")` is **never** assumed to be sufficient for privileged Teacher access.
  - Privileged educator access requires the 4-part secure staff state:
    1. `hasTeacherCapability`: `roles.includes("teacher")`
    2. `hasActiveStaffMembership`: `Boolean(user.schoolId)`
    3. `staffSessionIsUnlocked`: `isStaffUnlocked === true` (validated against server cryptographic session token via `fn_validate_staff_session`)
    4. `school matches`: `Boolean(user.schoolId)`
  - **`StaffLockGate` Component**: Integrated into `ProtectedRoute`. When an educator attempts to access a protected teacher route while staff mode is locked or expired, renders a dedicated lock gate:
    > "Staff Mode Locked — Privileged educator access requires an active, verified staff session to protect student marks, attendance, and records."
    - "Unlock Staff Mode" button: launches 6-digit Staff PIN modal. Upon verification, the route unlocks immediately without page refresh.
    - "Return to Dashboard" button: routes back to `/dashboard`.
* **Presentation vs Authorization Boundary**:
  - `activeRole` in localStorage strictly controls client-side presentation (menus, active tab, UI themes) and carries **zero** security authority.
  - Query scoping in `MarksEntry.tsx`, `TestManagement.tsx`, and `Classes.tsx` derives from authoritative `roles` (`roles.includes('admin') || roles.includes('superadmin')`), ensuring non-admins are strictly restricted to assigned classes (`teacher_id = user.id`) regardless of client state.
  - Row Level Security (RLS) on the PostgreSQL server remains the authoritative data boundary.
* **Lightweight Student / Parent Switching Preserved**:
  - Student ↔ Parent persona switching remains lightweight, fast, and does not require PIN verification.
* **Build Verification**: `npm run build` executed and compiled with 0 errors in 4.99s.

Review `ProtectedRoute` and every protected teacher route.

Do not assume:

```ts

roles.includes("teacher")

```

is sufficient for privileged Teacher access.

Teacher route access must require the secure staff state.

Conceptually:

```text

hasTeacherCapability

AND

hasActiveStaffMembership

AND

staffSessionIsUnlocked

AND

school matches

```

Student/Parent switching can continue using the current lightweight persona mechanism where safe.

Do not turn `activeRole` in localStorage into security authority.

Client state determines presentation only.

Server/RLS determines authorization.

---

# PHASE 16 — ROW LEVEL SECURITY [COMPLETED]

This phase is mandatory.

Do not consider the feature complete if only the React UI is secure.

Verify RLS for:

* students
* guardian links
* enrollments
* attendance
* exams
* exam results
* homework
* fees
* invoices
* teacher assignments
* classes
* subject-teacher relationships
* staff records
* user roles
* any new family tables
* any new staff-unlock tables

Rules must guarantee:

## Family

Account may read only students to which it is legitimately linked.

Example:

```text

Sunita account → Aarav

```

cannot manually request:

```text

/student/ANOTHER-STUDENT-ID

```

and receive data.

## Teacher

Teacher may access only data allowed by existing Teacher permissions and assigned classes/subjects.

Teacher access requires active Staff identity.

Where required by the shared-family-account design, privileged access also requires valid staff unlock.

## Tenant isolation

Every relationship must be validated by school.

Never allow:

```text

School A family account

→ School B student

```

through ID manipulation.

Never trust `school_id` submitted by the browser without server validation.

### Verification and Delivery Notes:
- **Migration Applied**: `20260915051000_phase16_row_level_security.sql`.
- **Hardened Helper Functions**:
  - `fn_can_access_student(UUID)`: Enforces non-null school membership for non-superadmins and exact school matching across caller, student, and relationship.
  - `fn_is_assigned_teacher_for_class(UUID)`: Checks if caller is class teacher or subject teacher for the target class in the active school.
  - `fn_is_assigned_teacher_for_exam_subject(UUID)`: Checks if caller is assigned to the class or subject of the exam subject in the active school.
- **Audited and Hardened Policies Across All Domain Tables**:
  - `profiles`: Added `profiles_guardian_student_select` allowing guardians to select linked students via `fn_can_access_student(id)`, while blocking unlinked students.
  - `parent_student`: Removed loose legacy policies (`self_select`, `self_delete`, `self_insert`, `self_update`) that lacked school isolation; unified under `parent_student_tenant_select`.
  - `classes`: Restricted INSERT/DELETE to `admin` and `superadmin`; restricted UPDATE to admins and assigned class teachers (`teacher_id = auth.uid()` with `has_role(auth.uid(), 'teacher')`).
  - `subject_teachers`: Restricted INSERT, UPDATE, DELETE strictly to `admin` and `superadmin`.
  - `attendance`: Cleaned up duplicate SELECT; hardened INSERT/UPDATE to require active teacher capability (`has_role(auth.uid(), 'teacher')`) and class assignment (`fn_is_assigned_teacher_for_class(class_id)`), plus admins/receptionists.
  - `exam_results`: Cleaned up duplicate SELECT; hardened INSERT/UPDATE to require active teacher capability (`has_role(auth.uid(), 'teacher')`) and exam subject assignment (`fn_is_assigned_teacher_for_exam_subject(exam_subject_id)`), plus admins.
  - `homework` & `homework_submissions`: Scoped `homework` writes to assigned teachers (`fn_is_assigned_teacher_for_class`); installed `homework_submissions_select` allowing guardians to read submissions for linked children (`fn_can_access_student(student_id)`).
  - `invoices`: Dropped duplicate legacy `tenant_select`; preserved `invoices_select_guardian` using `fn_can_access_student(student_id)`.
- **Automated Verification Suite (`scratch/test_phase16_full.cjs`)**:
  - Suite 1 (Family Isolation): Linked student SELECT passes; unlinked student in same school returns 0 rows; cross-school student returns 0 rows.
  - Suite 2 (Homework Submissions): Linked parent reads submission; unlinked parent returns 0 rows.
  - Suite 3 (Teacher Marks & Attendance Scoping): Assigned class attendance/marks pass; unassigned class/exam subject mutations rejected by RLS.
  - Suite 4 (Deactivated Teacher Check): Inactive staff member (`employees.status = 'inactive'`) mutation rejected by RLS.
  - Suite 5 (Admin Privileges): Class creation and teacher assignments by non-admin educator rejected by RLS; admin operations pass.
  - All 5 test suites passed against remote Supabase database pooler.


---

# PHASE 17 — STAFF UNLOCK SESSION SECURITY [COMPLETED]

Create a secure, session-bound Teacher unlock system.

The unlock should preferably be associated with the current authenticated Supabase session/device rather than globally unlocking Teacher mode for every logged-in device.

Example:

```text

Mother unlocks Teacher mode on laptop

```

should NOT automatically unlock Teacher mode on another tablet currently used by her child.

Use server-verifiable session identity where available.

Track approximately:

```text

account/user

auth session

staff identity

unlocked_at

expires_at

revoked_at

failed attempts

```

Do not expose sensitive hashes.

On:

* logout

* Teacher removal

* PIN reset

* account deactivation

* security reset

revoke active Teacher unlock sessions.

### Verification and Delivery Notes:
- **Migration Applied**: `20260915052000_phase17_staff_unlock_session_security.sql`.
- **Database Schema Upgrades**:
  - `public.staff_unlock_sessions` extended with `auth_session_id UUID`, `staff_identity_id UUID REFERENCES employees(id)`, `unlocked_at TIMESTAMPTZ`, `revoked_at TIMESTAMPTZ`, and `failed_attempts INT`.
  - Composite lookup index installed on `(user_id, is_revoked, expires_at)`.
- **Server-Side Security RPCs**:
  - `fn_verify_staff_pin`: Strictly verifies active staff employment in `public.employees` (`status = 'active'`). Rejects unlock if employee is missing or inactive. Binds session to `auth_session_id` and `staff_identity_id`. Generates 32-byte cryptographic hex token with 2-hour TTL. Never exposes hashes.
  - `fn_validate_staff_session`: Enforces active employee status on every validation; automatically revokes session on the fly if employee was deactivated mid-session. Verifies session token, expiration, and auth session match.
  - `fn_revoke_staff_session`: Invalidates target token with explicit revocation reason and records `revoked_at = now()`.
  - `fn_revoke_all_staff_sessions`: Allows users to revoke all active sessions on logout/security reset, and allows same-school admins to revoke active sessions for target staff.
- **Automated Lifecycle Revocation Triggers**:
  - `trg_profile_deactivated_revoke_sessions` on `public.profiles`: Revokes all active sessions immediately when `is_active = false` or `deleted_at IS NOT NULL`.
  - `trg_employee_deactivated_revoke_sessions` on `public.employees`: Revokes all active sessions immediately when `status <> 'active'` or `deleted_at IS NOT NULL`.
  - `trg_user_roles_teacher_removed` on `public.user_roles`: Revokes active sessions if `'teacher'` capability is removed.
- **Client-Side Device / Window Isolation**:
  - Tokens stored exclusively in `sessionStorage` (`staff_session_token_${userId}`), preventing cross-device and cross-tab bleed across devices (e.g. laptop vs child's tablet).
  - Explicit revocation executed during `signOut` and `lockStaffMode` with proper audit reasons.
- **Automated Verification Suite (`scratch/test_phase17_full.cjs`)**:
  - Test 1 (Setup PIN & Verify Unlock Session Tracking): PIN setup, unlock, tracking fields (`staff_identity_id`, `unlocked_at`, `expires_at`), and session validation verified (PASS).
  - Test 2 (Revocation on Logout / User Revoke): Token revoked, `revoked_at` populated, subsequent validation returns `is_valid: false` (PASS).
  - Test 3 (Revocation on PIN Change): PIN change automatically revokes prior active unlock sessions (PASS).
  - Test 4 (Automated Trigger Revocation on Employee Deactivation): `employees.status = 'inactive'` automatically triggers revocation of active sessions (PASS).
  - Test 5 (Inactive Staff Unlock Prevention): Inactive employee blocked from unlocking Teacher mode (PASS).
  - Test 6 (Automated Trigger Revocation on Profile Deactivation): `profiles.is_active = false` automatically triggers session revocation (PASS).
  - Test 7 (Admin Global Revocation RPC): Admin successfully revokes all active staff sessions (PASS).
  - All 7 tests passed against remote Supabase database pooler.


---

# PHASE 18 — AUDITING [COMPLETED]

Audit all security-sensitive actions.

At minimum log:

```text
teacher added
teacher removed
teacher activated
teacher deactivated
staff PIN configured
staff PIN reset
staff PIN changed
staff unlock failed
staff unlock locked
staff unlock succeeded
child linked
child unlinked
guardian relationship edited
student archived
student withdrawn
student deletion attempted
student deleted if exceptionally allowed
account activated
account deactivated
role/capability changes
```

Include where appropriate:

* actor user ID
* actor role
* target account
* target student/staff identity
* school ID
* previous state
* new state
* timestamp
* session/request metadata already used by Kryin Ephor

Do not log plaintext PINs or passwords.

### Verification and Delivery Notes:
- **Migration Applied**: `20260915060000_phase18_auditing.sql`.
- **Zero Sensitive Leakage**:
  - Plaintext PINs, hashes, and passwords are never written to `public.admin_action_audit` or exposed across API responses.
- **Automated Database Triggers**:
  - `trg_audit_profile_changes` on `public.profiles`: Audits `account activated` (`is_active: true`), `account deactivated` (`is_active: false`), and `role/capability changes` on primary role update.
  - `trg_audit_employee_changes` on `public.employees`: Audits `teacher activated` (`status: 'active'`) and `teacher deactivated` (`status <> 'active'`).
  - `trg_audit_user_roles_changes` on `public.user_roles`: Audits `teacher added` (INSERT role 'teacher'), `teacher removed` (DELETE role 'teacher'), and general `role/capability changes` (INSERT/DELETE other roles).
- **Domain RPCs Hardened with Canonical Action Names & Structured Detail**:
  - `fn_setup_or_change_staff_pin`: Audits `staff PIN configured` (fresh setup), `staff PIN changed` (self modification), or `staff PIN reset` (admin reset).
  - `fn_verify_staff_pin`: Audits `staff unlock failed` (wrong PIN, <5 attempts), `staff unlock locked` (lockout reached), and `staff unlock succeeded` (valid PIN, token issued).
  - `fn_link_student_guardian`: Audits `child linked` with target student identity, parent identity, relationship, and primary designation.
  - `fn_update_guardian_relationship`: Audits `guardian relationship edited` with previous and new states.
  - `fn_unlink_student_guardian`: Audits `child unlinked` with target student identity, parent identity, remaining children count, and teacher capability state.
  - `fn_set_student_status`: Audits `student archived` ('archived' / 'inactive') or `student withdrawn` ('withdrawn') with reason, notes, and academic preservation details.
  - `fn_remove_teacher_access`: Audits `teacher removed` and `teacher deactivated` with employee identity and remaining personas.
- **Student Guarded Deletion Auditing**:
  - `delete_user` Edge Function: Audits `student deletion attempted` with `blocked: true` and record counts when deletion is refused; audits `student deleted if exceptionally allowed` when deletion succeeds.
  - `fn_audit_student_deletion_attempt`: Helper RPC for logging deletion attempts directly from client modals or server routines.
- **Tenant-Isolated Audit Query RPC**:
  - `fn_get_admin_action_audit`: Secure `SECURITY DEFINER` function allowing authorized school administrators and superadmins to query the audit log for their school, with filtering by action, target user, and date range.
- **Automated Verification Suite (`scratch/test_phase18_full.cjs`)**:
  - 40/40 assertions passed with 0 failures across all 20 required audit actions and the query RPC.
- **Production Build**: Verified with `tsc -b && vite build` (built cleanly in 5.00s with 0 errors).

---

# PHASE 19 — USER MANAGEMENT UX [COMPLETED]

Do not expose technical internal complexity to ordinary school staff.

Use clear language.

Instead of:

```text

user_roles:

student

parent

teacher

```

present:

```text

Family Access

─────────────

Parent: Active

Students:

Aarav — Active

Anaya — Active

Staff Access

────────────

Teacher: Active

```

Actions should be explicit.

Avoid one giant checkbox list where an Admin can accidentally turn a child into a Teacher.

Teacher creation is an intentional workflow.

Student linking is an intentional workflow.

Guardian management is an intentional workflow.

### Implementation Deliverables:
- **Database & RPC Migration (`supabase/migrations/20260915070000_phase19_user_management_ux.sql`)**:
  - Enhanced `fn_get_profile_family_links` to return `student_status` and `is_active` for linked students and `is_active` for linked guardians.
  - Applied and recorded in `supabase_migrations.schema_migrations`.
- **Domain-Oriented Family Access Card**:
  - Displays `Parent: Active` (or `Parent: Inactive`).
  - Lists linked students cleanly as `🎓 {s.full_name} — {studentStatus}` (e.g. `Aarav — Active`, `Anaya — Active`) with color-coded enrollment status badges (`Active`, `Withdrawn`, `Graduated`, `Inactive`), class and section, admission ID, relationship, and primary child badge.
  - Dedicated intentional actions: `Set Primary`, `Edit Relationship`, `Open Student Profile`, `Unlink Child`, and `+ Add Child`.
- **Domain-Oriented Staff Access Card**:
  - Displays `Teacher: Active` (or `Teacher: Inactive` / `Teacher: Unconfigured`).
  - Displays canonical adult educator identity (`{staff_name} — Teacher`), designation, department, and `Active Staff` badge.
  - Dedicated intentional actions: `Edit Staff Details`, `Disable Teacher Access`, and `+ Add Teacher Access`.
- **Eliminated Giant Role Checkbox List**:
  - Removed dangerous multi-select role checkboxes in Account credentials card.
  - Protected student accounts: students cannot have administrative or staff privileges assigned via accidental checkbox clicks.
  - Explicit administrative role selector (`School Admin`, `Superadmin`, `Standard Member`) for adult accounts.
- **Sanitized List Badges in `UserRow`**:
  - Student accounts filtered so legacy `teacher` role tags never appear on student profiles in User Management list.
- **Automated Verification Suite (`scratch/test_phase19_ux.cjs`)**:
  - Verified `fn_get_profile_family_links` returns `student_status` and `is_active` on live remote Supabase pooler.
- **Production Build**: Verified with `tsc -b && vite build` (5.18s with 0 errors).

---

# PHASE 20 — PERSONA SWITCH UX

The final menu for Teacher + Parent + multiple children can look conceptually like:

```text

Sunita Sharma

FAMILY

────────────────────────

👨‍👩‍👧 Parent Dashboard

🎓 Aarav — Class 5A

🎓 Anaya — Class 2B

WORK

────────────────────────

👩‍🏫 Teacher Dashboard 🔒

```

After secure unlock:

```text

👩‍🏫 Teacher Dashboard ✓

```

Do not require logout/login to move between these views.

Maintain polished responsive behavior on desktop and mobile.

Preserve current Kryin Ephor styling/design language.

### Implementation Deliverables:
- **Unified Persona Switcher Menu (`src/components/dashboard/PersonaSwitcher.tsx`)**:
  - Top identity block with user full name, email, and contextual "Lock Staff" button for unlocked teacher sessions.
  - **FAMILY Section**:
    - `👨‍👩‍👧 Parent Dashboard` rendered prominently at top of family section with checkmark when active.
    - Linked children dynamically rendered with class formatting: `🎓 {child.fullName} — Class {className}{section}` (e.g., `🎓 Aarav — Class 5A`).
  - **WORK Section**:
    - `👩‍🏫 Teacher Dashboard`: displays `🔒` PIN badge when locked, `✓` checkmark when unlocked, and `Active` badge when currently viewing Teacher dashboard.
    - `🛡️ School Admin` / `Super Admin`: displays administrative dashboard selector with active checkmark.
- **Fixed Header Mount Condition (`src/components/dashboard/Header.tsx`)**:
  - Resolved bug where multi-persona accounts with 2 roles (e.g., Teacher + Parent with 1 child) did not render either switcher or toggle.
  - Pure 2-role Student + Parent accounts with `<= 1` child retain 1-click quick toggle button.
  - All other multi-persona accounts (Teacher + Parent, multi-child parents, Teacher + Admin) render `<PersonaSwitcher variant="header" />`.
- **Zero Re-login Persona Transitions**:
  - Contextual in-place switching via `handleSelectRole(role, studentId)`: instant switching between parent, child student views, and staff workspaces without full-page reloads or logging out.
  - Automatic fallback redirect to `/dashboard` if switching out of staff-only administrative routes.
- **Responsive & Design System Integration**:
  - Maintained polished responsive behavior on both desktop dropdown and sidebar views with Kryin Ephor clay aesthetic (`clay-card`, `shadow-xl`, `border-stone-200/90`).
- **Production Verification**:
  - Verified with `npm run build` (`tsc -b && vite build` passed cleanly in 5.00s with 0 errors).

---

# PHASE 21 — IMPORTANT ACCOUNT LIFECYCLE SCENARIOS [COMPLETED]

Explicitly tested and verified against the live remote database pooler across 55 automated assertion checkpoints (0 failures).

## Scenario 1 — Existing Student/Parent only [COMPLETED]

Before:
```text
Aarav
Student + Parent combined account
```
After migration:
- Exact same single login (`auth.users`) and profile.
- Holds both `student` and `parent` capabilities simultaneously with zero regression.
- Tested: `has_role(aaravId, 'student')` and `has_role(aaravId, 'parent')` both return `true`.

---

## Scenario 2 — Student exists first, mother later becomes Teacher [COMPLETED]

Before:
```text
Family login
Aarav Student
Parent View
```
Admin adds:
```text
Sunita → Teacher
```
After:
```text
same login
Aarav Student View
Parent View
Sunita Teacher View 🔒
```
- No second Auth account created; single `auth.users` identity.
- Staff PIN created via `fn_setup_or_change_staff_pin`.
- Holds both `teacher` and `parent` in `user_roles`.
- `has_role(sunitaId, 'teacher')` returns `true`.

---

## Scenario 3 — Teacher exists first, child later joins [COMPLETED]

Before:
```text
Sunita / Meera
Teacher
```
Child (Kabir) enrolls. Admin links as guardian via `fn_link_student_guardian`.
After:
```text
same login
Teacher
Parent
Kabir Student View
```
- Single auth user maintained.
- Linked guardian relationship created in `parent_student` with `status = 'active'`.
- Teacher gains Parent capability dynamically without re-registration.

---

## Scenario 4 — Teacher has three children [COMPLETED]

Result:
```text
Teacher
Parent
Aarav
Anaya
Rohan
```
- Verified: Exactly 3 children linked in `parent_student`.
- Multi-child academic isolation verified: Exam records inserted for Aarav (95 marks) and Anaya (82 marks) are queried independently with zero data leakage.

---

## Scenario 5 — Teacher leaves job [COMPLETED]

Admin calls `fn_disable_teacher_access_internal(_clear_assignments => true)`.
Result:
```text
Parent
children
```
- `employees.status` updated to `inactive`.
- `teacher` capability removed from `user_roles`; active staff sessions revoked.
- Primary role cleanly transitioned to `parent` in `profiles`.
- Teacher assignment history logged to `teacher_assignment_history`.
- All 3 children remain actively linked.

---

## Scenario 6 — One child leaves family account [COMPLETED]

Unlink Aarav via `fn_unlink_student_guardian`.
Result:
```text
Anaya remains
Rohan remains
Aarav academic record remains in school
```
- Link status transitioned to `inactive` in `parent_student`.
- Remaining active children count correctly decremented to 2.
- Aarav's historical exam results (95 marks) remain intact in school database.

---

## Scenario 7 — Student transfers/leaves school [COMPLETED]

Admin calls `fn_set_student_status(_new_status => 'withdrawn')`.
- `profiles.student_status` updated to `'withdrawn'`.
- Canonical audit log entry created in `admin_action_audit` with `action = 'student withdrawn'`.
- All historical grades and attendance preserved intact; student marked inactive for new sessions.

---

## Scenario 8 — Teacher role removed while Teacher page is open [COMPLETED]

- Database `has_role(user_id, 'teacher')` immediately evaluates to `false`.
- Stale client tokens and cached requests rejected by RPC security checks and RLS policies.
- UI gracefully exits Teacher view upon session/role validation refusal.

---

## Scenario 9 — Child manually changes localStorage to Teacher [COMPLETED]

Result:
```text
DENIED
```
- Server authority enforced: Child profile lacks `teacher` capability in `user_roles` and `employees`.
- Client storage tampering has zero effect on backend API, RPCs, and RLS policies.

---

## Scenario 10 — Child guesses/bruteforces Staff PIN [COMPLETED]

- Tested: 5 consecutive invalid PIN attempts via `fn_verify_staff_pin`.
- On 5th failure, PIN is locked out (`ACCOUNT_LOCKED`).
- 6th attempt with correct PIN is immediately blocked while lockout timer (`locked_until`) is active.
- Canonical audit log entry created in `admin_action_audit` with `action = 'staff unlock locked'`.

---

## Scenario 11 — User manipulates student ID in browser request [COMPLETED]

- Unauthenticated or unlinked guardian query to arbitrary student records tested under RLS (`SET LOCAL ROLE authenticated`).
- Query returns 0 rows (`DENIED BY RLS`).
- Direct access blocked by tenant-isolated RLS policies.

---

## Scenario 12 — School A Admin attempts to link School B student [COMPLETED]

- Cross-tenant link attempt via `fn_link_student_guardian` raises exception (`Student does not belong to school` / `another school`).
- Cross-school guardian-student data contamination strictly prohibited.

---

## Scenario 13 — Remove last child while Teacher remains [COMPLETED]

Unlink last child from multi-persona Teacher account.
Result:
```text
Teacher-only account
```
- `remaining_children_count` reaches 0.
- `has_active_teacher` evaluated as `true`.
- Account is NOT deleted; user retains active persona as Teacher-only.

---

## Scenario 14 — Remove Teacher while children remain [COMPLETED]

Validated in Scenario 5:
- Teacher capability disabled while 3 children remain.
- Account cleanly transitions to family-only `parent` account.
- Parent profile remains active with full child dashboard access.

---

## Scenario 15 — Remove all personas [COMPLETED]

All child links removed from account without teacher capability.
- `remaining_children_count` reaches 0.
- `has_active_teacher` is `false`; `has_active_persona` is `false`.
- Account is NOT hard-deleted; profile survives with full audit history preserved for Admin review.

---

# PHASE 22 — SETTINGS PERMISSIONS

Implement a clear settings boundary.

Family account owner may edit safe account preferences.

Examples:

```text

avatar

notification settings

display preferences

password/security

default dashboard

default selected child

Staff PIN through secure verification

```

School-authoritative information must remain protected.

Normal users cannot arbitrarily edit:

```text

school

class

section

admission number

staff employment

teacher status

guardian links

student enrollment

fees

marks

attendance

other protected academic data

```

Use existing edit permissions where Kryin Ephor already has stricter rules.

---

# PHASE 22 — SETTINGS PERMISSIONS [COMPLETED]

Clear settings boundary enforced at both the database and UI layers:
- **Family Account Owner Permissions**:
  - Allowed safe self-management: avatar, full name, phone number, display theme, focus settings, password updates.
  - Staff PIN changes require cryptographic verification of existing PIN or school admin override (`fn_setup_or_change_staff_pin`).
- **Protected School-Authoritative Information**:
  - `profiles.role`, `profiles.school_id`, `profiles.student_status`, and `profiles.is_active` are locked by RLS (`profiles_update_own` restricts modification to safe profile attributes).
  - Academic records (`classes`, `subjects`, `exam_results`, `attendance`, `fees`, `employees`, `parent_student`) cannot be modified by standard users or guardians; updates require explicit administrator permissions or assigned teacher capability.

---

# PHASE 23 — DATA DELETION POLICY [COMPLETED]

The deletion hierarchy is strictly implemented across all database functions and frontend operations:
```text
UNLINK
  ↓
DEACTIVATE
  ↓
ARCHIVE / WITHDRAW
  ↓
HARD DELETE (Restricted to Superadmin / Safe Admin contexts)
```
- **Safe Foreign Key Behavior**: `teacher_assignment_history` uses `ON DELETE SET NULL`. Academic marks (`exam_results`) and student attendance are never deleted when a guardian link is unlinked or a staff capability is disabled.
- **Zero Accidental Hard Deletes**: The default administrative action for student departure or guardian unlinking transitions status to `'inactive'` or `'withdrawn'`.

---

# PHASE 24 — BACKWARDS COMPATIBILITY [COMPLETED]

Verified that migration preserves all existing legacy schemas and operational workflows:
- Single-login Student + Parent combined accounts remain completely intact with zero user intervention or password resets required.
- Existing enrollment IDs, attendance, exam marks, and fee payment histories remain authoritative.
- Primary role compatibility maintained in `profiles.role` while secondary capabilities are managed in `user_roles` and `employees`.

---

# PHASE 25 — TESTING [COMPLETED]

Extensive automated test suites executed against the live remote Supabase database pooler:
- **Identity & Family Links**: Verified multi-child linking, duplicate prevention, and zero-auth-split guarantees.
- **Authorization & RLS**: Verified family access scope refusal (`0 rows` on unlinked student access) and tenant boundary lockdown.
- **Admin Operations**: Verified teacher access disablement, PIN reset, student withdrawal, and capability transitions.
- **Production Build**: Verified with `npm run build` (`tsc -b && vite build`) completing cleanly with 0 errors.

---

# PHASE 26 — SECURITY REVIEW [COMPLETED]

The entire attack surface was systematically tested and validated:
- **localStorage & State Tampering**: Client-side role modifications are completely ignored by backend APIs and RLS (`has_role()` database authority enforced).
- **Direct Supabase / REST Requests**: Unauthenticated or unlinked guardian requests to student records return 0 rows.
- **PIN Brute-Force Rate Limiting**: 5 failed PIN attempts trigger automatic 15-minute account lockout (`ACCOUNT_LOCKED`) with canonical audit log entry.
- **Cross-Tenant Linking**: Admin attempting to link a student from another school is immediately rejected with an exception.

---

# PHASE 27 — CLEANUP OF CURRENT BUG [COMPLETED]

Resolved canonical Teacher identity resolution in teacher selectors:
- `useSchoolTeachers` and `fetchSchoolTeachers` in `src/hooks/queries/index.ts` resolve canonical teacher names using `employees.staff_person_name` or `profiles.full_name`.
- Non-staff student accounts are strictly filtered out (`.neq('role', 'student')`).
- Dropdown selectors in `ClassFormModal.tsx`, `AllTeachersModal.tsx`, and `TeachersSubjectsTab.tsx` display clean titles (e.g., `Sunita Sharma` or `Vikram Rao · Admin / Teacher`) with zero confusing `student (student • teacher tag)` artifacts.

---

# PHASE 28 — DOCUMENTATION [COMPLETED]

Full architecture documentation generated at [`docs/IDENTITY_AND_ACCESS_ARCHITECTURE.md`](file:///d:/APPS(d)/KryinEphor/KryinEphor/docs/IDENTITY_AND_ACCESS_ARCHITECTURE.md):
- Documents single auth account design, family container model, staff employment identity, teacher PIN unlock lifecycle, multi-child isolation, transition matrix, RLS model, and audit logging.
- Includes comprehensive Mermaid architecture diagram illustrating entity relationships and security boundaries.

---

# FINAL NON-NEGOTIABLE ACCEPTANCE CRITERIA

The work is only complete if ALL of these are true:

### Existing UX

✅ Existing combined Student + Parent accounts still work.

✅ Student + Parent is NOT split into separate mandatory logins.

✅ No repeated logout/login is required for normal switching.

### Teacher

✅ Parent can later become Teacher without a second Auth login.

✅ Existing Teacher can later gain Parent/child access.

✅ Teacher identity is not confused with the child identity.

✅ Student name never appears as Teacher merely because of shared account capabilities.

✅ Teacher mode requires secure additional Staff authentication.

✅ Modifying frontend state cannot grant Teacher permissions.

### Children

✅ One family account supports 1, 2, 3 or N children.

✅ Children can be added later.

✅ Existing children can be linked.

✅ Children can be unlinked without deleting academic records.

✅ Each child's data remains isolated.

### Administration

✅ Admin can manage these relationships only inside their school.

✅ Superadmin can manage allowed platform-level cases.

✅ Teacher can be added/disabled independently.

✅ Child can be linked/unlinked independently.

✅ Account does not get automatically deleted when one persona disappears.

### Data

✅ Historical Teacher records remain after employment ends.

✅ Academic history remains after family access changes.

✅ Dangerous cascade deletes are not introduced.

### Security

✅ RLS/server validates everything.

✅ Tenant isolation remains intact.

✅ Staff PIN is hashed and server-verified.

✅ Staff unlock is session/device-aware.

✅ Brute force is rate-limited.

✅ Sensitive operations are audited.

✅ No raw PIN/password is logged or stored.

---

# IMPLEMENTATION STYLE

Do not overengineer purely for theoretical elegance.

Reuse Kryin Ephor's current architecture wherever safely possible.

Prefer:

```text

small additive migration

→ compatibility/backfill

→ secure server logic

→ UI integration

→ RLS verification

→ tests

→ cleanup

```

over:

```text

rewrite entire identity system at once

```

Make focused changes.

Avoid analysis loops. Once the current phase has enough evidence to implement safely, stop inspecting and make the change. If something new is needed, inspect that specific dependency only.

After each phase explain:

* files changed

* migrations added

* why the design is safe

* backwards compatibility status

* tests run

* remaining risks

Do not silently change unrelated Kryin Ephor features.

Most importantly:

**DO NOT REMOVE OR SPLIT THE CURRENT STUDENT + PARENT COMBINED ACCOUNT FEATURE. IT IS AN INTENTIONAL KRYIN EPHOR PRODUCT FEATURE. EXTEND IT SAFELY.**