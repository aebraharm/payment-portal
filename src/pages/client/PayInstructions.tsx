import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { formatDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { LoadingScreen } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import { Stepper } from '../../components/ui/Stepper';
import { CopyField } from '../../components/ui/CopyField';
import { Badge } from '../../components/ui/Badge';
import {
  IconArrowLeft,
  IconBank,
  IconCheck,
  IconClock,
  IconGlobe,
  IconInfo,
  IconSend,
} from '../../components/ui/Icons';

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
  };
}

interface Reference {
  id: number;
  refCode: string;
  method: string;
  currency: string;
  amountCents: number;
  amountFormatted: string;
  status: string;
  instructionsSnapshot: any;
  createdAt: string;
}

const STEPS = [
  { label: 'Select invoice' },
  { label: 'Payment method' },
  { label: 'Instructions' },
  { label: 'Confirm & submit' },
];

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
  sepa_available: 'SEPA transfer availability',
  international_wire_available: 'International wire availability',
  additional_instructions: 'Additional instructions',
};

const TRANSFER_TYPE_LABELS: Record<string, string> = {
  ach: 'ACH transfer',
  domestic_wire: 'Domestic wire',
  international_wire: 'International wire',
  domestic_transfer: 'Domestic transfer',
  interac_etransfer: 'Interac e-Transfer',
  sepa_transfer: 'SEPA transfer',
};

