import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, formatIsoDate } from '../../lib/format';
import { Alert, Badge, Button, Card, EmptyState, KeyValue, Modal, PageHeader, SelectInput, TextArea, TextInput, useToast } from '../../components/ui';
import { AdminFrame, LoadProblem, PageSkeleton, can, useGateSession } from './AdminShared';
import { copyText, fieldErrorsFrom, formMessageFrom } from '../../components/forms';
import { formatMoney } from '../../lib/format';
import { ClientListRow, ClientDetail, ClientInvitation, DeliveryOutcome } from './adminTypes';

const DELIVERY_TEXT: Record<DeliveryOutcome, string> = {
  sent: 'The email was sent.',
  failed: 'The email could not be sent. Share the link securely, or try again later.',
  not_configured: 'Email is not configured on this server, so nothing was emailed. Share the link through a secure channel.',
  skipped: 'No email was sent for this link.',
  duplicate: 'An email with this link was already sent.',
  disabled: 'This notification is turned off in settings, so no email was sent.',
};

function LinkBox({ title, invitation }: { title: string; invitation: ClientInvitation }) {
  const toast = useToast();
  return (
    <Alert tone={invitation.notification === 'sent' ? 'success' : 'warning'} title={title}>
      <p>{DELIVERY_TEXT[invitation.notification]}</p>
      <p className="mt-2 text-xs text-slate-600">The link below is shown once. It can be used one time and expires after 7 days.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="block max-w-full break-all rounded-lg bg-white px-3 py-2 text-xs text-slate-800 ring-1 ring-slate-200">{invitation.activationUrl}</code>
        <Button
          variant="secondary"
          onClick={async () => {
            const ok = await copyText(invitation.activationUrl);
            toast(ok ? 'success' : 'danger', ok ? 'Link copied.' : 'Copy is not available. Select the link and copy it manually.');
          }}
        >
          Copy link
        </Button>
      </div>
    </Alert>
  );
}

export function AdminClientsPage() {
  const session = useGateSession();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const list = useAsync(() => api.get<{ clients: ClientListRow[] }>(`/admin/clients?${params.toString()}`), [q, status]);
  const toast = useToast();

  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader
          title="Clients"
          description="Clients sign in with their full name and an access code from an invitation link. Names alone never grant access."
          actions={can(session, 'clients:write') ? <Button onClick={() => setCreating(true)}>New client</Button> : undefined}
        />
        <Card>
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
            <TextInput label="Search" placeholder="Name, email or client code" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
            <SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </SelectInput>
          </div>
          {list.loading && <PageSkeleton />}
          {list.error ? <LoadProblem error={list.error} onRetry={list.reload} /> : null}
          {list.data && list.data.clients.length === 0 && <EmptyState title="No clients match">Try a different search, or add a new client.</EmptyState>}
          {list.data && list.data.clients.length > 0 && (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <caption className="sr-only">Clients</caption>
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-2 py-2 font-medium">Client</th>
                    <th scope="col" className="px-2 py-2 font-medium">Access</th>
                    <th scope="col" className="px-2 py-2 font-medium">Open invoices</th>
                    <th scope="col" className="px-2 py-2 font-medium">Status</th>
                    <th scope="col" className="px-2 py-2"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.clients.map((client) => (
                    <tr key={client.id} className="hover:bg-brand-50/40">
                      <td className="px-2 py-3">
                        <p className="font-medium text-slate-900">{client.fullName}</p>
                        <p className="text-xs text-slate-500">{client.clientCode} · {client.email}</p>
                      </td>
                      <td className="px-2 py-3">
                        {client.invitationPending ? <Badge tone="info">Invitation pending</Badge> : client.hasAccessCode ? <Badge tone="success">Active access code</Badge> : <Badge tone="warning">No access code</Badge>}
                      </td>
                      <td className="px-2 py-3">{client.openInvoices}</td>
                      <td className="px-2 py-3">{client.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>}</td>
                      <td className="px-2 py-3 text-right">
                        <Link to={`/admin/clients/${client.id}`} className="font-medium text-brand-700 hover:underline">
                          Manage<span className="sr-only"> {client.fullName}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <NewClientDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            toast('success', 'Client created. Send an invitation from the client page.');
            list.reload();
          }}
        />
      </div>
    </AdminFrame>
  );
}

function NewClientDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await api.post('/admin/clients', { fullName, email, phone });
      setFullName('');
      setEmail('');
      setPhone('');
      onCreated();
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(formMessageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="New client" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="new-client-form" loading={busy}>Create client</Button></>}>
      <form id="new-client-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextInput label="Full name" required value={fullName} onChange={(e) => setFullName(e.target.value)} error={errors.fullName} hint="This is the name the client types to sign in." />
        <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextInput label="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
      </form>
    </Modal>
  );
}

