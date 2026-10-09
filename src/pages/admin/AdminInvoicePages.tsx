import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, formatIsoDate, formatMoney } from '../../lib/format';
import { Alert, Badge, Button, Card, CheckboxField, EmptyState, KeyValue, Modal, PageHeader, SelectInput, TextArea, TextInput, useToast } from '../../components/ui';
import { AdminFrame, LoadProblem, PageSkeleton, can, useGateSession } from './AdminShared';
import { fieldErrorsFrom, formMessageFrom, todayLocalIso } from '../../components/forms';
import { AdminInvoiceRow, ClientListRow, LineItemDraft } from './adminTypes';
import { CURRENCIES } from '../../../shared/constants';
import { SUBMISSION_STATUS_META } from '../../../shared/status';
import { parseAmountInput, subtractAmounts, sumAmounts } from '../../../shared/money';

const CURRENCY_NAMES: Record<string, string> = { USD: 'US dollar', CAD: 'Canadian dollar', EUR: 'Euro', GBP: 'Pound sterling' };

export function AdminInvoicesPage() {
  const session = useGateSession();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const list = useAsync(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    return api.get<{ invoices: AdminInvoiceRow[] }>(`/admin/invoices?${params.toString()}`);
  }, [q, status]);

  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader
          title="Invoices"
          description="Totals are calculated by the server from line items. Each invoice is payable only in its own currency."
          actions={can(session, 'invoices:write') ? <Button onClick={() => setCreating(true)}>New invoice</Button> : undefined}
        />
        <Card>
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
            <TextInput label="Search" type="search" placeholder="Invoice number, client or description" value={q} onChange={(e) => setQ(e.target.value)} />
            <SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['unpaid', 'awaiting_payment', 'confirmation_submitted', 'under_review', 'info_requested', 'partially_paid', 'payment_verified', 'rejected', 'refunded', 'cancelled'].map((value) => (
                <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
              ))}
            </SelectInput>
          </div>
          {list.loading && <PageSkeleton />}
          {list.error ? <LoadProblem error={list.error} onRetry={list.reload} /> : null}
          {list.data && list.data.invoices.length === 0 && <EmptyState title="No invoices match">Create an invoice to get started.</EmptyState>}
          {list.data && list.data.invoices.length > 0 && (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <caption className="sr-only">Invoices</caption>
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-2 py-2 font-medium">Invoice</th>
                    <th scope="col" className="px-2 py-2 font-medium">Client</th>
                    <th scope="col" className="px-2 py-2 font-medium">Total</th>
                    <th scope="col" className="px-2 py-2 font-medium">Outstanding</th>
                    <th scope="col" className="px-2 py-2 font-medium">Status</th>
                    <th scope="col" className="px-2 py-2"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-brand-50/40">
                      <td className="px-2 py-3">
                        <p className="font-medium text-slate-900">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-slate-500">due {formatIsoDate(invoice.dueDate)}{invoice.overdue ? ' · overdue' : ''}</p>
                      </td>
                      <td className="px-2 py-3 text-slate-700">{invoice.clientName}</td>
                      <td className="px-2 py-3">{formatMoney(invoice.totalAmount, invoice.currency)}</td>
                      <td className="px-2 py-3 font-medium">{formatMoney(invoice.outstanding, invoice.currency)}</td>
                      <td className="px-2 py-3"><Badge tone={invoice.tone}>{invoice.statusLabel}</Badge></td>
                      <td className="px-2 py-3 text-right"><Link to={`/admin/invoices/${invoice.id}`} className="font-medium text-brand-700 hover:underline">Open<span className="sr-only"> {invoice.invoiceNumber}</span></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Modal open={creating} title="New invoice" onClose={() => setCreating(false)} footer={null}>
          <InvoiceForm
            mode="create"
            onCancel={() => setCreating(false)}
            onSaved={(id) => {
              setCreating(false);
              toast('success', 'Invoice created.');
              window.location.assign(`/admin/invoices/${id}`);
            }}
          />
        </Modal>
      </div>
    </AdminFrame>
  );
}

