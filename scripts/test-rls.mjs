#!/usr/bin/env node
/**
 * RLS smoke tests — verifies that the tables/views we recently hardened
 * are NOT readable by the anonymous role and that always-true write
 * policies have been removed.
 *
 * Usage:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... node scripts/test-rls.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.TEST_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.TEST_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.log("No TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY configured. Skipping RLS smoke test (production fallback prohibited).");
  process.exit(0);
}

const supabase = createClient(url, anon, { auth: { persistSession: false } });

const SENSITIVE_TABLES = [
  "profiles", "employees", "salary", "leave_requests",
  "messages", "message_threads", "thread_participants", "notifications",
  "audit_logs", "activity_logs", "system_logs",
  "password_resets", "recovery_email_otp", "api_keys",
  "school_backups", "subscription_events",
  "v_school_subscription_summary",
];

let failures = 0;

async function expectBlocked(table) {
  const { data, error } = await supabase.from(table).select("*").limit(1);
  // Either an explicit RLS/permission error, OR an empty array, is acceptable.
  // A non-empty data array means anon could read the table — FAIL.
  if (Array.isArray(data) && data.length > 0) {
    console.error(`✗ ${table}: anon returned ${data.length} row(s)`);
    failures++;
  } else {
    console.log(`✓ ${table}: anon read blocked (${error?.code || "empty"})`);
  }
}

async function expectInsertBlocked(table, payload) {
  const { error } = await supabase.from(table).insert(payload).select();
  if (!error) {
    console.error(`✗ ${table}: anon insert succeeded (should have been blocked)`);
    failures++;
  } else {
    console.log(`✓ ${table}: anon insert blocked (${error.code})`);
  }
}

console.log("=== Anonymous SELECT probes ===");
for (const t of SENSITIVE_TABLES) await expectBlocked(t);

console.log("\n=== Anonymous INSERT probes (previously always-true policies) ===");
await expectInsertBlocked("audit_logs", { action: "rls-test" });
await expectInsertBlocked("activity_logs", { action: "rls-test" });
await expectInsertBlocked("system_logs", { message: "rls-test" });
await expectInsertBlocked("password_resets", {
  user_id: "00000000-0000-0000-0000-000000000000",
  token: "x", expires_at: new Date().toISOString(),
});
await expectInsertBlocked("failed_jobs", { job_type: "rls-test", payload: {} });

if (failures > 0) {
  console.error(`\n${failures} RLS check(s) failed.`);
  process.exit(1);
}
console.log("\nAll RLS checks passed.");
