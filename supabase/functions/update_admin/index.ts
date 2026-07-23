import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const getCorsHeaders = (req: Request) => {
    const origin = req.headers.get('Origin') ?? '';
    const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const allowedOrigins = new Set(['https://kryinedu.lovable.app', ...configured]);
    const allowOrigin = allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com|sandbox\.lovable\.dev)$/i.test(origin)
        ? origin
        : 'https://kryinedu.lovable.app';
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
};

// Whitelist of valid roles
const VALID_ROLES = ['superadmin', 'admin', 'teacher', 'student', 'parent', 'accountant', 'receptionist'] as const;

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 401,
            });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
            return new Response(JSON.stringify({ error: 'Server misconfiguration: missing environment variables' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            });
        }

        // Verify JWT manually
        const callerClient = createClient(
            supabaseUrl,
            supabaseAnonKey,
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();

        if (callerError || !caller) {
            return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 401,
            });
        }

        // Create admin client with service role
        const supabaseAdmin = createClient(
            supabaseUrl,
            serviceRoleKey,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        const { data: callerProfile } = await supabaseAdmin
            .from('profiles')
            .select('role, school_id, full_name')
            .eq('id', caller.id)
            .single();

        if (!callerProfile) {
            return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 403,
            });
        }

        // Parse and validate JSON body
        let payload;
        try {
            payload = await req.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid or malformed JSON payload' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        const { adminId, password, fullName, schoolId, role, isActive, metadataPermissions, additionalRoles } = payload;
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : payload.email;

        if (!adminId) {
            return new Response(JSON.stringify({ error: 'Missing required field: adminId' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        const isSelfUpdate = caller.id === adminId;
        const isPrivileged = callerProfile.role === 'superadmin' || callerProfile.role === 'admin';
        if (!isSelfUpdate && !isPrivileged) {
            return new Response(JSON.stringify({ error: 'Forbidden: you can only change your own name' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
            });
        }
        if (isSelfUpdate && !isPrivileged && (email || password || role || schoolId !== undefined || typeof isActive === 'boolean' || Array.isArray(metadataPermissions) || Array.isArray(additionalRoles))) {
            return new Response(JSON.stringify({ error: 'You can only change your own name here' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // ALL VALIDATION — BEFORE any mutation (Fixes Problem #10, #37)
        // ═══════════════════════════════════════════════════════════════

        // Validate role against whitelist
        if (role && !VALID_ROLES.includes(role)) {
            return new Response(JSON.stringify({ error: `Invalid role: '${role}'. Allowed: ${VALID_ROLES.join(', ')}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        if (role && role !== 'superadmin' && schoolId === '') {
            return new Response(JSON.stringify({ error: `${role} users must be assigned to a school` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // Validate schoolId exists if provided
        if (schoolId !== undefined && schoolId !== null) {
            const { data: school } = await supabaseAdmin
                .from('schools')
                .select('id')
                .eq('id', schoolId)
                .single();
            if (!school) {
                return new Response(JSON.stringify({ error: 'Invalid schoolId: school does not exist' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }
        }

        // Fetch target profile
        const { data: targetProfile } = await supabaseAdmin
            .from('profiles')
            .select('role, school_id, email, full_name')
            .eq('id', adminId)
            .single();

        // Pre-update validation: profile must have a role (NOT NULL column).
        // If somehow null, fail fast with a friendly message rather than hitting
        // the DB constraint mid-write.
        if (targetProfile && !targetProfile.role && !role) {
            return new Response(JSON.stringify({ error: 'This user has no role assigned. Please select a role before saving.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // Pre-check: email uniqueness (gives a friendly error instead of a raw 23505)
        if (email && email !== targetProfile?.email) {
            const { data: existingEmail } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('email', email)
                .neq('id', adminId)
                .maybeSingle();
            if (existingEmail) {
                return new Response(JSON.stringify({ error: 'This email is already in use. Contact support if you think this is a mistake.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 409,
                });
            }
        }

        if (!targetProfile) {
            return new Response(JSON.stringify({ error: 'Target user profile not found' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 404,
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // PROTECTED ROOT SUPERADMINS — cannot be modified by anyone else.
        // Only the account itself can change its own profile/password.
        // Even other superadmins are blocked from editing role / is_active
        // / email / school assignment on these accounts.
        // ═══════════════════════════════════════════════════════════════
        const PROTECTED_EMAILS = new Set(['admin@admin.com', 'superadmin@edunex.com']);
        const targetEmail = (targetProfile.email || '').toLowerCase();
        const callerEmail = (caller.email || '').toLowerCase();
        if (PROTECTED_EMAILS.has(targetEmail) && caller.id !== adminId) {
            return new Response(JSON.stringify({ error: 'This account is protected. Only the account owner can modify it.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 403,
            });
        }
        // Even the owner cannot demote themselves or deactivate the protected account
        if (PROTECTED_EMAILS.has(targetEmail) && caller.id === adminId) {
            if (role && role !== 'superadmin') {
                return new Response(JSON.stringify({ error: 'The root superadmin role cannot be changed.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            if (typeof isActive === 'boolean' && isActive === false) {
                return new Response(JSON.stringify({ error: 'The root superadmin cannot be deactivated.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            if (email && email.toLowerCase() !== targetEmail) {
                return new Response(JSON.stringify({ error: 'The root superadmin email is locked.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
        }
        // Mark caller usage to silence unused-var lint
        void callerEmail;



        // Validate school context for school-level admins
        if (callerProfile.role === 'admin') {
            if (!callerProfile.school_id) {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin has no school context' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            if (targetProfile.school_id !== callerProfile.school_id) {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin cannot update users in other schools' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            if (schoolId !== undefined && schoolId !== callerProfile.school_id) {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin cannot move users to another school' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            if (role === 'superadmin' || targetProfile.role === 'superadmin') {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin cannot manage superadmin roles' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // UPDATE PROFILE FIRST — More likely to fail (Fixes Problem #10)
        // If profile update fails, we haven't touched auth yet = clean state.
        // ═══════════════════════════════════════════════════════════════
        const profileData: Record<string, unknown> = {
            updated_at: new Date().toISOString()
        };
        if (email) { profileData.email = email; profileData.login_id = email; }
        if (fullName) profileData.full_name = fullName;
        if (schoolId !== undefined) profileData.school_id = schoolId || null;
        if (role) profileData.role = role;
        if (typeof isActive === 'boolean') profileData.is_active = isActive;
        if (Array.isArray(metadataPermissions)) {
            // Server-side merge: fetch existing metadata, replace only `permissions` key
            const { data: existing } = await supabaseAdmin
                .from('profiles').select('metadata').eq('id', adminId).single();
            const baseMeta = (existing?.metadata && typeof existing.metadata === 'object') ? existing.metadata : {};
            profileData.metadata = { ...baseMeta, permissions: metadataPermissions };
        }

        // Use UPDATE (not upsert) — target profile already exists (we fetched it above).
        // Upsert was attempting to INSERT with NULL role on conflict-check, violating NOT NULL.
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update(profileData)
            .eq('id', adminId);

        if (profileError) {
            return new Response(JSON.stringify({ error: `Profile update failed: ${profileError.message}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // UPDATE AUTH USER SECOND — With rollback on failure
        // If auth fails, we revert the profile to its original state.
        // ═══════════════════════════════════════════════════════════════
        if (email || password || fullName) {
            const updateData: Record<string, unknown> = {};
            if (email) updateData.email = email;
            if (password) updateData.password = password;
            if (fullName) updateData.user_metadata = { full_name: fullName };
            if (role || schoolId !== undefined) {
                updateData.app_metadata = {
                    role: role || targetProfile.role,
                    school_id: schoolId !== undefined ? (schoolId || null) : targetProfile.school_id,
                };
            }

            const { error: userError } = await supabaseAdmin.auth.admin.updateUserById(
                adminId,
                updateData
            );

            if (userError) {
                // ═══ ROLLBACK: Revert profile to original state ═══
                const rollbackData: Record<string, unknown> = {};
                if (email) rollbackData.email = targetProfile.email;
                if (fullName) rollbackData.full_name = targetProfile.full_name;
                if (role) rollbackData.role = targetProfile.role;
                if (schoolId !== undefined) rollbackData.school_id = targetProfile.school_id;

                await supabaseAdmin.from('profiles').update(rollbackData).eq('id', adminId);

                return new Response(JSON.stringify({ error: `Auth user update failed: ${userError.message}. Profile changes have been rolled back.` }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }
        }

        if (fullName && fullName !== targetProfile.full_name) {
            await supabaseAdmin.from('notifications').insert({
                school_id: targetProfile.school_id,
                user_id: adminId,
                title: 'Name changed',
                message: `Your name has been changed to ${fullName} from ${targetProfile.full_name || 'Unnamed'} by ${callerProfile.full_name || caller.email || 'an administrator'} [${callerProfile.role}]`,
                type: 'info',
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // ADDITIONAL ROLES — sync user_roles rows other than the primary.
        // Client sends the full desired set of additional roles.
        // The primary role row is always kept (managed by DB trigger).
        // ═══════════════════════════════════════════════════════════════
        if (Array.isArray(additionalRoles)) {
            const primary = (role || targetProfile.role) as string;
            // Sanitize: whitelist, unique, drop primary, drop 'superadmin' unless caller is superadmin
            const cleaned = Array.from(new Set(
                additionalRoles
                    .filter((r: unknown): r is string => typeof r === 'string')
                    .map((r: string) => r.trim())
                    .filter((r: string) => VALID_ROLES.includes(r as typeof VALID_ROLES[number]))
                    .filter((r: string) => r !== primary)
                    .filter((r: string) => callerProfile.role === 'superadmin' ? true : r !== 'superadmin')
            ));

            // Delete additional roles no longer in the desired set (never delete primary).
            const keep = [primary, ...cleaned];
            await supabaseAdmin
                .from('user_roles')
                .delete()
                .eq('user_id', adminId)
                .not('role', 'in', `(${keep.map(r => `"${r}"`).join(',')})`);

            // Insert missing additional roles.
            if (cleaned.length > 0) {
                await supabaseAdmin
                    .from('user_roles')
                    .upsert(cleaned.map((r: string) => ({ user_id: adminId, role: r })), {
                        onConflict: 'user_id,role',
                        ignoreDuplicates: true,
                    });
            }
        }


        // ── Audit (item 12) — log sensitive admin actions ──────────
        try {
            const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
                    || req.headers.get('cf-connecting-ip') || null;
            const actions: string[] = [];
            if (password) actions.push('password_reset');
            if (email && email !== targetProfile.email) actions.push('email_change');
            if (role && role !== targetProfile.role) actions.push('role_change');
            if (typeof isActive === 'boolean' && isActive !== (targetProfile as { is_active?: boolean }).is_active) {
                actions.push(isActive ? 'reactivate' : 'deactivate');
            }
            if (schoolId !== undefined && schoolId !== targetProfile.school_id) actions.push('school_change');
            if (actions.length > 0) {
                await supabaseAdmin.from('admin_action_audit').insert({
                    actor_id: caller.id,
                    actor_role: callerProfile.role,
                    target_user_id: adminId,
                    action: actions.join(','),
                    detail: {
                        previous: {
                            email: targetProfile.email,
                            role: targetProfile.role,
                            school_id: targetProfile.school_id,
                        },
                        next: {
                            email: email ?? undefined,
                            role: role ?? undefined,
                            school_id: schoolId !== undefined ? (schoolId || null) : undefined,
                            is_active: typeof isActive === 'boolean' ? isActive : undefined,
                        },
                    },
                    ip_address: ip,
                });
            }
        } catch {
            // Auditing must never break the primary operation.
        }

        return new Response(JSON.stringify({ success: true, user: { id: adminId, email: email || targetProfile.email } }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        return new Response(JSON.stringify({ error: message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
