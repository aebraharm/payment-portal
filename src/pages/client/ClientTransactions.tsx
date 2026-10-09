import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { formatDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmationStatusBadge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Input';
import { IconList } from '../../components/ui/Icons';

interface Confirmation {
  id: number;
  refCode: string;
  invoiceRef: string;
  method: string;
  sentDate: string;
  amountSentFormatted: string;
  currency: string;
  status: string;
  createdAt: string;
}

interface Reference {
  id: number;
  refCode: string;
  invoiceRef: string;
  method: string;
  currency: string;
  amountFormatted: string;
  status: string;
  createdAt: string;
}

interface TransactionsData {
  references: Reference[];
  confirmations: Confirmation[];
}

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  western_union: 'Western Union',
  card: 'Card',
};

export function ClientTransactions() {
  const [data, setData] = useState<TransactionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.get<TransactionsData>('/api/client/transactions');
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load transactions.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <PageLoader label="Loading your transactions…" />;

  if (error || !data) {
    return (
      <Alert tone="error" title="Unable to load transactions">
        {error}
      </Alert>
    );
  }

  type Row =
    | { type: 'confirmation'; item: Confirmation; date: string }
    | { type: 'reference'; item: Reference; date: string };
  const rows: Row[] = [
    ...data.confirmations.map((c) => ({ type: 'confirmation' as const, item: c, date: c.createdAt })),
    ...data.references.map((r) => ({ type: 'reference' as const, item: r, date: r.createdAt })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .filter((row) => !statusFilter || (row.type === 'confirmation' && row.item.status === statusFilter));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Transaction history"
        description="Track your payment references and submitted confirmations."
        action={
          <div className="w-48">
            <Select
              label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'submitted', label: 'Awaiting verification' },
                { value: 'under_review', label: 'Under review' },
                { value: 'verified', label: 'Payment verified' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'info_requested', label: 'More information needed' },
              ]}
            />
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconList className="h-10 w-10" />}
            title="No transactions yet"
            description="When you make a payment, your references and confirmations will appear here."
          />
        </Card>
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-slate-100">
            {rows.map((row) =>
              row.type === 'confirmation' ? (
                <Link
                  key={`c-${row.item.id}`}
                  to={`/transactions/${row.item.id}`}
                  className="flex flex-col gap-2 p-4 transition-colors hover:bg-brand-50/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">{row.item.refCode}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="font-mono text-xs text-slate-400">{row.item.invoiceRef}</span>
                      <ConfirmationStatusBadge status={row.item.status as never} />
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {METHOD_LABELS[row.item.method] || row.item.method} · sent {formatDate(row.item.sentDate)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="font-semibold text-navy-900">{row.item.amountSentFormatted}</span>
                    <span className="text-xs text-slate-400">{formatDate(row.item.createdAt)}</span>
                  </div>
                </Link>
              ) : (
                <div
                  key={`r-${row.item.id}`}
                  className="flex flex-col gap-2 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">{row.item.refCode}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="font-mono text-xs text-slate-400">{row.item.invoiceRef}</span>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                        Instructions issued
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {METHOD_LABELS[row.item.method] || row.item.method} · {formatDate(row.item.createdAt)}
                    </p>
                  </div>
                  <span className="font-medium text-slate-600">{row.item.amountFormatted}</span>
                </div>
              )
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
