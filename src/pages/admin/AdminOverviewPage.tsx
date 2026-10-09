import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, formatMoney } from '../../lib/format';
import { Alert, Badge, Card, EmptyState, PageHeader } from '../../components/ui';
import { AdminFrame, LoadProblem, PageSkeleton, can, useGateSession } from './AdminShared';

export interface AdminDashboardView {
  generatedAt: string;
  timeZone: string;
  totals: {
    activeClients: number;
    openInvoices: number;
    overdueInvoices: number;
    awaitingReview: number;
    infoRequested: number;
    failedNotifications: number;
    notConfiguredNotifications: number;
  };
  outstandingByCurrency: { currency: string; invoices: number; billed: string; outstanding: string; outstandingFormatted: string }[];
  verifiedByCurrency: { currency: string; verified: string; refunded: string; net: string }[];
  monthlyNet: { month: string; currency: string; net: string }[];
  submissionsByStatus: { status: string; label: string; count: number }[];
  attention: { id: string; reference: string; clientName: string; invoiceNumber: string; waitingDays: number }[];
  recentActivity: { id: number; occurredAt: string; action: string; summary: string; actorType: string }[];
}

export function AdminOverviewPage() {
  return (
    <AdminFrame>
      <Overview />
    </AdminFrame>
  );
}

function Overview() {
  const session = useGateSession();
  const data = useAsync(() => api.get<AdminDashboardView>('/admin/dashboard'), []);
  if (data.loading) return <PageSkeleton />;
  if (data.error) return <LoadProblem error={data.error} onRetry={data.reload} />;
  const d = data.data;
  if (!d) return null;
  const t = d.totals;
  const maxNet = Math.max(1, ...d.monthlyNet.map((item) => Math.abs(Number(item.net))));
  return (
    <div className="page-enter space-y-8">
      <PageHeader title="Overview" description={`Figures are calculated from the database at ${formatDateTime(d.generatedAt)} (${d.timeZone}). Only verified payments count toward received totals.`} />

      {t.notConfiguredNotifications > 0 && (
        <Alert tone="warning" title="Email notifications are not configured.">
          {t.notConfiguredNotifications} notification{t.notConfiguredNotifications === 1 ? ' was' : 's were'} recorded as not configured. Nothing was emailed. Add SMTP settings to send them.
        </Alert>
      )}
      {t.failedNotifications > 0 && (
        <Alert tone="danger" title={`${t.failedNotifications} notification${t.failedNotifications === 1 ? '' : 's'} failed to send.`}>
          <Link to="/admin/notifications" className="font-medium underline">Review and retry</Link>
        </Alert>
      )}

      <section aria-labelledby="kpi" className="space-y-3">
        <h2 id="kpi" className="sr-only">Key figures</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Active clients" value={t.activeClients} />
          <Stat label="Open invoices" value={t.openInvoices} hint={`${t.overdueInvoices} overdue`} tone={t.overdueInvoices > 0 ? 'warning' : undefined} />
          <Stat label="Awaiting review" value={t.awaitingReview} hint={`${t.infoRequested} waiting for client information`} tone={t.awaitingReview > 0 ? 'info' : undefined} />
          <Stat label="Failed notifications" value={t.failedNotifications} tone={t.failedNotifications > 0 ? 'danger' : undefined} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <MoneyCard title="Outstanding" items={d.outstandingByCurrency.map((i) => ({ currency: i.currency, value: i.outstandingFormatted }))} />
          <MoneyCard title="Verified received" items={d.verifiedByCurrency.map((i) => ({ currency: i.currency, value: formatMoney(i.verified, i.currency) }))} />
          <MoneyCard title="Net after refunds" items={d.verifiedByCurrency.map((i) => ({ currency: i.currency, value: formatMoney(i.net, i.currency) }))} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Net verified receipts by month" className="xl:col-span-2" description="Verified payments minus recorded refunds.">
          {d.monthlyNet.length === 0 ? (
            <EmptyState title="No verified payments yet" />
          ) : (
            <div className="flex h-56 items-end gap-3" role="img" aria-label="Bar chart of net verified receipts by month and currency">
              {d.monthlyNet.map((item) => {
                const height = Math.max(4, Math.round((Math.abs(Number(item.net)) / maxNet) * 100));
                return (
                  <div key={`${item.month}-${item.currency}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <span className="text-center text-xs font-medium text-slate-700">{formatMoney(item.net, item.currency)}</span>
                    <div className="w-full max-w-14 rounded-t-lg bg-brand-600 transition-[height] duration-500 ease-out" style={{ height: `${height}%` }} />
                    <span className="text-xs text-slate-500">{item.month} · {item.currency}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="Submissions by status">
          <ul className="space-y-2">
            {d.submissionsByStatus.map((row) => (
              <li key={row.status} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{row.label}</span>
                <span className="font-semibold text-slate-900">{row.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Needs attention" description="Oldest confirmations waiting for a decision.">
          {d.attention.length === 0 ? (
            <EmptyState title="Nothing is waiting">New confirmations will appear here.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.attention.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{row.clientName}</p>
                    <p className="text-xs text-slate-500">{row.invoiceNumber} · {row.reference} · waiting {row.waitingDays} day{row.waitingDays === 1 ? '' : 's'}</p>
                  </div>
                  {can(session, 'payments:review') && (
                    <Link to={`/admin/submissions/${row.id}`} className="font-medium text-brand-700 hover:underline">Open</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent activity" description="From the audit log.">
          {d.recentActivity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recentActivity.map((row) => (
                <li key={row.id} className="py-3 text-sm">
                  <p className="text-slate-900">{row.summary}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(row.occurredAt)} · {row.actorType}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'warning' | 'danger' | 'info' }) {
  const ring = tone === 'danger' ? 'border-rose-200' : tone === 'warning' ? 'border-amber-200' : tone === 'info' ? 'border-blue-200' : 'border-slate-200';
  return (
    <div className={`rounded-2xl border ${ring} bg-white p-5 shadow-sm`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

function MoneyCard({ title, items }: { title: string; items: { currency: string; value: string }[] }) {
  return (
    <Card title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">None</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.currency} className="flex items-center justify-between text-sm">
              <Badge tone="info">{item.currency}</Badge>
              <span className="font-semibold text-slate-900">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

