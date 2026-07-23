-- ════════════════════════════════════════════════════════════════════
-- Finance & Subscription Management — apply this once in Supabase SQL editor.
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- 1. PLANS
CREATE TABLE IF NOT EXISTS public.plans (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  interval_months int  NOT NULL CHECK (interval_months IN (1, 6)),
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency        text NOT NULL DEFAULT 'INR',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO authenticated;
GRANT ALL    ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_read ON public.plans;
CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING (true);

INSERT INTO public.plans (id, name, interval_months, amount, currency) VALUES
  ('monthly',   'Monthly Plan',  1, 2999,  'INR'),
  ('six_month', '6-Month Plan',  6, 14999, 'INR')
ON CONFLICT (id) DO NOTHING;

-- 2. SCHOOL COLUMNS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='subscription_status_t') THEN
    CREATE TYPE public.subscription_status_t AS ENUM ('active','payment_due','locked','archived');
  END IF;
END $$;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS plan_id                 text REFERENCES public.plans(id) DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS subscription_start_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS next_due_date           date,
  ADD COLUMN IF NOT EXISTS subscription_status     public.subscription_status_t DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS manual_unlock_until     date,
  ADD COLUMN IF NOT EXISTS archived_at             timestamptz;

UPDATE public.schools
   SET plan_id                 = COALESCE(plan_id, 'monthly'),
       subscription_start_date = COALESCE(subscription_start_date, CURRENT_DATE),
       next_due_date           = COALESCE(next_due_date, CURRENT_DATE + INTERVAL '1 month'),
       subscription_status     = COALESCE(subscription_status, 'active')
 WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_schools_sub_status ON public.schools(subscription_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_schools_next_due   ON public.schools(next_due_date)        WHERE deleted_at IS NULL;

-- 3. INVOICE COLUMNS
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_number       text,
  ADD COLUMN IF NOT EXISTS billing_period_start date,
  ADD COLUMN IF NOT EXISTS billing_period_end   date,
  ADD COLUMN IF NOT EXISTS paid_at              timestamptz;
CREATE INDEX IF NOT EXISTS idx_invoices_due ON public.invoices(due_date) WHERE deleted_at IS NULL;

-- 4. SUBSCRIPTION EVENTS
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  from_status  text,
  to_status    text,
  metadata     jsonb DEFAULT '{}'::jsonb,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_events_school ON public.subscription_events(school_id, created_at DESC);
GRANT SELECT ON public.subscription_events TO authenticated;
GRANT ALL    ON public.subscription_events TO service_role;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_events_super ON public.subscription_events;
CREATE POLICY sub_events_super ON public.subscription_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'superadmin'));

