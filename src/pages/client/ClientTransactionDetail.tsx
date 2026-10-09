import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatDate, formatDateTime, formatBytes } from '../../lib/format';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { ConfirmationStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  IconArrowLeft,
  IconBank,
  IconClock,
  IconDoc,
  IconEye,
  IconFile,
  IconGlobe,
} from '../../components/ui/Icons';

interface Detail {
  confirmation: {
    id: number;
    refCode: string;
    invoiceRef: string;
    invoiceId: number;
    method: string;
    sentDate: string;
    amountSentCents: number;
    amountSentFormatted: string;
    currency: string;
    senderName: string | null;
    transferReference: string | null;
    transactionId: string | null;
    note: string | null;
    status: string;
    rejectionReason: string | null;
    reviewedAt: string | null;
    createdAt: string;
  };
  receipts: Array<{
    id: number;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
  history: Array<{
    id: number;
    status: string;
    note: string | null;
    actor_type: string;
    created_at: string;
  }>;
  reference: {
    id: number;
    refCode: string;
    method: string;
    status: string;
    instructionsSnapshot: any;
  } | null;
}

const STATUS_FLOW: Record<string, string> = {
  submitted: 'Awaiting verification',
  under_review: 'Under review',
  verified: 'Payment verified',
  rejected: 'Rejected',
  info_requested: 'More information needed',
};

export function ClientTransactionDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.get<Detail>(`/api/client/confirmations/${id}`);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load the transaction.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <PageLoader label="Loading transaction…" />;

  if (error || !data) {
    return (
      <Alert tone="error" title="Unable to load transaction">
        {error || 'Transaction not found.'}
        <div className="mt-3">
          <Link to="/transactions">
            <Button variant="secondary" size="sm">
              Back to transactions
            </Button>
          </Link>
        </div>
      </Alert>
    );
  }

  const { confirmation, receipts, history, reference } = data;
  const isWU = confirmation.method === 'western_union';
  const canResubmit = ['rejected', 'info_requested'].includes(confirmation.status);
  const snapshot = reference?.instructionsSnapshot || {};

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title="Transaction details"
        breadcrumbs={[
          { label: 'Transactions', to: '/transactions' },
          { label: confirmation.refCode },
        ]}
        action={
          <Link to="/transactions">
            <Button variant="secondary" size="sm">
              <IconArrowLeft className="h-4 w-4" />
              All transactions
            </Button>
          </Link>
        }
      />

