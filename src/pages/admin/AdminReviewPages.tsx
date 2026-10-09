import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, formatMoney } from '../../lib/format';
import { Alert, Badge, Button, Card, CheckboxField, EmptyState, KeyValue, Modal, PageHeader, SelectInput, TextArea, TextInput, useToast } from '../../components/ui';
import { AdminFrame, LoadProblem, PageSkeleton, can, useGateSession } from './AdminShared';
import { fieldErrorsFrom, formMessageFrom } from '../../components/forms';
import type { Tone } from '../../lib/format';

interface SubmissionRow {
  id: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientCode: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  methodLabel: string;
  currency: string;
  amountSentFormatted: string;
  sentOn: string;
  submittedAt: string;
  waitingDays: number;
  receiptCount: number;
  attemptNo: number;
}

const STATUS_OPTIONS = ['submitted', 'under_review', 'info_requested', 'verified', 'rejected', 'superseded'];

export function AdminSubmissionsPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useAsync(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    return api.get<{ submissions: SubmissionRow[] }>(`/admin/submissions?${params.toString()}`);
  }, [status, q]);
  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader title="Payment review" description="Confirmations from clients. A client's confirmation is not a payment until you verify it." />
        <Card>
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
            <TextInput label="Search" type="search" placeholder="Client, invoice or reference" value={q} onChange={(e) => setQ(e.target.value)} />
            <SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Open items</option>
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
              ))}
            </SelectInput>
          </div>
          {list.loading && <PageSkeleton />}
          {list.error ? <LoadProblem error={list.error} onRetry={list.reload} /> : null}
          {list.data && list.data.submissions.length === 0 && <EmptyState title="Nothing to review">New client confirmations will appear here.</EmptyState>}
          {list.data && list.data.submissions.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {list.data.submissions.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{row.clientName} <span className="text-xs font-normal text-slate-500">{row.clientCode}</span></p>
                    <p className="text-sm text-slate-600">{row.invoiceNumber} · {row.reference} · {row.methodLabel} · {row.amountSentFormatted} · sent {row.sentOn}</p>
                    <p className="text-xs text-slate-500">Submitted {formatDateTime(row.submittedAt)} · waiting {row.waitingDays} day{row.waitingDays === 1 ? '' : 's'} · {row.receiptCount} receipt{row.receiptCount === 1 ? '' : 's'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={row.tone}>{row.statusLabel}</Badge>
                    <Link to={`/admin/submissions/${row.id}`} className="text-sm font-medium text-brand-700 hover:underline">Review<span className="sr-only"> {row.reference}</span></Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AdminFrame>
  );
}

interface SubmissionDetailView {
  id: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  client: { id: string; name: string; code: string };
  status: string;
  statusLabel: string;
  tone: Tone;
  methodLabel: string;
  currency: string;
  amountSent: string;
  amountSentFormatted: string;
  referenceAmount: string;
  sentOn: string;
  senderName: string;
  senderCountry: string;
  transferReference: string;
  transactionId: string;
  clientNote: string;
  submittedAt: string;
  rejectionReason: string | null;
  infoRequest: string | null;
  verifiedAmount: string | null;
  verifiedAmountFormatted?: string | null;
  receipts: { id: string; originalName: string; contentType: string; byteSize: number; uploadedAt: string }[];
  history: { from: string | null; to: string; label: string; actorType: string; note: string; at: string }[];
  notes: { id: string; body: string; authorName: string; createdAt: string }[];
  invoice: { outstanding: string };
}

type Action = 'start' | 'info' | 'reject' | 'verify' | null;

export function AdminSubmissionDetailPage() {
  const session = useGateSession();
  const { submissionId = '' } = useParams();
  const detail = useAsync(() => api.get<SubmissionDetailView>(`/admin/submissions/${submissionId}`), [submissionId]);
  const toast = useToast();
  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canReview = can(session, 'payments:review');
  const canNote = can(session, 'notes:write');

  if (detail.loading) return <AdminFrame><PageSkeleton /></AdminFrame>;
  if (detail.error) return <AdminFrame><LoadProblem error={detail.error} onRetry={detail.reload} /></AdminFrame>;
  const s = detail.data;
  if (!s) return null;
  const open = ['submitted', 'under_review', 'info_requested'].includes(s.status);
  const done = () => {
    setAction(null);
    detail.reload();
  };

  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <Link to="/admin/submissions" className="text-sm font-medium text-brand-700 hover:underline">← Payment review</Link>
        <PageHeader
          title={`Confirmation for ${s.invoiceNumber}`}
          description={`${s.client.name} (${s.client.code}) · reference ${s.reference}`}
          actions={<Badge tone={s.tone}>{s.statusLabel}</Badge>}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <Alert tone="info">Confirmation is not payment. Only a verified amount is recorded in the ledger and changes the invoice balance.</Alert>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card title="What the client reported">
              <KeyValue
                items={[
                  { label: 'Amount sent', value: <span className="font-semibold">{s.amountSentFormatted}</span> },
                  { label: 'Reference amount', value: formatMoney(s.referenceAmount, s.currency) },
                  { label: 'Method', value: s.methodLabel },
                  { label: 'Date sent', value: s.sentOn },
                  { label: 'Sender name', value: s.senderName || '—' },
                  { label: 'Sent from', value: s.senderCountry || '—' },
                  { label: 'Transfer reference', value: s.transferReference || '—' },
                  { label: 'Transaction ID', value: s.transactionId || '—' },
                  { label: 'Submitted', value: formatDateTime(s.submittedAt) },
                  { label: 'Outstanding on invoice', value: formatMoney(s.invoice.outstanding, s.currency) },
                ]}
              />
              {s.clientNote && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{s.clientNote}</p>}
            </Card>

            <Card title="Receipts" description="Stored privately. Each view is recorded in the audit log.">
              {s.receipts.length === 0 ? (
                <EmptyState title="No receipt attached" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {s.receipts.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <span className="min-w-0 break-all">{r.originalName} <span className="text-xs text-slate-500">({Math.ceil(r.byteSize / 1024)} KB)</span></span>
                      <a className="font-medium text-brand-700 hover:underline" href={`/api/admin/receipts/${r.id}`} target="_blank" rel="noopener noreferrer">View receipt</a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Internal notes" description="Visible to staff only.">
              <ul className="mb-4 space-y-3 text-sm">
                {s.notes.length === 0 && <li className="text-slate-500">No notes yet.</li>}
                {s.notes.map((item) => (<li key={item.id} className="rounded-lg bg-slate-50 p-3"><p className="whitespace-pre-wrap">{item.body}</p><p className="mt-1 text-xs text-slate-500">{item.authorName} · {formatDateTime(item.createdAt)}</p></li>))}
              </ul>
              {canNote && (
                <form className="space-y-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); try { await api.post(`/admin/submissions/${submissionId}/notes`, { body: note }); setNote(''); detail.reload(); } catch (err) { setError(errorMessage(err)); } }}>
                  <TextArea label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                  <Button type="submit" variant="secondary" disabled={!note.trim()}>Save note</Button>
                </form>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            {canReview && open && (
              <Card title="Decision">
                <div className="space-y-3">
                  {s.status === 'submitted' && <Button className="w-full" variant="secondary" onClick={async () => { try { await api.post(`/admin/submissions/${submissionId}/start-review`); toast('success', 'Review started.'); done(); } catch (err) { setError(errorMessage(err)); } }}>Start review</Button>}
                  <Button className="w-full" onClick={() => setAction('verify')}>Verify payment</Button>
                  <Button className="w-full" variant="secondary" onClick={() => setAction('info')}>Request more information</Button>
                  <Button className="w-full" variant="danger" onClick={() => setAction('reject')}>Reject confirmation</Button>
                </div>
              </Card>
            )}
            <Card title="History">
              <ol className="space-y-3 text-sm">
                {s.history.map((item, index) => (
                  <li key={index} className="flex justify-between gap-3"><span className="text-slate-800">{item.label}</span><span className="text-xs text-slate-500">{formatDateTime(item.at)}</span></li>
                ))}
              </ol>
              {s.infoRequest && <Alert tone="warning" title="Information requested from client">{s.infoRequest}</Alert>}
              {s.rejectionReason && <Alert tone="danger" title="Rejected">{s.rejectionReason}</Alert>}
              {s.verifiedAmount && <Alert tone="success" title="Verified">{s.verifiedAmountFormatted ?? s.verifiedAmount}</Alert>}
            </Card>
          </div>
        </div>

        <VerifyDialog open={action === 'verify'} submission={s} onClose={() => setAction(null)} onDone={() => { toast('success', 'Payment verified and recorded in the ledger.'); done(); }} />
        <TextDialog open={action === 'info'} title="Request more information" label="What do you need from the client?" submit={(text) => api.post(`/admin/submissions/${submissionId}/request-info`, { message: text })} onClose={() => setAction(null)} onDone={() => { toast('info', 'The client has been asked for more information.'); done(); }} minLength={5} />
        <TextDialog open={action === 'reject'} title="Reject this confirmation" label="Reason (the client will see this)" submit={(text) => api.post(`/admin/submissions/${submissionId}/reject`, { reason: text })} onClose={() => setAction(null)} onDone={() => { toast('info', 'Confirmation rejected.'); done(); }} minLength={5} destructive />
      </div>
    </AdminFrame>
  );
}

function TextDialog({ open, title, label, submit, onClose, onDone, minLength, destructive }: { open: boolean; title: string; label: string; submit: (text: string) => Promise<unknown>; onClose: () => void; onDone: () => void; minLength: number; destructive?: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title={title} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="text-dialog" variant={destructive ? 'danger' : 'primary'} loading={busy}>Confirm</Button></>}>
      <form id="text-dialog" noValidate className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { await submit(text.trim()); setText(''); onDone(); } catch (err) { setError(formMessageFrom(err) ?? (minLength ? `Enter at least ${minLength} characters.` : null)); } finally { setBusy(false); } }}>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextArea label={label} required value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} hint={`At least ${minLength} characters.`} />
      </form>
    </Modal>
  );
}

function VerifyDialog({ open, submission, onClose, onDone }: { open: boolean; submission: SubmissionDetailView; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(submission.amountSent);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title="Verify payment" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="verify-form" loading={busy} disabled={!confirm}>Verify and record payment</Button></>}>
      <form id="verify-form" noValidate className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErrors({}); setFormError(null); try { await api.post(`/admin/submissions/${submission.id}/verify`, { verifiedAmount: amount, confirm, note }); onDone(); } catch (err) { setErrors(fieldErrorsFrom(err)); setFormError(formMessageFrom(err)); } finally { setBusy(false); } }}>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <p className="text-sm text-slate-700">Enter the amount you actually received in the bank or account statement. Verification changes the invoice balance.</p>
        <TextInput label={`Verified amount (${submission.currency})`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.verifiedAmount} hint={`Outstanding on the invoice: ${formatMoney(submission.invoice.outstanding, submission.currency)}`} />
        <TextArea label="Note for the record (optional)" value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} />
        <CheckboxField label="I have checked the receiving account or bank statement and confirm this amount was actually received." checked={confirm} onChange={(e) => setConfirm(e.target.checked)} error={errors.confirm} />
      </form>
    </Modal>
  );
}