export function PayInstructions() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [searchParams] = useSearchParams();
  const method = searchParams.get('method') || 'bank_transfer';
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState<InvoiceDetail['invoice'] | null>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const inv = await api.get<InvoiceDetail>(`/api/client/invoices/${invoiceId}`);
        if (cancelled) return;
        setInvoice(inv.invoice);
        // Generate the payment reference server-side (Step 3: prepare).
        const created = await api.post<{ reference: Reference }>('/api/client/payment-references', {
          invoiceId: inv.invoice.id,
          method,
          currency: inv.invoice.currency,
        });
        if (cancelled) return;
        setReference(created.reference);
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Unable to prepare your payment instructions. Please try again.');
        }
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, method]);

  if (phase === 'loading') {
    return <LoadingScreen message="Preparing your payment instructions…" submessage="Generating your payment reference…" />;
  }

  if (phase === 'error' || !invoice || !reference) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert tone="error" title="Unable to prepare payment instructions">
          {error || 'Please try again.'}
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Link to={`/pay/${invoiceId}`}>
              <Button variant="ghost" size="sm">
                Change payment method
              </Button>
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  const snapshot = reference.instructionsSnapshot || {};
  const isWU = reference.method === 'western_union';
  const fields: Array<[string, string]> = snapshot.profile?.fields
    ? (Object.entries(snapshot.profile.fields) as Array<[string, unknown]>)
        .map(([k, v]) => [k, String(v)] as [string, string])
        .filter(([, v]) => v.trim() !== '')
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title="Payment instructions"
        description="Follow these instructions carefully, then confirm that you have sent the payment."
        breadcrumbs={[
          { label: 'Make a payment', to: '/pay' },
          { label: invoice.invoiceRef, to: `/pay/${invoiceId}` },
          { label: 'Instructions' },
        ]}
      />
      <Stepper steps={STEPS} current={2} />

      {/* Amount + reference summary */}
      <Card className="border-brand-200 bg-brand-50/50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Amount to send</p>
            <p className="text-3xl font-bold text-navy-900">{reference.amountFormatted}</p>
            <p className="mt-1 text-sm text-slate-500">
              {invoice.invoiceRef} · Due {formatDate(invoice.dueDate)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Your payment reference</p>
            <p className="font-mono text-xl font-bold tracking-wider text-brand-700">{reference.refCode}</p>
            <p className="mt-1 text-xs text-slate-400">Quote this reference exactly</p>
          </div>
        </div>
      </Card>

      {/* Method-specific instructions */}
      <Card>
        <div className="mb-4 flex items-center gap-3">
          {isWU ? <IconGlobe className="h-6 w-6 text-brand-600" /> : <IconBank className="h-6 w-6 text-brand-600" />}
          <div>
            <h2 className="text-lg font-semibold">
              {isWU ? snapshot.displayName || 'Western Union' : 'Bank transfer'} instructions
            </h2>
            <p className="text-sm text-slate-500">
              {isWU ? 'Send your transfer via Western Union using the details below.' : `Send ${reference.amountFormatted} to the account below.`}
            </p>
          </div>
          <Badge tone="blue" className="ml-auto">
            {reference.currency}
          </Badge>
        </div>

        {isWU ? (
          <div className="space-y-4">
            {snapshot.recipientName && <CopyField label="Recipient name" value={snapshot.recipientName} />}
            {snapshot.recipientLocation && <CopyField label="Recipient location" value={snapshot.recipientLocation} />}
            {snapshot.countryOfReceipt && <CopyField label="Country of receipt" value={snapshot.countryOfReceipt} />}
            {snapshot.countries?.length > 0 && (
              <div>
                <p className="field-label">Supported countries / regions</p>
                <p className="mt-1 text-sm text-slate-700">{snapshot.countries.join(', ')}</p>
              </div>
            )}
            {snapshot.instructions && (
              <div className="panel-info text-sm text-slate-700">
                <p className="font-semibold text-navy-800">Transfer instructions</p>
                <p className="mt-1 whitespace-pre-line">{snapshot.instructions}</p>
              </div>
            )}
            {snapshot.clientInstructions && (
              <div className="panel-info text-sm text-slate-700">
                <p className="font-semibold text-navy-800">How to complete your transfer</p>
                <p className="mt-1 whitespace-pre-line">{snapshot.clientInstructions}</p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {snapshot.mtcnRequired && (
                <Alert tone="info" title="MTCN required">
                  You will receive an MTCN (Money Transfer Control Number) after sending. You must provide it when confirming your payment.
                </Alert>
              )}
              {snapshot.receiptRequired && (
                <Alert tone="info" title="Receipt required">
                  Upload your Western Union receipt when you confirm the transfer.
                </Alert>
              )}
            </div>
            {snapshot.additionalNotes && (
              <p className="text-sm text-slate-500 whitespace-pre-line">{snapshot.additionalNotes}</p>
            )}
            {snapshot.helpText && <p className="text-xs text-slate-400 whitespace-pre-line">{snapshot.helpText}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {snapshot.profile?.transferTypes?.length > 0 && (
              <div>
                <p className="field-label">Supported transfer types</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {snapshot.profile.transferTypes.map((t: string) => (
                    <Badge key={t} tone="blue">
                      {TRANSFER_TYPE_LABELS[t] || t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {fields.map(([key, value]) => (
              <CopyField key={key} label={FIELD_LABELS[key] || key.replace(/_/g, ' ')} value={String(value)} />
            ))}
            {snapshot.generalInstructions && (
              <div className="panel-info text-sm text-slate-700 whitespace-pre-line">{snapshot.generalInstructions}</div>
            )}
          </div>
        )}

        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-start gap-2">
            <IconInfo className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Send exactly <strong>{reference.amountFormatted}</strong> and quote reference{' '}
              <strong className="font-mono">{reference.refCode}</strong>. Your payment is only marked as received after our
              team verifies it — submitting this form does not confirm receipt of funds.
            </span>
          </p>
        </div>

        {snapshot.disclaimer && <p className="mt-4 text-xs text-slate-400 whitespace-pre-line">{snapshot.disclaimer}</p>}
      </Card>

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <IconClock className="h-5 w-5 text-brand-500" />
            <span>Done sending the money? Confirm it below to start verification.</span>
          </div>
          <div className="flex gap-2">
            <Link to={`/pay/${invoiceId}`}>
              <Button variant="secondary">
                <IconArrowLeft className="h-4 w-4" />
                Change method
              </Button>
            </Link>
            <Button
              btn-lg
              className="btn-lg"
              onClick={() => navigate(`/pay/${invoiceId}/submit?ref=${reference.id}`)}
            >
              <IconSend className="h-4 w-4" />
              I HAVE SENT THE MONEY
            </Button>
          </div>
        </div>
      </Card>

      <p className="text-center text-xs text-slate-400">
        <IconCheck className="mr-1 inline h-3.5 w-3.5 text-green-500" />
        Instructions generated {formatDate(reference.createdAt)} · Reference {reference.refCode}
      </p>
    </div>
  );
}
