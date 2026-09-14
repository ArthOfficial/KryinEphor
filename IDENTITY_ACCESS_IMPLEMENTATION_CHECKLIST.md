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

Fix Teacher handling.

Teacher options must come from valid active staff identities.

A person should appear in Teacher selection only if all required conditions hold:

```text

active staff membership

AND teacher capability

AND same school

AND not deleted

AND allowed to teach

```

Do NOT simply query:

```text

any profile containing "teacher" in user_roles

```

as the sole criterion.

Update:

* teacher dropdowns

* class teacher selectors

* subject teacher selectors

* teacher assignment queries

* teacher counts if necessary

so they reference the staff identity and staff name.

Fix the existing:

```text

student (student • teacher tag)

```

problem at its ROOT, not merely through nicer string formatting.

---

# PHASE 3 — ADD TEACHER TO AN EXISTING FAMILY/STUDENT ACCOUNT

This is a critical workflow.

Example:

```text

Existing:

Aarav Sharma

Student + Parent family account

Later:

Aarav's mother Sunita becomes a Teacher.

```

Admin/Superadmin should be able to choose:

```text

Add Staff / Teacher

[ Search existing account ]

```

Search may use safe school-scoped identifiers such as:

* verified email

* verified phone

* account username

* guardian name

* student/guardian relationship

Do NOT automatically select the student record as the teacher.

If the existing account represents a family/student account, show something similar to:

```text

Existing family account found

Student:

Aarav Sharma — Class 5A

Guardian:

Sunita Sharma — Mother

Add Sunita Sharma as staff?

[ Add Teacher ]

```

If guardian identity data does not yet exist in structured form, Admin must explicitly enter/select the adult Teacher's information.

DO NOT silently assume:

```text

profile.full_name == teacher name

```

because an existing family login may currently contain the student's name.

Create/reuse:

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

Clearly distinguish THREE operations:

## A. Unlink Child From Family Account

Meaning:

> This family account should no longer be able to access this student.

Do:

```text

guardian/family link → inactive/removed

```

DO NOT delete student academic data.

Student stays enrolled.

Marks remain.

Attendance remains.

Fees remain.

Only family access is removed.

---

## B. Student Leaves School

Use statuses such as:

```text

withdrawn

transferred

graduated

inactive

```

according to existing architecture.

Preserve history.

Do not hard-delete academic history.

Family may retain limited historical access according to product policy, or lose active access after withdrawal. Implement whichever current Kryin Ephor policy is most consistent, but keep the data.

---

## C. Mistaken/Duplicate Student Record

Hard delete should be exceptional.

Only allow if safe.

Before deletion verify:

* no attendance

* no marks

* no invoices

* no payments

* no exams/results

* no important messages

* no required audit history

* no dependent academic records

If meaningful history exists, refuse destructive deletion and require archive/merge/manual remediation instead.

Use confirmation UI.

Prefer:

```text

Archive

```

over:

```text

Delete

```

for real students.

All destructive actions must be audited.

---

# PHASE 11 — REMOVE THE LAST CHILD

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

---

# PHASE 12 — ADD ANOTHER CHILD

Admin/Superadmin should have:

```text

Add Child

```

with two paths.

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

# PHASE 13 — EDIT CHILD / FAMILY RELATIONSHIPS

Admin should be able to edit relationship metadata where appropriate:

```text

Mother

Father

Guardian

Other authorized guardian

Primary guardian

Emergency contact

```

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

# PHASE 14 — DUPLICATE DETECTION

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

# PHASE 15 — ROLE / ROUTE AUTHORIZATION CLEANUP

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

# PHASE 16 — ROW LEVEL SECURITY

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

---

# PHASE 17 — STAFF UNLOCK SESSION SECURITY

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

---

# PHASE 18 — AUDITING

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

---

# PHASE 19 — USER MANAGEMENT UX

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

---

# PHASE 21 — IMPORTANT ACCOUNT LIFECYCLE SCENARIOS

You MUST explicitly test all of these.

## Scenario 1 — Existing Student/Parent only

Before:

```text

Aarav

Student + Parent combined account

```

After migration:

exact same login and UX.

No breakage.

---

## Scenario 2 — Student exists first, mother later becomes Teacher

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

No second Auth account.

---

## Scenario 3 — Teacher exists first, child later joins

Before:

```text

Sunita

Teacher

```

Aarav enrolls.

Admin links Sunita as guardian.

After:

```text

same Sunita login

Teacher

Parent

Aarav Student View

```

---

## Scenario 4 — Teacher has three children

Result:

```text

Teacher

Parent

Aarav

Anaya

Rohan

```

Each child's academic data remains completely isolated.

---

## Scenario 5 — Teacher leaves job

