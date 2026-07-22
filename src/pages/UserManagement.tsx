import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    MoreVertical,
    Key,
    X,
    Crown,
    Building2,
    ShieldCheck,
    GraduationCap,
    Users as UsersIcon,
    ChevronDown,
    ChevronUp,
    BookOpen,
    UserCheck,
    Mail,
    // ChevronsUpDown removed with permissions UI
    User,

    Trash2,
    AlertTriangle,
    CheckCircle2,
    Send,
    RefreshCw,
    BadgeCheck,
    XCircle,
    Pencil,
} from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { getFunctionErrorMessage } from '../lib/functionErrors';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useUserManagementData, qk } from '../hooks/queries';
import QueryBoundary from '../components/ui/QueryBoundary';
import { useAuth } from '../hooks/useAuth';

interface User {
    id: string;
    full_name: string | null;
    role: string;
    school_id: string | null;
    school_name: string | null;
    status: string;
    is_active: boolean;
    metadata: { permissions?: unknown[] } | null;
    updated_at: string;
    email: string;
    avatar_url: string | null;
    recovery_email: string | null;
    recovery_email_verified: boolean;
}

interface SchoolGroup {
    schoolId: string | null;
    schoolName: string;
    users: User[];
    isCore: boolean;
}

/* ─── ROLE CONFIG ──────────────────────────────────────── */
const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; order: number }> = {
    superadmin: { label: 'Super Admin', color: 'text-indigo-700', bg: 'bg-indigo-100', order: 0 },
    admin: { label: 'Admin', color: 'text-amber-700', bg: 'bg-amber-100', order: 1 },
    teacher: { label: 'Teacher', color: 'text-sky-700', bg: 'bg-sky-100', order: 2 },
    student: { label: 'Student', color: 'text-emerald-700', bg: 'bg-emerald-100', order: 3 },
    parent: { label: 'Parent', color: 'text-purple-700', bg: 'bg-purple-100', order: 4 },
    accountant: { label: 'Accountant', color: 'text-rose-700', bg: 'bg-rose-100', order: 5 },
    receptionist: { label: 'Receptionist', color: 'text-teal-700', bg: 'bg-teal-100', order: 6 },
};

const getRoleStyle = (role: string) => ROLE_CONFIG[role] || { label: role, color: 'text-gray-700', bg: 'bg-gray-100', order: 99 };

/* Permission metadata removed — permissions UI was display-only. */



