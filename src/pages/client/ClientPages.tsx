import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage, newIdempotencyKey } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { usePublicConfig, type PublicConfig } from '../../lib/config';
import { formatDateTime, formatIsoDate, type Tone } from '../../lib/format';
import { Alert, Badge, Button, Card, CheckboxField, EmptyState, KeyValue, Modal, PageHeader, SelectInput, Skeleton, TextArea, TextInput, useToast, cx } from '../../components/ui';
import { ClientLayout } from '../../components/shells';
import { useGate } from '../../lib/session';
import type { ClientSession } from '../../lib/session';
import { copyText, fieldErrorsFrom, formMessageFrom, todayLocalIso } from '../../components/forms';
import type { ClientDashboardView, ClientReference, InvoiceDetailView, PaymentMethodOption, InstructionSnapshot } from '../../lib/clientTypes';
import { CARD_UNAVAILABLE_LABEL, CONFIRM_SENT_LABEL } from '../../../shared/constants';

function ClientFrame({ children, session }: { children: ReactNode; session: ClientSession }) {
  return <ClientLayout clientName={session.client.fullName}>{children}</ClientLayout>;
}

function Problem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert tone="danger" title="We could not load this page.">
      <p>{errorMessage(error)}</p>
      <Button variant="secondary" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </Alert>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return <Badge tone={tone}>{label}</Badge>;
}

function useCopy() {
  const toast = useToast();
  return async (value: string, label: string) => {
    const ok = await copyText(value);
    toast(ok ? 'success' : 'danger', ok ? `${label} copied.` : 'Copy is not available here. Select the text and copy it manually.');
  };
}

export function ClientDashboardPage() {
  const { session } = useGate<ClientSession>();
  const dashboard = useAsync(() => api.get<ClientDashboardView>('/client/dashboard'), []);
  const { config } = usePublicConfig();

  return (
    <ClientFrame session={session}>
      {dashboard.loading && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-64" />
        </div>
      )}
      {dashboard.error ? <Problem error={dashboard.error} onRetry={dashboard.reload} /> : null}
      {dashboard.data && <DashboardBody data={dashboard.data} config={config} />}
    </ClientFrame>
  );
}

