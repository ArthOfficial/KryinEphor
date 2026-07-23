-- ════════════════════════════════════════════════════════════════════
-- Phase 4A — Track A Hardening: DOWN migration
-- ════════════════════════════════════════════════════════════════════
BEGIN;

-- Restore previous handle_new_user (pre-hardening Phase-4A version)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_role      TEXT;
    v_full_name TEXT;
    v_school_id UUID;
BEGIN
    v_role := COALESCE(NEW.raw_app_meta_data ->> 'role', NEW.raw_user_meta_data ->> 'role');
    IF v_role IS NULL OR v_role = '' THEN
        RAISE EXCEPTION 'handle_new_user: role is required (app_metadata.role or user_metadata.role)'
            USING ERRCODE = 'check_violation';
    END IF;
    v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', '');
    v_school_id := NULLIF(COALESCE(NEW.raw_app_meta_data ->> 'school_id', NEW.raw_user_meta_data ->> 'school_id'), '')::UUID;

    INSERT INTO public.profiles (id, email, full_name, role, school_id, login_id)
    VALUES (NEW.id, NEW.email, v_full_name, v_role, v_school_id, NEW.email)
    ON CONFLICT (id) DO UPDATE SET
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        role      = COALESCE(EXCLUDED.role,      public.profiles.role),
        school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
        login_id  = COALESCE(public.profiles.login_id, EXCLUDED.login_id),
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER  IF EXISTS trg_reset_recovery_email_verified ON public.profiles;
DROP FUNCTION IF EXISTS public.reset_recovery_email_verified();

DROP INDEX IF EXISTS public.profiles_recovery_email_idx;
DROP INDEX IF EXISTS public.migration_audit_affected_profile_id_idx;

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_login_id_lowercase,
    DROP CONSTRAINT IF EXISTS profiles_recovery_email_lowercase,
    DROP CONSTRAINT IF EXISTS profiles_login_id_email_format,
    DROP CONSTRAINT IF EXISTS profiles_recovery_email_format;

ALTER TABLE public.migration_audit
    DROP COLUMN IF EXISTS affected_profile_id;

COMMIT;
