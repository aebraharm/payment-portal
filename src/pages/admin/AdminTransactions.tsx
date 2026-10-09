import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader, SearchInput, Table, TableHead, TableRow, Th, Td } from '../../components/shared';
import { ConfirmationStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconDownload, IconList } from '../../components/ui/Icons';

interface ConfirmationRow {
  id: number;
  refCode: string;
  invoiceRef: string;
  clientName: string;
  clientCode: string;
  method: string;
  sentDate: string;
  amountSentFormatted: string;
  currency: string;
  status: string;
  createdAt: string;
}

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  confirmations: ConfirmationRow[];
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'submitted', label: 'Awaiting verification' },
  { value: 'under_review', label: 'Under review' },
  { value: 'verified', label: 'Payment verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'info_requested', label: 'More information needed' },
];

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  western_union: 'Western Union',
  card: 'Card',
};

export function AdminTransactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Number(searchParams.get('page')) || 1;
  const q = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';
  const method = searchParams.get('method') || '';
  const currency = searchParams.get('currency') || '';

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (method) params.set('method', method);
      if (currency) params.set('currency', currency);
      const result = await api.get<ListResponse>(`/api/admin/transactions?${params}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, status, method, currency]);

  const setParam = (key: string, value: string) => {
    const next: Record<string, string> = { q, status, method, currency, page: '1' };
    next[key] = value;
    setSearchParams(next, { replace: true });
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (currency) params.set('currency', currency);
    window.location.href = `/api/admin/reports/transactions.csv?${params}`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Payment review"
        description="Review submitted payment confirmations. Nothing is verified until an administrator approves it."
        action={
          <Button variant="secondary" onClick={exportCsv}>
            <IconDownload className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Search reference, client…" />
          <Select label="Status" value={status} onChange={(e) => setParam('status', e.target.value)} options={STATUS_OPTIONS} />
          <Select
            label="Method"
            value={method}
            onChange={(e) => setParam('method', e.target.value)}
            options={[
              { value: '', label: 'All methods' },
              { value: 'bank_transfer', label: 'Bank transfer' },
              { value: 'western_union', label: 'Western Union' },
            ]}
          />
          <Select
            label="Currency"
            value={currency}
            onChange={(e) => setParam('currency', e.target.value)}
            options={[
              { value: '', label: 'All currencies' },
              { value: 'USD', label: 'USD' },
              { value: 'CAD', label: 'CAD' },
              { value: 'EUR', label: 'EUR' },
              { value: 'GBP', label: 'GBP' },
            ]}
          />
        </div>

        {loading && !data ? (
          <PageLoader label="Loading transactions…" />
        ) : error ? (
          <Alert tone="error" title="Unable to load transactions">
            {error}
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : data && data.confirmations.length === 0 ? (
          <EmptyState
            icon={<IconList className="h-10 w-10" />}
            title="No transactions to review"
            description="Submitted payment confirmations will appear here for review."
          />
        ) : (
          <>
            <Table>
              <TableHead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Client</Th>
                  <Th>Method</Th>
                  <Th>Amount</Th>
                  <Th>Sent date</Th>
                  <Th>Status</Th>
                  <Th>Submitted</Th>
                </tr>
              </TableHead>
              <tbody>
                {data?.confirmations.map((c) => (
                  <TableRow key={c.id} onClick={() => navigate(`/admin/transactions/${c.id}`)}>
                    <Td>
                      <div>
                        <p className="font-mono text-xs font-semibold text-slate-500">{c.refCode}</p>
                        <p className="font-mono text-xs text-slate-400">{c.invoiceRef}</p>
                      </div>
                    </Td>
                    <Td>
                      <div>
                        <p className="text-sm font-medium text-navy-900">{c.clientName}</p>
                        <p className="font-mono text-xs text-slate-400">{c.clientCode}</p>
                      </div>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-600">{METHOD_LABELS[c.method] || c.method}</span>
                    </Td>
                    <Td>
                      <span className="font-semibold text-navy-900">{c.amountSentFormatted}</span>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-500">{formatDate(c.sentDate)}</span>
                    </Td>
                    <Td>
                      <ConfirmationStatusBadge status={c.status as never} />
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-500">{formatDate(c.createdAt)}</span>
                    </Td>
                  </TableRow>
                ))}
              </tbody>
            </Table>
            {data && (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onChange={(p) => setParam('page', String(p))}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
