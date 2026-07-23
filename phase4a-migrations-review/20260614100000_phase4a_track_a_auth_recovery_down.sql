-- ════════════════════════════════════════════════════════════════════
-- Phase 4A — Track A: DOWN migration
-- ────────────────────────────────────────────────────────────────────
-- Reverts:
--   * handle_new_user() to the pre-Phase-4A version (post-hotfix
--     20260614060000_harden_edge_function_errors_and_roles.sql).
--   * Reactivates the 3 orphan profiles using migration_audit.
--   * Drops login_id / recovery_email / *_verified columns.
--   * Removes the migration_audit rows for this migration.
--
-- The public.migration_audit TABLE itself is intentionally retained
-- (Track B and future migrations may also write to it).
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Restore previous handle_new_user (default 'student') ────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, school_id)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
        COALESCE(NEW.raw_app_meta_data ->> 'role', NEW.raw_user_meta_data ->> 'role', 'student'),
        (COALESCE(NEW.raw_app_meta_data ->> 'school_id', NEW.raw_user_meta_data ->> 'school_id'))::UUID
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        role      = COALESCE(EXCLUDED.role,      public.profiles.role),
        school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 2. Reactivate rows captured during forward migration ───────────
-- Prefers affected_profile_id (added by the hardening migration); falls
-- back to parsing target_id when running against a pre-hardening DB.
UPDATE public.profiles p
   SET is_active  = true,
       updated_at = now()
  FROM public.migration_audit a
 WHERE a.migration_name = '20260614100000_phase4a_track_a_auth_recovery'
   AND a.action         = 'deactivate_orphan_profile'
   AND a.target_table   = 'profiles'
   AND p.id = COALESCE(a.affected_profile_id, NULLIF(a.target_id, '')::uuid);

-- ── 3. Drop the unique index and identity columns ──────────────────
DROP INDEX IF EXISTS public.profiles_login_id_uidx;

ALTER TABLE public.profiles
    DROP COLUMN IF EXISTS login_id,
    DROP COLUMN IF EXISTS recovery_email,
    DROP COLUMN IF EXISTS recovery_email_verified,
    DROP COLUMN IF EXISTS phone_verified;

-- ── 4. Purge this migration's audit rows (table itself is kept) ────
DELETE FROM public.migration_audit
 WHERE migration_name = '20260614100000_phase4a_track_a_auth_recovery';

COMMIT;
