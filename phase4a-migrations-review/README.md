# Phase 4A Migration Review Folder

> **Hardening follow-up:** `20260616120000_phase4a_track_a_hardening.sql` adds the review items 1–6, 11, 13, 16, 17 (backfill guard, `affected_profile_id`, lowercase/email-format CHECKs, verified-reset trigger, recovery_email index, column comments, descriptive trigger error). Apply it after Track A; its `_down.sql` reverts only the hardening layer.


These SQL files are **not** under `supabase/migrations/` on purpose — that path is auto-applied by the Lovable/Supabase migration system, and you asked for review-only delivery.

When you approve, the four files below should be moved (unchanged) to `supabase/migrations/` to apply them:

| Review path | Apply path |
|---|---|
| `phase4a-migrations-review/20260614100000_phase4a_track_a_auth_recovery.sql` | `supabase/migrations/20260614100000_phase4a_track_a_auth_recovery.sql` |
| `phase4a-migrations-review/20260614100000_phase4a_track_a_auth_recovery_down.sql` | run manually only on rollback |
| `phase4a-migrations-review/20260614110000_phase4a_track_b_rls_baseline.sql` | `supabase/migrations/20260614110000_phase4a_track_b_rls_baseline.sql` |
| `phase4a-migrations-review/20260614110000_phase4a_track_b_rls_baseline_down.sql` | run manually only on rollback |

Application order: Track A → smoke-test → Track B → smoke-test. See `PHASE4A_IMPLEMENTATION_PLAN.md §3`.

Down migrations are never auto-applied; if either forward migration must be reverted, run the matching `_down.sql` in the Supabase SQL editor.