      {/* Status banner */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Status</p>
            <div className="mt-1">
              <ConfirmationStatusBadge status={confirmation.status as never} />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Submitted {formatDateTime(confirmation.createdAt)}
              {confirmation.reviewedAt && ` · Reviewed ${formatDateTime(confirmation.reviewedAt)}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Amount</p>
            <p className="text-2xl font-bold text-navy-900">{confirmation.amountSentFormatted}</p>
            <p className="mt-1 font-mono text-sm text-slate-400">{confirmation.refCode}</p>
          </div>
        </div>

        {confirmation.status === 'submitted' && (
          <Alert tone="info" className="mt-4">
            Your confirmation is awaiting verification. We will update this page once our team has reviewed your submission.
          </Alert>
        )}
        {confirmation.status === 'under_review' && (
          <Alert tone="info" className="mt-4">
            Our team is currently reviewing your payment submission.
          </Alert>
        )}
        {confirmation.status === 'verified' && (
          <Alert tone="success" className="mt-4">
            This payment has been verified by our team. Thank you.
          </Alert>
        )}
        {confirmation.status === 'rejected' && (
          <Alert tone="error" className="mt-4" title="Submission rejected">
            {confirmation.rejectionReason || 'Your submission could not be verified.'}
            <div className="mt-3">
              <Link to={`/pay/${confirmation.invoiceId || ''}`}>
                <Button size="sm">Submit corrected information</Button>
              </Link>
            </div>
          </Alert>
        )}
        {confirmation.status === 'info_requested' && (
          <Alert tone="warning" className="mt-4" title="Additional information needed">
            {confirmation.rejectionReason || 'Our team needs more information to verify your payment.'}
          </Alert>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Submitted details */}
        <Card>
          <CardHeader title="Submitted details" />
          <dl className="space-y-3 text-sm">
            <DetailRow label="Invoice" value={confirmation.invoiceRef} mono />
            <DetailRow label="Payment method" value={isWU ? 'Western Union' : 'Bank transfer'} />
            <DetailRow label="Date sent" value={formatDate(confirmation.sentDate)} />
            <DetailRow label="Amount sent" value={confirmation.amountSentFormatted} />
            <DetailRow label="Sender / remitter" value={confirmation.senderName || '—'} />
            <DetailRow
              label={isWU ? 'MTCN / transfer reference' : 'Bank / transfer reference'}
              value={confirmation.transferReference || '—'}
              mono
            />
            <DetailRow label="Transaction ID" value={confirmation.transactionId || '—'} mono />
            {confirmation.note && <DetailRow label="Your note" value={confirmation.note} />}
          </dl>
        </Card>

        {/* Receipts */}
        <Card>
          <CardHeader title="Receipts" description="Uploaded proof of payment. Only you and administrators can view these files." />
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
                    </div>
                  </div>
                  <a
                    href={`/api/files/receipts/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    <IconEye className="h-4 w-4" />
                    View
                  </a>
                </li>
              ))}
            </ul>
          )}
          {canResubmit && (
            <div className="mt-4">
              <ResubmitReceipts confirmationId={confirmation.id} onUploaded={() => window.location.reload()} />
            </div>
          )}
        </Card>
      </div>

      {/* Instructions snapshot */}
      {snapshot && Object.keys(snapshot).length > 0 && (
        <Card>
          <CardHeader
            title="Payment instructions used"
            description="Snapshot of the instructions shown when this reference was issued. Later configuration changes do not affect this record."
          />
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {isWU ? <IconGlobe className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" /> : <IconBank className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />}
            <div className="min-w-0">
              <p className="font-semibold text-navy-800">
                {isWU ? snapshot.displayName || 'Western Union' : snapshot.profile?.name || 'Bank transfer'}
              </p>
              {isWU ? (
                <p className="mt-1">Recipient: {snapshot.recipientName || '—'}</p>
              ) : (
                <p className="mt-1">
                  {snapshot.profile?.fields?.beneficiary_name || '—'} · {snapshot.profile?.fields?.bank_name || ''}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Status timeline */}
      <Card>
        <CardHeader title="Status history" />
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">No status updates yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
            {history.map((h) => (
              <li key={h.id} className="relative">
                <span
                  className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500"
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold text-navy-900">{STATUS_FLOW[h.status] || h.status.replace(/_/g, ' ')}</p>
                {h.note && <p className="mt-0.5 text-sm text-slate-500">{h.note}</p>}
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                  <IconClock className="h-3 w-3" />
                  {formatDateTime(h.created_at)} · {h.actor_type}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {canResubmit && (
        <Card className="border-amber-200 bg-amber-50/50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 text-sm text-amber-900">
              <IconDoc className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                If your submission was rejected or we requested more information, you can submit corrected details for
                this payment reference.
              </span>
            </div>
            <Link to={`/pay/${confirmation.invoiceId || ''}`}>
              <Button>Submit corrected information</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={`text-right font-medium text-navy-900 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function ResubmitReceipts({ confirmationId, onUploaded }: { confirmationId: number; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('receipt', file);
      await api.postForm(`/api/client/confirmations/${confirmationId}/receipts`, formData);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="text-sm"
        aria-label="Choose receipt file"
      />
      {error && <p className="field-error">{error}</p>}
      <Button size="sm" variant="secondary" onClick={upload} disabled={!file} loading={uploading}>
        Upload additional receipt
      </Button>
    </div>
  );
}
