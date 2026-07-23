/**
 * End-to-end smoke test for school provisioning edge functions.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *   bun run scripts/smoke-test-schools.ts
 *
 * Asserts:
 *   1. Create School + Admin           → 200
 *   2. Duplicate subdomain             → 409
 *   3. Reserved subdomain ("admin")    → 400
 *   4. Update School (rename)          → 200
 *   5. Delete School                   → 200
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const EMAIL = process.env.SUPERADMIN_EMAIL!;
const PASSWORD = process.env.SUPERADMIN_PASSWORD!;

if (!URL || !ANON || !EMAIL || !PASSWORD) {
    console.error('Missing env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD');
    process.exit(1);
}

const sb = createClient(URL, ANON);

async function login() {
    const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error(`Login failed: ${error.message}`);
    return data.session!.access_token;
}

async function call(fn: string, body: unknown, token: string) {
    const res = await fetch(`${URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': ANON,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = {};
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, body: json, cid: res.headers.get('x-correlation-id') };
}

const expect = (label: string, actual: number, expected: number, extra?: unknown) => {
    const ok = actual === expected;
    console.log(`${ok ? '✅' : '❌'} ${label} → ${actual} (expected ${expected})`, extra ?? '');
    if (!ok) process.exitCode = 1;
};

(async () => {
    const token = await login();
    const stamp = Date.now();
    const subdomain = `smoke${stamp}`;
    const adminEmail = `smoke+${stamp}@example.com`;

    // 1. Create
    const create = await call('create_school_with_admin', {
        name: `Smoke ${stamp}`, subdomain, tier: 'starter',
        adminEmail, adminPassword: 'TempPass!234', adminFullName: 'Smoke Admin',
    }, token);
    expect('Create school', create.status, 200, create.body);
    const schoolId = create.body?.school?.id;

    // 2. Duplicate subdomain
    const dup = await call('create_school_with_admin', {
        name: `Dup ${stamp}`, subdomain, tier: 'starter',
        adminEmail: `dup+${stamp}@example.com`, adminPassword: 'TempPass!234', adminFullName: 'Dup',
    }, token);
    expect('Duplicate subdomain rejected', dup.status, 409, dup.body?.error);

    // 3. Reserved subdomain
    const reserved = await call('create_school_with_admin', {
        name: 'Reserved', subdomain: 'admin', tier: 'starter',
        adminEmail: `res+${stamp}@example.com`, adminPassword: 'TempPass!234', adminFullName: 'Res',
    }, token);
    expect('Reserved subdomain rejected', reserved.status, 400, reserved.body?.error);

    // 4. Update
    if (schoolId) {
        const upd = await call('update_school', {
            schoolId, name: `Smoke ${stamp} Renamed`, subdomain,
            subscription_tier: 'pro', status: 'active', max_students: 500,
        }, token);
        expect('Update school', upd.status, 200, upd.body);

        // 5. Delete
        const del = await call('delete_school', { schoolId, hard: true }, token);
        expect('Delete school', del.status, 200, del.body);
    }
})();
