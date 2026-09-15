import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    GraduationCap,
    Users as UsersIcon,
    BookOpen,
    Shield,
    Lock,
    ChevronDown,
    Check,
    ArrowLeftRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { UserRole } from '../../config/roles';

interface PersonaSwitcherProps {
    variant?: 'sidebar' | 'header';
    collapsed?: boolean;
}

export const PersonaSwitcher: React.FC<PersonaSwitcherProps> = ({
    variant = 'sidebar',
    collapsed = false
}) => {
    const {
        role,
        roles,
        linkedStudents,
        activeStudentId,
        setActiveStudentId,
        switchDashboardRole,
        isStaffUnlocked,
        lockStaffMode,
        openStaffPinModal
    } = useAuth();

    const navigate = useNavigate();
    const location = useLocation();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Check which workspaces are available
    const hasFamilyWorkspaces = roles.includes('student') || roles.includes('parent');
    const hasWorkWorkspaces = roles.some(r => ['teacher', 'admin', 'superadmin', 'accountant', 'receptionist'].includes(r));

    // Handle switching to a specific role/workspace
    const handleSelectRole = (nextRole: UserRole, studentId?: string) => {
        if (studentId) {
            setActiveStudentId(studentId);
        }

        if (nextRole === 'teacher' && !isStaffUnlocked) {
            setDropdownOpen(false);
            openStaffPinModal();
            return;
        }

        switchDashboardRole(nextRole);
        setDropdownOpen(false);

        // Auto-redirect to dashboard if current route is not accessible in next role
        if (['/classes', '/users', '/attendance', '/marks', '/manage-tests', '/school-finance', '/finance', '/settings', '/global-setup', '/alerts', '/database'].includes(location.pathname) && (nextRole === 'student' || nextRole === 'parent')) {
            navigate('/dashboard');
        }
    };

    // Label for current workspace
    const getCurrentWorkspaceLabel = () => {
        if (role === 'student') {
            const activeChild = linkedStudents.find(s => s.studentId === activeStudentId) || linkedStudents[0];
            return activeChild ? `${activeChild.fullName} (Student)` : 'Student View';
        }
        if (role === 'parent') return 'Parent Dashboard';
        if (role === 'teacher') return 'Teacher Dashboard';
        if (role === 'admin') return 'School Admin';
        if (role === 'superadmin') return 'Super Admin';
        return 'Workspace';
    };

    // Quick toggle for 2-role Student <-> Parent accounts
    const isPureStudentParent = roles.includes('student') && roles.includes('parent') && roles.length === 2;

    if (roles.length <= 1 && linkedStudents.length <= 1) {
        return null;
    }

    /* ─── VARIANT: SIDEBAR ─────────────────────────────────── */
    if (variant === 'sidebar') {
        if (isPureStudentParent) {
            return (
                <div className="mb-3">
                    <button
                        type="button"
                        onClick={() => {
                            const next = role === 'student' ? 'parent' : 'student';
                            handleSelectRole(next);
                        }}
                        title={role === 'student' ? 'Switch to Parent View' : 'Switch to Student View'}
                        className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-3 py-2'} rounded-2xl bg-gradient-to-r from-teal-500/10 via-emerald-500/10 to-teal-500/15 border border-teal-500/25 text-teal-900 hover:from-teal-500/20 hover:to-teal-500/25 hover:border-teal-500/50 hover:shadow-sm transition-all active:scale-[0.98] group`}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-lg bg-teal-600/15 flex items-center justify-center text-teal-700 shrink-0 group-hover:rotate-180 transition-transform duration-300">
                                <ArrowLeftRight className="w-3.5 h-3.5" />
                            </div>
                            {!collapsed && (
                                <span className="text-xs font-bold truncate">
                                    {role === 'student' ? 'Switch to Parent' : 'Switch to Student'}
                                </span>
                            )}
                        </div>
                        {!collapsed && (
                            <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-md bg-white text-teal-800 border border-teal-200 shrink-0 shadow-2xs">
                                {role === 'student' ? 'Parent' : 'Student'}
                            </span>
                        )}
                    </button>
                </div>
            );
        }

        return (
            <div className="mb-3 space-y-2">
                {!collapsed && (
                    <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Workspace Mode</span>
                        <span className="text-[9px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100">
                            {roles.length} Views
                        </span>
                    </div>
                )}

                {/* FAMILY SECTION */}
                {hasFamilyWorkspaces && (
                    <div className="space-y-1">
                        {!collapsed && (
                            <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400 px-1 pt-1">
                                Family
                            </div>
                        )}
                        <div className="space-y-1">
                            {/* Student Persona(s) */}
                            {roles.includes('student') && (
                                linkedStudents.length > 1 ? (
                                    linkedStudents.map((child) => {
                                        const isCurrent = role === 'student' && (activeStudentId === child.studentId || (!activeStudentId && child.isPrimary));
                                        return (
                                            <button
                                                key={child.studentId}
                                                type="button"
                                                onClick={() => handleSelectRole('student', child.studentId)}
                                                className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                                    isCurrent
                                                        ? 'bg-emerald-600 text-white font-bold shadow-xs'
                                                        : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-emerald-300'
                                                }`}
                                            >
                                                <div className="flex items-center gap-1.5 truncate">
                                                    <GraduationCap className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-white' : 'text-emerald-700'}`} />
                                                    {!collapsed && <span className="truncate">{child.fullName}</span>}
                                                </div>
                                                {!collapsed && (
                                                    <span className={`text-[9px] uppercase px-1 rounded ${isCurrent ? 'bg-emerald-700 text-emerald-100' : 'text-stone-400'}`}>
                                                        Student
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectRole('student')}
                                        className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                            role === 'student'
                                                ? 'bg-emerald-600 text-white font-bold shadow-xs'
                                                : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-emerald-300'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 truncate">
                                            <GraduationCap className={`w-3.5 h-3.5 shrink-0 ${role === 'student' ? 'text-white' : 'text-emerald-700'}`} />
                                            {!collapsed && (
                                                <span className="truncate">
                                                    {linkedStudents[0] ? `${linkedStudents[0].fullName} — Student` : 'Student View'}
                                                </span>
                                            )}
                                        </div>
                                        {!collapsed && role === 'student' && (
                                            <Check className="w-3 h-3 text-white shrink-0" />
                                        )}
                                    </button>
                                )
                            )}

                            {/* Parent Dashboard */}
                            {roles.includes('parent') && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole('parent')}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                        role === 'parent'
                                            ? 'bg-teal-700 text-white font-bold shadow-xs'
                                            : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-teal-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        <UsersIcon className={`w-3.5 h-3.5 shrink-0 ${role === 'parent' ? 'text-white' : 'text-teal-700'}`} />
                                        {!collapsed && <span className="truncate">Parent Dashboard</span>}
                                    </div>
                                    {!collapsed && role === 'parent' && (
                                        <Check className="w-3 h-3 text-white shrink-0" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* WORK / STAFF SECTION */}
                {hasWorkWorkspaces && (
                    <div className="space-y-1 pt-1">
                        {!collapsed && (
                            <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400 px-1 pt-1">
                                Work
                            </div>
                        )}
                        <div className="space-y-1">
                            {/* Teacher Workspace */}
                            {roles.includes('teacher') && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole('teacher')}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                        role === 'teacher'
                                            ? 'bg-amber-600 text-white font-bold shadow-xs'
                                            : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-amber-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        <BookOpen className={`w-3.5 h-3.5 shrink-0 ${role === 'teacher' ? 'text-white' : 'text-amber-700'}`} />
                                        {!collapsed && <span className="truncate">Teacher Dashboard</span>}
                                    </div>
                                    {!collapsed && (
                                        role === 'teacher' ? (
                                            <div className="flex items-center gap-1">
                                                <span className="text-[9px] bg-amber-700 px-1 rounded text-white">Active</span>
                                            </div>
                                        ) : !isStaffUnlocked ? (
                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                                <Lock className="w-2.5 h-2.5" /> PIN
                                            </span>
                                        ) : null
                                    )}
                                </button>
                            )}

                            {/* Admin Workspace */}
                            {(roles.includes('admin') || roles.includes('superadmin')) && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole(roles.includes('superadmin') ? 'superadmin' : 'admin')}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                        role === 'admin' || role === 'superadmin'
                                            ? 'bg-indigo-700 text-white font-bold shadow-xs'
                                            : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-indigo-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        <Shield className={`w-3.5 h-3.5 shrink-0 ${role === 'admin' || role === 'superadmin' ? 'text-white' : 'text-indigo-700'}`} />
                                        {!collapsed && (
                                            <span className="truncate">
                                                {roles.includes('superadmin') ? 'Super Admin' : 'School Admin'}
                                            </span>
                                        )}
                                    </div>
                                    {!collapsed && (role === 'admin' || role === 'superadmin') && (
                                        <Check className="w-3 h-3 text-white shrink-0" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    /* ─── VARIANT: HEADER DROPDOWN ─────────────────────────── */
    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-stone-800 border border-stone-200 hover:border-teal-400 hover:shadow-xs transition-all text-xs font-bold"
            >
                <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                <span className="truncate max-w-[140px]">{getCurrentWorkspaceLabel()}</span>
                <ChevronDown className={`w-3 h-3 text-stone-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-xl border border-stone-200/90 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden">
                    <div className="px-3 pb-2 border-b border-stone-100 flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-stone-400">Switch Workspace</span>
                        {role === 'teacher' && (
                            <button
                                type="button"
                                onClick={() => {
                                    lockStaffMode();
                                    setDropdownOpen(false);
                                    navigate('/dashboard');
                                }}
                                className="text-[10px] font-bold text-amber-700 hover:underline flex items-center gap-1"
                            >
                                <Lock className="w-2.5 h-2.5" /> Lock Staff
                            </button>
                        )}
                    </div>

                    {/* FAMILY WORKSPACES */}
                    {hasFamilyWorkspaces && (
                        <div className="px-2 py-1.5">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400 px-2 py-1">
                                Family
                            </div>
                            {roles.includes('student') && (
                                linkedStudents.length > 1 ? (
                                    linkedStudents.map(child => (
                                        <button
                                            key={child.studentId}
                                            type="button"
                                            onClick={() => handleSelectRole('student', child.studentId)}
                                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                                                role === 'student' && activeStudentId === child.studentId
                                                    ? 'bg-emerald-50 text-emerald-900 font-bold'
                                                    : 'hover:bg-stone-50 text-stone-700'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 truncate">
                                                <GraduationCap className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                                <span className="truncate">{child.fullName}</span>
                                            </div>
                                            {role === 'student' && activeStudentId === child.studentId && (
                                                <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                                            )}
                                        </button>
                                    ))
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectRole('student')}
                                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                                            role === 'student' ? 'bg-emerald-50 text-emerald-900 font-bold' : 'hover:bg-stone-50 text-stone-700'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 truncate">
                                            <GraduationCap className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                            <span className="truncate">{linkedStudents[0]?.fullName ? `${linkedStudents[0].fullName} — Student` : 'Student View'}</span>
                                        </div>
                                        {role === 'student' && <Check className="w-3 h-3 text-emerald-600 shrink-0" />}
                                    </button>
                                )
                            )}

                            {roles.includes('parent') && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole('parent')}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                                        role === 'parent' ? 'bg-teal-50 text-teal-900 font-bold' : 'hover:bg-stone-50 text-stone-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <UsersIcon className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                                        <span>Parent Dashboard</span>
                                    </div>
                                    {role === 'parent' && <Check className="w-3 h-3 text-teal-600 shrink-0" />}
                                </button>
                            )}
                        </div>
                    )}

                    {/* WORK WORKSPACES */}
                    {hasWorkWorkspaces && (
                        <div className="px-2 py-1.5 border-t border-stone-100">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400 px-2 py-1">
                                Work
                            </div>

                            {roles.includes('teacher') && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole('teacher')}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                                        role === 'teacher' ? 'bg-amber-50 text-amber-900 font-bold' : 'hover:bg-stone-50 text-stone-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <BookOpen className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                        <span>Teacher Dashboard</span>
                                    </div>
                                    {role === 'teacher' ? (
                                        <Check className="w-3 h-3 text-amber-600 shrink-0" />
                                    ) : !isStaffUnlocked ? (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                            <Lock className="w-2.5 h-2.5" /> PIN
                                        </span>
                                    ) : null}
                                </button>
                            )}

                            {(roles.includes('admin') || roles.includes('superadmin')) && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole(roles.includes('superadmin') ? 'superadmin' : 'admin')}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                                        role === 'admin' || role === 'superadmin' ? 'bg-indigo-50 text-indigo-900 font-bold' : 'hover:bg-stone-50 text-stone-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <Shield className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                        <span>{roles.includes('superadmin') ? 'Super Admin' : 'School Admin'}</span>
                                    </div>
                                    {(role === 'admin' || role === 'superadmin') && (
                                        <Check className="w-3 h-3 text-indigo-600 shrink-0" />
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
