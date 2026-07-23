-- ════════════════════════════════════════════════════════════════════
-- Phase 4A — Track B: DOWN migration
-- ────────────────────────────────────────────────────────────────────
-- Drops all baseline policies, disables RLS on the three tables,
-- removes has_role(). GRANTs are intentionally retained — they match
-- the Supabase PostgREST default and are harmless without RLS.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- profiles
DROP POLICY IF EXISTS profiles_self_select        ON public.profiles;
DROP POLICY IF EXISTS profiles_superadmin_select  ON public.profiles;
DROP POLICY IF EXISTS profiles_same_school_select ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update        ON public.profiles;
DROP POLICY IF EXISTS profiles_superadmin_update  ON public.profiles;

-- schools
DROP POLICY IF EXISTS schools_superadmin_all ON public.schools;
DROP POLICY IF EXISTS schools_own_select     ON public.schools;

-- memberships
DROP POLICY IF EXISTS memberships_self_select         ON public.memberships;
DROP POLICY IF EXISTS memberships_superadmin_all      ON public.memberships;
DROP POLICY IF EXISTS memberships_school_admin_select ON public.memberships;

ALTER TABLE public.profiles    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS public.has_role(UUID, TEXT);

COMMIT;
