import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, Loader2, UserPlus, Receipt, AlertTriangle, MessageSquare } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useNotifications, qk, type NotificationRow } from '../../hooks/queries';

const iconFor = (type: string | null) => {
    switch (type) {
        case 'enrollment': return UserPlus;
        case 'payment': return Receipt;
        case 'overdue': return AlertTriangle;
        default: return MessageSquare;
    }
};

const tint = (type: string | null) => {
    switch (type) {
        case 'enrollment': return { bg: 'bg-emerald-50', fg: 'text-emerald-600' };
        case 'payment': return { bg: 'bg-sky-50', fg: 'text-sky-600' };
        case 'overdue': return { bg: 'bg-rose-50', fg: 'text-rose-600' };
        default: return { bg: 'bg-stone-100', fg: 'text-stone-600' };
    }
};

const timeAgo = (iso: string | null) => {
    if (!iso) return '';
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); return `${d}d ago`;
};

const NotificationsBell: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const [busyAll, setBusyAll] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    const notificationsQuery = useNotifications(user?.id);
    const items: NotificationRow[] = notificationsQuery.data ?? [];
    const loading = notificationsQuery.isLoading;

    const unread = useMemo(() => items.filter(i => !i.is_read).length, [items]);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, []);

    const patchLocal = (patcher: (rows: NotificationRow[]) => NotificationRow[]) => {
        if (!user?.id) return;
        qc.setQueryData<NotificationRow[]>(qk.notifications(user.id), (prev) =>
            patcher(prev ?? []),
        );
    };

    const markRead = async (id: string) => {
        patchLocal((rows) => rows.map(i => i.id === id ? { ...i, is_read: true } : i));
        await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    };

    const markAll = async () => {
        if (!user?.id || unread === 0) return;
        setBusyAll(true);
        patchLocal((rows) => rows.map(i => ({ ...i, is_read: true })));
        await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
        setBusyAll(false);
    };

    const handleClick = (n: NotificationRow) => {
        if (!n.is_read) markRead(n.id);
        if (n.action_url) { setOpen(false); navigate(n.action_url); }
    };

    return (
        <div className="relative" ref={wrapRef}>
            <button
                onClick={() => setOpen(v => !v)}
                className="relative w-10 h-10 rounded-xl bg-white flex items-center justify-center text-primary shadow-sm border border-gray-200 hover:bg-teal-50 transition-colors"
                aria-label="Notifications"
            >
                <Bell className="w-5 h-5" />
                {unread > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-[380px] max-w-[95vw] bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden z-50"
                    >
                        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
                            <div>
                                <div className="text-sm font-bold text-foreground">Notifications</div>
                                <div className="text-[11px] text-muted">{unread > 0 ? `${unread} unread` : 'All caught up'}</div>
                            </div>
                            <button
                                onClick={markAll}
                                disabled={unread === 0 || busyAll}
                                className="text-[11px] font-bold text-primary hover:underline disabled:opacity-40 disabled:no-underline flex items-center gap-1"
                            >
                                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                            </button>
                        </div>

                        <div className="max-h-[420px] overflow-y-auto">
                            {loading ? (
                                <div className="flex items-center justify-center py-10 text-muted">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                </div>
                            ) : items.length === 0 ? (
                                <div className="py-14 text-center px-6">
                                    <Bell className="w-8 h-8 mx-auto text-stone-300 mb-2" />
                                    <p className="text-sm font-semibold text-stone-600">No notifications yet</p>
                                    <p className="text-xs text-muted mt-1">New enrollments, payments and alerts will appear here.</p>
                                </div>
                            ) : (
                                items.map(n => {
                                    const Icon = iconFor(n.type);
                                    const t = tint(n.type);
                                    return (
                                        <button
                                            key={n.id}
                                            onClick={() => handleClick(n)}
                                            className={`w-full text-left px-5 py-3.5 flex gap-3 hover:bg-stone-50 transition-colors border-l-2 ${n.is_read ? 'border-transparent' : 'border-primary bg-primary/[0.02]'}`}
                                        >
                                            <div className={`w-9 h-9 rounded-xl ${t.bg} ${t.fg} flex items-center justify-center flex-shrink-0`}>
                                                <Icon className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="text-sm font-bold text-foreground truncate">{n.title}</p>
                                                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                                                </div>
                                                <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.message}</p>
                                                <p className="text-[10px] text-stone-400 mt-1 font-medium">{timeAgo(n.created_at)}</p>
                                            </div>
                                            {!n.is_read && (
                                                <span
                                                    onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                                                    className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-primary"
                                                    title="Mark as read"
                                                >
                                                    <Check className="w-3.5 h-3.5" />
                                                </span>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default NotificationsBell;
