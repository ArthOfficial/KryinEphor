-- ════════════════════════════════════════════════════════════════════
-- Phase 4A — Track A: Hardening follow-up (REVIEW-ONLY)
-- ────────────────────────────────────────────────────────────────────
-- Apply by moving to supabase/migrations/ (or running in SQL editor).
-- Addresses review items 1–6, 11, 13, 16, 17:
--   1. Backfill validation guard for login_id.
--   2. migration_audit gains affected_profile_id; backfilled from target_id.
--   3. handle_new_user raises descriptive errors including the user id.
--   5/6. login_id / recovery_email lowercased + CHECK-constrained.
--  11. Trigger that resets recovery_email_verified when recovery_email changes.
--  13. CHECK constraints for email format.
--  16. Index on recovery_email.
--  17. Column comments on all 4 new columns.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. migration_audit: add affected_profile_id (item 2) ───────────
ALTER TABLE public.migration_audit
    ADD COLUMN IF NOT EXISTS affected_profile_id UUID;

UPDATE public.migration_audit
   SET affected_profile_id = target_id::uuid
 WHERE affected_profile_id IS NULL
   AND target_table = 'profiles'
   AND target_id ~* '^[0-9a-f-]{36}$';

CREATE INDEX IF NOT EXISTS migration_audit_affected_profile_id_idx
    ON public.migration_audit (affected_profile_id)
    WHERE affected_profile_id IS NOT NULL;

-- ── 2. Normalize existing login_id / recovery_email to lowercase ───
UPDATE public.profiles
   SET login_id = lower(trim(login_id))
 WHERE login_id IS NOT NULL
   AND login_id <> lower(trim(login_id));

UPDATE public.profiles
   SET recovery_email = lower(trim(recovery_email))
 WHERE recovery_email IS NOT NULL
   AND recovery_email <> lower(trim(recovery_email));

-- ── 3. Backfill validation guard (item 1) ──────────────────────────
DO $$
DECLARE
    v_missing INT;
BEGIN
    SELECT count(*) INTO v_missing FROM public.profiles WHERE login_id IS NULL;
    IF v_missing > 0 THEN
        RAISE EXCEPTION 'login_id backfill incomplete — % profile(s) still NULL', v_missing;
    END IF;
END $$;

-- ── 4. CHECK constraints: lowercase + email format (items 5, 6, 13) ─
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_login_id_lowercase,
    DROP CONSTRAINT IF EXISTS profiles_recovery_email_lowercase,
    DROP CONSTRAINT IF EXISTS profiles_login_id_email_format,
    DROP CONSTRAINT IF EXISTS profiles_recovery_email_format;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_login_id_lowercase
        CHECK (login_id IS NULL OR login_id = lower(login_id)),
    ADD CONSTRAINT profiles_recovery_email_lowercase
        CHECK (recovery_email IS NULL OR recovery_email = lower(recovery_email)),
    ADD CONSTRAINT profiles_login_id_email_format
        CHECK (login_id IS NULL OR login_id ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    ADD CONSTRAINT profiles_recovery_email_format
        CHECK (recovery_email IS NULL OR recovery_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- ── 5. Trigger: reset recovery_email_verified on address change (item 11) ─
CREATE OR REPLACE FUNCTION public.reset_recovery_email_verified()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.recovery_email IS DISTINCT FROM OLD.recovery_email THEN
        NEW.recovery_email_verified := false;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_reset_recovery_email_verified ON public.profiles;
CREATE TRIGGER trg_reset_recovery_email_verified
    BEFORE UPDATE OF recovery_email ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.reset_recovery_email_verified();

-- ── 6. Recovery email lookup index (item 16) ───────────────────────
CREATE INDEX IF NOT EXISTS profiles_recovery_email_idx
    ON public.profiles (recovery_email)
    WHERE recovery_email IS NOT NULL;

-- ── 7. handle_new_user: descriptive failure with user id (item 3) ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_role      TEXT;
    v_full_name TEXT;
    v_school_id UUID;
    v_login_id  TEXT;
BEGIN
    v_role := COALESCE(
        NEW.raw_app_meta_data  ->> 'role',
        NEW.raw_user_meta_data ->> 'role'
    );

    IF v_role IS NULL OR v_role = '' THEN
        RAISE EXCEPTION
          'handle_new_user: role must be supplied via app_metadata or user_metadata. User ID: %, email: %',
          NEW.id, NEW.email
          USING ERRCODE = 'check_violation';
    END IF;

    v_full_name := COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        ''
    );

    v_school_id := NULLIF(
        COALESCE(
            NEW.raw_app_meta_data  ->> 'school_id',
            NEW.raw_user_meta_data ->> 'school_id'
        ),
        ''
    )::UUID;

    v_login_id := lower(trim(NEW.email));

    INSERT INTO public.profiles (id, email, full_name, role, school_id, login_id)
    VALUES (NEW.id, NEW.email, v_full_name, v_role, v_school_id, v_login_id)
    ON CONFLICT (id) DO UPDATE SET
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        role      = COALESCE(EXCLUDED.role,      public.profiles.role),
        school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
        login_id  = COALESCE(public.profiles.login_id, EXCLUDED.login_id),
        updated_at = now();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 8. Column comments (item 17) ───────────────────────────────────
COMMENT ON COLUMN public.profiles.login_id IS
    'Institutional login credential, mirrors auth.users.email. Always lowercase + trimmed.';
COMMENT ON COLUMN public.profiles.recovery_email IS
    'Optional real inbox for password recovery. Null until user sets it. Lowercased at write time.';
COMMENT ON COLUMN public.profiles.recovery_email_verified IS
    'True only after OTP/link confirmation. Auto-resets to false when recovery_email changes.';
COMMENT ON COLUMN public.profiles.phone_verified IS
    'True only after OTP confirmation of phone number.';

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- Post-apply verification (item 18 — expanded checks)
-- ════════════════════════════════════════════════════════════════════
-- SELECT login_id, count(*) FROM public.profiles GROUP BY login_id HAVING count(*) > 1; -- expect 0 rows
-- SELECT id, role FROM public.profiles
--   WHERE role NOT IN ('superadmin','tenant_admin','school_admin','teacher','student'); -- expect 0 rows
-- SELECT count(*) FROM public.migration_audit
--   WHERE migration_name = '20260614100000_phase4a_track_a_auth_recovery'; -- expect 3
-- SELECT count(*) FROM public.profiles WHERE login_id IS NULL; -- expect 0
