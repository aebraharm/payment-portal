import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useClientAuth } from '../../context/ClientAuthContext';
import { useBranding } from '../../context/BrandingContext';
import { formatMoney, formatDate, daysUntil } from '../../lib/format';
import { InvoiceStatusBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { StatCard } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import {
  IconBell,
  IconClock,
  IconDoc,
  IconMail,
  IconPhone,
  IconPin,
  IconWallet,
} from '../../components/ui/Icons';

interface DashboardData {
  client: { id: number; clientCode: string; fullName: string; email: string | null };
  welcomeMessage: string;
  outstandingInvoices: Array<{
    id: number;
    invoiceRef: string;
    description: string;
    amountCents: number;
    amountFormatted: string;
    currency: string;
    dueDate: string;
    status: string;
  }>;
  outstandingTotals: Array<{ currency: string; cents: number; formatted: string }>;
  recentConfirmations: Array<{
    id: number;
    refCode: string;
    invoiceRef: string;
    status: string;
    amountSentFormatted: string;
    currency: string;
    createdAt: string;
  }>;
  statusUpdates: Array<{
    id: number;
    confirmation_id: number;
    ref_code: string;
    status: string;
    note: string | null;
    created_at: string;
  }>;
  support: { email: string; phone: string; whatsapp: string; officeAddress: string };
  currencies: Array<{ code: string; name: string; symbol: string }>;
}

export function ClientDashboard() {
  const { client } = useClientAuth();
  const { branding } = useBranding();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.get<DashboardData>('/api/client/dashboard');
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load your dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <PageLoader label="Loading your client dashboard…" />;
  if (error || !data) {
    return (
      <Alert tone="error" title="Unable to load your dashboard">
        {error || 'Please try again.'}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  const firstName = client?.fullName.split(' ')[0] || client?.fullName;
  const overdue = data.outstandingInvoices.filter((inv) => daysUntil(inv.dueDate) < 0);
  const nextDue = data.outstandingInvoices[0];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Greeting */}
      <div className="card flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">Welcome back,</p>
          <h1 className="text-2xl font-bold tracking-tight">
            {firstName} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {data.welcomeMessage || 'Manage your invoices and payments in one place.'}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Client reference: <span className="font-mono font-semibold">{data.client.clientCode}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/pay">
            <Button>
              <IconWallet className="h-4 w-4" />
              Make a payment
            </Button>
          </Link>
          <Link to="/transactions">
            <Button variant="secondary">View transactions</Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Outstanding balance"
          value={
            data.outstandingTotals.length
              ? data.outstandingTotals.map((t) => t.formatted).join(' + ')
              : 'All settled'
          }
          hint={data.outstandingTotals.length ? `${data.outstandingInvoices.length} open invoice(s)` : 'No amounts due'}
          icon={<IconWallet className="h-5 w-5" />}
          tone={data.outstandingTotals.length ? 'warning' : 'success'}
        />
        <StatCard
          label="Next payment due"
          value={nextDue ? formatDate(nextDue.dueDate) : '—'}
          hint={
            nextDue
              ? `${nextDue.amountFormatted} for ${nextDue.invoiceRef} (${daysUntil(nextDue.dueDate)} day(s) left)`
              : 'No upcoming deadlines'
          }
          icon={<IconClock className="h-5 w-5" />}
          tone={overdue.length ? 'danger' : 'default'}
        />
        <StatCard
          label="Pending confirmations"
          value={data.recentConfirmations.filter((c) => !['verified', 'rejected'].includes(c.status)).length}
          hint="Awaiting review by our team"
          icon={<IconBell className="h-5 w-5" />}
        />
      </div>

      {overdue.length > 0 && (
        <Alert tone="warning" title="Overdue invoice">
          {overdue.length === 1
            ? `Invoice ${overdue[0].invoiceRef} was due on ${formatDate(overdue[0].dueDate)}. Please complete payment or contact support.`
            : `${overdue.length} invoices are past their due date. Please review and complete payment or contact support.`}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Outstanding invoices */}
        <div className="lg:col-span-2">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Outstanding invoices</h2>
              <Link to="/pay" className="link text-sm">
                Pay an invoice
              </Link>
            </div>
            {data.outstandingInvoices.length === 0 ? (
              <EmptyState
                icon={<IconDoc className="h-10 w-10" />}
                title="No outstanding invoices"
                description="When an invoice is issued to you, it will appear here with payment instructions."
              />
            ) : (
              <div className="space-y-3">
                {data.outstandingInvoices.map((inv) => {
                  const days = daysUntil(inv.dueDate);
                  return (
                    <div
                      key={inv.id}
                      className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 transition-shadow hover:shadow-card sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-slate-500">{inv.invoiceRef}</span>
                          <InvoiceStatusBadge status={inv.status as never} />
                        </div>
                        <p className="mt-1 truncate text-sm font-medium text-navy-900">{inv.description}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Due {formatDate(inv.dueDate)} · {days < 0 ? `${Math.abs(days)} day(s) overdue` : `${days} day(s) left`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-lg font-bold text-navy-900">{inv.amountFormatted}</span>
                        <Link to={`/pay?invoice=${inv.id}`}>
                          <Button size="sm">Pay</Button>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Status updates + support */}
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Recent updates</h2>
            {data.statusUpdates.length === 0 ? (
              <p className="text-sm text-slate-400">No updates yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.statusUpdates.slice(0, 6).map((u) => (
                  <li key={u.id} className="flex gap-3 text-sm">
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                    <div>
                      <p className="text-slate-700">
                        <span className="font-mono text-xs">{u.ref_code}</span> — {u.status.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-slate-400">{new Date(u.created_at).toLocaleString()}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold">Support</h2>
            <ul className="space-y-3 text-sm">
              {data.support.email && (
                <li className="flex items-center gap-2 text-slate-600">
                  <IconMail className="h-4 w-4 text-brand-500" />
                  <a href={`mailto:${data.support.email}`} className="link">{data.support.email}</a>
                </li>
              )}
              {(branding?.supportPhone || data.support.phone) && (
                <li className="flex items-center gap-2 text-slate-600">
                  <IconPhone className="h-4 w-4 text-brand-500" />
                  <a href={`tel:${data.support.phone}`} className="link">{data.support.phone}</a>
                </li>
              )}
              {data.support.whatsapp && (
                <li className="flex items-center gap-2 text-slate-600">
                  <IconPhone className="h-4 w-4 text-green-500" />
                  <a
                    href={`https://wa.me/${data.support.whatsapp.replace(/[^\d]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link"
                  >
                    WhatsApp: {data.support.whatsapp}
                  </a>
                </li>
              )}
              {data.support.officeAddress && (
                <li className="flex items-start gap-2 text-slate-600">
                  <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  <span>{data.support.officeAddress}</span>
                </li>
              )}
              {!data.support.email && !data.support.phone && !data.support.whatsapp && !data.support.officeAddress && (
                <li className="text-slate-400">Support contact details will appear here once configured.</li>
              )}
            </ul>
            <div className="mt-4">
              <Link to="/support">
                <Button variant="secondary" size="sm" className="w-full">
                  Contact support
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