export function InvoiceForm({
  mode,
  invoice,
  onSaved,
  onCancel,
}: {
  mode: 'create' | 'edit';
  invoice?: AdminInvoiceRow & { lineItems?: LineItemDraft[] };
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const clients = useAsync(() => api.get<{ clients: ClientListRow[] }>('/admin/clients?status=active'), []);
  const [clientId, setClientId] = useState(invoice?.clientId ?? '');
  const [description, setDescription] = useState(invoice?.description ?? '');
  const [currency, setCurrency] = useState(invoice?.currency ?? 'USD');
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? todayLocalIso());
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? todayLocalIso());
  const [partial, setPartial] = useState(invoice?.partialPaymentsAllowed ?? false);
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [lines, setLines] = useState<LineItemDraft[]>(invoice?.lineItems?.length ? invoice.lineItems : [{ description: '', kind: 'charge', amount: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = lines.map((line) => parseAmountInput(line.amount));
  // Display preview only. The server recalculates the total from the same line items when saving.
  const charges = lines.flatMap((line, index) => (line.kind !== 'discount' && valid[index] ? [valid[index]] : []));
  const discounts = lines.flatMap((line, index) => (line.kind === 'discount' && valid[index] ? [valid[index]] : []));
  const preview = valid.every((amount) => amount !== null) ? subtractAmounts(sumAmounts(charges), sumAmounts(discounts)) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const body = { clientId, description, currency, issueDate, dueDate, partialPaymentsAllowed: partial, notes, lineItems: lines };
    try {
      if (mode === 'create') {
        const result = await api.post<{ invoice: { id: string } }>('/admin/invoices', body);
        onSaved(result.invoice.id);
      } else {
        await api.patch(`/admin/invoices/${invoice?.id}`, body);
        onSaved(invoice?.id ?? '');
      }
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(formMessageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {formError && <Alert tone="danger">{formError}</Alert>}
      {mode === 'create' && (
        <SelectInput label="Client" required value={clientId} onChange={(e) => setClientId(e.target.value)} error={errors.clientId} hint={clients.error ? 'Clients could not be loaded.' : undefined}>
          <option value="">Choose a client</option>
          {clients.data?.clients.map((c) => (
            <option key={c.id} value={c.id}>{c.fullName} ({c.clientCode})</option>
          ))}
        </SelectInput>
      )}
      <TextInput label="Description" required value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectInput label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} error={errors.currency} hint={CURRENCY_NAMES[currency]}>
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </SelectInput>
        <TextInput label="Issue date" type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} error={errors.issueDate} />
        <TextInput label="Due date" type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-800">Line items</legend>
        {lines.map((line, index) => (
          <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_140px_140px_auto] sm:items-end">
            <TextInput label={`Description ${index + 1}`} value={line.description} onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)))} error={errors[`lineItems.${index}.description`]} />
            <SelectInput label="Type" value={line.kind} onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, kind: e.target.value as LineItemDraft['kind'] } : l)))}>
              <option value="charge">Charge</option>
              <option value="fee">Fee</option>
              <option value="discount">Discount</option>
            </SelectInput>
            <TextInput label="Amount" inputMode="decimal" value={line.amount} onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))} error={errors[`lineItems.${index}.amount`]} />
            <Button variant="ghost" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove</Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" disabled={lines.length >= 50} onClick={() => setLines([...lines, { description: '', kind: 'charge', amount: '' }])}>Add line item</Button>
          <p className="text-sm text-slate-700">Total preview: <span className="font-semibold text-slate-900">{preview !== null ? formatMoney(preview, currency) : '—'}</span> <span className="text-xs text-slate-500">(the server recalculates on save)</span></p>
        </div>
        {errors.lineItems && <p className="text-sm text-rose-700">{errors.lineItems}</p>}
      </fieldset>
      <CheckboxField label="Allow partial payments" hint="If off, the client must pay the full outstanding balance in one reference." checked={partial} onChange={(e) => setPartial(e.target.checked)} />
      <TextArea label="Internal notes shown to the client (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} maxLength={2000} />
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>{mode === 'create' ? 'Create invoice' : 'Save changes'}</Button>
      </div>
    </form>
  );
}

