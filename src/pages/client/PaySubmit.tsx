import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { formatMoney, formatDate, todayIsoDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { LoadingScreen, PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Stepper } from '../../components/ui/Stepper';
import { FileUpload } from '../../components/ui/FileUpload';
import { Badge } from '../../components/ui/Badge';
import { CopyField } from '../../components/ui/CopyField';
import {
  IconArrowLeft,
  IconCheck,
  IconInfo,
  IconSend,
  IconShield,
} from '../../components/ui/Icons';

interface Reference {
  id: number;
  refCode: string;
  invoiceId: number;
  method: string;
  currency: string;
  amountCents: number;
  amountFormatted: string;
  status: string;
  instructionsSnapshot: any;
}

interface InvoiceDetail {
  invoice: {
    id: number;
    invoiceRef: string;
    description: string;
    amountCents: number;
    amountFormatted: string;
    currency: string;
    dueDate: string;
    status: string;
    allowPartial: boolean;
  };
}

interface ConfirmationResponse {
  confirmation: {
    id: number;
    refCode: string;
    invoiceRef: string;
    method: string;
    sentDate: string;
    amountSentCents: number;
    amountSentFormatted: string;
    currency: string;
    status: string;
    createdAt: string;
  };
  idempotentReplay?: boolean;
}

const STEPS = [
  { label: 'Select invoice' },
  { label: 'Payment method' },
  { label: 'Instructions' },
  { label: 'Confirm & submit' },
];

type Phase = 'loading' | 'form' | 'submitting' | 'uploading' | 'done' | 'error';

export function PaySubmit() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [searchParams] = useSearchParams();
  const refId = Number(searchParams.get('ref')) || 0;
  const navigate = useNavigate();

  const [reference, setReference] = useState<Reference | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDetail['invoice'] | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [sentDate, setSentDate] = useState(todayIsoDate());
  const [amountSent, setAmountSent] = useState('');
  const [senderName, setSenderName] = useState('');
  const [transferReference, setTransferReference] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ConfirmationResponse['confirmation'] | null>(null);

  const settings = useMemo(
    () => ({
      requireReceipt: true,
      requireSender: true,
      requireTransferRef: true,
      maxSizeMb: 10,
      allowedTypes: ['pdf', 'jpg', 'jpeg', 'png'],
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [refData, invData] = await Promise.all([
          api.get<{ reference: Reference }>(`/api/client/payment-references/${refId}`),
          api.get<InvoiceDetail>(`/api/client/invoices/${invoiceId}`),
        ]);
        if (cancelled) return;
        setReference(refData.reference);
        setInvoice(invData.invoice);
        setAmountSent((refData.reference.amountCents / 100).toFixed(2));
        setPhase('form');
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load the payment reference.');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, refId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reference) return;
    setFormError(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (!sentDate) errors.sentDate = 'Enter the date you sent the payment.';
    const amountCents = Math.round(parseFloat(amountSent) * 100);
    if (!amountSent || Number.isNaN(amountCents) || amountCents <= 0) {
      errors.amountSent = 'Enter a valid amount, e.g. 1500.00';
    }
    if (!senderName.trim()) errors.senderName = 'Enter the sender / remitter name.';
    if (!transferReference.trim()) {
      errors.transferReference =
        reference.method === 'western_union' ? 'Enter the MTCN / transfer reference.' : 'Enter the bank / transfer reference.';
    }
    if (!receipt) errors.receipt = 'Upload a receipt or proof of transfer.';
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    const formData = new FormData();
    formData.append('paymentReferenceId', String(reference.id));
    formData.append('sentDate', sentDate);
    formData.append('amountSent', amountSent.trim());
    formData.append('currency', reference.currency);
    formData.append('method', reference.method);
    formData.append('senderName', senderName.trim());
    formData.append('transferReference', transferReference.trim());
    if (transactionId.trim()) formData.append('transactionId', transactionId.trim());
    if (note.trim()) formData.append('note', note.trim());
    if (receipt) formData.append('receipt', receipt);

    setPhase('submitting');
    try {
      setPhase(receipt ? 'uploading' : 'submitting');
      const idempotencyKey = crypto.randomUUID();
      const data = await api.postForm<ConfirmationResponse>('/api/client/confirmations', formData, { idempotencyKey });
      setResult(data.confirmation);
      setPhase('done');
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const d of err.details) {
            if (d.path) mapped[d.path] = d.message;
          }
          setFieldErrors(mapped);
        }
      } else {
        setFormError('Unable to submit your confirmation right now. Please try again.');
      }
      setPhase('form');
    }
  };

  if (phase === 'loading') {
    return <PageLoader label="Loading your payment reference…" />;
  }

  if (phase === 'error' || !reference || !invoice) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert tone="error" title="Unable to load the payment reference">
          {loadError || 'Please try again.'}
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Link to={`/pay/${invoiceId}/instructions?method=${reference?.method || 'bank_transfer'}`}>
              <Button variant="ghost" size="sm">
                Back to instructions
              </Button>
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  if (phase === 'submitting' || phase === 'uploading') {
    return (
      <LoadingScreen
        message={phase === 'uploading' ? 'Uploading your receipt securely…' : 'Submitting your payment confirmation…'}
        submessage="Verifying your payment submission…"
      />
    );
  }

  if (phase === 'done' && result) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
        <Card className="text-center">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600"
            role="img"
            aria-label="Confirmation received"
          >
            <IconCheck className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">Confirmation received</h1>
          <p className="mt-2 text-sm text-slate-500">
            Thank you — we have received your payment confirmation. It is now <strong>awaiting verification</strong> by
            our team. This does not yet mean the payment has been received.
          </p>
          <div className="mt-6 space-y-3 text-left">
            <CopyField label="Transaction reference" value={result.refCode} />
            <CopyField label="Invoice reference" value={result.invoiceRef} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Amount submitted</p>
                <p className="mt-0.5 text-sm font-semibold text-navy-900">{result.amountSentFormatted}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Submitted</p>
                <p className="mt-0.5 text-sm font-semibold text-navy-900">{new Date(result.createdAt).toLocaleString()}</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
              <span className="text-sm font-medium text-violet-900">Status</span>
              <Badge tone="violet">Awaiting verification</Badge>
            </div>
          </div>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link to={`/transactions/${result.id}`}>
              <Button>Track this transaction</Button>
            </Link>
            <Link to="/">
              <Button variant="secondary">Back to dashboard</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const isWU = reference.method === 'western_union';

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title="Confirm your payment"
        description="Tell us the details of the transfer you sent so our team can verify it."
        breadcrumbs={[
          { label: 'Make a payment', to: '/pay' },
          { label: invoice.invoiceRef, to: `/pay/${invoiceId}` },
          { label: 'Instructions', to: `/pay/${invoiceId}/instructions?method=${reference.method}` },
          { label: 'Confirm' },
        ]}
      />
      <Stepper steps={STEPS} current={3} />

      <Card className="border-brand-200 bg-brand-50/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">You told us you sent</p>
            <p className="text-2xl font-bold text-navy-900">{reference.amountFormatted}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Payment reference</p>
            <p className="font-mono text-lg font-bold text-brand-700">{reference.refCode}</p>
          </div>
        </div>
      </Card>

      {formError && (
        <Alert tone="error" title="Unable to submit">
          {formError}
        </Alert>
      )}

      <Card>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Date you sent the payment"
              type="date"
              max={todayIsoDate()}
              value={sentDate}
              onChange={(e) => setSentDate(e.target.value)}
              error={fieldErrors.sentDate}
              required
            />
            <Input
              label={`Amount sent (${reference.currency})`}
              inputMode="decimal"
              placeholder="0.00"
              value={amountSent}
              onChange={(e) => setAmountSent(e.target.value)}
              error={fieldErrors.amountSent}
              hint={
                invoice.allowPartial
                  ? `Invoice total: ${invoice.amountFormatted}`
                  : `Full payment required: ${invoice.amountFormatted}`
              }
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="field-label">Currency</p>
              <div className="mt-1.5 flex h-[42px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-semibold text-navy-800">
                {reference.currency}
              </div>
              <p className="field-hint">Matches your invoice — no conversion is performed.</p>
            </div>
            <div>
              <p className="field-label">Payment method</p>
              <div className="mt-1.5 flex h-[42px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-semibold text-navy-800">
                {isWU ? 'Western Union' : 'Bank transfer'}
              </div>
            </div>
          </div>

          <Input
            label="Sender / remitter name"
            placeholder="Name on the account or transfer"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            error={fieldErrors.senderName}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={isWU ? 'MTCN / transfer reference' : 'Bank / transfer reference'}
              placeholder={isWU ? '10-digit MTCN' : 'e.g. ACH confirmation number'}
              value={transferReference}
              onChange={(e) => setTransferReference(e.target.value)}
              error={fieldErrors.transferReference}
              required
            />
            <Input
              label="Transaction ID (if available)"
              placeholder="Optional"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              error={fieldErrors.transactionId}
            />
          </div>

          <FileUpload
            label="Receipt / proof of transfer"
            hint={`PDF, JPG or PNG up to ${settings.maxSizeMb} MB. Your receipt is stored securely and only visible to you and our administrators.`}
            accept={settings.allowedTypes.map((t) => `.${t}`).join(',')}
            maxSizeMb={settings.maxSizeMb}
            value={receipt}
            onChange={setReceipt}
            error={fieldErrors.receipt}
            required
          />

          <Textarea
            label="Note (optional)"
            placeholder="Anything our team should know about this payment"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={fieldErrors.note}
          />

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="flex items-start gap-2">
              <IconInfo className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Submitting this form reports that you sent the payment. It does <strong>not</strong> mark the invoice as
                paid — an administrator must verify the transfer first.
              </span>
            </p>
          </div>

          <div className="flex justify-between">
            <Link to={`/pay/${invoiceId}/instructions?method=${reference.method}`}>
              <Button type="button" variant="secondary">
                <IconArrowLeft className="h-4 w-4" />
                Back to instructions
              </Button>
            </Link>
            <Button type="submit" btn-lg className="btn-lg">
              <IconSend className="h-4 w-4" />
              Submit payment confirmation
            </Button>
          </div>
        </form>
      </Card>

      <p className="flex items-center justify-center gap-2 text-center text-xs text-slate-400">
        <IconShield className="h-4 w-4" />
        Your receipt is encrypted in transit and stored in private, access-controlled storage.
      </p>
    </div>
  );
}
