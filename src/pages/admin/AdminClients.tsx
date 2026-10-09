import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatMoney, formatDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader, SearchInput, Table, TableHead, TableRow, Th, Td } from '../../components/shared';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { CopyField } from '../../components/ui/CopyField';
import { IconPlus, IconUsers } from '../../components/ui/Icons';

interface ClientRow {
  id: number;
  clientCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  accessCodeHint: string | null;
  createdAt: string;
  invoice_count?: number;
  open_invoice_count?: number;
}

interface ClientsResponse {
  total: number;
  page: number;
  pageSize: number;
  clients: ClientRow[];
}

export function AdminClients() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Number(searchParams.get('page')) || 1;
  const q = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';

  const [data, setData] = useState<ClientsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const result = await api.get<ClientsResponse>(`/api/admin/clients?${params}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load clients.');
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
        title="Clients"
        description="Create client profiles, issue invoices and manage portal access."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <IconPlus className="h-4 w-4" />
            New client
          </Button>
        }
      />

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:max-w-xs sm:flex-1">
            <SearchInput
              value={q}
              onChange={(v) => setSearchParams({ q: v, status, page: '1' }, { replace: true })}
              placeholder="Search name, code, email…"
            />
          </div>
          <div className="sm:w-44">
            <Select
              label="Status"
              value={status}
              onChange={(e) => setSearchParams({ q, status: e.target.value, page: '1' }, { replace: true })}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
              ]}
            />
          </div>
        </div>

        {loading && !data ? (
          <PageLoader label="Loading clients…" />
        ) : error ? (
          <Alert tone="error" title="Unable to load clients">
            {error}
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : data && data.clients.length === 0 ? (
          <EmptyState
            icon={<IconUsers className="h-10 w-10" />}
            title="No clients yet"
            description="Create your first client to issue invoices and enable portal access."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <IconPlus className="h-4 w-4" />
                New client
              </Button>
            }
          />
        ) : (
          <>
            <Table>
              <TableHead>
                <tr>
                  <Th>Client</Th>
                  <Th>Contact</Th>
                  <Th>Status</Th>
                  <Th>Invoices</Th>
                  <Th>Joined</Th>
                </tr>
              </TableHead>
              <tbody>
                {data?.clients.map((client) => (
                  <TableRow key={client.id} onClick={() => navigate(`/admin/clients/${client.id}`)}>
                    <Td>
                      <div>
                        <p className="font-semibold text-navy-900">{client.fullName}</p>
                        <p className="font-mono text-xs text-slate-400">{client.clientCode}</p>
                      </div>
                    </Td>
                    <Td>
                      <div className="text-sm">
                        {client.email && <p>{client.email}</p>}
                        {client.phone && <p className="text-slate-400">{client.phone}</p>}
                        {!client.email && !client.phone && <span className="text-slate-300">—</span>}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={client.status === 'active' ? 'green' : 'red'}>
                        {client.status === 'active' ? 'Active' : 'Suspended'}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-600">
                        {client.open_invoice_count || 0} open / {client.invoice_count || 0} total
                      </span>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-500">{formatDate(client.createdAt)}</span>
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

      <CreateClientModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(client) => navigate(`/admin/clients/${client.id}`)}
      />
    </div>
  );
}

function CreateClientModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (client: ClientRow) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ client: ClientRow; accessCode: string } | null>(null);

  const reset = () => {
    setFullName('');
    setEmail('');
    setPhone('');
    setNotes('');
    setError(null);
    setCreated(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<{ client: ClientRow; accessCode: string }>('/api/admin/clients', {
        fullName,
        email,
        phone,
        notes,
      });
      setCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the client.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New client"
      description="The client signs in with their full name and a one-time access code."
      footer={
        created ? (
          <Button
            onClick={() => {
              const c = created.client;
              reset();
              onClose();
              onCreated(c);
            }}
          >
            Continue to client
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="create-client-form" loading={submitting} loadingText="Creating…">
              Create client
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4">
          <Alert tone="success" title="Client created">
            Share this access code with the client securely. It is shown only once and cannot be retrieved again.
          </Alert>
          <CopyField label="Client reference" value={created.client.clientCode} />
          <CopyField label="Access code (show once)" value={created.accessCode} />
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            The client signs in with their full name: <strong>{created.client.fullName}</strong>
          </div>
        </div>
      ) : (
        <form id="create-client-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Input label="Full name" hint="This is the client's login identifier." value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Textarea label="Internal notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </form>
      )}
    </Modal>
  );
}

void formatMoney;
