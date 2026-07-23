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

// Whitelist of valid roles that can be created
const VALID_ROLES = ['admin', 'teacher', 'student', 'parent', 'accountant', 'receptionist'] as const;
type ValidRole = typeof VALID_ROLES[number];

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

        // Fetch caller profile to check role and school context
        const { data: callerProfile } = await supabaseAdmin
            .from('profiles')
            .select('role, school_id')
            .eq('id', caller.id)
            .single();

        if (!callerProfile || (callerProfile.role !== 'superadmin' && callerProfile.role !== 'admin')) {
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

        const { password, fullName, schoolId, role, classId } = payload;
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : payload.email;

        if (!email || !password || !fullName) {
            return new Response(JSON.stringify({ error: 'Missing required fields: email, password, fullName' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // ROLE VALIDATION — BEFORE any mutation (Fixes Problem #9)
        // ═══════════════════════════════════════════════════════════════
        const targetRole: ValidRole = (role && VALID_ROLES.includes(role)) ? role : 'admin';

        if (targetRole !== 'admin' && !schoolId) {
            return new Response(JSON.stringify({ error: `${targetRole} users must be assigned to a school` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        if (targetRole === 'admin' && !schoolId) {
            return new Response(JSON.stringify({ error: 'School admins must be assigned to a school. Only superadmins can be platform-level users.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        if (callerProfile.role === 'admin') {
            // School admins cannot create superadmins
            if (role === 'superadmin') {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin cannot create superadmin users' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            // School admins must have a school context
            if (!callerProfile.school_id) {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin has no school context' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            // School admins can only create users in their own school
            if (schoolId !== callerProfile.school_id) {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin cannot create users for other schools' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
        }

        // Validate schoolId exists in the database before creating the user
        let combinedStudentParentAccount = false;
        if (schoolId) {
            const { data: school } = await supabaseAdmin
                .from('schools')
                .select('id, email_domain, combined_parent_student_account')
                .eq('id', schoolId)
                .single();
            if (!school) {
                return new Response(JSON.stringify({ error: 'Invalid schoolId: school does not exist' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }
            combinedStudentParentAccount = targetRole === 'student' && school.combined_parent_student_account !== false;
            // Enforce school email-domain policy for ALL roles in the tenant.
            if (school.email_domain) {
                const expectedSuffix = '@' + String(school.email_domain).toLowerCase();
                if (!email.endsWith(expectedSuffix)) {
                    return new Response(JSON.stringify({
                        error: `Email must end with ${expectedSuffix} for this school.`,
                    }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                        status: 400,
                    });
                }
            } else {
                return new Response(JSON.stringify({
                    error: 'This school has no email domain configured. Ask a superadmin to set the school email domain before creating users.',
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }

            if (classId !== undefined) {
                if (targetRole !== 'student' || typeof classId !== 'string') {
                    return new Response(JSON.stringify({ error: 'Only student accounts can be assigned to a class.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                const { data: assignedClass } = await supabaseAdmin
                    .from('classes').select('id').eq('id', classId).eq('school_id', schoolId).is('deleted_at', null).maybeSingle();
                if (!assignedClass) {
                    return new Response(JSON.stringify({ error: 'Selected class was not found in this school.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // CREATE AUTH USER — Pass correct metadata (Fixes Problem #6, #37)
        // The handle_new_user() trigger reads these fields to create
        // the correct profile on first INSERT, eliminating the race
        // condition where a wrong-role profile is created.
        // ═══════════════════════════════════════════════════════════════
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            app_metadata: {
                role: targetRole,
                school_id: schoolId || null
            },
            user_metadata: {
                full_name: fullName,
                role: targetRole,
                school_id: schoolId || null,
            }
        });

        if (userError) {
            return new Response(JSON.stringify({ error: `Auth user creation failed: ${userError.message}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // UPSERT PROFILE — Belt-and-suspenders to ensure correct data
        // even if the trigger didn't fire or had issues.
        // ═══════════════════════════════════════════════════════════════
        const profilePayload: Record<string, unknown> = {
            id: userData.user.id,
            email: email,
            login_id: email,
            full_name: fullName,
            role: targetRole,
        };
        if (schoolId) profilePayload.school_id = schoolId;

        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert(profilePayload, { onConflict: 'id' });

        if (profileError) {
            // Rollback: delete the auth user since profile failed
            await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
            return new Response(JSON.stringify({ error: `Profile creation failed: ${profileError.message}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        if (combinedStudentParentAccount) {
            const { error: parentRoleError } = await supabaseAdmin
                .from('user_roles')
                .insert({ user_id: userData.user.id, role: 'parent' });
            if (parentRoleError) {
                await supabaseAdmin.from('profiles').delete().eq('id', userData.user.id);
                await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
                return new Response(JSON.stringify({ error: `Combined account setup failed: ${parentRoleError.message}. User rolled back.` }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // CREATE MEMBERSHIP — FATAL for tenant users (Phase 3 hardening)
        // A tenant user without a membership row is an orphan and breaks
        // RBAC. If membership creation fails, we roll back the auth user
        // and profile so the workspace is never left in a partial state.
        // ═══════════════════════════════════════════════════════════════
        if (schoolId) {
            const { data: systemRole } = await supabaseAdmin
                .from('roles')
                .select('id')
                .eq('name', targetRole)
                .eq('is_system', true)
                .single();

            const { error: membershipError } = await supabaseAdmin
                .from('memberships')
                .upsert({
                    user_id: userData.user.id,
                    school_id: schoolId,
                    role_id: systemRole?.id || null,
                    status: 'active'
                }, { onConflict: 'user_id,school_id' });

            if (membershipError) {
                // Rollback: profile (CASCADE-linked to auth.users) + auth user
                await supabaseAdmin.from('profiles').delete().eq('id', userData.user.id);
                await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
                return new Response(JSON.stringify({
                    error: `Membership creation failed: ${membershipError.message}. User rolled back.`
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }

            if (classId) {
                const { error: enrollmentError } = await supabaseAdmin.from('class_enrollments').insert({
                    class_id: classId, school_id: schoolId, student_id: userData.user.id,
                });
                if (enrollmentError) {
                    await supabaseAdmin.from('profiles').delete().eq('id', userData.user.id);
                    await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
                    return new Response(JSON.stringify({ error: `Class assignment failed: ${enrollmentError.message}. User rolled back.` }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
            }
        }

        return new Response(JSON.stringify({ success: true, user: { id: userData.user.id, email } }), {
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