-- 5. SCHOOL BACKUPS
CREATE TABLE IF NOT EXISTS public.school_backups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  school_name     text NOT NULL,
  archive_name    text NOT NULL,
  storage_path    text,
  size_bytes      bigint DEFAULT 0,
  row_counts      jsonb DEFAULT '{}'::jsonb,
  checksum_sha256 text,
  status          text NOT NULL DEFAULT 'pending',
  validated       boolean DEFAULT false,
  error           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backups_school ON public.school_backups(school_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.school_backups TO authenticated;
GRANT ALL ON public.school_backups TO service_role;
ALTER TABLE public.school_backups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backups_super ON public.school_backups;
CREATE POLICY backups_super ON public.school_backups FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'superadmin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'superadmin'));

-- 6. fn_recompute_school_status
CREATE OR REPLACE FUNCTION public.fn_recompute_school_status(p_school uuid)
RETURNS public.subscription_status_t LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_oldest date; v_days int; v_unlock date; v_arch timestamptz;
        v_old public.subscription_status_t; v_new public.subscription_status_t;
BEGIN
  SELECT manual_unlock_until, archived_at, subscription_status
    INTO v_unlock, v_arch, v_old
    FROM public.schools WHERE id = p_school;
  IF v_arch IS NOT NULL THEN
    v_new := 'archived';
  ELSE
    SELECT MIN(due_date) INTO v_oldest FROM public.invoices
      WHERE school_id = p_school AND status IN ('pending','overdue') AND deleted_at IS NULL;
    IF v_unlock IS NOT NULL AND v_unlock >= CURRENT_DATE THEN v_new := 'active';
    ELSIF v_oldest IS NULL THEN v_new := 'active';
    ELSE
      v_days := CURRENT_DATE - v_oldest;
      IF v_days > 5 THEN v_new := 'locked';
      ELSIF v_days >= 0 THEN
        UPDATE public.invoices SET status='overdue'
          WHERE school_id = p_school AND status='pending' AND due_date < CURRENT_DATE;
        v_new := 'payment_due';
      ELSE v_new := 'active'; END IF;
    END IF;
  END IF;
  UPDATE public.schools SET subscription_status = v_new WHERE id = p_school;
  IF v_old IS DISTINCT FROM v_new THEN
    INSERT INTO public.subscription_events(school_id,event_type,from_status,to_status)
    VALUES (p_school,'status_change',v_old::text,v_new::text);
  END IF;
  RETURN v_new;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_recompute_school_status(uuid) TO authenticated, service_role;

-- 7. fn_generate_invoice
CREATE OR REPLACE FUNCTION public.fn_generate_invoice(p_school uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_plan_id text; v_plan public.plans%ROWTYPE; v_next date; v_ps date; v_pe date;
        v_cnt int; v_seq int; v_num text; v_id uuid;
BEGIN
  SELECT plan_id, COALESCE(next_due_date, CURRENT_DATE) INTO v_plan_id, v_next
    FROM public.schools WHERE id = p_school;
  SELECT * INTO v_plan FROM public.plans WHERE id = v_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found for school %', p_school; END IF;
  SELECT COUNT(*) INTO v_cnt FROM public.invoices
    WHERE school_id = p_school AND status IN ('pending','overdue') AND deleted_at IS NULL;
  IF v_cnt > 0 THEN RETURN NULL; END IF;
  v_ps := v_next;
  v_pe := (v_next + (v_plan.interval_months || ' months')::interval - INTERVAL '1 day')::date;
  SELECT COUNT(*) + 1 INTO v_seq FROM public.invoices
    WHERE date_trunc('month',created_at) = date_trunc('month',now());
  v_num := 'INV-' || to_char(now(),'YYYYMM') || '-' || lpad(v_seq::text,4,'0');
  INSERT INTO public.invoices(school_id,invoice_number,amount,status,due_date,
    billing_period_start,billing_period_end,items,created_at)
  VALUES (p_school,v_num,v_plan.amount,'pending',v_next,v_ps,v_pe,
    jsonb_build_array(jsonb_build_object('description',v_plan.name,'amount',v_plan.amount,
      'period_start',v_ps,'period_end',v_pe)), now())
  RETURNING id INTO v_id;
  UPDATE public.schools
    SET next_due_date = (v_next + (v_plan.interval_months || ' months')::interval)::date
    WHERE id = p_school;
  INSERT INTO public.subscription_events(school_id,event_type,metadata)
  VALUES (p_school,'invoice_generated',
    jsonb_build_object('invoice_id',v_id,'invoice_number',v_num,'amount',v_plan.amount));
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_generate_invoice(uuid) TO authenticated, service_role;

-- 8. fn_billing_run
CREATE OR REPLACE FUNCTION public.fn_billing_run()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v record; v_created int := 0; v_changes int := 0; v_inv uuid;
        v_prev public.subscription_status_t; v_new public.subscription_status_t;
BEGIN
  FOR v IN SELECT id, next_due_date, subscription_status FROM public.schools
           WHERE deleted_at IS NULL AND archived_at IS NULL
  LOOP
    IF v.next_due_date IS NOT NULL AND v.next_due_date <= CURRENT_DATE + 7 THEN
      v_inv := public.fn_generate_invoice(v.id);
      IF v_inv IS NOT NULL THEN v_created := v_created + 1; END IF;
    END IF;
    v_prev := v.subscription_status;
    v_new  := public.fn_recompute_school_status(v.id);
    IF v_prev IS DISTINCT FROM v_new THEN v_changes := v_changes + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('invoices_created',v_created,'status_changes',v_changes,'ran_at',now());
END $$;
GRANT EXECUTE ON FUNCTION public.fn_billing_run() TO authenticated, service_role;

-- 9. Admin RPCs
CREATE OR REPLACE FUNCTION public.fn_mark_invoice_paid(p_invoice uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_school uuid;
BEGIN
  UPDATE public.invoices SET status='paid', paid_at=now() WHERE id=p_invoice
  RETURNING school_id INTO v_school;
  IF v_school IS NULL THEN RAISE EXCEPTION 'invoice not found'; END IF;
  PERFORM public.fn_recompute_school_status(v_school);
  INSERT INTO public.subscription_events(school_id,event_type,actor_id,metadata)
  VALUES (v_school,'manual_paid',p_actor,jsonb_build_object('invoice_id',p_invoice));
END $$;
GRANT EXECUTE ON FUNCTION public.fn_mark_invoice_paid(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_extend_due_date(p_school uuid, p_days int, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'invalid days'; END IF;
  UPDATE public.invoices SET due_date = due_date + p_days, status='pending'
    WHERE school_id=p_school AND status IN ('pending','overdue') AND deleted_at IS NULL;
  UPDATE public.schools SET next_due_date = COALESCE(next_due_date, CURRENT_DATE) + p_days
    WHERE id = p_school;
  PERFORM public.fn_recompute_school_status(p_school);
  INSERT INTO public.subscription_events(school_id,event_type,actor_id,metadata)
  VALUES (p_school,'due_extended',p_actor,jsonb_build_object('days',p_days));
END $$;
GRANT EXECUTE ON FUNCTION public.fn_extend_due_date(uuid,int,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_manual_unlock(p_school uuid, p_until date, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.schools SET manual_unlock_until = p_until WHERE id = p_school;
  PERFORM public.fn_recompute_school_status(p_school);
  INSERT INTO public.subscription_events(school_id,event_type,actor_id,metadata)
  VALUES (p_school,'manual_unlock',p_actor,jsonb_build_object('until',p_until));
END $$;
GRANT EXECUTE ON FUNCTION public.fn_manual_unlock(uuid,date,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_archive_school(p_school uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.schools SET archived_at=now(), subscription_status='archived' WHERE id=p_school;
  INSERT INTO public.subscription_events(school_id,event_type,actor_id) VALUES (p_school,'archived',p_actor);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_archive_school(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_restore_school(p_school uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.schools SET archived_at=NULL, subscription_status='active',
    manual_unlock_until = CURRENT_DATE + INTERVAL '30 days' WHERE id=p_school;
  INSERT INTO public.subscription_events(school_id,event_type,actor_id) VALUES (p_school,'restored',p_actor);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_restore_school(uuid,uuid) TO authenticated, service_role;

-- 10. Dashboard view
CREATE OR REPLACE VIEW public.v_school_subscription_summary AS
SELECT s.id, s.name, s.plan_id, p.name AS plan_name, p.amount, p.currency,
       s.next_due_date, s.subscription_status, s.archived_at, s.manual_unlock_until,
       COALESCE((SELECT SUM(i.amount) FROM public.invoices i
                  WHERE i.school_id=s.id AND i.status IN ('pending','overdue') AND i.deleted_at IS NULL),0) AS outstanding_amount,
       (SELECT MIN(i.due_date) FROM public.invoices i
         WHERE i.school_id=s.id AND i.status IN ('pending','overdue') AND i.deleted_at IS NULL) AS oldest_due_date
FROM public.schools s
LEFT JOIN public.plans p ON p.id = s.plan_id
WHERE s.deleted_at IS NULL;
GRANT SELECT ON public.v_school_subscription_summary TO authenticated, service_role;
