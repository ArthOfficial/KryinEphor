#!/usr/bin/env node
/**
 * CI gate: runs the Supabase database linter via the Management API and
 * fails the build if:
 *   1) any previously-resolved security finding reappears (FORBIDDEN set), OR
 *   2) a NEW WARN/ERROR-level lint name appears that isn't in the accepted baseline.
 *
 * Required env:
 *   SUPABASE_ACCESS_TOKEN  – personal access token (sbp_…)
 *   SUPABASE_PROJECT_REF   – e.g. qgefjcuulsofevmxfqxe
 */
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF");
  process.exit(2);
}

// Findings that must NEVER reappear once fixed.
const FORBIDDEN = new Set([
  "SUPA_anon_security_definer_function_executable",
  "SUPA_auth_leaked_password_protection",
  "SUPA_authenticated_security_definer_function_executable",
  "SUPA_pg_graphql_anon_table_exposed",
  "SUPA_rls_policy_always_true",
  "SUPA_security_definer_view",
  "anon_security_definer_function_executable",
  "auth_leaked_password_protection",
  "authenticated_security_definer_function_executable",
  "pg_graphql_anon_table_exposed",
  "rls_policy_always_true",
  "security_definer_view",
  "employees_sensitive_fields_school_wide",
  "leave_requests_school_wide",
  "messages_no_participant_check",
  "notifications_no_recipient_check",
  "password_resets_unrestricted_insert",
  "profiles_pii_school_wide",
  "salary_school_wide_exposure",
  "thread_participants_school_wide",
  "audit_logs_unrestricted_insert",
]);

// Lints that are accepted by design (every user-facing table the app reads
// requires SELECT granted to `authenticated` for RLS to evaluate; revoking
// it would break the application). These remain visible to GraphQL by design.
const ACCEPTED = new Set([
  "pg_graphql_authenticated_table_exposed",
  "extension_in_public", // pg_trgm is fine in public for our search needs
  "rls_enabled_no_policy", // tracked separately; not in scope of this gate
]);

const url = `https://api.supabase.com/v1/projects/${REF}/database/lints`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
if (!res.ok) {
  console.error(`Linter API ${res.status}: ${await res.text()}`);
  process.exit(2);
}
const lints = await res.json();

const forbidden = lints.filter(
  (l) => FORBIDDEN.has(l.name) || FORBIDDEN.has(l.lint_id)
);

const unexpected = lints.filter((l) => {
  const id = l.name || l.lint_id;
  const lvl = (l.level || "").toUpperCase();
  if (lvl !== "WARN" && lvl !== "ERROR") return false;
  if (FORBIDDEN.has(id)) return false; // counted above
  return !ACCEPTED.has(id);
});

if (forbidden.length) {
  console.error("✗ Forbidden security findings reappeared:");
  for (const h of forbidden) console.error(`  - ${h.name || h.lint_id}: ${h.detail || ""}`);
}
if (unexpected.length) {
  console.error("✗ New unexpected WARN/ERROR lints (not in accepted baseline):");
  for (const h of unexpected) console.error(`  - [${h.level}] ${h.name || h.lint_id}: ${h.detail || ""}`);
}
if (forbidden.length || unexpected.length) process.exit(1);
console.log("✓ Supabase linter clean (no forbidden or unexpected findings).");
