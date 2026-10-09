import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatDate, formatDateTime, formatBytes } from '../../lib/format';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { ConfirmationStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Input';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  IconArrowLeft,
  IconBank,
  IconCheck,
  IconClock,
  IconDoc,
  IconEye,
  IconFile,
  IconGlobe,
  IconInfo,
} from '../../components/ui/Icons';

interface ReviewDetail {
  confirmation: {
    id: number;
    refCode: string;
    invoiceRef: string;
    clientName: string;
    clientCode: string;
    method: string;
    sentDate: string;
    amountSentFormatted: string;
    currency: string;
    senderName: string | null;
    transferReference: string | null;
    transactionId: string | null;
    note: string | null;
    status: string;
    reviewerEmail: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
  };
  invoice: {
    id: number;
    invoiceRef: string;
    description: string;
    amountFormatted: string;
    currency: string;
    status: string;
    dueDate: string;
  } | null;
  reference: {
    refCode: string;
    method: string;
    currency: string;
    amountFormatted: string;
    status: string;
    instructionsSnapshot: any;
    createdAt: string;
  } | null;
  receipts: Array<{
    id: number;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    uploadedAt: string;
  }>;
  history: Array<{ id: number; status: string; note: string | null; actor_type: string; created_at: string }>;
  notes: Array<{ id: number; note: string; admin_email: string | null; created_at: string }>;
}

const FIELD_LABELS: Record<string, string> = {
  beneficiary_name: 'Beneficiary / account-holder name',
  bank_name: 'Bank name',
  account_number: 'Account number',
  account_type: 'Account type',
  routing_number: 'Routing number (ABA)',
  ach_instructions: 'ACH instructions',
  domestic_wire_instructions: 'Domestic wire instructions',
  domestic_transfer_instructions: 'Domestic transfer instructions',
  international_wire_instructions: 'International wire instructions',
  swift_bic: 'SWIFT / BIC',
  bic_swift: 'BIC / SWIFT',
  iban: 'IBAN',
  transit_number: 'Transit number',
  institution_number: 'Institution number',
  sort_code: 'Sort code',
  bank_address: 'Bank address',
  intermediary_bank: 'Intermediary / correspondent bank',
  required_reference: 'Required transfer reference',
  additional_instructions: 'Additional instructions',
};

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Awaiting verification',
  under_review: 'Under review',
  verified: 'Payment verified',
  rejected: 'Rejected',
  info_requested: 'More information needed',
};

