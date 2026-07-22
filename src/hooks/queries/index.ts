/**
 * Shared React Query hooks.
 *
 * Every hook here owns a stable queryKey so React Query dedupes concurrent
 * calls, caches results across mounts (staleTime), and refetches
 * predictably on mutation via `queryClient.invalidateQueries`.
 *
 * QueryClient defaults (see src/main.tsx):
 *   staleTime: 30s · gcTime: 5m · refetchOnWindowFocus: false · retry: 1
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../../lib/supabase';

// ── keys ─────────────────────────────────────────────────────────────────────
export const qk = {
    schoolsSummary: ['schools-summary'] as const,
    adminDashboardStats: ['admin-dashboard-stats'] as const,
    superAdminMetrics: ['super-admin-metrics'] as const,
    notifications: (userId: string) => ['notifications', userId] as const,
    dashboardActivity: (userId: string) => ['dashboard-activity', userId] as const,
    userManagement: ['user-management-bundle'] as const,
    invoicesPage: (schoolId: string, status: string, q: string, page: number, pageSize: number) =>
        ['invoices', schoolId, status, q, page, pageSize] as const,
    receiptsPage: (schoolId: string, q: string, page: number, pageSize: number) =>
        ['receipts', schoolId, q, page, pageSize] as const,
    schoolStudents: (schoolId: string) => ['school-students', schoolId] as const,
};

// ── super-admin: schools summary view ────────────────────────────────────────
export interface SchoolSummaryRow {
    id: string;
    name: string;
    subdomain: string | null;
    email_domain: string | null;
    subscription_tier: string | null;
    status: string | null;
    created_at: string | null;
    max_students: number | null;
    student_count: number;
    admin_count: number;
    revenue: number;
    admin_id: string | null;
    admin_email: string | null;
    admin_name: string | null;
    [key: string]: unknown;
}

export function useSchoolsSummary() {
    return useQuery({
        queryKey: qk.schoolsSummary,
        queryFn: async (): Promise<SchoolSummaryRow[]> => {
            const { data, error } = await supabase
                .from('school_summary_metrics' as never)
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return ((data as unknown as SchoolSummaryRow[]) ?? [])
                .map((s) => ({
                    ...s,
                    student_count: Number(s.student_count) || 0,
                    revenue: Number(s.revenue) || 0,
                    admin_email: s.admin_email || 'No admin assigned',
                    admin_name: s.admin_name || '',
                }))
                // Security: drop schools without a domain, or where the admin
                // email doesn't match the school's domain.
                .filter((s) => {
                    if (!s.email_domain) return false;
                    if (!s.admin_email || s.admin_email === 'No admin assigned') return true;
                    return String(s.admin_email).toLowerCase()
                        .endsWith('@' + String(s.email_domain).toLowerCase());
                });
        },
    });
}

// ── admin dashboard RPC ──────────────────────────────────────────────────────
export interface AdminDashboardStats {
    students: number;
    teachers: number;
    classes: number;
    month_revenue: number;
    pending_amount: number;
    overdue_amount: number;
    paid_invoices: number;
    pending_invoices: number;
    collection_pct: number;
    top_payers: { name: string; student_id: string; total_paid: number }[];
}

export function useAdminDashboardStats(enabled = true) {
    return useQuery({
        queryKey: qk.adminDashboardStats,
        enabled,
        queryFn: async (): Promise<AdminDashboardStats | null> => {
            const { data, error } = await supabase.rpc('fn_admin_dashboard_stats' as never);
            if (error) throw error;
            return (data as unknown as AdminDashboardStats) ?? null;
        },
    });
}

// ── super-admin dashboard metrics rollup ─────────────────────────────────────
export interface DashboardMetricRow {
    metric_key: string;
    metric_value: number;
    previous_value: number | null;
    updated_at: string | null;
}

export function useSuperAdminMetrics(enabled = true) {
    return useQuery({
        queryKey: qk.superAdminMetrics,
        enabled,
        queryFn: async (): Promise<DashboardMetricRow[]> => {
            const { data, error } = await supabase
                .from('dashboard_metrics')
                .select('metric_key,metric_value,previous_value,updated_at')
                .is('school_id', null);
            if (error) throw error;
            return (data as DashboardMetricRow[]) ?? [];
        },
    });
}

// ── notifications feed (per user) ────────────────────────────────────────────
export interface NotificationRow {
    id: string;
    title: string;
    message: string;
    type: string | null;
    is_read: boolean | null;
    action_url: string | null;
    created_at: string | null;
}

export function useNotifications(userId: string | undefined | null, limit = 30) {
    const qc = useQueryClient();
    const query = useQuery({
        queryKey: userId ? qk.notifications(userId) : ['notifications', 'anon'],
        enabled: !!userId,
        queryFn: async (): Promise<NotificationRow[]> => {
            const { data, error } = await supabase
                .from('notifications')
                .select('id,title,message,type,is_read,action_url,created_at')
                .eq('user_id', userId!)
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            return (data as NotificationRow[]) ?? [];
        },
    });

    // Realtime: invalidate on any change to this user's notifications.
    useEffect(() => {
        if (!userId) return;
        const channel = supabase
            .channel(`notifications-live:${userId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
                () => { qc.invalidateQueries({ queryKey: qk.notifications(userId) }); },
            )
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [userId, qc]);

    return query;
}

// ── user management bundle (profiles + schools + permissions) ────────────────
export interface UMProfile {
    id: string; full_name: string | null; role: string; school_id: string | null;
    is_active: boolean; metadata: unknown; updated_at: string; email: string;
    avatar_url: string | null; recovery_email: string | null; recovery_email_verified: boolean | null;
}
export interface UMSchool { id: string; name: string; email_domain: string | null; combined_parent_student_account: boolean; }
export interface UMPermission { id: string; [k: string]: unknown; }

export function useUserManagementData() {
    return useQuery({
        queryKey: qk.userManagement,
        queryFn: async () => {
            const [profilesRes, schoolsRes, permsRes] = await Promise.all([
                supabase.from('profiles').select('id,full_name,role,school_id,is_active,metadata,updated_at,email,avatar_url,recovery_email,recovery_email_verified'),
                supabase.from('schools').select('id, name, email_domain, combined_parent_student_account').is('deleted_at', null),
                supabase.from('permissions').select('*'),
            ]);
            if (profilesRes.error) throw profilesRes.error;
            if (schoolsRes.error) throw schoolsRes.error;
            if (permsRes.error) throw permsRes.error;
            return {
                profiles: (profilesRes.data ?? []) as UMProfile[],
                schools: (schoolsRes.data ?? []) as UMSchool[],
                permissions: (permsRes.data ?? []) as UMPermission[],
            };
        },
    });
}

// ── invoices with server-side pagination ─────────────────────────────────────
export interface InvoiceRow {
    id: string; invoice_number: string | null; student_id: string | null;
    amount: number; paid_amount: number | null; late_fee: number | null;
    status: string; due_date: string; period_label: string | null;
    created_at: string; discount: number | null;
}

export function useInvoicesPage(
    schoolId: string,
    status: string,
    q: string,
    page: number,
    pageSize = 50,
) {
    return useQuery({
        queryKey: qk.invoicesPage(schoolId, status, q, page, pageSize),
        enabled: !!schoolId,
        placeholderData: (prev) => prev,
        queryFn: async () => {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let query: any = supabase
                .from('invoices')
                .select(
                    'id,invoice_number,student_id,amount,paid_amount,late_fee,status,due_date,period_label,created_at,discount',
                    { count: 'exact' },
                )
                .eq('school_id', schoolId)
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .range(from, to);
            if (status !== 'all') query = query.eq('status', status);
            if (q) query = query.ilike('invoice_number', `%${q}%`);
            const { data, count, error } = await query;
            if (error) throw error;
            return { rows: (data ?? []) as InvoiceRow[], total: count ?? 0 };
        },
    });
}

// ── receipts (payment transactions) with server-side pagination ──────────────
export interface ReceiptRow {
    id: string; invoice_id: string | null; student_id: string | null; amount: number;
    payment_method: string | null; reference_number: string | null; created_at: string; type: string;
}

export function useReceiptsPage(schoolId: string, q: string, page: number, pageSize = 50) {
    return useQuery({
        queryKey: qk.receiptsPage(schoolId, q, page, pageSize),
        enabled: !!schoolId,
        placeholderData: (prev) => prev,
        queryFn: async () => {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let query: any = supabase
                .from('transactions')
                .select(
                    'id,invoice_id,student_id,amount,payment_method,reference_number,created_at,type',
                    { count: 'exact' },
                )
                .eq('school_id', schoolId)
                .eq('type', 'payment')
                .order('created_at', { ascending: false })
                .range(from, to);
            if (q) query = query.ilike('reference_number', `%${q}%`);
            const { data, count, error } = await query;
            if (error) throw error;
            return { rows: (data ?? []) as ReceiptRow[], total: count ?? 0 };
        },
    });
}

// ── school students (cached lookup for invoices/receipts joins) ──────────────
export function useSchoolStudents(schoolId: string) {
    return useQuery({
        queryKey: qk.schoolStudents(schoolId),
        enabled: !!schoolId,
        staleTime: 60_000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id,full_name,email')
                .eq('school_id', schoolId)
                .limit(2000);
            if (error) throw error;
            return (data ?? []) as { id: string; full_name: string | null; email: string }[];
        },
    });
}