function DashboardBody({ data, config }: { data: ClientDashboardView; config: PublicConfig | null }) {
  return (
    <div className="page-enter space-y-8">
      <PageHeader
        title={`Hello, ${data.client.name}`}
        description={data.welcome || config?.branding.clientWelcomeMessage || ''}
        actions={<span className="text-xs text-slate-500">Client code {data.client.code}</span>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Open invoices</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{data.summary.openInvoices}</p>
          {data.summary.overdueInvoices > 0 && <p className="mt-1 text-sm text-rose-700">{data.summary.overdueInvoices} overdue</p>}
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Outstanding</p>
          {data.summary.outstandingByCurrency.length === 0 ? (
            <p className="mt-2 text-lg text-slate-700">Nothing due</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {data.summary.outstandingByCurrency.map((item) => (
                <li key={item.currency} className="text-lg font-semibold text-slate-900">
                  {item.amountFormatted}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Confirmations in progress</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{data.summary.pendingConfirmations}</p>
          <p className="mt-1 text-sm text-slate-600">These are not verified payments until our team confirms them.</p>
        </Card>
      </div>

      <Card title="Your invoices" description="Select an invoice to see payment options and the status of your payments.">
        {data.invoices.length === 0 ? (
          <EmptyState title="No invoices yet">Your invoices will appear here when they are issued.</EmptyState>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Your invoices</caption>
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-2 py-2 font-medium">Invoice</th>
                  <th scope="col" className="px-2 py-2 font-medium">Due</th>
                  <th scope="col" className="px-2 py-2 font-medium">Outstanding</th>
                  <th scope="col" className="px-2 py-2 font-medium">Status</th>
                  <th scope="col" className="px-2 py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id} className="transition-colors hover:bg-brand-50/50">
                    <td className="px-2 py-3">
                      <p className="font-medium text-slate-900">{invoice.invoiceNumber}</p>
                      <p className="text-xs text-slate-500">{invoice.description}</p>
                    </td>
                    <td className="px-2 py-3 text-slate-700">
                      {formatIsoDate(invoice.dueDate)}
                      {invoice.overdue && <span className="ml-2 text-xs font-medium text-rose-700">Overdue</span>}
                    </td>
                    <td className="px-2 py-3 font-medium text-slate-900">{invoice.outstandingFormatted}</td>
                    <td className="px-2 py-3"><StatusBadge label={invoice.statusLabel} tone={invoice.tone} /></td>
                    <td className="px-2 py-3 text-right">
                      <Link to={`/client/invoices/${invoice.id}`} className="font-medium text-brand-700 hover:underline">
                        View<span className="sr-only"> invoice {invoice.invoiceNumber}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data.notifications.length > 0 && (
        <Card title="Recent messages from our team">
          <ul className="divide-y divide-slate-100">
            {data.notifications.map((item) => (
              <li key={item.id} className="py-3 text-sm">
                <p className="font-medium text-slate-900">{item.subject}</p>
                <p className="text-xs text-slate-500">{formatDateTime(item.sentAt)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function ClientInvoicePage() {
  const { session } = useGate<ClientSession>();
  const { invoiceId = '' } = useParams();
  const detail = useAsync(() => api.get<InvoiceDetailView>(`/client/invoices/${invoiceId}`), [invoiceId]);
  const [highlight, setHighlight] = useState<string | null>(null);

  return (
    <ClientFrame session={session}>
      <Link to="/client" className="text-sm font-medium text-brand-700 hover:underline">
        ← Back to dashboard
      </Link>
      {detail.loading && (
        <div className="mt-6 space-y-4" aria-busy="true">
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
      )}
      {detail.error ? <div className="mt-6"><Problem error={detail.error} onRetry={detail.reload} /></div> : null}
      {detail.data && (
        <InvoicePanel
          data={detail.data}
          highlight={highlight}
          onChanged={(referenceId) => {
            setHighlight(referenceId);
            detail.reload();
          }}
        />
      )}
    </ClientFrame>
  );
}

function InvoicePanel({ data, highlight, onChanged }: { data: InvoiceDetailView; highlight: string | null; onChanged: (referenceId: string | null) => void }) {
  const { invoice, options, lineItems, references } = data;
  return (
    <div className="page-enter mt-6 space-y-8">
      <PageHeader
        title={`Invoice ${invoice.invoiceNumber}`}
        description={invoice.description}
        actions={<StatusBadge label={invoice.statusLabel} tone={invoice.tone} />}
      />
      <Card>
        <KeyValue
          items={[
            { label: 'Amount due', value: <span className="text-lg font-semibold">{invoice.outstandingFormatted}</span> },
            { label: 'Invoice total', value: invoice.totalFormatted },
            { label: 'Already verified', value: invoice.paid },
            { label: 'Due date', value: <>{formatIsoDate(invoice.dueDate)}{invoice.overdue && <span className="ml-2 font-medium text-rose-700">Overdue</span>}</> },
          ]}
        />
        <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {lineItems.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="text-slate-800">
                {item.description} <span className="text-xs text-slate-500">({item.kind})</span>
              </span>
              <span className="font-medium text-slate-900">{item.amountFormatted}</span>
            </li>
          ))}
        </ul>
        {invoice.notes && <p className="mt-4 text-sm text-slate-700">{invoice.notes}</p>}
      </Card>

      <PaymentOptionsCard invoiceId={invoice.id} options={options} onCreated={(id) => onChanged(id)} />

      <section aria-labelledby="refs-heading" className="space-y-4">
        <h2 id="refs-heading" className="text-base font-semibold text-slate-900">
          Your payment references
        </h2>
        {references.length === 0 && <EmptyState title="No payment reference yet">Choose a payment method above to get instructions and a reference code.</EmptyState>}
        {references.map((reference) => (
          <ReferenceCard key={reference.id} reference={reference} highlighted={highlight === reference.id} onChanged={() => onChanged(reference.id)} />
        ))}
      </section>
    </div>
  );
}

export function PaymentOptionsCard({ invoiceId, options, onCreated }: { invoiceId: string; options: InvoiceDetailView['options']; onCreated: (referenceId: string) => void }) {
  const available = options.methods.filter((item) => item.available);
  const [method, setMethod] = useState<PaymentMethodOption['method'] | null>(available[0]?.method ?? null);
  const [bankProfileId, setBankProfileId] = useState<string>('');
  const [amount, setAmount] = useState(options.outstanding);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const toast = useToast();
  const selected = options.methods.find((item) => item.method === method) ?? null;
  const banks = selected?.bankAccounts ?? [];
  const chosenBank = banks.length === 1 ? banks[0].id : bankProfileId;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.available || method === null || method === 'card') return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const body: Record<string, unknown> = { currency: options.currency.code, method };
      if (method === 'bank_transfer') body.bankProfileId = chosenBank || null;
      if (options.partialPaymentsAllowed) body.amount = amount;
      const result = await api.post<{ reference: ClientReference; created: boolean }>(`/client/invoices/${invoiceId}/references`, body, {
        'Idempotency-Key': idempotencyKey,
      });
      setIdempotencyKey(newIdempotencyKey());
      toast('success', result.created ? 'Your payment reference is ready.' : 'Your existing payment reference is shown below.');
      onCreated(result.reference.id);
    } catch (caught) {
      setFieldErrors(fieldErrorsFrom(caught));
      setError(formMessageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Choose how to pay" description="Payments are accepted only in the invoice currency. We do not convert currencies.">
      <Alert tone="info">{options.currency.note}</Alert>
      {!options.currency.payable && <Alert tone="warning" title="Payments in this currency are not available right now.">Contact your case manager before sending money.</Alert>}
      {options.methods.every((item) => !item.available) && options.currency.payable && (
        <div className="mt-4">
          <Alert tone="warning" title="No payment method is available for this invoice right now.">
            {options.methods.find((item) => item.reason)?.reason ?? 'Please contact your case manager.'}
          </Alert>
        </div>
      )}
      <form onSubmit={create} noValidate className="mt-5 space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-slate-800">Payment method</legend>
          {options.methods.map((item) => {
            const disabled = !item.available;
            const isCard = item.method === 'card';
            const inputId = `method-${item.method}`;
            const noteId = `${inputId}-note`;
            const title = isCard ? CARD_UNAVAILABLE_LABEL : item.label;
            const note = isCard ? 'Card payments are not accepted through this portal. No card details are collected.' : disabled ? item.reason : null;
            return (
              <div
                key={item.method}
                className={cx(
                  'flex items-start gap-3 rounded-xl border p-4 text-sm transition-colors',
                  disabled ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-200 hover:border-brand-200',
                  method === item.method && !disabled && 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600',
                )}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="payment-method"
                  value={item.method}
                  className="mt-0.5 size-4 text-brand-600 focus:ring-brand-200 disabled:cursor-not-allowed"
                  checked={method === item.method}
                  disabled={disabled}
                  onChange={() => setMethod(item.method)}
                  aria-describedby={note ? noteId : undefined}
                />
                <div className="min-w-0">
                  <label htmlFor={inputId} className={cx('block font-medium', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
                    {title}
                  </label>
                  {note && (
                    <p id={noteId} className="mt-1 text-xs text-slate-500">
                      {note}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </fieldset>

        {selected?.available && method === 'bank_transfer' && banks.length > 1 && (
          <SelectInput label="Bank account" value={chosenBank} onChange={(event) => setBankProfileId(event.target.value)} error={fieldErrors.bankProfileId} required>
            <option value="">Choose an account</option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.label} · {bank.transferTypeLabel}
              </option>
            ))}
          </SelectInput>
        )}
        {selected?.available && method === 'bank_transfer' && banks.length === 1 && <p className="text-sm text-slate-700">Bank account: {banks[0].label} · {banks[0].transferTypeLabel}</p>}

        {selected?.available && options.partialPaymentsAllowed && (
          <TextInput
            label={`Amount to pay now (${options.currency.code})`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={fieldErrors.amount}
            hint={`You can pay part of the balance. The most you can enter is ${options.outstanding}.`}
          />
        )}

        <Button type="submit" loading={busy} disabled={!selected?.available || (selected?.method === 'bank_transfer' && banks.length > 1 && !chosenBank)}>
          Create payment reference
        </Button>
      </form>
    </Card>
  );
}

export function ReferenceCard({ reference, highlighted, onChanged }: { reference: ClientReference; highlighted: boolean; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const { config } = usePublicConfig();
  const copy = useCopy();
  const toast = useToast();
  const snapshot: InstructionSnapshot = reference.instructions;
  return (
    <Card className={cx('page-enter transition-shadow', highlighted && 'ring-2 ring-brand-600')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment reference</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-lg font-semibold text-slate-900">
            <span className="break-all">{reference.reference}</span>
            <button
              type="button"
              className="rounded-md px-2 py-1 font-sans text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
              onClick={() => void copy(reference.reference, 'Reference')}
            >
              Copy
            </button>
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {reference.methodLabel} · {reference.amountFormatted} · issued {formatDateTime(reference.issuedAt)}
          </p>
        </div>
        <StatusBadge label={reference.statusLabel} tone={reference.tone} />
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Send your payment exactly like this</h3>
          {snapshot.bank && (
            <>
              <p className="text-sm text-slate-700">
                {snapshot.bank.profileLabel} · {snapshot.bank.transferTypeLabel}
              </p>
              <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {snapshot.bank.fields.map((field) => (
                  <div key={field.key} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                    <dt className="text-slate-600">{field.label}</dt>
                    <dd className="flex min-w-0 items-center gap-2 text-right font-medium text-slate-900">
                      <span className="break-all">{field.value}</span>
                      <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
                        onClick={() => void copy(field.value, field.label)}
                      >
                        Copy<span className="sr-only"> {field.label}</span>
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
              {snapshot.bank.additionalInstructions && <p className="text-sm text-slate-700">{snapshot.bank.additionalInstructions}</p>}
            </>
          )}
          {snapshot.westernUnion && (
            <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">Service</dt><dd className="font-medium">{snapshot.westernUnion.displayName}</dd></div>
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">Recipient name</dt><dd className="font-medium">{snapshot.westernUnion.recipientName}</dd></div>
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">Recipient city</dt><dd className="font-medium">{snapshot.westernUnion.recipientCity}</dd></div>
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">Recipient country</dt><dd className="font-medium">{snapshot.westernUnion.recipientCountry}</dd></div>
              {snapshot.westernUnion.instructions && <p className="px-4 py-3 text-slate-700">{snapshot.westernUnion.instructions}</p>}
            </dl>
          )}
          <p className="text-sm text-slate-700">{snapshot.guidance.referenceInstruction}</p>
          <p className="text-xs text-slate-500">{snapshot.guidance.paymentDisclaimer}</p>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">After you send the money</h3>
          <p className="text-sm text-slate-700">{config?.workflow.confirmationInstructions}</p>
          <Button onClick={() => setConfirming(true)} disabled={!reference.canSubmitConfirmation} className="w-full sm:w-auto">
            {CONFIRM_SENT_LABEL}
          </Button>
          {!reference.canSubmitConfirmation && reference.confirmationBlockedReason && <p className="text-sm text-slate-600">{reference.confirmationBlockedReason}</p>}
          <p className="text-xs text-slate-500">Telling us you sent the money does not mark your invoice paid. Our team verifies every payment.</p>
        </div>
      </div>

      {reference.submissions.length > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">Your confirmations</h3>
          <ol className="mt-3 space-y-3">
            {reference.submissions.map((submission) => (
              <li key={submission.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">Confirmation {submission.attemptNo}</span>
                  <StatusBadge label={submission.statusLabel} tone={submission.tone} />
                </div>
                <p className="mt-1 text-slate-600">
                  {submission.amountSentFormatted} · sent on {submission.sentOn} · submitted {formatDateTime(submission.submittedAt)}
                </p>
                {submission.infoRequest && (
                  <Alert tone="warning" title="We need more information">
                    {submission.infoRequest}
                  </Alert>
                )}
                {submission.rejectionReason && (
                  <Alert tone="danger" title="This confirmation could not be accepted">
                    {submission.rejectionReason}
                  </Alert>
                )}
                {submission.status === 'verified' && submission.verifiedAmountFormatted && (
                  <p className="mt-2 text-emerald-800">Verified amount: {submission.verifiedAmountFormatted}</p>
                )}
                {submission.receipts.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {submission.receipts.map((receipt) => (
                      <li key={receipt.id}>
                        <a className="text-brand-700 underline-offset-2 hover:underline" href={`/api/client/receipts/${receipt.id}`} target="_blank" rel="noopener noreferrer">
                          {receipt.originalName}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {confirming && (
        <ConfirmationDialog
          reference={reference}
          instructionsTransactionLabel={snapshot.transactionIdLabel}
          maxReceiptMegabytes={config?.workflow.maxReceiptMegabytes ?? 5}
          onClose={() => setConfirming(false)}
          onSubmitted={() => {
            setConfirming(false);
            toast('success', 'Your confirmation was received. It is not verified until our team reviews it.');
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

export function ConfirmationDialog({
  reference,
  instructionsTransactionLabel,
  maxReceiptMegabytes,
  onClose,
  onSubmitted,
}: {
  reference: ClientReference;
  instructionsTransactionLabel: string;
  maxReceiptMegabytes: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const req = reference.instructions.requirements;
  const [sentOn, setSentOn] = useState(todayLocalIso());
  const [amountSent, setAmountSent] = useState(reference.amount);
  const [senderName, setSenderName] = useState('');
  const [senderCountry, setSenderCountry] = useState('');
  const [transferReference, setTransferReference] = useState(reference.reference);
  const [transactionId, setTransactionId] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const show = (key: 'senderName' | 'senderCountry' | 'transferReference' | 'transactionId' | 'receipt') => req[key] !== 'hidden';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    const localErrors: Record<string, string> = {};
    if (!acknowledged) localErrors.acknowledged = 'Confirm that you have sent this payment before submitting.';
    if (req.receipt === 'required' && !receipt) localErrors.receipt = 'Attach a receipt. Accepted files are PDF, JPEG and PNG.';
    if (receipt && receipt.size > maxReceiptMegabytes * 1024 * 1024) localErrors.receipt = `The receipt must be ${maxReceiptMegabytes} MB or smaller.`;
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }
    const form = new FormData();
    form.set('method', reference.method);
    form.set('currency', reference.currency);
    form.set('sentOn', sentOn);
    form.set('amountSent', amountSent);
    form.set('senderName', senderName);
    form.set('senderCountry', senderCountry.toUpperCase());
    form.set('transferReference', transferReference);
    form.set('transactionId', transactionId);
    form.set('note', note);
    if (receipt) form.set('receipt', receipt, receipt.name);
    setBusy(true);
    try {
      await api.upload(`/client/references/${reference.id}/submissions`, form, { 'Idempotency-Key': idempotencyKey });
      onSubmitted();
    } catch (caught) {
      setErrors(fieldErrorsFrom(caught));
      setFormError(formMessageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Tell us about your payment"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="confirmation-form" loading={busy}>
            Submit for review
          </Button>
        </>
      }
    >
      <form id="confirmation-form" onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-slate-600">Reference <span className="font-mono font-medium text-slate-900">{reference.reference}</span></p>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextInput label="Date you sent the money" type="date" required value={sentOn} onChange={(e) => setSentOn(e.target.value)} error={errors.sentOn} />
        <TextInput label={`Amount sent (${reference.currency})`} inputMode="decimal" required value={amountSent} onChange={(e) => setAmountSent(e.target.value)} error={errors.amountSent} />
        {show('senderName') && <TextInput label="Name of sender" required={req.senderName === 'required'} value={senderName} onChange={(e) => setSenderName(e.target.value)} error={errors.senderName} />}
        {show('senderCountry') && (
          <TextInput label="Country sent from (2-letter code)" maxLength={2} required={req.senderCountry === 'required'} value={senderCountry} onChange={(e) => setSenderCountry(e.target.value)} error={errors.senderCountry} hint="For example NG, GB, US or CA." />
        )}
        {show('transferReference') && <TextInput label="Transfer reference you used" required={req.transferReference === 'required'} value={transferReference} onChange={(e) => setTransferReference(e.target.value)} error={errors.transferReference} />}
        {show('transactionId') && <TextInput label={instructionsTransactionLabel || 'Transaction ID'} required={req.transactionId === 'required'} value={transactionId} onChange={(e) => setTransactionId(e.target.value)} error={errors.transactionId} />}
        <TextArea label="Anything else we should know (optional)" value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} maxLength={1000} />
        {show('receipt') && (
          <div className="space-y-1.5">
            <label htmlFor="receipt-file" className="block text-sm font-medium text-slate-800">
              Receipt {req.receipt === 'required' && <span className="text-rose-600" aria-hidden="true">*</span>}
            </label>
            <input
              id="receipt-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              aria-invalid={errors.receipt ? true : undefined}
              aria-describedby="receipt-hint"
              className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:font-semibold file:text-brand-800 hover:file:bg-brand-100"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            />
            <p id="receipt-hint" className="text-xs text-slate-500">PDF, JPEG or PNG. Up to {maxReceiptMegabytes} MB.</p>
            {errors.receipt && <p className="text-sm text-rose-700">{errors.receipt}</p>}
          </div>
        )}
        <CheckboxField
          label="I have sent this payment. I understand it is not verified until our team confirms it."
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          error={errors.acknowledged}
        />
      </form>
    </Modal>
  );
}

export function ClientSecurityPage() {
  const { session } = useGate<ClientSession>();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    setSaved(false);
    if (next !== confirm) {
      setErrors({ confirm: 'The two access codes do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/client/auth/change-access-code', { currentAccessCode: current, newAccessCode: next });
      setSaved(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (caught) {
      setErrors(fieldErrorsFrom(caught));
      setFormError(formMessageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ClientFrame session={session}>
      <div className="page-enter mx-auto max-w-lg">
          <PageHeader title="Security" description="Change the access code you use with your full name to sign in." />
          <Card>
            <form onSubmit={submit} noValidate className="space-y-4">
              {formError && <Alert tone="danger">{formError}</Alert>}
              {saved && <Alert tone="success">Your access code has been changed. Other devices have been signed out.</Alert>}
              <TextInput label="Current access code" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.currentAccessCode} />
              <TextInput label="New access code" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} error={errors.newAccessCode} />
              <TextInput label="Confirm new access code" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
              <Button type="submit" loading={busy}>
                Change access code
              </Button>
            </form>
          </Card>
      </div>
    </ClientFrame>
  );
}
