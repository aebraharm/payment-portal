import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatMoney, formatDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { PageLoader, LoadingScreen } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import { Stepper } from '../../components/ui/Stepper';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBank,
  IconCard,
  IconCheck,
  IconGlobe,
  IconLock,
  IconWallet,
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

interface MethodInfo {
  code: string;
  name: string;
  available: boolean;
  label?: string;
  reason?: string;
}

interface MethodsResponse {
  invoiceCurrency: string;
  methods: MethodInfo[];
  currencies: Array<{ code: string; name: string; symbol: string }>;
  settings: { cardLabel: string };
}

const STEPS = [
  { label: 'Select invoice' },
  { label: 'Payment method' },
  { label: 'Instructions' },
  { label: 'Confirm & submit' },
];

const METHOD_ICONS: Record<string, typeof IconBank> = {
  bank_transfer: IconBank,
  western_union: IconGlobe,
  card: IconCard,
};

export function PaySelectMethod() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<InvoiceDetail['invoice'] | null>(null);
  const [data, setData] = useState<MethodsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [inv, methods] = await Promise.all([
          api.get<InvoiceDetail>(`/api/client/invoices/${invoiceId}`),
          api.get<MethodsResponse>(`/api/client/payment-methods?invoiceId=${invoiceId}`),
        ]);
        if (cancelled) return;
        setInvoice(inv.invoice);
        setData(methods);
        const firstAvailable = methods.methods.find((m) => m.available);
        if (firstAvailable) setSelected(firstAvailable.code);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load payment options.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  const onContinue = async () => {
    if (!selected || !invoice) return;
    setSubmitting(true);
    navigate(`/pay/${invoiceId}/instructions?method=${encodeURIComponent(selected)}`);
  };

  if (loading) return <LoadingScreen message="Preparing your payment options…" />;

  if (error || !invoice || !data) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert tone="error" title="Unable to load payment options">
          {error || 'Please try again.'}
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Link to="/pay">
              <Button variant="ghost" size="sm">
                Back to invoices
              </Button>
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title="Make a payment"
        description="Choose how you would like to pay this invoice."
        breadcrumbs={[
          { label: 'Make a payment', to: '/pay' },
          { label: invoice.invoiceRef },
        ]}
      />
      <Stepper steps={STEPS} current={1} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <p className="font-mono text-xs text-slate-500">{invoice.invoiceRef}</p>
            <p className="font-semibold text-navy-900">{invoice.description}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-navy-900">{invoice.amountFormatted}</p>
            <p className="text-xs text-slate-400">Due {formatDate(invoice.dueDate)}</p>
          </div>
        </div>

        {/* Currency: locked to the invoice currency (no silent conversion) */}
        <div className="mt-4">
          <p className="field-label">Currency</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.currencies.map((cur) => {
              const isInvoiceCurrency = cur.code === invoice.currency;
              return (
                <div
                  key={cur.code}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                    isInvoiceCurrency
                      ? 'border-brand-300 bg-brand-50 font-semibold text-navy-900'
                      : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                  }`}
                  aria-disabled={!isInvoiceCurrency}
                >
                  <span className="font-mono text-xs">{cur.symbol}</span>
                  <span>{cur.code}</span>
                  {!isInvoiceCurrency && <IconLock className="ml-auto h-3.5 w-3.5" />}
                </div>
              );
            })}
          </div>
          <p className="field-hint">
            This invoice is billed in {invoice.currency}. Currency conversion is not performed automatically.
          </p>
        </div>

        {/* Payment methods */}
        <div className="mt-5">
          <p className="field-label">Payment method</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {data.methods.map((method) => {
              const Icon = METHOD_ICONS[method.code] || IconWallet;
              const isSelected = selected === method.code;
              const isCard = method.code === 'card';
              return (
                <button
                  key={method.code}
                  type="button"
                  disabled={!method.available}
                  onClick={() => method.available && setSelected(method.code)}
                  className={`relative flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                    !method.available
                      ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
                      : isSelected
                        ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200'
                        : 'border-slate-200 bg-white hover:border-brand-300 hover:shadow-card'
                  }`}
                  aria-pressed={isSelected}
                  aria-disabled={!method.available}
                >
                  <Icon className={`mt-0.5 h-6 w-6 ${method.available ? 'text-brand-600' : 'text-slate-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-navy-900">{method.name}</span>
                    {isCard && (
                      <span className="mt-0.5 block text-xs font-medium text-amber-700">
                        {method.label || data.settings.cardLabel}
                      </span>
                    )}
                    {!method.available && !isCard && method.reason && (
                      <span className="mt-0.5 block text-xs text-slate-500">{method.reason}</span>
                    )}
                    {method.available && (
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {method.code === 'bank_transfer'
                          ? 'Pay directly to the agency bank account'
                          : method.code === 'western_union'
                            ? 'Send via Western Union money transfer'
                            : ''}
                      </span>
                    )}
                  </span>
                  {isSelected && <IconCheck className="h-5 w-5 shrink-0 text-brand-600" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex justify-between">
          <Link to="/pay">
            <Button variant="secondary">
              <IconArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <Button onClick={onContinue} disabled={!selected} loading={submitting}>
            Continue to instructions
            <IconArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