export function AdminClientDetailPage() {
  const session = useGateSession();
  const { clientId = '' } = useParams();
  const detail = useAsync(() => api.get<ClientDetail>(`/admin/clients/${clientId}`), [clientId]);
  const toast = useToast();
  const [invitation, setInvitation] = useState<{ title: string; data: ClientInvitation } | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<{ fullName: string; email: string; phone: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canWrite = can(session, 'clients:write');

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (detail.loading) return <AdminFrame><PageSkeleton /></AdminFrame>;
  if (detail.error) return <AdminFrame><LoadProblem error={detail.error} onRetry={detail.reload} /></AdminFrame>;
  const data = detail.data;
  if (!data) return null;
  const c = data.client;
  const form = profile ?? { fullName: c.fullName, email: c.email, phone: c.phone };

  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <Link to="/admin/clients" className="text-sm font-medium text-brand-700 hover:underline">← All clients</Link>
        <PageHeader
          title={c.fullName}
          description={`${c.clientCode} · ${c.status === 'active' ? 'Active' : 'Suspended'}`}
          actions={<Badge tone={c.status === 'active' ? 'success' : 'danger'}>{c.status === 'active' ? 'Active' : 'Suspended'}</Badge>}
        />
        {actionError && <Alert tone="danger">{actionError}</Alert>}
        {invitation && <LinkBox title={invitation.title} invitation={invitation.data} />}

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card title="Profile" actions={canWrite ? <Button variant="secondary" loading={busy === 'profile'} onClick={() => run('profile', async () => { setProfileErrors({}); try { await api.patch(`/admin/clients/${clientId}`, form); setProfile(null); toast('success', 'Profile saved.'); detail.reload(); } catch (e) { setProfileErrors(fieldErrorsFrom(e)); throw e; } })}>Save profile</Button> : undefined}>
              {canWrite ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput label="Full name" value={form.fullName} onChange={(e) => setProfile({ ...form, fullName: e.target.value })} error={profileErrors.fullName} />
                  <TextInput label="Email" type="email" value={form.email} onChange={(e) => setProfile({ ...form, email: e.target.value })} error={profileErrors.email} />
                  <TextInput label="Phone" value={form.phone} onChange={(e) => setProfile({ ...form, phone: e.target.value })} error={profileErrors.phone} />
                </div>
              ) : (
                <KeyValue items={[{ label: 'Email', value: c.email }, { label: 'Phone', value: c.phone || '—' }]} />
              )}
            </Card>

            <Card title="Invoices">
              {data.invoices.length === 0 ? (
                <EmptyState title="No invoices for this client" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.invoices.map((invoice) => (
                    <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div>
                        <Link to={`/admin/invoices/${invoice.id}`} className="font-medium text-brand-700 hover:underline">{invoice.invoiceNumber}</Link>
                        <p className="text-xs text-slate-500">{invoice.description} · due {formatIsoDate(invoice.dueDate)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-slate-900">{formatMoney(invoice.outstanding, invoice.currency)} outstanding</p>
                        <Badge tone={invoice.tone}>{invoice.statusLabel}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            {canWrite && (
              <Card title="Access" description="Invitations and access codes are handled with single-use links.">
                <div className="space-y-3">
                  <Button className="w-full" variant="secondary" loading={busy === 'invite'} onClick={() => run('invite', async () => {
                    const result = await api.post<ClientInvitation>(`/admin/clients/${clientId}/invitation`, {});
                    setInvitation({ title: 'Invitation link created', data: result });
                  })}>
                    Create invitation link
                  </Button>
                  <Button className="w-full" variant="secondary" loading={busy === 'reset'} onClick={() => {
                    if (!window.confirm('Reset this client\'s access code? The current code will stop working and a new link will be created.')) return;
                    void run('reset', async () => {
                      const result = await api.post<ClientInvitation>(`/admin/clients/${clientId}/access-reset`, {});
                      setInvitation({ title: 'Access reset link created', data: result });
                    });
                  }}>
                    Reset access code
                  </Button>
                  <Button className="w-full" variant={c.status === 'active' ? 'danger' : 'secondary'} loading={busy === 'status'} onClick={() => {
                    const next = c.status === 'active' ? 'suspended' : 'active';
                    if (next === 'suspended' && !window.confirm('Suspend this client? They will be signed out and cannot sign in until reactivated.')) return;
                    void run('status', async () => {
                      await api.post(`/admin/clients/${clientId}/status`, { status: next });
                      toast('success', next === 'suspended' ? 'Client suspended.' : 'Client reactivated.');
                      detail.reload();
                    });
                  }}>
                    {c.status === 'active' ? 'Suspend client' : 'Reactivate client'}
                  </Button>
                </div>
              </Card>
            )}
            <Card title="Internal notes" description="Visible to staff only.">
              <ul className="mb-4 space-y-3 text-sm">
                {data.notes.length === 0 && <li className="text-slate-500">No notes yet.</li>}
                {data.notes.map((item) => (
                  <li key={item.id} className="rounded-lg bg-slate-50 p-3">
                    <p className="whitespace-pre-wrap text-slate-900">{item.body}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.authorName} · {formatDateTime(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
              {canWrite && (
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setNoteError(null); void run('note', async () => { try { await api.post(`/admin/clients/${clientId}/notes`, { body: note }); setNote(''); detail.reload(); } catch (err) { setNoteError(formMessageFrom(err)); throw err; } }); }}>
                  <TextArea label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} error={noteError ?? undefined} maxLength={2000} />
                  <Button type="submit" variant="secondary" loading={busy === 'note'} disabled={!note.trim()}>Save note</Button>
                </form>
              )}
            </Card>
          </div>
        </div>
      </div>
    </AdminFrame>
  );
}
