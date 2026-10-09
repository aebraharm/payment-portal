import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { formatMoney, formatDate } from '../../lib/format';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader, StatCard } from '../../components/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmationStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { BarChart, DonutChart, LineChart } from '../../components/ui/Charts';
import {
  IconAlert,
  IconBell,
  IconCheck,
  IconClock,
  IconDoc,
  IconList,
  IconUsers,
  IconWallet,
} from '../../components/ui/Icons';

interface Stats {
  totals: { clients: number; invoices: number; openInvoices: number; confirmations: number };
  confirmationsByStatus: Record<string, number>;
  outstandingByCurrency: Array<{ currency: string; cents: number; formatted: string }>;
  verifiedByCurrency: Array<{ currency: string; cents: number; formatted: string }>;
  rejectedCount: number;
  pendingReview: number;
  attention: { pendingReview: number; overdueInvoices: number; suspendedClients: number; failedNotifications: number };
  activity: Array<{ day: string; n: number }>;
  recentConfirmations: Array<{
    id: number;
    status: string;
    currency: string;
    amount_sent_cents: number;
    amountFormatted: string;
    created_at: string;
    ref_code: string;
    invoice_ref: string;
    client_name: string;
  }>;
  recentAudit: Array<{
    id: number;
    actor_type: string;
    actor_id: number | null;
    action: string;
    entity: string | null;
    created_at: string;
  }>;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: '#8b5cf6',
  under_review: '#2563eb',
  verified: '#10b981',
  rejected: '#ef4444',
  info_requested: '#f59e0b',
};

export function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.get<Stats>('/api/admin/dashboard/stats');
        if (!cancelled) setStats(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <PageLoader label="Loading admin dashboard…" />;

  if (error || !stats) {
    return (
      <Alert tone="error" title="Unable to load dashboard">
        {error}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  const statusChart = Object.entries(stats.confirmationsByStatus).map(([status, n]) => ({
    label: status.replace(/_/g, ' '),
    value: n,
    color: STATUS_COLORS[status] || '#94a3b8',
  }));

  const outstandingChart = stats.outstandingByCurrency.map((c, i) => ({
    label: c.currency,
    value: c.cents,
    color: undefined,
  }));

  const verifiedTotal = stats.verifiedByCurrency.reduce((sum, c) => sum + c.cents, 0);
  const outstandingTotal = stats.outstandingByCurrency.reduce((sum, c) => sum + c.cents, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Dashboard" description="Overview of clients, invoices and payment activity." />

      {/* Attention items */}
      {(stats.attention.pendingReview > 0 || stats.attention.overdueInvoices > 0 || stats.attention.failedNotifications > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {stats.attention.pendingReview > 0 && (
            <Link to="/admin/transactions?status=submitted">
              <div className="card flex items-center gap-3 border-violet-200 bg-violet-50 p-4 transition-shadow hover:shadow-card-hover">
                <IconBell className="h-5 w-5 text-violet-600" />
                <div>
                  <p className="text-lg font-bold text-violet-900">{stats.attention.pendingReview}</p>
                  <p className="text-xs text-violet-700">payment confirmation(s) awaiting review</p>
                </div>
              </div>
            </Link>
          )}
          {stats.attention.overdueInvoices > 0 && (
            <Link to="/admin/invoices?status=unpaid">
              <div className="card flex items-center gap-3 border-amber-200 bg-amber-50 p-4 transition-shadow hover:shadow-card-hover">
                <IconClock className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-lg font-bold text-amber-900">{stats.attention.overdueInvoices}</p>
                  <p className="text-xs text-amber-700">overdue invoice(s)</p>
                </div>
              </div>
            </Link>
          )}
          {stats.attention.failedNotifications > 0 && (
            <Link to="/admin/security?tab=notifications">
              <div className="card flex items-center gap-3 border-red-200 bg-red-50 p-4 transition-shadow hover:shadow-card-hover">
                <IconAlert className="h-5 w-5 text-red-600" />
                <div>
                  <p className="text-lg font-bold text-red-900">{stats.attention.failedNotifications}</p>
                  <p className="text-xs text-red-700">failed notification(s)</p>
                </div>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clients" value={stats.totals.clients} icon={<IconUsers className="h-5 w-5 text-brand-600" />} />
        <StatCard
          label="Invoices"
          value={stats.totals.invoices}
          hint={`${stats.totals.openInvoices} open`}
          icon={<IconDoc className="h-5 w-5 text-brand-600" />}
        />
        <StatCard
          label="Outstanding"
          value={stats.outstandingByCurrency.length ? stats.outstandingByCurrency.map((c) => c.formatted).join(' + ') : '—'}
          hint={stats.outstandingByCurrency.length ? 'across open invoices' : 'nothing outstanding'}
          icon={<IconWallet className="h-5 w-5 text-amber-500" />}
          tone={outstandingTotal > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Verified payments"
          value={stats.verifiedByCurrency.length ? stats.verifiedByCurrency.map((c) => c.formatted).join(' + ') : '—'}
          hint={formatMoney(verifiedTotal, 'USD') !== '$0.00' ? 'total verified volume' : 'no verified payments yet'}
          icon={<IconCheck className="h-5 w-5 text-green-500" />}
          tone="success"
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Payments by status" description="All submitted payment confirmations." />
          {statusChart.length === 0 ? (
            <EmptyState icon={<IconList className="h-8 w-8" />} title="No payments yet" description="Confirmation statuses will appear here." />
          ) : (
            <BarChart data={statusChart} />
          )}
        </Card>
        <Card>
          <CardHeader title="Outstanding by currency" description="Open invoice balances." />
          {outstandingChart.length === 0 ? (
            <EmptyState icon={<IconWallet className="h-8 w-8" />} title="Nothing outstanding" description="All invoices are settled." />
          ) : (
            <DonutChart
              data={outstandingChart.map((d) => ({ ...d, value: d.value }))}
              centerLabel="open"
              centerValue={stats.outstandingByCurrency.length ? `${stats.outstandingByCurrency.length} cur.` : '0'}
            />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Payment activity" description="Confirmations submitted over the last 14 days." />
        <LineChart data={stats.activity.map((a) => ({ label: formatDate(a.day), value: a.n }))} />
      </Card>

      {/* Recent activity */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-0">
          <CardHeader
            title="Recent transactions"
            action={
              <Link to="/admin/transactions" className="link text-sm">
                View all
              </Link>
            }
          />
          {stats.recentConfirmations.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState icon={<IconList className="h-8 w-8" />} title="No transactions yet" />
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {stats.recentConfirmations.map((c) => (
                <Link
                  key={c.id}
                  to={`/admin/transactions/${c.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-brand-50/40"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">{c.ref_code}</span>
                      <ConfirmationStatusBadge status={c.status as never} />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600">
                      {c.client_name} · {c.invoice_ref}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-navy-900">{c.amountFormatted}</p>
                    <p className="text-xs text-slate-400">{formatDate(c.created_at)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-0">
          <CardHeader
            title="Recent audit activity"
            action={
              <Link to="/admin/security" className="link text-sm">
                View logs
              </Link>
            }
          />
          {stats.recentAudit.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState icon={<IconList className="h-8 w-8" />} title="No activity yet" />
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {stats.recentAudit.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-slate-400">
                      {log.actor_type}
                      {log.entity ? ` · ${log.entity}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{formatDate(log.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
