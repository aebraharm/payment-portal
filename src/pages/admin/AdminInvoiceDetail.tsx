import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatMoney, formatDate } from '../../lib/format';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { InvoiceStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { IconArrowLeft } from '../../components/ui/Icons';

interface InvoiceDetail {
  invoice: {
    id: number;
    invoiceRef: string;
    description: string;
    amountCents: number;
    amountFormatted: string;
    currency: string;
    issueDate: string;
    dueDate: string;
    status: string;
    allowPartial: boolean;
    notes: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    lineItems: Array<{ id: number; description: string; quantity: number; unitAmountCents: number; totalCents: number }>;
    clientId: number;
    clientName: string | null;
    clientCode: string | null;
  };
}

const EDITABLE_STATUSES = ['unpaid', 'awaiting_payment', 'confirmation_submitted', 'under_review', 'rejected', 'draft'];

export function AdminInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<InvoiceDetail>(`/api/admin/invoices/${id}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load invoice.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !data) return <PageLoader label="Loading invoice…" />;
  if (error || !data) {
    return (
      <Alert tone="error" title="Unable to load invoice">
        {error}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  const { invoice } = data;
  const editable = EDITABLE_STATUSES.includes(invoice.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title={invoice.invoiceRef}
        description={invoice.description}
        breadcrumbs={[
          { label: 'Invoices', to: '/admin/invoices' },
          { label: invoice.invoiceRef },
        ]}
        action={
          <div className="flex items-center gap-3">
            <InvoiceStatusBadge status={invoice.status as never} />
            <Link to="/admin/invoices">
              <Button variant="secondary" size="sm">
                <IconArrowLeft className="h-4 w-4" />
                All invoices
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Invoice details" />
          <dl className="space-y-3 text-sm">
            <Row label="Client" value={invoice.clientName ? `${invoice.clientName} (${invoice.clientCode})` : '—'} />
            <Row label="Amount" value={invoice.amountFormatted} />
            <Row label="Issue date" value={formatDate(invoice.issueDate)} />
            <Row label="Due date" value={formatDate(invoice.dueDate)} />
            <Row label="Partial payments" value={invoice.allowPartial ? 'Allowed' : 'Not allowed'} />
            {invoice.cancelledAt && (
              <>
                <Row label="Cancelled at" value={formatDate(invoice.cancelledAt)} />
                <Row label="Cancel reason" value={invoice.cancelReason || '—'} />
              </>
            )}
          </dl>
          {invoice.lineItems.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold text-navy-800">Line items</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {invoice.lineItems.map((li) => (
                  <li key={li.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-slate-600">
                      {li.description} × {li.quantity}
                    </span>
                    <span className="font-medium text-navy-900">{formatMoney(li.totalCents, invoice.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {invoice.notes && (
            <div className="mt-5">
              <p className="mb-1 text-sm font-semibold text-navy-800">Notes</p>
              <p className="whitespace-pre-line text-sm text-slate-600">{invoice.notes}</p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Actions" description="Edit or cancel this invoice. Changes are audited." />
          {editable ? (
            <EditInvoiceForm invoice={invoice} onSaved={load} onCancelled={load} />
          ) : (
            <Alert tone="info">
              This invoice is <strong>{invoice.status.replace(/_/g, ' ')}</strong> and can no longer be edited.
            </Alert>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-navy-900">{value}</dd>
    </div>
  );
}

function EditInvoiceForm({
  invoice,
  onSaved,
  onCancelled,
}: {
  invoice: InvoiceDetail['invoice'];
  onSaved: () => void;
  onCancelled: () => void;
}) {
  const [description, setDescription] = useState(invoice.description);
  const [dueDate, setDueDate] = useState(invoice.dueDate);
  const [allowPartial, setAllowPartial] = useState(invoice.allowPartial);
  const [notes, setNotes] = useState(invoice.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.put(`/api/admin/invoices/${invoice.id}`, { description, dueDate, allowPartial, notes });
      setMessage('Invoice updated.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      <form onSubmit={onSave} className="space-y-4">
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} required />
        <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={allowPartial}
            onChange={(e) => setAllowPartial(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Allow partial payments
        </label>
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button type="submit" loading={saving} loadingText="Saving…">
          Save changes
        </Button>
      </form>
      <div className="border-t border-slate-100 pt-4">
        <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
          Cancel invoice…
        </Button>
      </div>
      <CancelInvoiceModal
        invoiceId={invoice.id}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onCancelled={onCancelled}
      />
    </div>
  );
}

function CancelInvoiceModal({
  invoiceId,
  open,
  onClose,
  onCancelled,
}: {
  invoiceId: number;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doCancel = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/admin/invoices/${invoiceId}/cancel`, { reason });
      onClose();
      onCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel the invoice.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel invoice"
      description="Cancelling an invoice is permanent and is recorded in the audit log. A reason is required."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep invoice
          </Button>
          <Button variant="danger" onClick={doCancel} loading={loading} disabled={reason.trim().length < 3}>
            Cancel invoice
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Textarea label="Cancellation reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
    </Modal>
  );
}
