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

            // Upfront validation for guardian linking BEFORE creating Auth user
            if (payload.guardianId) {
                if (targetRole !== 'student') {
                    return new Response(JSON.stringify({ error: 'Only student accounts can be linked to a guardian.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                const { data: guardian, error: guardianErr } = await supabaseAdmin
                    .from('profiles')
                    .select('id, school_id, full_name, role, is_active, deleted_at')
                    .eq('id', payload.guardianId)
                    .maybeSingle();

                if (guardianErr || !guardian) {
                    return new Response(JSON.stringify({ error: 'Selected guardian account was not found.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                if (guardian.school_id !== schoolId) {
                    return new Response(JSON.stringify({ error: 'Selected guardian does not belong to this school.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                if (guardian.deleted_at) {
                    return new Response(JSON.stringify({ error: 'Selected guardian account is deleted.' }), {
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

        const rollbackUser = async (userId: string) => {
            try {
                await supabaseAdmin.from('class_enrollments').delete().eq('student_id', userId);
                await supabaseAdmin.from('parent_student').delete().eq('student_id', userId);
                await supabaseAdmin.from('employees').delete().eq('profile_id', userId);
                await supabaseAdmin.from('memberships').delete().eq('user_id', userId);
                await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
                await supabaseAdmin.from('profiles').delete().eq('id', userId);
                await supabaseAdmin.auth.admin.deleteUser(userId);
            } catch (rbErr) {
                console.error(`Rollback error for user ${userId}:`, rbErr);
            }
        };

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
            await rollbackUser(userData.user.id);
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
                await rollbackUser(userData.user.id);
                return new Response(JSON.stringify({ error: `Combined account setup failed: ${parentRoleError.message}. User rolled back.` }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // CREATE MEMBERSHIP — FATAL for tenant users (Phase 3 hardening)
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
                await rollbackUser(userData.user.id);
                return new Response(JSON.stringify({
                    error: `Membership creation failed: ${membershipError.message}. User rolled back.`
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }

            if (targetRole === 'teacher') {
                const { error: empError } = await supabaseAdmin
                    .from('employees')
                    .upsert({
                        profile_id: userData.user.id,
                        school_id: schoolId,
                        designation: typeof payload.designation === 'string' && payload.designation.trim() ? payload.designation.trim() : 'Teacher',
                        department: typeof payload.department === 'string' && payload.department.trim() ? payload.department.trim() : 'Academics',
                        status: 'active',
                        staff_person_name: typeof payload.staffPersonName === 'string' && payload.staffPersonName.trim() ? payload.staffPersonName.trim() : fullName,
                    }, { onConflict: 'profile_id,school_id' });

                if (empError) {
                    await rollbackUser(userData.user.id);
                    return new Response(JSON.stringify({ error: `Staff profile setup failed: ${empError.message}. User rolled back.` }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
            }

            if (targetRole === 'student') {
                // Self-link for combined single-child parent-student experience
                const { error: selfLinkErr } = await supabaseAdmin.from('parent_student').upsert({
                    parent_id: userData.user.id,
                    student_id: userData.user.id,
                    school_id: schoolId,
                    relationship: 'self_student',
                    is_primary: true,
                    status: 'active',
                }, { onConflict: 'parent_id,student_id' });

                if (selfLinkErr) {
                    await rollbackUser(userData.user.id);
                    return new Response(JSON.stringify({ error: `Student self-link setup failed: ${selfLinkErr.message}. User rolled back.` }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }

                // Link to existing parent/guardian/staff account if specified
                if (payload.guardianId) {
                    // Check other active children count for this guardian
                    const { count: otherChildrenCount } = await supabaseAdmin
                        .from('parent_student')
                        .select('id', { count: 'exact', head: true })
                        .eq('parent_id', payload.guardianId)
                        .eq('school_id', schoolId)
                        .eq('status', 'active');

                    // If guardian has no other active children, this child MUST be primary
                    const shouldBePrimary = otherChildrenCount === 0 || payload.isPrimaryGuardian !== false;

                    // If this link is primary, demote any other active children of this guardian
                    if (shouldBePrimary) {
                        await supabaseAdmin
                            .from('parent_student')
                            .update({ is_primary: false, updated_at: new Date().toISOString() })
                            .eq('parent_id', payload.guardianId)
                            .eq('school_id', schoolId)
                            .eq('status', 'active')
                            .eq('is_primary', true);
                    }

                    // Upsert family link
                    const { error: linkErr } = await supabaseAdmin.from('parent_student').upsert({
                        parent_id: payload.guardianId,
                        student_id: userData.user.id,
                        school_id: schoolId,
                        relationship: payload.guardianRelationship || 'parent',
                        is_primary: shouldBePrimary,
                        status: 'active',
                        created_by: caller.id,
                    }, { onConflict: 'parent_id,student_id' });

                    if (linkErr) {
                        await rollbackUser(userData.user.id);
                        return new Response(JSON.stringify({ error: `Guardian link failed: ${linkErr.message}. User rolled back.` }), {
                            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                        });
                    }

                    // Record parent capability in user_roles ONLY
                    // (NEVER modify profiles.roles and NEVER modify profiles.is_active!)
                    await supabaseAdmin.from('user_roles').upsert({
                        user_id: payload.guardianId,
                        role: 'parent'
                    }, { onConflict: 'user_id,role' });

                    // Canonical audit entry in admin_action_audit
                    await supabaseAdmin.from('admin_action_audit').insert({
                        actor_id: caller.id,
                        actor_role: callerProfile.role,
                        school_id: schoolId,
                        target_user_id: payload.guardianId,
                        action: 'child linked',
                        detail: {
                            parent_id: payload.guardianId,
                            student_id: userData.user.id,
                            student_name: fullName,
                            target_student_identity: userData.user.id,
                            relationship: payload.guardianRelationship || 'parent',
                            is_primary: shouldBePrimary,
                            created_new_student: true
                        }
                    });
                }
            }

            if (classId) {
                const { error: enrollmentError } = await supabaseAdmin.from('class_enrollments').insert({
                    class_id: classId, school_id: schoolId, student_id: userData.user.id,
                });
                if (enrollmentError) {
                    await rollbackUser(userData.user.id);
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
