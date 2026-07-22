import { useEffect, useMemo, useState } from 'react';
import StudentPortalLayout from '../components/student/StudentPortalLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

type Invoice = { id: string; invoice_number: string; amount: number; paid_amount: number | null; status: string; due_date: string | null; period_label: string | null };
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);

export default function StudentFees() {
  const { user } = useAuth(); const [invoices, setInvoices] = useState<Invoice[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { if (!user?.schoolId) return; supabase.from('invoices').select('id,invoice_number,amount,paid_amount,status,due_date,period_label').eq('school_id', user.schoolId).eq('student_id', user.id).is('deleted_at', null).order('due_date', { ascending: false }).then(({ data }) => { setInvoices((data ?? []) as Invoice[]); setLoading(false); }); }, [user?.id, user?.schoolId]);
  const summary = useMemo(() => invoices.reduce((total, item) => ({ billed: total.billed + Number(item.amount || 0), paid: total.paid + Number(item.paid_amount || 0) }), { billed: 0, paid: 0 }), [invoices]);
  return <StudentPortalLayout title="Fees"><div className="space-y-7">
    <section className="clay-card p-6 sm:p-8"><p className="text-sm font-bold text-primary">Fee overview</p><h1 className="mt-1 text-3xl font-bold text-foreground">Your school fees</h1><p className="mt-2 text-muted">See each fee record and its payment status.</p><div className="mt-6 grid gap-4 sm:grid-cols-3">{[['Total billed', summary.billed], ['Paid', summary.paid], ['Pending', Math.max(0, summary.billed - summary.paid)]].map(([label, amount]) => <div key={String(label)} className="rounded-2xl border border-border bg-white/65 p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p><p className="mt-2 text-2xl font-bold text-foreground">{money(Number(amount))}</p></div>)}</div></section>
    <section className="clay-card overflow-hidden"><div className="border-b border-border px-6 py-4"><h2 className="font-bold text-foreground">Fee records</h2></div>{loading ? <p className="p-6 text-muted">Loading fees…</p> : invoices.length === 0 ? <p className="p-6 text-muted">No fee records yet.</p> : <div className="divide-y divide-border">{invoices.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"><div><p className="font-bold text-foreground">{item.period_label || item.invoice_number}</p><p className="mt-1 text-sm text-muted">Due {item.due_date || 'not set'}</p></div><div className="text-right"><p className="font-bold text-foreground">{money(Number(item.amount))}</p><span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${item.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{item.status}</span></div></div>)}</div>}</section>
  </div></StudentPortalLayout>;
}
