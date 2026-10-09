import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader, SearchInput, Table, TableHead, TableRow, Th, Td } from '../../components/shared';
import { InvoiceStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconDoc, IconPlus } from '../../components/ui/Icons';

interface InvoiceRow {
  id: number;
  invoiceRef: string;
  description: string;
  amountFormatted: string;
  currency: string;
  dueDate: string;
  status: string;
  clientName: string | null;
  clientCode: string | null;
}

interface InvoicesResponse {
  total: number;
  page: number;
  pageSize: number;
  invoices: InvoiceRow[];
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'confirmation_submitted', label: 'Confirmation submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'paid', label: 'Payment verified' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function AdminInvoices() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Number(searchParams.get('page')) || 1;
  const q = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';

  const [data, setData] = useState<InvoicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const result = await api.get<InvoicesResponse>(`/api/admin/invoices?${params}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load invoices.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, status]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Invoices"
        description="Issue invoices to clients. Amounts are calculated and validated on the server."
        action={
          <Link to="/admin/invoices/new">
            <Button>
              <IconPlus className="h-4 w-4" />
              New invoice
            </Button>
          </Link>
        }
      />

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:max-w-xs sm:flex-1">
            <SearchInput
              value={q}
              onChange={(v) => setSearchParams({ q: v, status, page: '1' }, { replace: true })}
              placeholder="Search reference, description, client…"
            />
          </div>
          <div className="sm:w-56">
            <Select
              label="Status"
              value={status}
              onChange={(e) => setSearchParams({ q, status: e.target.value, page: '1' }, { replace: true })}
              options={STATUS_OPTIONS}
            />
          </div>
        </div>

        {loading && !data ? (
          <PageLoader label="Loading invoices…" />
        ) : error ? (
          <Alert tone="error" title="Unable to load invoices">
            {error}
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : data && data.invoices.length === 0 ? (
          <EmptyState
            icon={<IconDoc className="h-10 w-10" />}
            title="No invoices yet"
            description="Create an invoice and assign it to a client to start collecting payments."
            action={
              <Link to="/admin/invoices/new">
                <Button>
                  <IconPlus className="h-4 w-4" />
                  New invoice
                </Button>
              </Link>
            }
          />
        ) : (
          <>
            <Table>
              <TableHead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Client</Th>
                  <Th>Amount</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                </tr>
              </TableHead>
              <tbody>
                {data?.invoices.map((inv) => (
                  <TableRow key={inv.id} onClick={() => navigate(`/admin/invoices/${inv.id}`)}>
                    <Td>
                      <div>
                        <p className="font-mono text-xs font-semibold text-slate-500">{inv.invoiceRef}</p>
                        <p className="text-sm font-medium text-navy-900">{inv.description}</p>
                      </div>
                    </Td>
                    <Td>
                      {inv.clientName ? (
                        <div>
                          <p className="text-sm font-medium text-navy-900">{inv.clientName}</p>
                          <p className="font-mono text-xs text-slate-400">{inv.clientCode}</p>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </Td>
                    <Td>
                      <span className="font-semibold text-navy-900">{inv.amountFormatted}</span>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-500">{formatDate(inv.dueDate)}</span>
                    </Td>
                    <Td>
                      <InvoiceStatusBadge status={inv.status as never} />
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
                onChange={(p) => setSearchParams({ q, status, page: String(p) }, { replace: true })}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
