-- ════════════════════════════════════════════════════════════════════
-- Phase 4A.2 — recovery_email_otp table for set_recovery_email function
-- ════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.recovery_email_otp (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    code_hash    TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.recovery_email_otp TO authenticated;
GRANT ALL    ON public.recovery_email_otp TO service_role;

ALTER TABLE public.recovery_email_otp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recovery_email_otp_self_select ON public.recovery_email_otp;
CREATE POLICY recovery_email_otp_self_select
    ON public.recovery_email_otp FOR SELECT TO authenticated
    USING (user_id = auth.uid());

COMMIT;
