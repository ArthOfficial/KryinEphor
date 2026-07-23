-- ════════════════════════════════════════════════════════════════════
-- Recovery email OTP permissions + audit hardening
-- ────────────────────────────────────────────────────────────────────
-- Enforces the admin recovery-email flow for exactly:
--   superadmin, admin (principal), receptionist
-- Adds SQL verification, matching RLS, audit logging, and User Settings
-- permission rows for the recovery flow.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_roles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('superadmin','admin','teacher','student','parent','accountant','receptionist')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL    ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_roles_self_select ON public.user_roles;
CREATE POLICY user_roles_self_select ON public.user_roles
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_roles_superadmin_select ON public.user_roles;
CREATE POLICY user_roles_superadmin_select ON public.user_roles
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'superadmin'));

INSERT INTO public.user_roles (user_id, role)
SELECT id, role FROM public.profiles WHERE role IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_profile_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.user_roles WHERE user_id = OLD.id;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
        DELETE FROM public.user_roles WHERE user_id = NEW.id;
    END IF;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, NEW.role)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_user_role ON public.profiles;
CREATE TRIGGER trg_sync_profile_user_role
    AFTER INSERT OR UPDATE OF role OR DELETE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.sync_profile_user_role();

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.user_roles ur
          JOIN public.profiles p ON p.id = ur.user_id
         WHERE ur.user_id = _user_id
           AND ur.role = _role
           AND p.is_active = true
    )
$$;

GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_recovery_email(_actor_id UUID, _target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles actor
          JOIN public.profiles target ON target.id = _target_user_id
         WHERE actor.id = _actor_id
           AND actor.is_active = true
           AND target.is_active = true
           AND (
                public.has_role(_actor_id, 'superadmin')
                OR (
                    target.role <> 'superadmin'
                    AND actor.school_id IS NOT NULL
                    AND target.school_id IS NOT NULL
                    AND actor.school_id = target.school_id
                    AND (public.has_role(_actor_id, 'admin') OR public.has_role(_actor_id, 'receptionist'))
                )
           )
    )
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_recovery_email(UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS profiles_same_school_receptionist_select ON public.profiles;
CREATE POLICY profiles_same_school_receptionist_select ON public.profiles
    FOR SELECT TO authenticated
    USING (school_id IS NOT NULL AND school_id = public.get_auth_school_id() AND public.has_role(auth.uid(), 'receptionist'));

CREATE TABLE IF NOT EXISTS public.recovery_email_otp (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    code_hash    TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_email_otp_expires_idx ON public.recovery_email_otp (expires_at);

GRANT SELECT ON public.recovery_email_otp TO authenticated;
GRANT ALL    ON public.recovery_email_otp TO service_role;

ALTER TABLE public.recovery_email_otp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recovery_email_otp_self_select ON public.recovery_email_otp;
CREATE POLICY recovery_email_otp_self_select ON public.recovery_email_otp
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS recovery_email_otp_admin_select ON public.recovery_email_otp;
CREATE POLICY recovery_email_otp_admin_select ON public.recovery_email_otp
    FOR SELECT TO authenticated USING (public.can_manage_recovery_email(auth.uid(), user_id));

CREATE TABLE IF NOT EXISTS public.admin_action_audit (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_role      TEXT,
    target_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    detail          JSONB,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_action_audit_target_created_idx ON public.admin_action_audit (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_action_audit_actor_created_idx ON public.admin_action_audit (actor_id, created_at DESC);

GRANT SELECT ON public.admin_action_audit TO authenticated;
GRANT ALL    ON public.admin_action_audit TO service_role;

ALTER TABLE public.admin_action_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_action_audit_superadmin_select ON public.admin_action_audit;
CREATE POLICY admin_action_audit_superadmin_select ON public.admin_action_audit
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'superadmin'));

DROP POLICY IF EXISTS admin_action_audit_school_admin_reception_select ON public.admin_action_audit;
CREATE POLICY admin_action_audit_school_admin_reception_select ON public.admin_action_audit
    FOR SELECT TO authenticated USING (public.can_manage_recovery_email(auth.uid(), target_user_id));

INSERT INTO public.permissions (module, action, description) VALUES
    ('recovery', 'read',   'View recovery email verification status'),
    ('recovery', 'create', 'Send recovery email verification OTP'),
    ('recovery', 'update', 'Confirm recovery email OTP and mark verified')
ON CONFLICT (module, action) DO UPDATE SET description = EXCLUDED.description;

COMMIT;