export function AdminInvoiceDetailPage() {
  const session = useGateSession();
  const { invoiceId = '' } = useParams();
  const detail = useAsync(() => api.get<InvoiceDetailAdmin>(`/admin/invoices/${invoiceId}`), [invoiceId]);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<null | 'cancel' | 'refund'>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canWrite = can(session, 'invoices:write');

  if (detail.loading) return <AdminFrame><PageSkeleton /></AdminFrame>;
  if (detail.error) return <AdminFrame><LoadProblem error={detail.error} onRetry={detail.reload} /></AdminFrame>;
  const data = detail.data;
  if (!data) return null;
  const inv = data.invoice;
  const locked = data.references.length > 0 || data.submissions.length > 0 || data.ledger.length > 0;

  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <Link to="/admin/invoices" className="text-sm font-medium text-brand-700 hover:underline">← All invoices</Link>
        <PageHeader title={`Invoice ${inv.invoiceNumber}`} description={`${inv.clientName} · ${inv.description}`} actions={<Badge tone={inv.tone}>{inv.statusLabel}</Badge>} />
        {error && <Alert tone="danger">{error}</Alert>}
        <Card>
          <KeyValue
            items={[
              { label: 'Total', value: formatMoney(inv.totalAmount, inv.currency) },
              { label: 'Verified received', value: formatMoney(data.netPaid, inv.currency) },
              { label: 'Outstanding', value: <span className="font-semibold">{formatMoney(inv.outstanding, inv.currency)}</span> },
              { label: 'Issued / due', value: `${formatIsoDate(inv.issueDate)} / ${formatIsoDate(inv.dueDate)}` },
              { label: 'Partial payments', value: inv.partialPaymentsAllowed ? 'Allowed' : 'Full balance only' },
              { label: 'Currency', value: `${inv.currency} (payable only in ${inv.currency})` },
            ]}
          />
          <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {data.lineItems.map((item, index) => (
              <li key={index} className="flex justify-between gap-3 px-4 py-2.5 text-sm"><span>{item.description} <span className="text-xs text-slate-500">({item.kind})</span></span><span className="font-medium">{formatMoney(item.amount, inv.currency)}</span></li>
            ))}
          </ul>
          {canWrite && (
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={locked}>Edit invoice</Button>
              <Button variant="secondary" onClick={() => setDialog('refund')}>Record manual refund</Button>
              <Button variant="danger" onClick={() => setDialog('cancel')} disabled={inv.status === 'cancelled'}>Cancel invoice</Button>
            </div>
          )}
          {canWrite && locked && <p className="mt-2 text-xs text-slate-500">Editing is locked once a payment reference or confirmation exists.</p>}
        </Card>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card title="Payment references and confirmations" className="xl:col-span-2">
            {data.submissions.length === 0 ? (
              <EmptyState title="No confirmations yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.submissions.map((s) => {
                  const meta = SUBMISSION_STATUS_META[s.status as keyof typeof SUBMISSION_STATUS_META];
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div>
                        <Link to={`/admin/submissions/${s.id}`} className="font-medium text-brand-700 hover:underline">{s.reference}</Link>
                        <p className="text-xs text-slate-500">{s.method.replace(/_/g, ' ')} · {formatMoney(s.amountSent, inv.currency)} · sent {s.sentOn} · {s.receiptCount} receipt{s.receiptCount === 1 ? '' : 's'}</p>
                      </div>
                      <Badge tone={meta?.tone ?? 'neutral'}>{meta?.label ?? s.status}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card title="Ledger" description="Only verified payments and recorded refunds appear here.">
            {data.ledger.length === 0 ? <EmptyState title="No ledger entries" /> : (
              <ul className="space-y-2 text-sm">
                {data.ledger.map((row) => (
                  <li key={row.id} className="flex justify-between gap-3"><span>{row.kind === 'refund' ? 'Refund' : 'Verified payment'} <span className="text-xs text-slate-500">{formatDateTime(row.recordedAt)}</span></span><span className="font-medium">{formatMoney(row.amount, row.currency)}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="History" description="Every change to this invoice is recorded in the audit log.">
          {data.audit.length === 0 ? <p className="text-sm text-slate-500">No history yet.</p> : (
            <ol className="space-y-3 text-sm">
              {data.audit.map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-2"><span className="text-slate-800">{row.summary}</span><span className="text-xs text-slate-500">{formatDateTime(row.occurredAt)} · {row.actorType}</span></li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Internal notes">
          <ul className="mb-4 space-y-3 text-sm">
            {data.notes.length === 0 && <li className="text-slate-500">No notes yet.</li>}
            {data.notes.map((item) => (<li key={item.id} className="rounded-lg bg-slate-50 p-3"><p className="whitespace-pre-wrap">{item.body}</p><p className="mt-1 text-xs text-slate-500">{item.authorName} · {formatDateTime(item.createdAt)}</p></li>))}
          </ul>
          {canWrite && (
            <form className="space-y-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); try { await api.post(`/admin/invoices/${invoiceId}/notes`, { body: note }); setNote(''); detail.reload(); } catch (err) { setError(errorMessage(err)); } }}>
              <TextArea label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
              <Button type="submit" variant="secondary" disabled={!note.trim()}>Save note</Button>
            </form>
          )}
        </Card>

        <Modal open={editing} title="Edit invoice" onClose={() => setEditing(false)} footer={null}>
          <InvoiceForm mode="edit" invoice={{ ...inv, lineItems: data.lineItems.map((l) => ({ description: l.description, kind: l.kind as LineItemDraft['kind'], amount: l.amount })) }} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); toast('success', 'Invoice updated.'); detail.reload(); }} />
        </Modal>
        <CancelDialog open={dialog === 'cancel'} invoiceId={invoiceId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); toast('success', 'Invoice cancelled.'); detail.reload(); }} />
        <RefundDialog open={dialog === 'refund'} invoiceId={invoiceId} currency={inv.currency} onClose={() => setDialog(null)} onDone={() => { setDialog(null); toast('success', 'Refund recorded. No money was moved by this portal.'); detail.reload(); }} />
      </div>
    </AdminFrame>
  );
}

function CancelDialog({ open, invoiceId, onClose, onDone }: { open: boolean; invoiceId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  return (
    <Modal open={open} title="Cancel this invoice?" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Keep invoice</Button><Button variant="danger" type="submit" form="cancel-form" loading={busy}>Cancel invoice</Button></>}>
      <form id="cancel-form" noValidate className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErrors({}); setFormError(null); try { await api.post(`/admin/invoices/${invoiceId}/cancel`, { reason, confirm }); onDone(); } catch (err) { setErrors(fieldErrorsFrom(err)); setFormError(formMessageFrom(err)); } finally { setBusy(false); } }}>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <p className="text-sm text-slate-700">Cancelling is blocked when the invoice has verified payments, refunds or pending confirmations.</p>
        <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} />
        <CheckboxField label="I understand this invoice will be cancelled and the client will no longer be asked to pay it." checked={confirm} onChange={(e) => setConfirm(e.target.checked)} error={errors.confirm} />
      </form>
    </Modal>
  );
}

function RefundDialog({ open, invoiceId, currency, onClose, onDone }: { open: boolean; invoiceId: string; currency: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [transferReference, setTransferReference] = useState('');
  const [note, setNote] = useState('');
  const [confirmManual, setConfirmManual] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title="Record a manual refund" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="refund-form" loading={busy}>Record refund</Button></>}>
      <form id="refund-form" noValidate className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErrors({}); setFormError(null); try { await api.post(`/admin/invoices/${invoiceId}/refunds`, { currency, amount, transferReference, confirmManual, note }); onDone(); } catch (err) { setErrors(fieldErrorsFrom(err)); setFormError(formMessageFrom(err)); } finally { setBusy(false); } }}>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Alert tone="info">This records a refund that was already sent outside the portal. The portal never moves money.</Alert>
        <TextInput label={`Amount refunded (${currency})`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} />
        <TextInput label="Refund transfer reference" required value={transferReference} onChange={(e) => setTransferReference(e.target.value)} error={errors.transferReference} />
        <TextArea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} />
        <CheckboxField label="I have sent this refund outside this portal and confirm the details above are correct." checked={confirmManual} onChange={(e) => setConfirmManual(e.target.checked)} error={errors.confirmManual} />
      </form>
    </Modal>
  );
}

export interface InvoiceDetailAdmin {
  invoice: AdminInvoiceRow;
  netPaid: string;
  lineItems: { description: string; kind: string; amount: string }[];
  references: { id: string; reference: string; method: string; amount: string; status: string }[];
  submissions: { id: string; reference: string; method: string; status: string; amountSent: string; sentOn: string; receiptCount: number; createdAt: string }[];
  ledger: { id: string; kind: string; amount: string; currency: string; recordedAt: string; note: string }[];
  notes: { id: string; body: string; authorName: string; createdAt: string }[];
  audit: { id: number; occurredAt: string; action: string; summary: string; actorType: string }[];
}

