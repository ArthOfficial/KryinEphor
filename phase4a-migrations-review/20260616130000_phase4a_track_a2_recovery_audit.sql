-- ════════════════════════════════════════════════════════════════════
-- Phase 4A.2 — Recovery audit + admin action audit
-- ────────────────────────────────────────────────────────────────────
-- Addresses review items 9 (password_recovery_audit) and 12 (school
-- admin password-reset logging). Both are append-only and only readable
-- by superadmins; writes go through service_role from edge functions.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── password_recovery_audit ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.password_recovery_audit (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    login_id     TEXT NOT NULL,
    ip_address   TEXT,
    user_agent   TEXT,
    status       TEXT NOT NULL CHECK (status IN (
        'sent','rate_limited','no_recovery_email','unverified',
        'unknown_account','delivery_failed','link_only_no_mailer'
    )),
    recovery_link TEXT,  -- only stored when no mailer is configured
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_recovery_audit_login_id_created_idx
    ON public.password_recovery_audit (login_id, created_at DESC);

CREATE INDEX IF NOT EXISTS password_recovery_audit_ip_created_idx
    ON public.password_recovery_audit (ip_address, created_at DESC)
    WHERE ip_address IS NOT NULL;

GRANT SELECT ON public.password_recovery_audit TO authenticated;
GRANT ALL    ON public.password_recovery_audit TO service_role;

ALTER TABLE public.password_recovery_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS password_recovery_audit_superadmin_select
    ON public.password_recovery_audit;
CREATE POLICY password_recovery_audit_superadmin_select
    ON public.password_recovery_audit
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'superadmin'
    ));

-- ── admin_action_audit (item 12 — password resets, role changes, etc.) ─
CREATE TABLE IF NOT EXISTS public.admin_action_audit (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_role      TEXT,
    target_user_id  UUID,
    action          TEXT NOT NULL,
    detail          JSONB,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_action_audit_target_created_idx
    ON public.admin_action_audit (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_action_audit_actor_created_idx
    ON public.admin_action_audit (actor_id, created_at DESC);

GRANT SELECT ON public.admin_action_audit TO authenticated;
GRANT ALL    ON public.admin_action_audit TO service_role;

ALTER TABLE public.admin_action_audit ENABLE ROW LEVEL SECURITY;

-- Superadmins see everything; school admins see actions targeting users
-- in their own school.
DROP POLICY IF EXISTS admin_action_audit_superadmin_select
    ON public.admin_action_audit;
CREATE POLICY admin_action_audit_superadmin_select
    ON public.admin_action_audit
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'superadmin'
    ));

DROP POLICY IF EXISTS admin_action_audit_school_admin_select
    ON public.admin_action_audit;
CREATE POLICY admin_action_audit_school_admin_select
    ON public.admin_action_audit
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1
          FROM public.profiles caller
          JOIN public.profiles target ON target.id = admin_action_audit.target_user_id
         WHERE caller.id = auth.uid()
           AND caller.role = 'admin'
           AND caller.school_id IS NOT NULL
           AND caller.school_id = target.school_id
    ));

COMMIT;
