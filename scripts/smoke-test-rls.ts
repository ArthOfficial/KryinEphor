/**
 * Smoke test: verify role changes immediately remove backend access.
 *
 * Flow:
 *   1. Login as superadmin → read schools/profiles → expect 200 with rows.
 *   2. Demote the *test* user (TEST_EMAIL) to 'teacher' via service-role admin call.
 *   3. Login as that demoted user → read schools/profiles → expect 0 rows
 *      (RLS scoped to own tenant, not global).
 *   4. Restore role.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *   TEST_EMAIL=... TEST_PASSWORD=... \
 *   bun run scripts/smoke-test-rls.ts
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPER_EMAIL = process.env.SUPERADMIN_EMAIL!;
const SUPER_PASS = process.env.SUPERADMIN_PASSWORD!;
const TEST_EMAIL = process.env.TEST_EMAIL!;
const TEST_PASS = process.env.TEST_PASSWORD!;

if (!URL || !ANON || !SERVICE || !SUPER_EMAIL || !SUPER_PASS || !TEST_EMAIL || !TEST_PASS) {
    console.error('Missing required env vars.');
    process.exit(1);
}

const admin = createClient(URL, SERVICE);

const expect = (label: string, ok: boolean, extra?: unknown) => {
    console.log(`${ok ? '✅' : '❌'} ${label}`, extra ?? '');
    if (!ok) process.exitCode = 1;
};

async function loginAs(email: string, password: string) {
    const c = createClient(URL, ANON);
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
    return c;
}

async function setRole(userId: string, role: string) {
    const { error: pErr } = await admin.from('profiles').update({ role }).eq('id', userId);
    if (pErr) throw new Error(`profile update failed: ${pErr.message}`);
    const { error: aErr } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: { role },
    });
    if (aErr) throw new Error(`auth metadata update failed: ${aErr.message}`);
}

(async () => {
    // 1. Look up the test user id.
    const { data: prof } = await admin.from('profiles').select('id, role').eq('email', TEST_EMAIL).single();
    if (!prof) { console.error('Test user not found'); process.exit(1); }
    const originalRole = prof.role as string;
    const userId = prof.id as string;

    try {
        // Make sure test user can see schools as superadmin
        await setRole(userId, 'superadmin');
        await new Promise(r => setTimeout(r, 500));
        let client = await loginAs(TEST_EMAIL, TEST_PASS);
        const sup = await client.from('schools').select('id');
        expect('superadmin sees schools', !sup.error && (sup.data?.length ?? 0) > 0, { count: sup.data?.length, err: sup.error?.message });

        // 2. Demote to teacher
        await setRole(userId, 'teacher');
        await new Promise(r => setTimeout(r, 500));

        // 3. New session as teacher should NOT see global schools list
        client = await loginAs(TEST_EMAIL, TEST_PASS);
        const tch = await client.from('schools').select('id');
        expect('teacher cannot list all schools', (tch.data?.length ?? 0) <= 1, { count: tch.data?.length, err: tch.error?.message });

        const others = await client.from('profiles').select('id').neq('id', userId);
        expect('teacher cannot read other profiles', (others.data?.length ?? 0) === 0, { count: others.data?.length, err: others.error?.message });
    } finally {
        // 4. Restore
        await setRole(userId, originalRole);
        console.log(`↩️  restored role to ${originalRole}`);
    }
})();
