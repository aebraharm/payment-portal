import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatMoney, formatDate, daysUntil } from '../../lib/format';
import { InvoiceStatusBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import { IconArrowRight, IconDoc, IconWallet } from '../../components/ui/Icons';
import { Stepper } from '../../components/ui/Stepper';

interface Invoice {
  id: number;
  invoiceRef: string;
  description: string;
  amountCents: number;
  amountFormatted: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: string;
  allowPartial: boolean;
}

const PAYABLE_STATUSES = ['unpaid', 'awaiting_payment', 'rejected'];

const STEPS = [
  { label: 'Select invoice' },
  { label: 'Payment method' },
  { label: 'Instructions' },
  { label: 'Confirm & submit' },
];

export function PaySelectInvoice() {
  const [searchParams] = useSearchParams();
  const preselected = Number(searchParams.get('invoice')) || null;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ invoices: Invoice[] }>('/api/client/invoices');
        if (!cancelled) setInvoices(data.invoices);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load invoices.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <PageLoader label="Loading your invoices…" />;

  const payable = invoices.filter((inv) => PAYABLE_STATUSES.includes(inv.status));
  const other = invoices.filter((inv) => !PAYABLE_STATUSES.includes(inv.status));

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader title="Make a payment" description="Select the invoice you would like to pay." />
      <Stepper steps={STEPS} current={0} />

      {error && (
        <Alert tone="error" title="Unable to load invoices">
          {error}
        </Alert>
      )}

      {payable.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconDoc className="h-10 w-10" />}
            title="No invoices ready for payment"
            description="Invoices that are unpaid or awaiting payment will appear here. Invoices already verified or cancelled are listed below."
            action={
              <Link to="/">
                <Button variant="secondary">Back to dashboard</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {payable.map((inv) => {
            const days = daysUntil(inv.dueDate);
            const isPreselected = inv.id === preselected;
            return (
              <Card
                key={inv.id}
                className={`transition-shadow hover:shadow-card-hover ${isPreselected ? 'ring-2 ring-brand-300' : ''}`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">{inv.invoiceRef}</span>
                      <InvoiceStatusBadge status={inv.status as never} />
                    </div>
                    <p className="mt-1.5 text-base font-semibold text-navy-900">{inv.description}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Due {formatDate(inv.dueDate)} · {days < 0 ? `${Math.abs(days)} day(s) overdue` : `${days} day(s) left`}
                      {inv.allowPartial ? ' · Partial payments allowed' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <p className="text-xl font-bold text-navy-900">{inv.amountFormatted}</p>
                      <p className="text-xs text-slate-400">{formatMoney(inv.amountCents, inv.currency)}</p>
                    </div>
                    <Link to={`/pay/${inv.id}`}>
                      <Button>
                        Select
                        <IconArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {other.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-500">Other invoices</h2>
          <ul className="divide-y divide-slate-100">
            {other.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <IconWallet className="h-4 w-4 shrink-0 text-slate-300" />
                  <span className="truncate text-sm text-slate-600">
                    <span className="font-mono text-xs">{inv.invoiceRef}</span> · {inv.description}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium text-slate-500">{inv.amountFormatted}</span>
                  <InvoiceStatusBadge status={inv.status as never} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