/* ─── USER DRAWER ──────────────────────────────────────── */
const UserDrawer: React.FC<{
    user: User | null;
    isOpen: boolean;
    onClose: () => void;
    schools: { id: string; name: string; email_domain?: string | null; combined_parent_student_account?: boolean }[];
    permissions?: unknown[];
    onSaved: () => void;
}> = ({ user, isOpen, onClose, schools, onSaved }) => {
    const { role: currentRole, user: currentUser } = useAuth();
    const isSuperadmin = currentRole === 'superadmin';
    const canManageUsers = currentRole === 'superadmin' || currentRole === 'admin';
    const canEditName = !!user && (canManageUsers || currentUser?.id === user.id);

    const [editRole, setEditRole] = useState('');
    const [editFullName, setEditFullName] = useState('');
    const [editSchool, setEditSchool] = useState('');
    const [editEmail, setEditEmail] = useState('');           // full email (no domain / superadmin)
    const [editEmailLocal, setEditEmailLocal] = useState(''); // local part when domain is locked
    const [isActive, setIsActive] = useState(true);
    const [additionalRoles, setAdditionalRoles] = useState<string[]>([]);



    const [newPass, setNewPass] = useState('');
    const [saving, setSaving] = useState(false);
    const [passSaving, setPassSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [editingName, setEditingName] = useState(false);

    const PROTECTED_EMAILS = new Set(['admin@admin.com', 'superadmin@edunex.com']);
    const isProtected = !!user && PROTECTED_EMAILS.has((user.email || '').toLowerCase());

    // Domain of the school this user is currently assigned to (locks the "@…" suffix).
    const editSelectedSchool = schools.find(s => s.id === editSchool);
    const editLockedDomain = editSelectedSchool?.email_domain || '';

    // permsByCategory removed with permissions UI


    useEffect(() => {
        if (user) {
            setEditRole(user.role || '');
            setEditFullName(user.full_name || '');
            setEditSchool(user.school_id || '');
            setEditEmail(user.email || '');
            const atIdx = (user.email || '').indexOf('@');
            setEditEmailLocal(atIdx > 0 ? user.email.slice(0, atIdx) : '');
            setIsActive(user.is_active ?? true);
            setNewPass('');
            setMessage('');
            setErrorMsg('');
            setAdditionalRoles([]);
            setEditingName(false);
            // Fetch this user's assigned roles (primary + additional) via secure RPC.
            (async () => {
                const { data, error } = await supabase.rpc('fn_get_user_roles', { _target_user_id: user.id });
                if (!error && Array.isArray(data)) {
                    const primary = user.role;
                    setAdditionalRoles((data as string[]).filter(r => r && r !== primary));
                }
            })();
        }
    }, [user]);


    // Category toggles removed with permissions UI


    const handleSave = async () => {
        if (!user) return;
        setSaving(true);
        setMessage('');
        setErrorMsg('');
        try {
            // Route all privileged profile mutations through the edge function.
            // Direct client `from('profiles').update(...)` is no longer allowed
            // for role, school, is_active, or permissions changes.
            await supabase.auth.refreshSession();

            // If the target school has an email_domain, force-compose the email
            // from the editable local-part + locked "@domain" so admins can't
            // sneak in a foreign address.
            const composedEmail = editLockedDomain
                ? `${(editEmailLocal || '').trim().toLowerCase()}@${editLockedDomain}`
                : editEmail.trim();

            const body: Record<string, unknown> = {
                adminId: user.id,
                fullName: editFullName.trim() || user.full_name || 'User',
            };
            if (canManageUsers) {
                body.role = editRole;
                body.schoolId = editSchool || '';
                body.isActive = isActive;
                body.metadataPermissions = user.metadata?.permissions ?? [];
                body.additionalRoles = additionalRoles;
                if (composedEmail && composedEmail !== user.email) body.email = composedEmail;
            }

            const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to update user'));
            if (fnData?.error) throw new Error(fnData.error);

            setMessage('Account details updated successfully!');
            onSaved();
            setTimeout(() => onClose(), 1200);
        } catch (err) {
            setErrorMsg((err instanceof Error ? err.message : '') || 'Failed to update user.');
        } finally {
            setSaving(false);
        }
    };

    const handlePasswordReset = async () => {
        if (!user || !newPass || newPass.length < 6) {
            setErrorMsg('Password must be at least 6 characters.');
            return;
        }
        setPassSaving(true);
        setErrorMsg('');
        setMessage('');
        try {
            const { data: { user: currentUser }, error: sessionErr } = await supabase.auth.getUser();
            if (sessionErr || !currentUser) throw new Error('No active session.');

            const body: Record<string, string> = {
                adminId: user.id,
                email: editEmail || user.email,
                fullName: user.full_name || 'User',
                password: newPass,
                schoolId: editSchool || ''
            };

            const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to update password'));
            if (fnData?.error) throw new Error(fnData.error);

            setMessage('Password updated successfully!');
            setNewPass('');
        } catch (err) {
            setErrorMsg((err instanceof Error ? err.message : '') || 'Failed to reset password.');
        } finally {
            setPassSaving(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && user && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[60] bg-stone-900/40 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed top-0 right-0 h-full w-full max-w-lg z-[70] bg-[#FAF9F6] border-l border-gray-200 flex flex-col shadow-2xl overflow-y-auto"
                    >
                        {/* ── Header ── */}
                        <div className="flex justify-between items-center px-8 pt-8 pb-4">
                            <h2 className="text-2xl font-bold text-foreground">User Settings</h2>
                            <button onClick={onClose} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center hover:text-rose-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* ── Avatar & Info ── */}
                        <div className="flex items-center gap-4 mx-8 mb-6 p-4 clay-card">
                            <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-white font-bold text-xl shadow-lg flex-shrink-0">
                                {user.avatar_url
                                    ? <img src={user.avatar_url} className="w-full h-full object-cover rounded-2xl" alt="avatar" />
                                    : (user.full_name ? user.full_name.substring(0, 2).toUpperCase() : '??')}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1 min-w-0">
                                    {editingName ? (
                                        <input
                                            autoFocus
                                            value={editFullName}
                                            onChange={e => setEditFullName(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Escape') { setEditFullName(user.full_name || ''); setEditingName(false); } }}
                                            className="clay-input h-8 flex-1 min-w-0 text-sm font-bold"
                                            aria-label="Full name"
                                        />
                                    ) : (
                                        <h3 className="text-lg font-bold text-foreground truncate">{user.full_name || 'No Name'}</h3>
                                    )}
                                    {canEditName && (
                                        <button type="button" onClick={() => setEditingName(true)} className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors" aria-label="Edit name">
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                                <p className="text-xs text-muted truncate">{user.email}</p>
                                <span className={`mt-1 inline-block text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${ROLE_CONFIG[user.role]?.bg ?? 'bg-gray-100'
                                    } ${ROLE_CONFIG[user.role]?.color ?? 'text-gray-700'}`}>
                                    {ROLE_CONFIG[user.role]?.label ?? user.role}
                                </span>
                            </div>
                        </div>

                        {/* ── Alerts ── */}
                        <div className="px-8">
                            {message && <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 text-sm font-medium rounded-xl border border-emerald-100">{message}</div>}
                            {errorMsg && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-100">{errorMsg}</div>}
                            {isProtected && <div className="mb-4 p-3 bg-amber-50 text-amber-800 text-sm font-medium rounded-xl border border-amber-200">🔒 This is a protected root superadmin account. Role, status, school and email are locked.</div>}
                        </div>


                        {/* ── Body ── */}
                        <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6">

                            {/* ── Section: Identity ── */}
                            <div>
                                <p className="text-[11px] font-bold text-muted uppercase tracking-widest mb-3">Identity</p>
                                <div className="space-y-3">
                                    {/* Email */}
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1.5">
                                            <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> Email Address</span>
                                        </label>
                                        {editLockedDomain ? (
                                            <div className={`flex items-stretch rounded-xl overflow-hidden border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-primary/20 ${isProtected ? 'opacity-60' : ''}`}>
                                                <input
                                                    type="text"
                                                    value={editEmailLocal}
                                                    onChange={e => setEditEmailLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                                                    disabled={isProtected}
                                                    className="flex-1 px-3 py-2 text-sm outline-none disabled:cursor-not-allowed font-mono"
                                                    placeholder="john.doe"
                                                    autoComplete="off"
                                                />
                                                <span className="px-3 py-2 bg-stone-50 border-l border-gray-200 text-sm text-stone-600 font-mono truncate max-w-[55%]" title={`@${editLockedDomain}`}>
                                                    @{editLockedDomain}
                                                </span>
                                            </div>
                                        ) : isSuperadmin ? (
                                            <input
                                                type="email"
                                                value={editEmail}
                                                onChange={e => setEditEmail(e.target.value)}
                                                disabled={isProtected}
                                                className="clay-input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                                placeholder="user@example.com"
                                            />
                                        ) : (
                                            <div className="clay-input w-full text-sm bg-stone-50 text-stone-600 font-mono truncate">
                                                {editEmail || '—'}
                                            </div>
                                        )}
                                        <p className="text-[10px] text-muted mt-1">
                                            {editLockedDomain
                                                ? <>Full email: <span className="font-mono text-foreground">{(editEmailLocal || 'username')}@{editLockedDomain}</span></>
                                                : 'Changing email will update login credentials via the admin function.'}
                                        </p>
                                    </div>


                                    {/* Role + Status */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-semibold text-muted block mb-1.5">Role</label>
                                            <select
                                                value={editRole}
                                                onChange={e => setEditRole(e.target.value)}
                                                disabled={isProtected}
                                                className="clay-input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                            >
                                                <option value="">Select Role</option>
                                                {Object.keys(ROLE_CONFIG)
                                                    .filter(r => isSuperadmin || r !== 'superadmin')
                                                    .map(r => (
                                                        <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
                                                    ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-muted block mb-1.5">Account Status</label>
                                            <button
                                                onClick={() => !isProtected && setIsActive(!isActive)}
                                                disabled={isProtected}
                                                className={`w-full py-2.5 px-3 rounded-xl shadow-sm border font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${isActive
                                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                                    : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                                                    }`}
                                            >
                                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-emerald-500' : 'bg-red-400'}`} />
                                                {isActive ? 'Active' : 'Disabled'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* School */}
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1.5">
                                            <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" /> School Assignment</span>
                                        </label>
                                        {isSuperadmin ? (
                                            <select
                                                value={editSchool}
                                                onChange={e => setEditSchool(e.target.value)}
                                                disabled={isProtected}
                                                className="clay-input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                            >
                                                <option value="">Platform Core (No School)</option>
                                                {schools.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className="clay-input w-full text-sm bg-stone-50 text-stone-700 flex items-center justify-between">
                                                <span className="truncate">{editSelectedSchool?.name ?? 'Platform Core'}</span>
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Locked</span>
                                            </div>
                                        )}
                                        <p className="text-[10px] text-muted mt-1">
                                            {isSuperadmin
                                                ? 'Transfer this user to another school or set as a platform-level core member.'
                                                : 'Only the platform superadmin can move users between schools.'}
                                        </p>
                                    </div>

                                    {/* Additional Roles */}
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1.5">
                                            <span className="inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Additional Roles</span>
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {Object.keys(ROLE_CONFIG)
                                                .filter(r => isSuperadmin || r !== 'superadmin')
                                                .filter(r => r !== editRole)
                                                .map(r => {
                                                    const checked = additionalRoles.includes(r);
                                                    return (
                                                        <label
                                                            key={r}
                                                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium cursor-pointer transition-colors ${checked
                                                                ? `${ROLE_CONFIG[r].bg} ${ROLE_CONFIG[r].color} border-transparent`
                                                                : 'bg-white border-gray-200 text-stone-600 hover:bg-stone-50'
                                                                } ${isProtected ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                className="w-3.5 h-3.5 accent-current"
                                                                checked={checked}
                                                                disabled={isProtected}
                                                                onChange={e => {
                                                                    setAdditionalRoles(prev =>
                                                                        e.target.checked
                                                                            ? [...prev, r]
                                                                            : prev.filter(x => x !== r)
                                                                    );
                                                                }}
                                                            />
                                                            {ROLE_CONFIG[r].label}
                                                        </label>
                                                    );
                                                })}
                                        </div>
                                        <p className="text-[10px] text-muted mt-1.5">
                                            Grant extra roles on top of the primary one — e.g. a teacher who also handles reception.
                                        </p>
                                    </div>
                                </div>
                            </div>


                            {/* ── Section: Recovery Email ── */}
                            {!isProtected && (
                                <RecoveryEmailSection userId={user.id} userEmail={user.email} />
                            )}

                            {/* Danger zone: permanent delete */}
                            {!isProtected && (
                                <div className="pt-3 border-t border-rose-100">
                                    <button
                                        onClick={() => setDeleteOpen(true)}
                                        className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm font-semibold hover:bg-rose-100 transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Permanently Delete User
                                    </button>
                                    <p className="text-[10px] text-muted mt-1.5">Irreversible. Removes the account, profile, and access immediately.</p>
                                </div>
                            )}

                            {/* ── Section: Security ── */}
                            <div className="pt-2 border-t border-gray-100">
                                <p className="text-[11px] font-bold text-muted uppercase tracking-widest mb-3">Security</p>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1.5">New Password</label>
                                        <input
                                            type="password"
                                            placeholder="Minimum 6 characters"
                                            className="clay-input w-full text-sm"
                                            value={newPass}
                                            onChange={e => setNewPass(e.target.value)}
                                        />
                                    </div>
                                    <button
                                        onClick={handlePasswordReset}
                                        disabled={passSaving || !newPass}
                                        className="w-full clay-btn-outline justify-center gap-2 py-3 text-sm flex items-center disabled:opacity-50"
                                    >
                                        <Key className="w-4 h-4" />
                                        {passSaving ? 'Resetting...' : 'Reset User Password'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* ── Footer: Save ── */}
                        <div className="px-8 pb-8 pt-4 border-t border-gray-200 bg-[#FAF9F6]">
                            <button onClick={handleSave} disabled={saving} className="w-full clay-btn py-3 disabled:opacity-50">
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </motion.div>

                    <DeleteUserConfirmModal
                        isOpen={deleteOpen}
                        onClose={() => setDeleteOpen(false)}
                        user={user}
                        schoolName={schools.find(s => s.id === user.school_id)?.name || ''}
                        onDeleted={() => {
                            setDeleteOpen(false);
                            onSaved();
                            onClose();
                        }}
                    />
                </>
            )}
        </AnimatePresence>
    );
};

/* ─── RECOVERY EMAIL SECTION ───────────────────────────── */
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const REC_OTP_TTL_SEC = 10 * 60;

const RecoveryEmailSection: React.FC<{ userId: string; userEmail: string }> = ({ userId, userEmail }) => {
    const [loading, setLoading] = useState(true);
    const [stored, setStored] = useState<string | null>(null);
    const [verified, setVerified] = useState(false);
    const [editing, setEditing] = useState(false);

    const [emailInput, setEmailInput] = useState('');
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [info, setInfo] = useState('');
    const [error, setError] = useState('');
    const [expiresAt, setExpiresAt] = useState(0);
    const [tick, setTick] = useState(Date.now());

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('recovery_email, recovery_email_verified')
                .eq('id', userId)
                .maybeSingle();
            if (error) throw error;
            setStored(data?.recovery_email ?? null);
            setVerified(Boolean(data?.recovery_email_verified));
            setEmailInput(data?.recovery_email || '');
            setEditing(!data?.recovery_email_verified);
        } catch {
            setStored(null); setVerified(false); setEditing(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (userId) load();   }, [userId]);

    // OTP countdown
    useEffect(() => {
        if (!otpSent || verified || !expiresAt) return;
        const id = setInterval(() => setTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [otpSent, verified, expiresAt]);

    const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - tick) / 1000)) : 0;
    const expired = otpSent && !verified && expiresAt > 0 && secondsLeft === 0;
    const validEmail = EMAIL_REGEX.test(emailInput.trim());
    const sameAsLogin = emailInput.trim().toLowerCase() === (userEmail || '').toLowerCase();

    const sendOtp = async () => {
        setError(''); setInfo('');
        if (!validEmail) { setError('Enter a valid email address.'); return; }
        if (sameAsLogin) { setError('Recovery email must differ from the login email.'); return; }
        setBusy(true);
        try {
            await supabase.auth.refreshSession();
            const { data, error } = await supabase.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: userId, recoveryEmail: emailInput.trim().toLowerCase() },
            });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Failed to send code'));
            if (data?.error) throw new Error(data.error);
            setOtpSent(true);
            setOtp('');
            setExpiresAt(Date.now() + REC_OTP_TTL_SEC * 1000);
            setTick(Date.now());
            setInfo(data?.message || 'Verification code sent.');
            toast.success('Verification code sent.');
        } catch (e) {
            const friendly = (e instanceof Error ? e.message : '') || 'Failed to send code.';
            setError(friendly);
            toast.error(friendly);
        } finally { setBusy(false); }
    };

    const confirmOtp = async () => {
        setError(''); setInfo('');
        if (expired) { setError('Code expired. Send a new one.'); return; }
        if (!/^\d{6}$/.test(otp.trim())) { setError('Enter the 6-digit code.'); return; }
        setBusy(true);
        try {
            await supabase.auth.refreshSession();
            const { data, error } = await supabase.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: userId, code: otp.trim() },
            });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Verification failed'));
            if (data?.error) throw new Error(data.error);
            toast.success('Recovery email verified.');
            setOtpSent(false); setOtp(''); setExpiresAt(0);
            await load();
        } catch (e) {
            const friendly = (e instanceof Error ? e.message : '') || 'Verification failed.';
            setError(friendly);
            toast.error(friendly);
        } finally { setBusy(false); }
    };

    const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;

    return (
        <div className="pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-bold text-muted uppercase tracking-widest">Recovery Email</p>
                {verified && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Verified
                    </span>
                )}
            </div>

            {loading ? (
                <p className="text-xs text-muted italic">Loading…</p>
            ) : verified && !editing ? (
                <div className="flex items-center justify-between bg-emerald-50/60 border border-emerald-100 rounded-xl p-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-emerald-900 truncate">{stored}</p>
                        <p className="text-[10px] text-emerald-700/80">Used for password recovery.</p>
                    </div>
                    <button
                        onClick={() => { setEditing(true); setOtpSent(false); setError(''); setInfo(''); }}
                        className="text-[11px] font-semibold text-emerald-700 hover:underline px-2 py-1 rounded-md"
                    >
                        Change
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted block">
                        <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> Recovery email</span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="email"
                            value={emailInput}
                            disabled={otpSent || busy}
                            onChange={e => setEmailInput(e.target.value)}
                            placeholder="recovery@example.com"
                            className="clay-input w-full text-sm disabled:opacity-60"
                        />
                        {!otpSent && (
                            <button
                                onClick={sendOtp}
                                disabled={busy || !validEmail || sameAsLogin}
                                className="px-3 rounded-xl bg-primary text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Send className="w-3.5 h-3.5" />
                                {busy ? 'Sending…' : 'Send code'}
                            </button>
                        )}
                    </div>
                    {stored && !verified && !otpSent && (
                        <p className="text-[10px] text-amber-700">Saved as <strong>{stored}</strong> but not yet verified.</p>
                    )}

                    {otpSent && (
                        <div className="space-y-2 mt-2 p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                            <label className="text-xs font-semibold text-amber-900 block">Enter the 6-digit code we just sent</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={otp}
                                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                                    placeholder="123456"
                                    disabled={busy}
                                    className="clay-input w-full text-sm font-mono tracking-[0.4em] text-center"
                                />
                                <button
                                    onClick={confirmOtp}
                                    disabled={busy || otp.length !== 6 || expired}
                                    className="px-3 rounded-xl bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
                                >
                                    {busy ? 'Verifying…' : 'Verify'}
                                </button>
                            </div>
                            <div className="flex items-center justify-between text-[10px]">
                                <span className={expired ? 'text-rose-700 font-semibold' : 'text-amber-800'}>
                                    {expired ? 'Code expired.' : `Expires in ${mmss}`}
                                </span>
                                <button
                                    type="button"
                                    onClick={sendOtp}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1 text-amber-800 hover:underline disabled:opacity-50"
                                >
                                    <RefreshCw className="w-3 h-3" /> Resend
                                </button>
                            </div>
                        </div>
                    )}

                    {error && <p className="text-[11px] text-rose-700">{error}</p>}
                    {info && !error && <p className="text-[11px] text-emerald-700">{info}</p>}

                    {verified && editing && (
                        <button
                            onClick={() => { setEditing(false); setError(''); setInfo(''); setOtpSent(false); setEmailInput(stored || ''); }}
                            className="text-[10px] text-muted hover:underline"
                        >
                            Cancel change
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

/* ─── DELETE USER CONFIRMATION ─────────────────────────── */
const slugifyClient = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const DeleteUserConfirmModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    user: User;
    schoolName: string;
    onDeleted: () => void;
}> = ({ isOpen, onClose, user, schoolName, onDeleted }) => {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    const schoolSlug = schoolName ? slugifyClient(schoolName) : 'platform';
    const expected = `${schoolSlug}/${(user.full_name || '').trim().toLowerCase()}`;
    const typed = text.trim().toLowerCase();
    const matches = typed === expected;
    const empty = typed.length === 0;
    // Live validation state
    const validation: { tone: 'idle' | 'progress' | 'error' | 'ok'; msg: string } =
        empty ? { tone: 'idle', msg: 'Type the confirmation string above to enable deletion.' }
        : matches ? { tone: 'ok', msg: '✓ Match — deletion enabled.' }
        : expected.startsWith(typed) ? { tone: 'progress', msg: `Keep typing… (${typed.length}/${expected.length})` }
        : { tone: 'error', msg: "Doesn't match the required string. Check school slug and name." };

    useEffect(() => {
        if (isOpen) {
            setText(''); setErr('');
            // Reliable focus after motion mount
            const t = setTimeout(() => inputRef.current?.focus(), 60);
            return () => clearTimeout(t);
        }
    }, [isOpen]);

    const handleDelete = async () => {
        if (!matches) return;
        setBusy(true);
        setErr('');
        try {
            await supabase.auth.refreshSession();
            const { data, error } = await supabase.functions.invoke('delete_user', {
                body: { targetUserId: user.id, confirmText: text.trim() },
            });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Failed to delete user'));
            if (data?.error) throw new Error(data.error);
            toast.success(`Deleted ${user.full_name || user.email}`);
            onDeleted();
        } catch (e) {
            const friendly = (e instanceof Error ? e.message : '') || 'Failed to delete user.';
            setErr(friendly);
            toast.error(friendly);
            // Keep the modal open so the admin can retry or cancel.
        } finally {
            setBusy(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && matches && !busy) handleDelete();
        if (e.key === 'Escape' && !busy) onClose();
    };

    const validationStyles = {
        idle: 'text-muted',
        progress: 'text-amber-700',
        error: 'text-rose-700',
        ok: 'text-emerald-700',
    }[validation.tone];

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={busy ? undefined : onClose}
                        className="fixed inset-0 z-[80] bg-stone-900/50 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[90] w-[92vw] max-w-md bg-white rounded-3xl shadow-2xl border border-rose-100 overflow-hidden"
                    >
                        <div className="p-6">
                            <div className="flex items-start gap-3 mb-4">
                                <div className="w-11 h-11 rounded-2xl bg-rose-100 flex items-center justify-center flex-shrink-0">
                                    <AlertTriangle className="w-5 h-5 text-rose-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-foreground">Permanently delete user?</h3>
                                    <p className="text-xs text-muted mt-0.5">
                                        This will remove <strong>{user.full_name}</strong> ({user.email}) and all related access. This action cannot be undone.
                                    </p>
                                </div>
                            </div>

                            <div className="bg-rose-50/60 border border-rose-100 rounded-xl p-3 mb-3">
                                <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider mb-1">To confirm, type</p>
                                <p className="font-mono text-sm font-bold text-rose-900 break-all">{expected}</p>
                            </div>

                            <input
                                ref={inputRef}
                                type="text"
                                value={text}
                                onChange={e => setText(e.target.value)}
                                onKeyDown={onKeyDown}
                                placeholder={expected}
                                aria-invalid={validation.tone === 'error'}
                                aria-describedby="delete-confirm-hint"
                                className={`clay-input w-full text-sm font-mono transition-colors ${
                                    validation.tone === 'ok' ? 'border-emerald-300 ring-1 ring-emerald-200' :
                                    validation.tone === 'error' ? 'border-rose-300 ring-1 ring-rose-200' : ''
                                }`}
                            />
                            <p id="delete-confirm-hint" className={`text-[11px] mt-1.5 ${validationStyles}`}>
                                {validation.msg}
                            </p>

                            {err && <div className="mt-3 p-2.5 bg-red-50 text-red-700 text-xs font-medium rounded-lg border border-red-100">{err}</div>}

                            <div className="flex gap-2 mt-5">
                                <button
                                    onClick={onClose}
                                    disabled={busy}
                                    className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-muted hover:bg-gray-50 transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={!matches || busy}
                                    className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    {busy ? 'Deleting…' : 'Delete forever'}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

/* ─── ADD USER MODAL ────────────────────────────────────── */
const AddUserModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    schools: { id: string; name: string; email_domain?: string | null; combined_parent_student_account?: boolean }[];
    onCreated: () => void;
    initialRole?: string;
}> = ({ isOpen, onClose, schools, onCreated, initialRole }) => {
    const { user: currentUser, role: currentRole } = useAuth();
    const isSuperadmin = currentRole === 'superadmin';
    const myschoolId = currentUser?.schoolId ?? '';

    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');           // full email (used for Platform Core / no-domain)
    const [emailLocal, setEmailLocal] = useState(''); // username-only when school has email_domain
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('admin');
    // Non-superadmins can only create users inside their own school.
    const [schoolId, setSchoolId] = useState<string>(isSuperadmin ? '' : (myschoolId || ''));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Recovery-email flow (after user is created)
    const [createdUserId, setCreatedUserId] = useState<string>('');
    const [recoveryEmail, setRecoveryEmail] = useState('');
    const [recoverySent, setRecoverySent] = useState(false);
    const [recoveryVerified, setRecoveryVerified] = useState(false);
    const [otp, setOtp] = useState('');
    const [recError, setRecError] = useState('');
    const [recInfo, setRecInfo] = useState('');
    const [recBusy, setRecBusy] = useState(false);
    // 'idle' | 'sending' | 'sent' | 'failed'
    const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
    const OTP_TTL_SEC = 10 * 60;
    const [expiresAt, setExpiresAt] = useState<number>(0); // epoch ms
    const [now, setNow] = useState<number>(Date.now());

    // Tick every second while waiting for OTP entry
    useEffect(() => {
        if (!recoverySent || recoveryVerified || !expiresAt) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [recoverySent, recoveryVerified, expiresAt]);

    const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
    const expired = recoverySent && !recoveryVerified && expiresAt > 0 && secondsLeft === 0;

    // Selected school's email domain (if any). Locks the "@domain" suffix.
    const selectedSchool = schools.find(s => s.id === schoolId);
    const lockedDomain = selectedSchool?.email_domain || '';

    useEffect(() => {
        if (isOpen) {
            setFullName(''); setEmail(''); setEmailLocal(''); setPassword('');
            setRole(initialRole || 'admin');
            setSchoolId(isSuperadmin ? '' : (myschoolId || ''));
            setError(''); setSuccess('');
            setCreatedUserId(''); setRecoveryEmail(''); setRecoverySent(false);
            setRecoveryVerified(false); setOtp('');
            setRecError(''); setRecInfo('');
            setSendStatus('idle'); setExpiresAt(0);
        }
    }, [isOpen, isSuperadmin, myschoolId, initialRole]);

    // Clear email fields when switching schools with/without a domain
    useEffect(() => { setEmail(''); setEmailLocal(''); }, [schoolId]);

    const handleCreate = async () => {
        // Compose the effective email
        const finalEmail = lockedDomain
            ? `${emailLocal.trim().toLowerCase()}@${lockedDomain}`
            : email.trim().toLowerCase();

        if (!fullName.trim() || !finalEmail || password.length < 6) {
            setError('Name, email, and a password of at least 6 characters are required.');
            return;
        }
        if (lockedDomain && !/^[a-z0-9._-]+$/.test(emailLocal.trim().toLowerCase())) {
            setError('Username can only contain letters, numbers, dot, dash, underscore.');
            return;
        }
        if (!lockedDomain && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(finalEmail)) {
            setError('Enter a valid email address.');
            return;
        }
        setSaving(true); setError(''); setSuccess('');
        try {
            const body: Record<string, string> = { email: finalEmail, password, fullName: fullName.trim(), role };
            if (schoolId) body.schoolId = schoolId;

            await supabase.auth.refreshSession();

            const { data, error: fnError } = await supabase.functions.invoke('create_tenant_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to create user'));
            if (data?.error) throw new Error(data.error);
            const newId = data?.user?.id || data?.userId || data?.id || '';
            setCreatedUserId(newId);
            setSuccess(`User "${fullName}" created. Now add a recovery email below (optional).`);
            onCreated();
        } catch (err) {
            setError((err instanceof Error ? err.message : '') || 'Failed to create user.');
        } finally {
            setSaving(false);
        }
    };


    const handleSendOtp = async () => {
        setRecError(''); setRecInfo('');
        if (!createdUserId) { setRecError('No user id yet.'); return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recoveryEmail.trim())) {
            setRecError('Enter a valid email address.'); return;
        }
        setRecBusy(true);
        setSendStatus('sending');
        try {
            const { data, error: fnError } = await supabase.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: createdUserId, recoveryEmail: recoveryEmail.trim().toLowerCase() },
            });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Could not send code'));
            if (data?.error) throw new Error(data.error);
            setRecoverySent(true);
            setSendStatus('sent');
            setExpiresAt(Date.now() + OTP_TTL_SEC * 1000);
            setNow(Date.now());
            setOtp('');
            setRecInfo(data?.message || 'Verification code sent.');
        } catch (err) {
            setSendStatus('failed');
            setRecError((err instanceof Error ? err.message : '') || 'Failed to send code.');
        } finally { setRecBusy(false); }
    };

    const handleConfirmOtp = async () => {
        setRecError(''); setRecInfo('');
        if (expired) { setRecError('Code expired. Request a new one.'); return; }
        if (!/^\d{6}$/.test(otp.trim())) { setRecError('Enter the 6-digit code.'); return; }
        setRecBusy(true);
        try {
            const { data, error: fnError } = await supabase.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: createdUserId, code: otp.trim() },
            });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Verification failed'));
            if (data?.error) throw new Error(data.error);
            setRecoveryVerified(true);
            setRecInfo('Recovery email verified ✓');
        } catch (err) {
            setRecError((err instanceof Error ? err.message : '') || 'Verification failed.');
        } finally { setRecBusy(false); }
    };

    const resetOtpFlow = () => {
        setRecoverySent(false); setOtp('');
        setRecInfo(''); setRecError(''); setExpiresAt(0); setSendStatus('idle');
    };


    const userCreated = Boolean(createdUserId);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={onClose} className="fixed inset-0 z-[60] bg-stone-900/40 backdrop-blur-sm" />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 24 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
                        className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                    >
                        <div className="bg-[#FAF9F6] rounded-3xl shadow-2xl w-full max-w-md border border-gray-200 overflow-hidden max-h-[90vh] flex flex-col">
                            {/* Header */}
                            <div className="flex items-center justify-between px-7 pt-7 pb-5 border-b border-gray-100">
                                <div>
                                    <h2 className="text-xl font-bold text-foreground">Add New User</h2>
                                    <p className="text-xs text-muted mt-0.5">Create a user account with full credentials.</p>
                                </div>
                                <button onClick={onClose} className="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center hover:text-rose-500 transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            {/* Body */}
                            <div className="px-7 py-6 space-y-4 overflow-y-auto">
                                {error && <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-100">{error}</div>}
                                {success && <div className="p-3 bg-emerald-50 text-emerald-700 text-sm font-medium rounded-xl border border-emerald-100">{success}</div>}

                                <div>
                                    <label className="text-xs font-semibold text-muted block mb-1.5">Full Name <span className="text-rose-500">*</span></label>
                                    <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60" placeholder="e.g. Jane Smith" autoFocus />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-muted block mb-1.5">
                                        <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> Login Email <span className="text-rose-500">*</span></span>
                                    </label>
                                    {lockedDomain ? (
                                        <div className="flex items-stretch rounded-xl overflow-hidden border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-primary/20">
                                            <input
                                                type="text"
                                                value={emailLocal}
                                                onChange={e => setEmailLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                                                disabled={userCreated}
                                                className="flex-1 px-3 py-2 text-sm outline-none disabled:opacity-60 font-mono"
                                                placeholder="john.doe"
                                                autoComplete="off"
                                            />
                                            <span className="px-3 py-2 bg-stone-50 border-l border-gray-200 text-sm text-stone-600 font-mono truncate max-w-[55%]" title={`@${lockedDomain}`}>
                                                @{lockedDomain}
                                            </span>
                                        </div>
                                    ) : isSuperadmin ? (
                                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60" placeholder="user@example.com" />
                                    ) : (
                                        <div className="clay-input w-full text-sm bg-stone-50 text-stone-500 italic cursor-not-allowed">
                                            Email domain not configured
                                        </div>
                                    )}
                                    {lockedDomain && (
                                        <p className="text-[10px] text-muted mt-1">Full email: <span className="font-mono text-foreground">{(emailLocal || 'username')}@{lockedDomain}</span></p>
                                    )}
                                    {!lockedDomain && schoolId && (
                                        <p className="text-[10px] text-amber-600 mt-1">
                                            {isSuperadmin
                                                ? 'This school has no email domain configured. Set one in Database → Edit school so all logins share the same subdomain.'
                                                : 'Your school has no email domain configured yet. Ask your platform superadmin to set one before creating users.'}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-muted block mb-1.5">
                                        <span className="inline-flex items-center gap-1"><Key className="w-3 h-3" /> Password <span className="text-rose-500">*</span></span>
                                    </label>
                                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60" placeholder="Minimum 6 characters" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1.5">Role <span className="text-rose-500">*</span></label>
                                        <select value={role} onChange={e => setRole(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60">
                                            {Object.keys(ROLE_CONFIG)
                                                .filter(r => isSuperadmin || r !== 'superadmin')
                                                .map(r => (
                                                    <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
                                                ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1.5">
                                            <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" /> School</span>
                                        </label>
                                        {isSuperadmin ? (
                                            <select value={schoolId} onChange={e => setSchoolId(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60">
                                                <option value="">Platform Core</option>
                                                {schools.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className="clay-input w-full text-sm bg-stone-50 text-stone-700 flex items-center justify-between">
                                                <span className="truncate">{selectedSchool?.name ?? 'Your school'}</span>
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Locked</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {role && (
                                    <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest ${ROLE_CONFIG[role]?.bg ?? 'bg-gray-100'} ${ROLE_CONFIG[role]?.color ?? 'text-gray-700'}`}>
                                            {ROLE_CONFIG[role]?.label ?? role}
                                        </span>
                                        <span className="text-xs text-muted">
                                            {schoolId ? schools.find(s => s.id === schoolId)?.name ?? 'Unknown School' : 'Platform Core'}
                                        </span>
                                    </div>
                                )}
                                {(role === 'student' || role === 'parent') && selectedSchool && (
                                    <p className={`text-xs font-semibold rounded-xl px-3 py-2 ${selectedSchool.combined_parent_student_account !== false ? 'bg-teal-50 text-teal-800 border border-teal-100' : 'bg-stone-100 text-stone-700 border border-stone-200'}`}>
                                        This school has combined parent/student account — {selectedSchool.combined_parent_student_account !== false ? 'enabled' : 'disabled'}.
                                    </p>
                                )}

                                {/* ── Recovery Email Section (after user is created) ── */}
                                {userCreated && (
                                    <div className="mt-2 p-4 rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/70 to-lime-50/70 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-lg bg-emerald-600/10 flex items-center justify-center">
                                                <Mail className="w-3.5 h-3.5 text-emerald-700" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-emerald-900">Recovery Email</p>
                                                <p className="text-[11px] text-emerald-700/70">User's real inbox — used only for password resets.</p>
                                            </div>
                                            {recoveryVerified && (
                                                <span className="ml-auto text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-600 text-white">VERIFIED</span>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={recoveryEmail}
                                                onChange={e => setRecoveryEmail(e.target.value)}
                                                disabled={(recoverySent && !expired) || recoveryVerified || recBusy}
                                                className="clay-input flex-1 text-sm"
                                                placeholder="real-email@gmail.com"
                                            />
                                            {(!recoverySent || expired) && !recoveryVerified && (
                                                <button
                                                    onClick={handleSendOtp}
                                                    disabled={recBusy || !recoveryEmail}
                                                    className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors disabled:opacity-50 whitespace-nowrap"
                                                >
                                                    {recBusy ? 'Sending…' : expired ? 'Resend' : 'Verify'}
                                                </button>
                                            )}
                                        </div>

                                        {/* Status pill */}
                                        {sendStatus !== 'idle' && !recoveryVerified && (
                                            <div className="flex items-center gap-2 text-[11px] font-medium">
                                                {sendStatus === 'sending' && (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-700">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                                                        Sending verification code…
                                                    </span>
                                                )}
                                                {sendStatus === 'sent' && !expired && (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                                                        ✓ Code sent · expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                                                    </span>
                                                )}
                                                {sendStatus === 'sent' && expired && (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800">
                                                        ⏱ Code expired — request a new one
                                                    </span>
                                                )}
                                                {sendStatus === 'failed' && (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700">
                                                        ✗ Send failed
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {recoverySent && !recoveryVerified && (
                                            <>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        maxLength={6}
                                                        value={otp}
                                                        onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                                                        disabled={expired}
                                                        className="clay-input flex-1 text-sm font-mono tracking-[0.5em] text-center"
                                                        placeholder="• • • • • •"
                                                    />
                                                    <button
                                                        onClick={handleConfirmOtp}
                                                        disabled={recBusy || otp.length !== 6 || expired}
                                                        title={expired ? 'Code expired — request a new one' : undefined}
                                                        className="px-4 py-2 rounded-xl bg-emerald-900 text-white text-xs font-bold hover:bg-emerald-950 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                                                    >
                                                        {recBusy ? '…' : 'Confirm'}
                                                    </button>
                                                </div>
                                                {!expired && (
                                                    <button
                                                        onClick={resetOtpFlow}
                                                        className="text-[11px] text-emerald-700 hover:text-emerald-900 underline"
                                                    >
                                                        Change email / resend code
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        {recInfo && sendStatus !== 'sent' && <p className="text-[11px] text-emerald-700">{recInfo}</p>}
                                        {recError && (
                                            <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
                                                <strong>Error:</strong> {recError}
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>
                            {/* Footer */}
                            <div className="px-7 pb-7 pt-3 flex gap-3 border-t border-gray-100 bg-[#FAF9F6]">
                                {!userCreated ? (
                                    <>
                                        <button onClick={onClose} className="flex-1 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-muted hover:bg-gray-50 transition-colors">
                                            Cancel
                                        </button>
                                        <button onClick={handleCreate} disabled={saving} className="flex-1 clay-btn py-3 disabled:opacity-50 flex items-center justify-center gap-2">
                                            {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating...</> : <>Create User</>}
                                        </button>
                                    </>
                                ) : (
                                    <button onClick={onClose} className="flex-1 clay-btn py-3">
                                        Done
                                    </button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

/* ─── USER ROW ─────────────────────────────────────────── */
const UserRow: React.FC<{ user: User; onSelect: (u: User) => void; idx: number }> = ({ user, onSelect, idx }) => {
    const style = getRoleStyle(user.role);
    const { user: currentUser } = useAuth();
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03, duration: 0.25 }}
            className="flex items-center gap-3 p-3 rounded-xl bg-white/60 hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-100 transition-all group cursor-pointer"
            onClick={() => onSelect(user)}
        >
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                {user.avatar_url || (user.full_name ? user.full_name.substring(0, 2).toUpperCase() : '??')}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground truncate">{user.full_name || 'Anonymous'}{currentUser?.id === user.id ? ' (YOU)' : ''}</span>
                    {user.recovery_email_verified ? (
                        <span
                            title={`Email verified${user.recovery_email ? `: ${user.recovery_email}` : ''}`}
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white flex-shrink-0 shadow-sm"
                            aria-label="Verified email"
                        >
                            <BadgeCheck className="w-3 h-3" strokeWidth={3} />
                        </span>
                    ) : (
                        <span
                            title="No verified recovery email"
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 flex-shrink-0"
                            aria-label="Email not verified"
                        >
                            <XCircle className="w-3 h-3" strokeWidth={2.5} />
                        </span>
                    )}
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest flex-shrink-0 ${style.bg} ${style.color}`}>
                        {style.label}
                    </span>
                </div>
                <p className="text-xs text-muted truncate">{user.email}</p>
            </div>
            <div className="text-right flex-shrink-0 hidden sm:block">
                <p className="text-[10px] text-muted italic">
                    {user.updated_at ? formatDistanceToNow(new Date(user.updated_at), { addSuffix: true }) : 'Never'}
                </p>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onSelect(user); }}
                className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-muted hover:text-primary hover:bg-primary/10 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
            >
                <MoreVertical className="w-3.5 h-3.5" />
            </button>
        </motion.div>
    );
};

/* ─── ROLE SECTION ─────────────────────────────────────── */
const RoleSection: React.FC<{ role: string; users: User[]; onSelect: (u: User) => void }> = ({ role, users, onSelect }) => {
    const style = getRoleStyle(role);
    const RoleIcon = role === 'admin' ? ShieldCheck
        : role === 'superadmin' ? Crown
            : role === 'teacher' ? BookOpen
                : role === 'student' ? GraduationCap
                    : UserCheck;

    if (users.length === 0) return null;

    return (
        <div className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2 px-1">
                <RoleIcon className={`w-3.5 h-3.5 ${style.color}`} />
                <span className={`text-[10px] font-bold uppercase tracking-widest ${style.color}`}>
                    {style.label}s ({users.length})
                </span>
            </div>
            <div className="space-y-1">
                {users.map((user, idx) => (
                    <UserRow key={user.id} user={user} onSelect={onSelect} idx={idx} />
                ))}
            </div>
        </div>
    );
};

/* ─── SCHOOL CARD ──────────────────────────────────────── */
const SchoolCard: React.FC<{ group: SchoolGroup; onSelectUser: (u: User) => void; defaultExpanded: boolean; onDeleteSchool?: (schoolId: string, schoolName: string) => void }> = ({ group, onSelectUser, defaultExpanded, onDeleteSchool }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    const roleGroups = useMemo(() => {
        const sorted = [...group.users].sort((a, b) => {
            return (ROLE_CONFIG[a.role]?.order ?? 99) - (ROLE_CONFIG[b.role]?.order ?? 99);
        });
        const map = new Map<string, User[]>();
        for (const u of sorted) {
            if (!map.has(u.role)) map.set(u.role, []);
            map.get(u.role)!.push(u);
        }
        return map;
    }, [group.users]);

    const adminCount = group.users.filter(u => u.role === 'admin' || u.role === 'superadmin').length;
    const teacherCount = group.users.filter(u => u.role === 'teacher').length;
    const studentCount = group.users.filter(u => u.role === 'student').length;
    const otherCount = group.users.length - adminCount - teacherCount - studentCount;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="clay-card overflow-hidden"
        >
            {/* Card Header */}
            <div className="flex items-center">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex-1 flex items-center gap-4 p-5 hover:bg-gray-50/50 transition-colors text-left"
            >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md ${group.isCore
                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
                    : 'bg-gradient-to-br from-teal-600 to-emerald-500'
                    }`}>
                    {group.isCore
                        ? <Crown className="w-6 h-6 text-white" />
                        : <Building2 className="w-6 h-6 text-white" />
                    }
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg text-foreground truncate">{group.schoolName}</h3>
                        <span className="text-xs font-bold text-muted bg-gray-100 px-2.5 py-0.5 rounded-full flex-shrink-0">
                            {group.users.length} {group.users.length === 1 ? 'user' : 'users'}
                        </span>
                    </div>
                    {/* Summary pills */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {adminCount > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                {adminCount} Admin{adminCount > 1 ? 's' : ''}
                            </span>
                        )}
                        {teacherCount > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                                {teacherCount} Teacher{teacherCount > 1 ? 's' : ''}
                            </span>
                        )}
                        {studentCount > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                {studentCount} Student{studentCount > 1 ? 's' : ''}
                            </span>
                        )}
                        {otherCount > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                {otherCount} Other{otherCount > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-muted">
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </button>
            {!group.isCore && group.schoolId && onDeleteSchool && (
                <button
                    type="button"
                    onClick={() => onDeleteSchool(group.schoolId!, group.schoolName)}
                    className="mr-5 w-9 h-9 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    title="Permanently delete this school and all its data"
                    aria-label="Permanently delete school"
                >
                    <Trash2 className="w-4 h-4 mx-auto" />
                </button>
            )}
            </div>

            {/* Card Body */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="px-5 pb-5 pt-1 border-t border-gray-100">
                            <div className="mt-3 space-y-2">
                                {Array.from(roleGroups.entries()).map(([role, users]) => (
                                    <RoleSection key={role} role={role} users={users} onSelect={onSelectUser} />
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

/* ─── MAIN PAGE ────────────────────────────────────────── */
const UserManagement: React.FC = () => {
    const qc = useQueryClient();
    const { role: currentRole } = useAuth();
    const bundleQuery = useUserManagementData();
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showAddUser, setShowAddUser] = useState(false);
    const [schoolToDelete, setSchoolToDelete] = useState<{ id: string; name: string } | null>(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    const [deletingSchool, setDeletingSchool] = useState(false);
    const requestedRole = new URLSearchParams(window.location.search).get('newUser');

    useEffect(() => {
        if (requestedRole === 'teacher') setShowAddUser(true);
    }, [requestedRole]);

    const refetchAll = () => { qc.invalidateQueries({ queryKey: qk.userManagement }); };

    const deleteSchool = async () => {
        if (!schoolToDelete || deleteConfirmation !== 'CONFIRM') return;
        setDeletingSchool(true);
        try {
            const { data, error } = await supabase.functions.invoke('delete_school', { body: { schoolId: schoolToDelete.id, hard: true } });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Failed to permanently delete school'));
            if (data?.error) throw new Error(data.error);
            toast.success('School and all related data deleted.');
            setSchoolToDelete(null);
            setDeleteConfirmation('');
            refetchAll();
        } catch (error) {
            toast.error((error instanceof Error ? error.message : '') || 'Failed to permanently delete school.');
        } finally {
            setDeletingSchool(false);
        }
    };

    const bundle = bundleQuery.data;
    const schools = bundle?.schools ?? [];
    const permissions = bundle?.permissions ?? [];

    const users: User[] = useMemo(() => {
        if (!bundle) return [];
        const schoolMap = new Map(bundle.schools.map(s => [s.id, s.name]));
        return bundle.profiles.map((u): User => ({
            id: u.id,
            full_name: u.full_name,
            role: u.role,
            school_id: u.school_id,
            school_name: u.school_id ? (schoolMap.get(u.school_id) || 'Unknown') : 'Platform',
            status: u.is_active ? 'Active' : 'Disabled',
            is_active: u.is_active,
            metadata: u.metadata || {},
            updated_at: u.updated_at,
            email: u.email,
            avatar_url: u.avatar_url,
            recovery_email: u.recovery_email ?? null,
            recovery_email_verified: Boolean(u.recovery_email_verified),
        }));
    }, [bundle]);

    /* Group & filter */
    const schoolGroups = useMemo(() => {
        const filtered = users.filter(u =>
            (u.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.role.toLowerCase().includes(searchTerm.toLowerCase())
        );

        const map = new Map<string, SchoolGroup>();

        for (const user of filtered) {
            const key = user.school_id || 'core';
            if (!map.has(key)) {
                map.set(key, {
                    schoolId: user.school_id,
                    schoolName: user.school_id ? (user.school_name || 'Unknown School') : 'Core',
                    users: [],
                    isCore: !user.school_id,
                });
            }
            map.get(key)!.users.push(user);
        }

        // Sort: Core first, then schools alphabetically
        const groups = Array.from(map.values());
        groups.sort((a, b) => {
            if (a.isCore && !b.isCore) return -1;
            if (!a.isCore && b.isCore) return 1;
            return a.schoolName.localeCompare(b.schoolName);
        });

        return groups;
    }, [users, searchTerm]);

    const totalUsers = users.length;

    return (
        <div className="min-h-screen bg-[#FAF9F6] flex">
            <Sidebar activePage="Users" />

            <main className="flex-1 lg:ml-72 flex flex-col p-6 md:p-10">
                <Header title="User Management" />

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 mt-8">
                    <div>
                        <h2 className="text-xl font-bold text-foreground">All Users</h2>
                        <p className="text-muted mt-1 text-sm">
                            {totalUsers} users across {schoolGroups.filter(g => !g.isCore).length} school{schoolGroups.filter(g => !g.isCore).length !== 1 ? 's' : ''} and platform core
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="relative w-64 md:w-80">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                placeholder="Search name, email, or role..."
                                className="clay-input pl-11 w-full"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button
                            onClick={() => setShowAddUser(true)}
                            className="clay-btn flex items-center gap-2 py-2.5 px-4 text-sm whitespace-nowrap"
                        >
                            <span className="text-lg leading-none">+</span>
                            Add User
                        </button>
                    </div>
                </div>

                {/* Summary stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                    {[
                        { label: 'Total Users', value: totalUsers, icon: UsersIcon, color: 'text-primary', bg: 'bg-primary/10' },
                        { label: 'Admins', value: users.filter(u => u.role === 'admin' || u.role === 'superadmin').length, icon: ShieldCheck, color: 'text-amber-600', bg: 'bg-amber-50' },
                        { label: 'Teachers', value: users.filter(u => u.role === 'teacher').length, icon: BookOpen, color: 'text-sky-600', bg: 'bg-sky-50' },
                        { label: 'Students', value: users.filter(u => u.role === 'student').length, icon: GraduationCap, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                    ].map((stat, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.08 }}
                            className="clay-card p-4 flex items-center gap-3"
                        >
                            <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center flex-shrink-0`}>
                                <stat.icon className={`w-5 h-5 ${stat.color}`} />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                                <p className="text-[10px] font-bold text-muted uppercase tracking-widest">{stat.label}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>

                <QueryBoundary
                    query={{ ...bundleQuery, data: schoolGroups }}
                    isEmpty={(g) => g.length === 0}
                    emptyIcon={UsersIcon}
                    emptyTitle="No users found"
                    emptyDescription="Try adjusting your search term."
                    loadingRows={4}
                    loadingHeight={72}
                >
                    {(groups) => (
                        <div className="space-y-6">
                            {groups.map((group) => (
                                <SchoolCard
                                    key={group.schoolId || 'core'}
                                    group={group}
                                    onSelectUser={setSelectedUser}
                                    defaultExpanded={group.isCore || groups.length <= 3}
                                    onDeleteSchool={currentRole === 'superadmin' ? (id, name) => { setSchoolToDelete({ id, name }); setDeleteConfirmation(''); } : undefined}
                                />
                            ))}
                        </div>
                    )}
                </QueryBoundary>

                <UserDrawer
                    user={selectedUser}
                    isOpen={!!selectedUser}
                    onClose={() => setSelectedUser(null)}
                    schools={schools}
                    permissions={permissions}
                    onSaved={refetchAll}
                />

                <AddUserModal
                    isOpen={showAddUser}
                    onClose={() => setShowAddUser(false)}
                    schools={schools}
                    onCreated={refetchAll}
                    initialRole={requestedRole === 'teacher' ? 'teacher' : undefined}
                />

                <AnimatePresence>
                    {schoolToDelete && (
                        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
                            <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !deletingSchool && setSchoolToDelete(null)} className="absolute inset-0 bg-stone-950/45" aria-label="Close deletion confirmation" />
                            <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                                <h2 className="text-lg font-bold text-foreground">Permanently delete {schoolToDelete.name}?</h2>
                                <p className="mt-2 text-sm text-muted">This deletes the school, every user account, and all remaining school data. It cannot be undone.</p>
                                <label className="mt-5 block text-sm font-semibold text-foreground">Type <span className="font-mono">CONFIRM</span> to continue
                                    <input autoFocus value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} disabled={deletingSchool} className="clay-input mt-2 w-full" placeholder="CONFIRM" />
                                </label>
                                <div className="mt-5 flex justify-end gap-3">
                                    <button onClick={() => setSchoolToDelete(null)} disabled={deletingSchool} className="px-4 py-2 text-sm font-bold text-muted">Cancel</button>
                                    <button onClick={deleteSchool} disabled={deleteConfirmation !== 'CONFIRM' || deletingSchool} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{deletingSchool ? 'Deleting…' : 'Delete permanently'}</button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>


                <div className="mt-auto pt-10 text-center text-sm text-muted font-medium italic opacity-70">
                    © 2024 Kryin School. Administrative Controls Active.
                </div>
            </main>
        </div>
    );
};

export default UserManagement;
