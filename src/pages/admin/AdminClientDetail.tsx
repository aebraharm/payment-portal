import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatMoney, formatDate } from '../../lib/format';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import { CopyField } from '../../components/ui/CopyField';
import { EmptyState } from '../../components/ui/EmptyState';
import { InvoiceStatusBadge, ConfirmationStatusBadge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { IconDoc, IconKey, IconList, IconPlus, IconUsers } from '../../components/ui/Icons';

interface ClientDetail {
  client: {
    id: number;
    clientCode: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    status: string;
    accessCodeHint: string | null;
    notes: string | null;
    createdAt: string;
  };
  invoices: Array<{
    id: number;
    invoiceRef: string;
    description: string;
    amountFormatted: string;
    currency: string;
    dueDate: string;
    status: string;
  }>;
  confirmations: Array<{
    id: number;
    ref_code: string;
    method: string;
    currency: string;
    amount_sent_cents: number;
    status: string;
    created_at: string;
  }>;
  notes: Array<{ id: number; note: string; admin_email: string | null; created_at: string }>;
  outstanding: Array<{ currency: string; amountCents: number; amountFormatted: string }>;
}

export function AdminClientDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('profile');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<ClientDetail>(`/api/admin/clients/${id}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load client.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !data) return <PageLoader label="Loading client…" />;
  if (error || !data) {
    return (
      <Alert tone="error" title="Unable to load client">
        {error}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  const { client } = data;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={client.fullName}
        description={`Client reference ${client.clientCode}`}
        breadcrumbs={[
          { label: 'Clients', to: '/admin/clients' },
          { label: client.clientCode },
        ]}
        action={
          <Badge tone={client.status === 'active' ? 'green' : 'red'}>
            {client.status === 'active' ? 'Active' : 'Suspended'}
          </Badge>
        }
      />

      {data.outstanding.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {data.outstanding.map((o) => (
            <div key={o.currency} className="card flex items-center gap-3 px-4 py-3">
              <span className="text-sm text-slate-500">Outstanding</span>
              <span className="text-lg font-bold text-amber-700">{o.amountFormatted}</span>
            </div>
          ))}
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'invoices', label: `Invoices (${data.invoices.length})` },
          { id: 'transactions', label: `Transactions (${data.confirmations.length})` },
          { id: 'notes', label: `Notes (${data.notes.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'profile' && <ProfileTab client={client} onUpdated={load} />}
      {tab === 'invoices' && (
        <Card>
          <CardHeader
            title="Invoices"
            action={
              <Link to={`/admin/invoices/new?clientId=${client.id}`}>
                <Button size="sm">
                  <IconPlus className="h-4 w-4" />
                  New invoice
                </Button>
              </Link>
            }
          />
          {data.invoices.length === 0 ? (
            <EmptyState icon={<IconDoc className="h-8 w-8" />} title="No invoices" description="Create an invoice for this client." />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.invoices.map((inv) => (
                <Link
                  key={inv.id}
                  to={`/admin/invoices/${inv.id}`}
                  className="flex items-center justify-between gap-3 px-1 py-3 transition-colors hover:bg-brand-50/40"
                >
                  <div>
                    <p className="font-mono text-xs text-slate-500">{inv.invoiceRef}</p>
                    <p className="text-sm font-medium text-navy-900">{inv.description}</p>
                    <p className="text-xs text-slate-400">Due {formatDate(inv.dueDate)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-navy-900">{inv.amountFormatted}</span>
                    <InvoiceStatusBadge status={inv.status as never} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}
      {tab === 'transactions' && (
        <Card>
          <CardHeader title="Payment transactions" />
          {data.confirmations.length === 0 ? (
            <EmptyState icon={<IconList className="h-8 w-8" />} title="No transactions" description="This client has not submitted any payment confirmations." />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.confirmations.map((c) => (
                <Link
                  key={c.id}
                  to={`/admin/transactions/${c.id}`}
                  className="flex items-center justify-between gap-3 px-1 py-3 transition-colors hover:bg-brand-50/40"
                >
                  <div>
                    <p className="font-mono text-xs text-slate-500">{c.ref_code}</p>
                    <p className="text-xs text-slate-400">{formatDate(c.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-navy-900">{formatMoney(c.amount_sent_cents, c.currency)}</span>
                    <ConfirmationStatusBadge status={c.status as never} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}
      {tab === 'notes' && <NotesTab clientId={client.id} notes={data.notes} onAdded={load} />}
    </div>
  );
}

function ProfileTab({ client, onUpdated }: { client: ClientDetail['client']; onUpdated: () => void }) {
  const [fullName, setFullName] = useState(client.fullName);
  const [email, setEmail] = useState(client.email || '');
  const [phone, setPhone] = useState(client.phone || '');
  const [status, setStatus] = useState(client.status);
  const [notes, setNotes] = useState(client.notes || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.put(`/api/admin/clients/${client.id}`, { fullName, email, phone, status, notes });
      setMessage('Client profile saved.');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Edit profile" />
        <form onSubmit={onSave} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {message && <Alert tone="success">{message}</Alert>}
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required hint="The client's login identifier." />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Select
            label="Account status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />
          <Textarea label="Internal notes" value={notes} onChange={(e) => setNotes(e.target.value)} hint="Only visible to administrators." />
          <Button type="submit" loading={saving} loadingText="Saving…">
            Save changes
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Portal access" description="Manage how this client signs in to the portal." />
        <div className="space-y-4">
          <CopyField label="Client reference" value={client.clientCode} />
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Access code hint</p>
            <p className="mt-0.5 font-mono text-sm text-slate-600">••••••{client.accessCodeHint || ''}</p>
            <p className="mt-1 text-xs text-slate-400">Only the last characters are stored for identification. The full code is never retrievable.</p>
          </div>
          <Button variant="secondary" onClick={() => setResetOpen(true)}>
            <IconKey className="h-4 w-4" />
            Reset access code
          </Button>
          {client.status === 'suspended' && (
            <Alert tone="warning">This client is suspended and cannot sign in.</Alert>
          )}
        </div>
      </Card>

      <ResetAccessModal clientId={client.id} open={resetOpen} onClose={() => setResetOpen(false)} />
    </div>
  );
}

function ResetAccessModal({ clientId, open, onClose }: { clientId: number; open: boolean; onClose: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{ accessCode: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doReset = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ accessCode: string }>(`/api/admin/clients/${clientId}/access-code/reset`);
      setResult(res);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset the access code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Reset access code"
        description="The client's current access code stops working immediately. All their sessions are revoked."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {!result && (
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                Generate new access code
              </Button>
            )}
          </>
        }
      >
        {error && <Alert tone="error">{error}</Alert>}
        {result ? (
          <div className="space-y-4">
            <Alert tone="success">New access code generated. Share it with the client securely — it is shown only once.</Alert>
            <CopyField label="New access code (show once)" value={result.accessCode} />
          </div>
        ) : (
          <p className="text-sm text-slate-600">A new 8-character access code will be generated for this client.</p>
        )}
      </Modal>
      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={doReset}
        loading={loading}
        tone="danger"
        title="Reset this client's access code?"
        description="The old code stops working immediately and all active sessions are revoked."
        confirmLabel="Reset access code"
      />
    </>
  );
}

function NotesTab({
  clientId,
  notes,
  onAdded,
}: {
  clientId: number;
  notes: ClientDetail['notes'];
  onAdded: () => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/admin/clients/${clientId}/notes`, { note });
      setNote('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add the note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Internal notes" description="Private notes about this client. Never shared with the client." />
      <form onSubmit={addNote} className="mb-5 space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Textarea label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} required />
        <Button type="submit" size="sm" loading={saving} disabled={!note.trim()}>
          <IconPlus className="h-4 w-4" />
          Add note
        </Button>
      </form>
      {notes.length === 0 ? (
        <EmptyState icon={<IconUsers className="h-8 w-8" />} title="No notes yet" />
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="whitespace-pre-line text-sm text-slate-700">{n.note}</p>
              <p className="mt-2 text-xs text-slate-400">
                {n.admin_email || 'Admin'} · {formatDate(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
