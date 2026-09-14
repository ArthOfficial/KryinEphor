import React, { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Menu, X, ChevronLeft, ChevronRight, TimerReset, ClipboardPenLine, ChartNoAxesCombined, ArrowLeftRight, Lock } from 'lucide-react';
import {
    LayoutDashboard,
    Users,
    BookOpen,
    GraduationCap,
    Coins,
    Wallet,
    FileText,
    Settings,
    Bell,
    LogOut,
    School as SchoolIcon,
    AlertTriangle,
    Crown,
    CheckSquare,
    Database as DatabaseIcon
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { DASHBOARD_ROUTES, getRoleStyle } from '../../config/roles';

interface SidebarProps {
    activePage?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ activePage = 'Dashboard' }) => {
    const { user, role, roles, signOut, isTransitioning, switchDashboardRole, isStaffUnlocked, lockStaffMode } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem('sidebar:collapsed') === '1';
    });

    // Close drawer on route change
    useEffect(() => { setMobileOpen(false); }, [location.pathname]);

    // Lock body scroll when drawer is open
    useEffect(() => {
        document.body.style.overflow = mobileOpen ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [mobileOpen]);

    useEffect(() => {
        const openMobileMenu = () => setMobileOpen(true);
        window.addEventListener('sidebar:open-mobile-menu', openMobileMenu);
        return () => window.removeEventListener('sidebar:open-mobile-menu', openMobileMenu);
    }, []);

    // Sync desktop-collapsed state to <body> so pages can shrink their left offset via CSS
    useEffect(() => {
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        localStorage.setItem('sidebar:collapsed', collapsed ? '1' : '0');
    }, [collapsed]);

    // Map icon strings to components
    const iconMap: Record<string, LucideIcon> = {
        'LayoutDashboard': LayoutDashboard,
        'Database': DatabaseIcon,
        'Users': Users,
        'BookOpen': BookOpen,
        'GraduationCap': GraduationCap,
        'Coins': Coins,
        'Wallet': Wallet,
        'FileText': FileText,
        'Settings': Settings,
        'Bell': Bell,
        'School': SchoolIcon,
        'AlertTriangle': AlertTriangle,
        'CheckSquare': CheckSquare,
        'TimerReset': TimerReset,
        'ClipboardPenLine': ClipboardPenLine,
        'ChartNoAxesCombined': ChartNoAxesCombined
    };

    const activeRole = role || (roles.length > 0 ? roles[0] : null);
    const allowedRoutes = DASHBOARD_ROUTES.filter(route =>
        activeRole ? route.roles.includes(activeRole) : false
    );

    // Group routes for UI strictly by active role
    const menuGroups = (() => {
        if (activeRole === 'student') {
            return [
                {
                    title: "Overview",
                    items: allowedRoutes.filter(r => r.label === 'Dashboard')
                },
                {
                    title: "Student Portal",
                    items: [
                        { path: '/fees', label: 'Fees', icon: 'Coins' },
                        { path: '/tests', label: 'Tests', icon: 'FileText' },
                        { path: '/performance', label: 'Performance', icon: 'ChartNoAxesCombined' },
                        { path: '/focus', label: 'Focus Mode', icon: 'TimerReset' }
                    ]
                }
            ];
        }

        if (activeRole === 'parent') {
            return [
                {
                    title: "Overview",
                    items: allowedRoutes.filter(r => r.label === 'Dashboard')
                },
                {
                    title: "Parent Portal",
                    items: [
                        { path: '/fees', label: 'Fees', icon: 'Coins' },
                        { path: '/tests', label: 'Tests', icon: 'FileText' },
                        { path: '/performance', label: 'Performance', icon: 'ChartNoAxesCombined' }
                    ]
                }
            ];
        }

        return [
            {
                title: "Main Menu",
                items: allowedRoutes.filter(r => ['Dashboard', 'Database', 'Users'].includes(r.label))
            },
            {
                title: "Academics",
                items: [
                    ...allowedRoutes.filter(r => ['Classes', 'Attendance'].includes(r.label)),
                    ...(activeRole === 'admin' || activeRole === 'teacher'
                        ? [{ path: '/manage-tests', label: 'Tests', icon: 'FileText' }, { path: '/marks', label: 'Marks', icon: 'ClipboardPenLine' }]
                        : [])
                ]
            },
            {
                title: "Operations",
                items: allowedRoutes.filter(r => ['Finance', 'School Finance'].includes(r.label))
            },
            {
                title: "System",
                items: allowedRoutes.filter(r => ['System Alerts', 'Global Setup'].includes(r.label))
            }
        ].filter(g => g.items.length > 0);
    })();

    return (
        <>
            {/* Mobile hamburger trigger — bottom-right, hidden while drawer open */}
            {false && !mobileOpen && (
                <button
                    type="button"
                    onClick={() => setMobileOpen(true)}
                    aria-label="Open menu"
                    className="lg:hidden fixed bottom-5 right-5 z-[60] w-14 h-14 rounded-full bg-primary text-white shadow-xl shadow-teal-900/30 border border-teal-700/20 flex items-center justify-center active:scale-95 hover:scale-105 transition"
                >
                    <Menu className="w-6 h-6" />
                </button>
            )}



            {/* Mobile backdrop */}
            {mobileOpen && (
                <div
                    className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[55]"
                    onClick={() => setMobileOpen(false)}
                    aria-hidden="true"
                />
            )}

            <aside
                className={`fixed top-0 left-0 h-full ${collapsed ? 'lg:w-20' : 'lg:w-72'} w-72 max-w-[85vw] bg-[#FAF9F6]/95 backdrop-blur-xl border-r border-gray-200 z-[58] flex flex-col transform transition-[transform,width] duration-300 ease-out lg:translate-x-0 lg:z-50 ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
            >
                {/* Mobile close button */}
                <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close menu"
                    className="lg:hidden absolute top-5 right-5 w-10 h-10 rounded-xl bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:text-rose-500 flex items-center justify-center text-muted transition z-10"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Desktop collapse toggle */}
                <button
                    type="button"
                    onClick={() => setCollapsed(c => !c)}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    className="hidden lg:flex absolute -right-3 top-8 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-md items-center justify-center text-muted hover:text-primary hover:scale-110 transition z-10"
                >
                    {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                </button>

                <div className={`${collapsed ? 'p-4 lg:px-2' : 'p-6'} transition-all`}>
                    <Link to="/" className={`flex items-center gap-3 mb-8 ${collapsed ? 'lg:justify-center lg:px-0' : 'px-2'} group`}>
                        <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-teal-900/20 group-hover:scale-110 transition-transform shrink-0">
                            <GraduationCap className="text-white w-6 h-6" />
                        </div>
                        <span className={`font-semibold text-2xl tracking-tight text-foreground ${collapsed ? 'lg:hidden' : ''}`}>Kryin <span className="font-normal text-muted">School</span></span>
                    </Link>
                </div>

                <nav className={`flex-1 ${collapsed ? 'lg:px-2' : 'px-4'} py-2 space-y-6 overflow-y-auto custom-scroll`}>
                    {menuGroups.map((group, idx) => (
                        <div key={idx}>
                            <div className={`px-4 mb-2 text-xs font-bold text-muted uppercase tracking-widest opacity-80 ${collapsed ? 'lg:hidden' : ''}`}>
                                {group.title}
                            </div>
                            <div className="space-y-1">
                                {group.items.map((item, i) => {
                                    const Icon = iconMap[item.icon || 'LayoutDashboard'] || LayoutDashboard;
                                    const isActive = item.label === activePage || location.pathname === item.path;
                                    return (
                                        <Link
                                            key={i}
                                            to={item.path}
                                            onClick={() => setMobileOpen(false)}
                                            title={collapsed ? item.label : undefined}
                                            className={`nav-item flex items-center ${collapsed ? 'lg:justify-center lg:px-2' : 'justify-between px-4'} py-3 text-sm font-medium transition-all ${item.path === '/focus' ? 'bg-stone-950 text-white font-bold shadow-soft hover:bg-stone-800' : isActive ? 'active bg-white shadow-soft text-primary font-bold' : 'hover:bg-white/50 text-muted'}`}
                                        >
                                            <div className={`flex items-center gap-3 ${collapsed ? 'lg:gap-0' : ''}`}>
                                                <Icon className={`w-5 h-5 shrink-0 ${item.path === '/focus' ? 'text-white' : isActive ? 'text-primary' : 'text-muted'}`} />
                                                <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>

                <div className={`mt-auto ${collapsed ? 'p-3 lg:px-2' : 'p-6'} border-t border-gray-100`}>
                    {/* Role Switcher for Multi-role Accounts (e.g. Student <-> Parent or general multi-role) */}
                    {roles.length > 1 && (
                        <div className="mb-3">
                            {roles.includes('student') && roles.includes('parent') && roles.length === 2 ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = activeRole === 'student' ? 'parent' : 'student';
                                        switchDashboardRole(next);
                                        if (!['/dashboard', '/fees', '/tests', '/performance'].includes(location.pathname)) {
                                            navigate('/dashboard');
                                        }
                                    }}
                                    title={activeRole === 'student' ? 'Switch to Parent View' : 'Switch to Student View'}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-3 py-2'} rounded-2xl bg-gradient-to-r from-teal-500/10 via-emerald-500/10 to-teal-500/15 border border-teal-500/25 text-teal-900 hover:from-teal-500/20 hover:to-teal-500/25 hover:border-teal-500/50 hover:shadow-sm transition-all active:scale-[0.98] group`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-6 h-6 rounded-lg bg-teal-600/15 flex items-center justify-center text-teal-700 shrink-0 group-hover:rotate-180 transition-transform duration-300">
                                            <ArrowLeftRight className="w-3.5 h-3.5" />
                                        </div>
                                        {!collapsed && (
                                            <span className="text-xs font-bold truncate">
                                                {activeRole === 'student' ? 'Switch to Parent' : 'Switch to Student'}
                                            </span>
                                        )}
                                    </div>
                                    {!collapsed && (
                                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-md bg-white text-teal-800 border border-teal-200 shrink-0 shadow-xs">
                                            {activeRole === 'student' ? 'Parent' : 'Student'}
                                        </span>
                                    )}
                                </button>
                            ) : (
                                <div className="space-y-1.5">
                                    {!collapsed && (
                                        <div className="flex items-center justify-between px-1">
                                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Switch Role</span>
                                            <span className="text-[9px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100">
                                                {roles.length} roles
                                            </span>
                                        </div>
                                    )}
                                    <div className={`flex ${collapsed ? 'flex-col gap-1' : 'flex-wrap gap-1'}`}>
                                        {roles.map((r) => {
                                            const isCurrent = r === activeRole;
                                            const rStyle = getRoleStyle(r);
                                            const isTeacherLocked = r === 'teacher' && !isStaffUnlocked;
                                            return (
                                                <button
                                                    key={r}
                                                    type="button"
                                                    onClick={() => {
                                                        switchDashboardRole(r);
                                                        if (['/classes', '/users', '/attendance', '/marks', '/manage-tests', '/school-finance', '/finance', '/settings', '/global-setup', '/alerts', '/database'].includes(location.pathname) && (r === 'student' || r === 'parent')) {
                                                            navigate('/dashboard');
                                                        }
                                                    }}
                                                    title={`Switch view to ${rStyle.label}${isTeacherLocked ? ' (PIN required)' : ''}`}
                                                    className={`text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1 ${collapsed ? 'w-8 h-8' : 'px-2.5 py-1.5 flex-1 min-w-[65px] text-center'} ${
                                                        isCurrent
                                                            ? 'bg-primary text-white shadow-sm shadow-teal-900/20'
                                                            : 'bg-white/80 hover:bg-white text-stone-600 border border-stone-200/70 hover:border-teal-300'
                                                    }`}
                                                >
                                                    <span>{collapsed ? r.charAt(0).toUpperCase() : rStyle.label}</span>
                                                    {isTeacherLocked && !collapsed && (
                                                        <Lock className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {activeRole === 'teacher' && (
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                await lockStaffMode();
                                                navigate('/dashboard');
                                            }}
                                            title="Lock Teacher View"
                                            className={`w-full mt-2 flex items-center justify-center gap-1.5 ${collapsed ? 'p-2' : 'px-2.5 py-1.5'} rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 hover:bg-amber-100 text-xs font-bold transition-all shadow-xs`}
                                        >
                                            <Lock className="w-3 h-3 text-amber-700 shrink-0" />
                                            {!collapsed && <span>Lock Teacher View</span>}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <div className={`clay-card ${collapsed ? 'p-2 lg:justify-center' : 'p-4'} flex items-center gap-3 relative overflow-hidden group`}>
                        <div className="relative shrink-0">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-stone-800 to-stone-600 flex items-center justify-center text-white font-bold shadow-md">
                                {user?.fullName?.substring(0, 2).toUpperCase() || user?.email?.substring(0, 2).toUpperCase() || 'SC'}
                            </div>
                            {role === 'superadmin' && (
                                <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                                    <Crown className="w-3 h-3 text-amber-900" />
                                </div>
                            )}
                        </div>
                        <div className={`overflow-hidden flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
                            <div className="text-sm font-bold text-foreground truncate capitalize">{user?.fullName || user?.email?.split('@')[0] || 'System Core'}</div>
                            <div className="text-[10px] text-muted truncate uppercase font-bold tracking-wider">{role}</div>
                        </div>
                        <button
                            onClick={() => signOut()}
                            disabled={isTransitioning}
                            title="Logout"
                            className={`w-8 h-8 rounded-lg text-muted hover:text-rose-500 hover:bg-rose-50 transition-colors flex items-center justify-center disabled:opacity-50 shrink-0 ${collapsed ? 'lg:hidden' : ''}`}
                        >
                            {isTransitioning ? (
                                <div className="w-4 h-4 border-2 border-rose-500/20 border-t-rose-500 rounded-full animate-spin" />
                            ) : (
                                <LogOut className="w-4 h-4" />
                            )}
                        </button>
                        <div className="absolute inset-0 bg-primary opacity-0 group-hover:opacity-[0.02] transition-opacity pointer-events-none"></div>
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
