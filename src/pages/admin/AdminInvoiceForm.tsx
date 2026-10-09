import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { todayIsoDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { IconArrowLeft, IconPlus, IconTrash } from '../../components/ui/Icons';

interface ClientOption {
  id: number;
  clientCode: string;
  fullName: string;
}

interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unitAmount: string;
}

export function AdminInvoiceForm() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const preselectedClient = Number(searchParams.get('clientId')) || 0;

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState(preselectedClient);
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [issueDate, setIssueDate] = useState(todayIsoDate());
  const [dueDate, setDueDate] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', quantity: 1, unitAmount: '' }]);
  const [useLineItems, setUseLineItems] = useState(false);
  const [amount, setAmount] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [clientsRes, brandingRes, settingsRes] = await Promise.all([
          api.get<{ clients: ClientOption[] }>('/api/admin/clients?pageSize=200'),
          api.get<{ currencies: CurrencyOption[] }>('/api/public/branding'),
          api.get<{ settings: { invoice_due_days_default: number } }>('/api/admin/settings'),
        ]);
        if (cancelled) return;
        setClients(clientsRes.clients);
        setCurrencies(brandingRes.currencies);
        const dueDays = settingsRes.settings.invoice_due_days_default || 14;
        const due = new Date();
        due.setDate(due.getDate() + dueDays);
        setDueDate(due.toISOString().slice(0, 10));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load form data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lineItemTotal = useMemo(() => {
    return lineItems.reduce((sum, li) => {
      const unit = parseFloat(li.unitAmount);
      if (Number.isNaN(unit)) return sum;
      return sum + unit * (li.quantity || 0);
    }, 0);
  }, [lineItems]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!clientId) {
      setFormError('Select a client.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        clientId,
        description,
        currency,
        issueDate,
        dueDate,
        allowPartial,
        notes,
      };
      if (useLineItems) {
        payload.lineItems = lineItems
          .filter((li) => li.description.trim())
          .map((li) => ({ description: li.description, quantity: li.quantity, unitAmount: li.unitAmount }));
      } else {
        payload.amount = amount;
      }
      const result = await api.post<{ invoice: { id: number } }>('/api/admin/invoices', payload);
      navigate(`/admin/invoices/${result.invoice.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create the invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageLoader label="Preparing invoice form…" />;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title="New invoice"
        description="Assign an invoice to a client. The server calculates and validates the amount."
        breadcrumbs={[
          { label: 'Invoices', to: '/admin/invoices' },
          { label: 'New' },
        ]}
      />

      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          {formError && <Alert tone="error">{formError}</Alert>}

          <Select
            label="Client"
            value={String(clientId)}
            onChange={(e) => setClientId(Number(e.target.value))}
            options={[
              { value: '0', label: 'Select a client…' },
              ...clients.map((c) => ({ value: String(c.id), label: `${c.fullName} (${c.clientCode})` })),
            ]}
            required
          />

          <Input
            label="Description"
            placeholder="e.g. Student visa application processing"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              options={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
              required
            />
            <Input label="Issue date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
            <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Allow partial payments for this invoice
          </label>

          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-navy-800">Amount</p>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={useLineItems} onChange={(e) => setUseLineItems(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                Use line items
              </label>
            </div>
            {useLineItems ? (
              <div className="mt-3 space-y-3">
                {lineItems.map((li, idx) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_90px_140px_40px] sm:items-end">
                    <Input
                      label={idx === 0 ? 'Description' : ''}
                      placeholder="Item description"
                      value={li.description}
                      onChange={(e) => {
                        const next = [...lineItems];
                        next[idx].description = e.target.value;
                        setLineItems(next);
                      }}
                    />
                    <Input
                      label={idx === 0 ? 'Qty' : ''}
                      type="number"
                      min={1}
                      value={String(li.quantity)}
                      onChange={(e) => {
                        const next = [...lineItems];
                        next[idx].quantity = Number(e.target.value) || 1;
                        setLineItems(next);
                      }}
                    />
                    <Input
                      label={idx === 0 ? 'Unit amount' : ''}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={li.unitAmount}
                      onChange={(e) => {
                        const next = [...lineItems];
                        next[idx].unitAmount = e.target.value;
                        setLineItems(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))}
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove line item"
                      disabled={lineItems.length === 1}
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLineItems([...lineItems, { description: '', quantity: 1, unitAmount: '' }])}>
                    <IconPlus className="h-4 w-4" />
                    Add line item
                  </Button>
                  <p className="text-sm text-slate-500">
                    Calculated total: <span className="font-semibold text-navy-900">{lineItemTotal.toFixed(2)} {currency}</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-3 max-w-xs">
                <Input
                  label="Total amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required={!useLineItems}
                />
              </div>
            )}
          </div>

          <Textarea label="Invoice notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

          <div className="flex justify-between">
            <Link to="/admin/invoices">
              <Button type="button" variant="secondary">
                <IconArrowLeft className="h-4 w-4" />
                Cancel
              </Button>
            </Link>
            <Button type="submit" loading={submitting} loadingText="Creating invoice…">
              Create invoice
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