export function AdminTransactionReview() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionOpen, setActionOpen] = useState<null | 'under_review' | 'verified' | 'rejected' | 'info_requested'>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<ReviewDetail>(`/api/admin/transactions/${id}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the transaction.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !data) return <PageLoader label="Loading transaction…" />;
  if (error || !data) {
    return (
      <Alert tone="error" title="Unable to load transaction">
        {error}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  const { confirmation, invoice, reference, receipts, history, notes } = data;
  const isWU = confirmation.method === 'western_union';
  const snapshot = reference?.instructionsSnapshot || {};
  const reviewable = ['submitted', 'under_review', 'info_requested', 'rejected'].includes(confirmation.status);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={`Review ${confirmation.refCode}`}
        description={`Submitted by ${confirmation.clientName} (${confirmation.clientCode})`}
        breadcrumbs={[
          { label: 'Payment review', to: '/admin/transactions' },
          { label: confirmation.refCode },
        ]}
        action={
          <div className="flex items-center gap-3">
            <ConfirmationStatusBadge status={confirmation.status as never} />
            <Link to="/admin/transactions">
              <Button variant="secondary" size="sm">
                <IconArrowLeft className="h-4 w-4" />
                All transactions
              </Button>
            </Link>
          </div>
        }
      />

      {/* Review actions */}
      {reviewable && (
        <Card className="border-brand-200 bg-brand-50/40">
          <CardHeader
            title="Review actions"
            description="Verification is a privileged action: it records you as the reviewer and cannot be undone. Only mark a payment as verified after confirming receipt of funds."
          />
          <div className="flex flex-wrap gap-2">
            {confirmation.status !== 'under_review' && (
              <Button variant="secondary" onClick={() => setActionOpen('under_review')}>
                <IconClock className="h-4 w-4" />
                Mark under review
              </Button>
            )}
            <Button onClick={() => setActionOpen('verified')}>
              <IconCheck className="h-4 w-4" />
              Verify payment
            </Button>
            <Button variant="danger" onClick={() => setActionOpen('rejected')}>
              Reject…
            </Button>
            <Button variant="secondary" onClick={() => setActionOpen('info_requested')}>
              <IconInfo className="h-4 w-4" />
              Request information…
            </Button>
            <Button variant="ghost" onClick={() => setNoteOpen(true)}>
              <IconDoc className="h-4 w-4" />
              Add internal note
            </Button>
          </div>
        </Card>
      )}

      {confirmation.status === 'verified' && (
        <Alert tone="success" title="Payment verified">
          Verified by {confirmation.reviewerEmail || 'an administrator'} on {formatDateTime(confirmation.reviewedAt)}.
        </Alert>
      )}
      {confirmation.status === 'rejected' && (
        <Alert tone="error" title="Submission rejected">
          {confirmation.rejectionReason || 'No reason recorded.'}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Submitted details */}
        <Card>
          <CardHeader title="Submitted details" />
          <dl className="space-y-3 text-sm">
            <Row label="Invoice" value={`${confirmation.invoiceRef}${invoice ? ` — ${invoice.description}` : ''}`} />
            <Row label="Payment method" value={isWU ? 'Western Union' : 'Bank transfer'} />
            <Row label="Amount sent" value={confirmation.amountSentFormatted} />
            {invoice && <Row label="Invoice amount" value={invoice.amountFormatted} />}
            <Row label="Date sent" value={formatDate(confirmation.sentDate)} />
            <Row label="Sender / remitter" value={confirmation.senderName || '—'} />
            <Row label={isWU ? 'MTCN / transfer reference' : 'Bank / transfer reference'} value={confirmation.transferReference || '—'} mono />
            <Row label="Transaction ID" value={confirmation.transactionId || '—'} mono />
            {confirmation.note && <Row label="Client note" value={confirmation.note} />}
            <Row label="Submitted" value={formatDateTime(confirmation.createdAt)} />
          </dl>
        </Card>

        {/* Receipts */}
        <Card>
          <CardHeader title="Receipts" description="Stored in private storage. Access is logged." />
          {receipts.length === 0 ? (
            <EmptyState icon={<IconFile className="h-8 w-8" />} title="No receipts uploaded" />
          ) : (
            <ul className="space-y-2">
              {receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <IconFile className="h-5 w-5 shrink-0 text-brand-500" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy-900">{r.originalFilename}</p>
                      <p className="text-xs text-slate-400">
                        {formatBytes(r.sizeBytes)} · {formatDateTime(r.uploadedAt)}
                      </p>
                      <p className="truncate font-mono text-[10px] text-slate-300">sha256:{r.sha256.slice(0, 16)}…</p>
                    </div>
                  </div>
                  <a href={`/api/files/receipts/${r.id}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                    <IconEye className="h-4 w-4" />
                    View
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Instructions snapshot */}
      {reference && snapshot && Object.keys(snapshot).length > 0 && (
        <Card>
          <CardHeader
            title="Instructions snapshot"
            description={`Instructions shown when ${reference.refCode} was issued (${formatDateTime(reference.createdAt)}). Later configuration changes do not affect this record.`}
          />
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-navy-800">
              {isWU ? <IconGlobe className="h-4 w-4 text-brand-500" /> : <IconBank className="h-4 w-4 text-brand-500" />}
              {isWU ? snapshot.displayName || 'Western Union' : snapshot.profile?.name || 'Bank transfer'}
            </div>
            {isWU ? (
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {snapshot.recipientName && <Row label="Recipient" value={snapshot.recipientName} />}
                {snapshot.recipientLocation && <Row label="Location" value={snapshot.recipientLocation} />}
                {snapshot.countryOfReceipt && <Row label="Country of receipt" value={snapshot.countryOfReceipt} />}
                {snapshot.countries?.length > 0 && <Row label="Countries" value={snapshot.countries.join(', ')} />}
                {snapshot.instructions && <Row label="Instructions" value={snapshot.instructions} />}
              </dl>
            ) : (
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {Object.entries(snapshot.profile?.fields || {})
                  .filter(([, v]) => String(v).trim())
                  .map(([k, v]) => (
                    <Row key={k} label={FIELD_LABELS[k] || k.replace(/_/g, ' ')} value={String(v)} mono />
                  ))}
              </dl>
            )}
          </div>
        </Card>
      )}

      {/* History + notes */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Status history" />
          <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
            {history.map((h) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500" aria-hidden="true" />
                <p className="text-sm font-semibold text-navy-900">{STATUS_LABELS[h.status] || h.status.replace(/_/g, ' ')}</p>
                {h.note && <p className="mt-0.5 text-sm text-slate-500">{h.note}</p>}
                <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(h.created_at)} · {h.actor_type}</p>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardHeader title="Internal notes" description="Private review notes. Never shared with the client." />
          {notes.length === 0 ? (
            <p className="text-sm text-slate-400">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="whitespace-pre-line text-sm text-slate-700">{n.note}</p>
                  <p className="mt-2 text-xs text-slate-400">{n.admin_email || 'Admin'} · {formatDateTime(n.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {actionOpen && (
        <ReviewActionModal
          action={actionOpen}
          confirmationId={confirmation.id}
          amount={confirmation.amountSentFormatted}
          onClose={() => setActionOpen(null)}
          onDone={load}
        />
      )}
      {noteOpen && (
        <AddNoteModal
          confirmationId={confirmation.id}
          onClose={() => setNoteOpen(false)}
          onDone={load}
        />
      )}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={`max-w-[60%] text-right font-medium text-navy-900 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function ReviewActionModal({
  action,
  confirmationId,
  amount,
  onClose,
  onDone,
}: {
  action: 'under_review' | 'verified' | 'rejected' | 'info_requested';
  confirmationId: number;
  amount: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const needsReason = action === 'rejected' || action === 'info_requested';
  const titles: Record<string, string> = {
    under_review: 'Mark as under review',
    verified: 'Verify this payment',
    rejected: 'Reject this submission',
    info_requested: 'Request additional information',
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/admin/transactions/${confirmationId}/review`, { action, reason, note });
      onClose();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the action.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={titles[action]}
        description={
          action === 'verified'
            ? `Mark ${amount} as verified. This records you as the reviewer. Only do this after confirming receipt of funds.`
            : action === 'rejected'
              ? 'The client will see the reason and can submit corrected information.'
              : action === 'info_requested'
                ? 'The client will be asked to provide more information.'
                : 'Move this submission into active review.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {action === 'verified' ? (
              <Button onClick={() => setConfirmOpen(true)} disabled={loading}>
                <IconCheck className="h-4 w-4" />
                Verify payment
              </Button>
            ) : (
              <Button
                variant={action === 'rejected' ? 'danger' : 'primary'}
                onClick={submit}
                loading={loading}
                disabled={needsReason && reason.trim().length < 3}
              >
                {action === 'under_review' ? 'Mark under review' : action === 'rejected' ? 'Reject submission' : 'Request information'}
              </Button>
            )}
          </>
        }
      >
        {error && <Alert tone="error">{error}</Alert>}
        {needsReason && (
          <Textarea
            label={action === 'rejected' ? 'Rejection reason *' : 'Information requested *'}
            placeholder={action === 'rejected' ? 'Why could this submission not be verified?' : 'What additional information is needed?'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        )}
        <Textarea label="Internal note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submit}
        loading={loading}
        title={`Verify ${amount}?`}
        description="This marks the payment as verified and records you as the reviewer with a timestamp. This action is audited."
        confirmLabel="Yes, verify payment"
      />
    </>
  );
}

function AddNoteModal({
  confirmationId,
  onClose,
  onDone,
}: {
  confirmationId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/admin/transactions/${confirmationId}/notes`, { note });
      onClose();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add the note.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add internal note"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={loading} disabled={!note.trim()}>
            Add note
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} required />
      </form>
    </Modal>
  );
}