Remove staff capability.

Result:

```text

Parent

children

```

Teacher history remains.

---

## Scenario 6 — One child leaves family account

Example:

```text

Aarav

Anaya

```

unlink Aarav.

Result:

```text

Anaya remains

Aarav academic record remains in school

```

---

## Scenario 7 — Student transfers/leaves school

Mark academic/enrollment status appropriately.

Do not destroy history.

---

## Scenario 8 — Teacher role removed while Teacher page is open

Server must immediately or promptly reject future privileged requests.

UI should safely exit Teacher mode.

---

## Scenario 9 — Child manually changes localStorage to Teacher

Result:

```text

DENIED

```

No Teacher data exposed.

---

## Scenario 10 — Child guesses/bruteforces Staff PIN

Rate limit and lockout.

No Teacher access.

Audit event created.

---

## Scenario 11 — User manipulates student ID in browser request

If not linked:

```text

DENIED BY RLS/SERVER

```

---

## Scenario 12 — School A Admin attempts to link School B student

```text

DENIED

```

---

## Scenario 13 — Remove last child while Teacher remains

Result:

```text

Teacher-only account

```

Do not delete account.

---

## Scenario 14 — Remove Teacher while children remain

Result:

```text

family-only account

```

---

## Scenario 15 — Remove all personas

Do not hard-delete automatically.

Mark account requiring Admin decision/deactivation.

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

# PHASE 23 — DATA DELETION POLICY

Use this hierarchy:

```text

UNLINK

↓

DEACTIVATE

↓

ARCHIVE/WITHDRAW

↓

HARD DELETE only when genuinely safe

```

Do not use hard delete as the default "Remove" action.

Academic and financial history must survive staff/family relationship changes.

Use safe foreign-key behavior.

Do not create cascading deletion chains capable of removing student history when an account is deleted.

---

# PHASE 24 — BACKWARDS COMPATIBILITY

Migration MUST preserve:

* existing Student logins

* existing Student + Parent switching

* existing Teacher accounts

* existing Admin accounts

* existing Superadmin accounts

* current enrollment IDs where possible

* current academic history

* existing attendance

* existing test results

* current fee data

* current tenant boundaries

Do not require schools to recreate users.

Do not require users to reset passwords solely because of this architecture change.

Where legacy fields must remain temporarily, document them clearly as compatibility fields and identify the new source of truth.

Avoid permanent dual sources of truth.

---

# PHASE 25 — TESTING

Create/extend tests covering:

### Identity

* existing Student account migration

* Parent access

* Teacher staff identity

* multiple children

* duplicate-link prevention

### Authorization

* family can access linked child

* family cannot access unlinked child

* teacher locked → Teacher API denied

* teacher unlocked → permitted scoped API works

* expired staff unlock → denied

* removed teacher → denied

* wrong school → denied

### Admin

* add teacher to existing family

* add child to existing teacher

* add second/third child

* unlink child

* disable teacher

* reset Staff PIN

* deactivate account

### Regression

* existing Student dashboard

* Parent dashboard

* attendance

* tests

* marks

* fees

* teacher class assignments

* current role switching

Run production build before completion.

---

# PHASE 26 — SECURITY REVIEW

Before declaring this finished, attempt to attack the implementation.

Test:

```text

localStorage manipulation

React state manipulation

direct Supabase request

direct REST request

teacher route entered manually

student ID substitution

school ID substitution

stale Teacher unlock

expired Teacher unlock

removed Teacher using old browser session

PIN brute force

duplicate guardian linking

duplicate staff membership

cross-tenant linking

```

The React UI must never be the final security boundary.

Database/RLS/server validation must remain authoritative.

---

# PHASE 27 — CLEANUP OF CURRENT BUG

Specifically fix the existing case where UI may display:

```text

student (student • teacher tag)

```

Do NOT solve it only by changing its text.

After this architecture:

Teacher selectors should obtain a canonical Teacher identity.

Example:

```text

Sunita Sharma

```

If an Admin is also legitimately a Teacher:

```text

Vikram Rao

```

The UI may optionally show secondary staff context:

```text

Vikram Rao · Admin / Teacher

```

but never expose confusing legacy role-tag combinations.

Students who have no legitimate staff identity must never appear in Teacher assignment selectors.

---

# PHASE 28 — DOCUMENTATION

Update project documentation after implementation.

Document:

1. Auth account

2. Family account

3. Student identity

4. Guardian link

5. Staff identity

6. Teacher unlock

7. multiple-child relationship

8. account lifecycle

9. Teacher lifecycle

10. Student lifecycle

11. Admin permissions

12. RLS security model

13. migration/backwards compatibility

Add a simple architecture diagram.

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