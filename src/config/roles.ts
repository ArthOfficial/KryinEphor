export type UserRole = 'superadmin' | 'admin' | 'teacher' | 'student' | 'parent' | 'receptionist' | 'accountant';

export interface RouteConfig {
    path: string;
    label: string;
    icon?: string;
    roles: UserRole[];
    keywords?: string[];
}

// ─────────────────────────────────────────────────────────────
// 📝 Author: Narco / Arth
// 🔗 GitHub: https://github.com/ArthOfficial
// 🌐 Website: https://arth-hub.vercel.app
// © 2026 Arth — All rights reserved.
// ─────────────────────────────────────────────────────────────

export const DASHBOARD_ROUTES: RouteConfig[] = [
    { path: '/super-admin', label: 'Dashboard', icon: 'LayoutDashboard', roles: ['superadmin'], keywords: ['overview', 'home', 'main', 'status'] },
    { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard', roles: ['admin', 'teacher', 'student', 'parent', 'receptionist', 'accountant'], keywords: ['overview', 'home', 'main'] },
    { path: '/database', label: 'Database', icon: 'Database', roles: ['superadmin'], keywords: ['tenant', 'schema', 'tables', 'school', 'data', 'infrastructure'] },
    { path: '/users', label: 'Users', icon: 'Users', roles: ['superadmin', 'admin', 'receptionist'], keywords: ['admin', 'users', 'staff', 'management', 'accounts', 'recovery', 'otp'] },
    { path: '/finance', label: 'Finance', icon: 'Coins', roles: ['superadmin'], keywords: ['billing', 'payments', 'fees', 'money', 'invoice', 'revenue'] },
    { path: '/school-finance', label: 'School Finance', icon: 'Wallet', roles: ['admin', 'accountant'], keywords: ['fees', 'salary', 'invoice', 'receipt', 'payroll', 'dues', 'collection'] },
    { path: '/classes', label: 'Classes', icon: 'GraduationCap', roles: ['admin', 'teacher', 'receptionist', 'accountant'], keywords: ['class', 'section', 'roster', 'students', 'subjects', 'grade', 'principal'] },
    { path: '/attendance', label: 'Attendance', icon: 'CheckSquare', roles: ['admin', 'teacher'], keywords: ['presence', 'absence', 'roll', 'students', 'records'] },
    { path: '/alerts', label: 'System Alerts', icon: 'AlertTriangle', roles: ['superadmin', 'admin'], keywords: ['logs', 'errors', 'notifications', 'status', 'health', 'system'] },
    { path: '/settings', label: 'Global Setup', icon: 'Settings', roles: ['superadmin', 'admin'], keywords: ['permissions', 'roles', 'config', 'setup', 'school', 'module', 'system'] },
];
