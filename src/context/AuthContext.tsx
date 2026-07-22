import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserRole } from '../config/roles';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { AuthContext, type AuthUser } from './authContextValue';
import { shouldHydrateAuthEvent, signOutBeforeRedirect } from '../lib/auth/loginSession';

// Re-export useAuth from its dedicated module so existing imports keep working
// while React Fast Refresh treats this file as a pure component module.
// eslint-disable-next-line react-refresh/only-export-components
export { useAuth } from '../hooks/useAuth';

/**
 * Fetch the user's profile (role, full_name, school) from the profiles table.
 */
async function fetchProfile(userId: string): Promise<{ role: UserRole; fullName: string; schoolId: string | null; schoolName: string | null } | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('role, full_name, school_id, schools:school_id(name)')
        .eq('id', userId)
        .single();

    if (error || !data) {
        await logger.error('auth', 'Failed to fetch profile', {
            userId,
            details: { error: error?.message }
        });
        return null;
    }

    const row = data as unknown as {
        role: string;
        full_name: string | null;
        school_id: string | null;
        schools: { name: string } | { name: string }[] | null;
    };
    const schoolJoin = Array.isArray(row.schools) ? row.schools[0] : row.schools;

    return {
        role: row.role as UserRole,
        fullName: row.full_name || '',
        schoolId: row.school_id ?? null,
        schoolName: schoolJoin?.name ?? null,
    };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [role, setRole] = useState<UserRole | null>(null);
    const [roles, setRoles] = useState<UserRole[]>([]);
    const [loading, setLoading] = useState(true); // Start as true — checking session
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [transition, setTransition] = useState<{ show: boolean; message: string; messages?: string[]; submessage?: string }>({
        show: false,
        message: 'Just a moment…',
    });
    const [toast, setToast] = useState({ show: false, message: '' });
    const loginInProgressRef = useRef(false);

    /**
     * Handle a Supabase auth session — fetch profile and set state.
     */
    const handleSession = useCallback(async (session: Session | null, shouldLog: boolean) => {
        if (!session?.user) {
            setUser(null);
            setRole(null);
            setRoles([]);
            setLoading(false);
            return;
        }

        const supaUser: User = session.user;
        const profile = await fetchProfile(supaUser.id);

        if (profile) {
            setUser({
                id: supaUser.id,
                email: supaUser.email || '',
                fullName: profile.fullName,
                schoolId: profile.schoolId,
                schoolName: profile.schoolName,
            });
            // Fetch all assigned roles (primary + additional) via SECURITY DEFINER RPC.
            const { data: rolesData } = await supabase.rpc('fn_get_my_roles');
            const allRoles = Array.from(new Set([
                profile.role,
                ...(((rolesData ?? []) as string[]).map(r => r as UserRole)),
            ]));
            setRoles(allRoles);
            setRole(profile.role);
            if (shouldLog) {
                await logger.info('auth', 'Session restored', {
                    details: { email: supaUser.email, role: profile.role, roles: allRoles },
                    userId: supaUser.id
                });
            }
        } else {
            setUser(null);
            setRole(null);
            setRoles([]);
            if (shouldLog) {
                await logger.warn('auth', 'User has no profile', {
                    details: { email: supaUser.email, userId: supaUser.id }
                });
            }
        }

        setLoading(false);
    }, []);

    /**
     * On mount: rely on onAuthStateChange (fires INITIAL_SESSION immediately).
     * We deliberately don't also call getSession() — that caused duplicate
     * "Session restored" logs (one per call site). Likewise, TOKEN_REFRESHED
     * and USER_UPDATED fire periodically (every ~hour and on metadata change)
     * and should never re-log a session-restore event.
     */
    useEffect(() => {
        // Pick up a one-shot toast queued before a hard navigation (e.g.
        // post sign-out redirect from a protected/locked screen back to "/").
        try {
            const queued = sessionStorage.getItem('post_signout_toast');
            if (queued) {
                sessionStorage.removeItem('post_signout_toast');
                // Defer so the landing page mounts first.
                setTimeout(() => setToast({ show: true, message: queued }), 350);
            }
        } catch { /* ignore */ }

        let loggedForUser: string | null = null;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!shouldHydrateAuthEvent(event, loginInProgressRef.current)) return;
            const uid = session?.user?.id ?? null;
            const isNewUser = uid !== null && uid !== loggedForUser;
            const shouldLog =
                isNewUser && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN');
            if (shouldLog) loggedForUser = uid;
            if (event === 'SIGNED_OUT') loggedForUser = null;
            handleSession(session, shouldLog);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [handleSession]);

    /**
     * Realtime: when the current user's profile row changes (role, school,
     * is_active), immediately re-sync. If role changes or account is
     * deactivated, force refresh/reload so ProtectedRoute re-evaluates and
     * the JWT picks up new app_metadata for RLS.
     */
    useEffect(() => {
        if (!user?.id) return;
        const currentRole = role;
        const channel = supabase
            .channel(`profile-watch-${user.id}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
                async (payload) => {
                    const newRow = payload.new as { role?: string; is_active?: boolean } | null;
                    if (!newRow || payload.eventType === 'DELETE' || newRow.is_active === false) {
                        await logger.warn('auth', 'Profile deleted/deactivated — signing out', { userId: user.id });
                        await supabase.auth.signOut();
                        window.location.href = '/';
                        return;
                    }
                    if (newRow.role && newRow.role !== currentRole) {
                        await logger.info('auth', 'Role changed — reloading session', {
                            userId: user.id,
                            details: { from: currentRole, to: newRow.role },
                        });
                        try { await supabase.auth.refreshSession(); } catch { /* ignore */ }
                        window.location.reload();
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id, role]);

    /**
     * Login with email + password via Supabase Auth.
     */
    const login = async (email: string, password: string): Promise<UserRole> => {
        loginInProgressRef.current = true;
        setLoading(true);
        setTransition({
            show: true,
            message: 'Signing you in…',
            messages: [
                'Signing you in…',
                'Verifying credentials…',
                'Loading your workspace…',
                'Almost there…',
            ],
            submessage: 'Securely connecting to your dashboard.',
        });
        setIsTransitioning(true);

        const loginDetails = { email }; // SECURITY: Never log passwords

        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                await logger.error('auth', `Login failed for ${email}`, {
                    action: 'login',
                    status: 'failed',
                    details: loginDetails
                });
                setLoading(false);
                setIsTransitioning(false);
                throw new Error(error.message);
            }

            // Fetch profile for the logged-in user
            const profile = await fetchProfile(data.user.id);

            if (!profile) {
                await supabase.auth.signOut();
                await logger.error('auth', 'Login succeeded but no profile found', {
                    action: 'login',
                    status: 'failed',
                    details: { email, userId: data.user.id },
                    userId: data.user.id
                });
                setLoading(false);
                setIsTransitioning(false);
                throw new Error('Account not configured. Contact your administrator.');
            }

            setUser({
                id: data.user.id,
                email: data.user.email || email,
                fullName: profile.fullName,
                schoolId: profile.schoolId,
                schoolName: profile.schoolName,
            });
            const { data: rolesData } = await supabase.rpc('fn_get_my_roles');
            setRole(profile.role);
            setRoles(Array.from(new Set([
                profile.role,
                ...(((rolesData ?? []) as string[]).map(r => r as UserRole)),
            ])));

            await logger.info('auth', 'Login successful', {
                action: 'login',
                status: 'success',
                details: { email, role: profile.role },
                userId: data.user.id
            });

            return profile.role;
        } catch (e: unknown) {
            // Error already logged if it was a Supabase error
            if (!(e instanceof Error && e.message === 'Login failed')) {
                // Fallback catch for unexpected errors
                console.error(e);
            }
            throw e;
        } finally {
            loginInProgressRef.current = false;
            setLoading(false);
            setIsTransitioning(false);
            setTransition({ show: false, message: '' });
        }
    };

    /**
     * Sign out via Supabase Auth.
     */
    const signOut = async () => {
        const currentEmail = user?.email;
        const currentUserId = user?.id;
        setTransition({
            show: true,
            message: 'Signing you out…',
            messages: [
                'Signing you out…',
                'Clearing your session…',
                'See you soon…',
            ],
            submessage: 'Securely ending your session.',
        });
        setIsTransitioning(true);

        // Fire-and-forget logs so we don't block the redirect on network I/O.
        void logger.info('auth', 'Logout initiated', {
            action: 'logout',
            status: 'pending',
            details: { email: currentEmail },
            userId: currentUserId,
        });

        // Local scope = clear tokens client-side without waiting for the
        // Supabase server round-trip (which was adding ~5–7s to sign-out).
        // Global session revocation happens lazily on next server contact.
        try {
            await signOutBeforeRedirect(
                () => supabase.auth.signOut({ scope: 'global' }),
                () => {
                    void logger.info('auth', 'Logout successful', {
                        action: 'logout',
                        status: 'success',
                        details: { email: currentEmail },
                    });
                    setUser(null);
                    setRole(null);
                    setRoles([]);
                    try {
                        sessionStorage.setItem('post_signout_toast', 'Logged out successfully! Come back soon.');
                    } catch { /* ignore quota / privacy-mode errors */ }
                    window.location.replace('/');
                },
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unable to sign out.';
            await logger.error('auth', 'Logout failed', {
                action: 'logout',
                status: 'error',
                details: { error: message },
                userId: currentUserId,
            });
            setToast({ show: true, message: `Sign-out failed: ${message}` });
            setIsTransitioning(false);
            setTransition({ show: false, message: '' });
        }
    };

    const switchDashboardRole = useCallback((nextRole: Extract<UserRole, 'student' | 'parent'>) => {
        if (roles.includes(nextRole)) setRole(nextRole);
    }, [roles]);

    const hideToast = () => setToast({ ...toast, show: false });

    return (
        <AuthContext.Provider value={{
            user,
            role,
            roles,
            loading,
            isTransitioning,
            transition,
            setTransitioning: setIsTransitioning,
            setTransition,
            switchDashboardRole,
            login,
            signOut,
            toast,
            hideToast
        }}>
            {children}
        </AuthContext.Provider>
    );
};
