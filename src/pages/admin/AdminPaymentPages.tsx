import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { Alert, Badge, Button, Card, CheckboxField, EmptyState, Modal, PageHeader, SelectInput, TextArea, TextInput, useToast } from '../../components/ui';
import { AdminFrame, LoadProblem, PageSkeleton, can, useGateSession } from './AdminShared';
import { fieldErrorsFrom, formMessageFrom } from '../../components/forms';
import { CARD_UNAVAILABLE_LABEL, CURRENCIES, PAYMENT_METHOD_LABELS, SENDER_REQUIREMENT_OPTIONS } from '../../../shared/constants';
import { WU_MTCN_REQUIREMENTS, WU_RECEIPT_REQUIREMENTS } from '../../../shared/schemas';
import { fieldsFor, transferTypesFor, type BankFieldDef } from '../../../shared/bank';

interface CurrencyRow { code: string; name: string; enabled: boolean }
interface BankProfileRow {
  id: string;
  currency: string;
  transferType: string;
  transferTypeLabel?: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
  fields: Record<string, string>;
  archived?: boolean;
  usageCount?: number;
}
interface WesternUnionRow {
  enabled: boolean;
  ready?: boolean;
  config: {
    displayName: string;
    supportedCurrencies: string[];
    supportedCountries: string[];
    recipientName: string;
    recipientCity: string;
    recipientCountry: string;
    instructions: string;
    requiredSenderFields: string[];
    mtcnRequirement: string;
    receiptRequirement: string;
    additionalNotes: string;
    clientHelpText: string;
    supportText: string;
  };
}
interface PaymentConfigView {
  currencies: CurrencyRow[];
  methods: Record<'bank_transfer' | 'western_union' | 'card', boolean>;
  bankProfiles: BankProfileRow[];
  westernUnion: WesternUnionRow;
  card: { available: false; label: string; note: string };
}

export function AdminPaymentPage() {
  const session = useGateSession();
  const writable = can(session, 'payment_config:write');
  const data = useAsync(() => api.get<PaymentConfigView>('/admin/payment-config'), []);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ profile: BankProfileRow | null; currency: string } | null>(null);

  async function toggle(path: string, enabled: boolean, done: string) {
    setError(null);
    try {
      await api.put(path, { enabled });
      toast('success', done);
      data.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader title="Payment setup" description="Choose which currencies and methods clients can use, and maintain the bank and Western Union details shown on payment references." />
        {error && <Alert tone="danger">{error}</Alert>}
        {data.loading && <PageSkeleton />}
        {data.error ? <LoadProblem error={data.error} onRetry={data.reload} /> : null}
        {data.data && (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Currencies" description="A currency must be enabled, and have an active bank account for bank transfers, before clients can pay in it. Currencies are never converted.">
                <ul className="divide-y divide-slate-100">
                  {CURRENCIES.map((code) => {
                    const row = data.data!.currencies.find((c) => c.code === code);
                    const enabled = row?.enabled ?? false;
                    return (
                      <li key={code} className="flex items-center justify-between gap-3 py-3">
                        <div>
                          <p className="font-medium text-slate-900">{code}</p>
                          <p className="text-xs text-slate-500">{row?.name ?? code} · {data.data!.bankProfiles.filter((b) => b.currency === code && b.enabled && !b.archived).length} active bank profile(s)</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge tone={enabled ? 'success' : 'muted'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
                          {writable && <Button variant="secondary" onClick={() => void toggle(`/admin/payment-config/currencies/${code}`, !enabled, `${code} ${enabled ? 'disabled' : 'enabled'}.`)}>{enabled ? 'Disable' : 'Enable'}<span className="sr-only"> {code}</span></Button>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <Card title="Methods">
                <ul className="divide-y divide-slate-100">
                  <li className="flex items-center justify-between gap-3 py-3">
                    <div><p className="font-medium">{PAYMENT_METHOD_LABELS.bank_transfer}</p><p className="text-xs text-slate-500">Shown when an active bank profile exists for the invoice currency.</p></div>
                    <div className="flex items-center gap-3"><Badge tone={data.data.methods.bank_transfer ? 'success' : 'muted'}>{data.data.methods.bank_transfer ? 'On' : 'Off'}</Badge>{writable && <Button variant="secondary" onClick={() => void toggle('/admin/payment-config/methods/bank_transfer', !data.data!.methods.bank_transfer, 'Bank transfer updated.')}>{data.data.methods.bank_transfer ? 'Turn off' : 'Turn on'}</Button>}</div>
                  </li>
                  <li className="flex items-center justify-between gap-3 py-3">
                    <div><p className="font-medium">{data.data.westernUnion.config.displayName || PAYMENT_METHOD_LABELS.western_union}</p><p className="text-xs text-slate-500">{data.data.westernUnion.ready ? 'Configured.' : 'Needs supported currencies, a recipient and instructions before it can be shown.'} Submissions are unverified until reviewed. Switch it on in the Western Union section below.</p></div>
                    <Badge tone={data.data.methods.western_union ? 'success' : 'muted'}>{data.data.methods.western_union ? 'On' : 'Off'}</Badge>
                  </li>
                  <li className="flex items-center justify-between gap-3 py-3">
                    <div><p className="font-medium text-slate-500">Card</p><p className="text-xs text-slate-500">{data.data.card.note}</p></div>
                    <Badge tone="muted">{CARD_UNAVAILABLE_LABEL}</Badge>
                  </li>
                </ul>
              </Card>
            </div>

            <Card title="Bank accounts" description="Each account lists the fields clients see. Bank details are never stored in the frontend and never invented by the system."
              actions={writable ? <Button onClick={() => setEditing({ profile: null, currency: 'USD' })}>Add bank account</Button> : undefined}>
              {data.data.bankProfiles.length === 0 ? (
                <EmptyState title="No bank accounts yet">Add the bank details for each currency you accept.</EmptyState>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.data.bankProfiles.map((profile) => (
                    <li key={profile.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium text-slate-900">{profile.label}</p>
                        <p className="text-xs text-slate-500">{profile.currency} · {profile.transferTypeLabel ?? profile.transferType} · order {profile.sortOrder}{profile.archived ? ' · archived' : ''}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={profile.enabled && !profile.archived ? 'success' : 'muted'}>{profile.enabled && !profile.archived ? 'Active' : 'Inactive'}</Badge>
                        {writable && <Button variant="secondary" onClick={() => setEditing({ profile, currency: profile.currency })}>Edit<span className="sr-only"> {profile.label}</span></Button>}
                        {writable && <DeleteProfileButton id={profile.id} onDone={(message) => { toast('info', message); data.reload(); }} onError={setError} />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <WesternUnionCard value={data.data.westernUnion} writable={writable} onSaved={() => { toast('success', 'Western Union settings saved.'); data.reload(); }} onError={setError} />
          </>
        )}
        {editing && <BankProfileDialog key={editing.profile?.id ?? 'new'} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('success', 'Bank account saved.'); data.reload(); }} />}
      </div>
    </AdminFrame>
  );
}

function DeleteProfileButton({ id, onDone, onError }: { id: string; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      loading={busy}
      onClick={async () => {
        if (!window.confirm('Remove this bank account? If clients have already used it, it will be archived and hidden instead of deleted.')) return;
        setBusy(true);
        try {
          const result = await api.delete<{ result: string }>(`/admin/payment-config/bank-profiles/${id}`);
          onDone(result.result === 'archived' ? 'Bank account archived because it appears in payment history.' : 'Bank account removed.');
        } catch (err) {
          onError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      Remove
    </Button>
  );
}

function BankProfileDialog({ initial, onClose, onSaved }: { initial: { profile: BankProfileRow | null; currency: string }; onClose: () => void; onSaved: () => void }) {
  const profile = initial.profile;
  const [currency, setCurrency] = useState(profile?.currency ?? initial.currency);
  const types = transferTypesFor(currency as (typeof CURRENCIES)[number]);
  const [transferType, setTransferType] = useState(profile?.transferType ?? types[0]?.value ?? '');
  const [label, setLabel] = useState(profile?.label ?? '');
  const [sortOrder, setSortOrder] = useState(String(profile?.sortOrder ?? 0));
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [values, setValues] = useState<Record<string, string>>(profile?.fields ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields: BankFieldDef[] = transferType ? fieldsFor(currency as (typeof CURRENCIES)[number], transferType) : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const body = { currency, transferType, label, enabled, sortOrder: Number(sortOrder) || 0, fields: values };
    try {
      if (profile) await api.patch(`/admin/payment-config/bank-profiles/${profile.id}`, body);
      else await api.post('/admin/payment-config/bank-profiles', body);
      onSaved();
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      setFormError(formMessageFrom(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={profile ? 'Edit bank account' : 'Add bank account'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="bank-form" loading={busy}>Save bank account</Button></>}>
      <form id="bank-form" noValidate onSubmit={submit} className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectInput label="Currency" value={currency} onChange={(e) => { setCurrency(e.target.value); setTransferType(transferTypesFor(e.target.value as (typeof CURRENCIES)[number])[0]?.value ?? ''); setValues({}); }} disabled={Boolean(profile)}>
            {CURRENCIES.map((code) => (<option key={code} value={code}>{code}</option>))}
          </SelectInput>
          <SelectInput label="Transfer type" value={transferType} onChange={(e) => { setTransferType(e.target.value); setValues({}); }} error={errors.transferType}>
            {types.map((type) => (<option key={type.value} value={type.value}>{type.label}</option>))}
          </SelectInput>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <TextInput label="Label shown to clients" required value={label} onChange={(e) => setLabel(e.target.value)} error={errors.label} />
          <TextInput label="Order" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} error={errors.sortOrder} />
        </div>
        <CheckboxField label="Active (clients can be shown this account)" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <fieldset className="space-y-4 border-t border-slate-200 pt-4">
          <legend className="text-sm font-semibold text-slate-900">Account details</legend>
          {fields.map((def) => {
            const isRequired = def.requiredFor.includes(transferType as never);
            const value = values[def.key] ?? '';
            const set = (next: string) => setValues({ ...values, [def.key]: next });
            const error = errors[`fields.${def.key}`] ?? errors[def.key];
            return def.kind === 'multiline' ? (
              <TextArea key={def.key} label={def.label} required={isRequired} value={value} onChange={(e) => set(e.target.value)} error={error} hint={def.help} />
            ) : (
              <TextInput key={def.key} label={def.label} required={isRequired} value={value} onChange={(e) => set(e.target.value)} error={error} hint={def.help} />
            );
          })}
          {fields.length === 0 && <p className="text-sm text-slate-500">Choose a transfer type to see its fields.</p>}
        </fieldset>
        <p className="text-xs text-slate-500">Check every value against your bank statement before saving. Clients see these values exactly as entered, and each payment reference keeps the values from the time it was issued.</p>
      </form>
    </Modal>
  );
}

function WesternUnionCard({ value, writable, onSaved, onError }: { value: WesternUnionRow; writable: boolean; onSaved: () => void; onError: (message: string) => void }) {
  const [enabled, setEnabled] = useState(value.enabled);
  const [cfg, setCfg] = useState(value.config);
  const [countries, setCountries] = useState(cfg.supportedCountries.join(', '));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof cfg>(key: K, next: (typeof cfg)[K]) => setCfg({ ...cfg, [key]: next });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const config = { ...cfg, supportedCountries: countries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) };
      await api.put('/admin/payment-config/western-union', { enabled, config });
      onSaved();
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      onError(formMessageFrom(err) ?? 'Western Union settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Western Union" description="Shown separately from bank transfers. Submissions for this method stay unverified until an authorised reviewer checks them.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <CheckboxField label="Offer Western Union to clients" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!writable} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name shown to clients" value={cfg.displayName} onChange={(e) => set('displayName', e.target.value)} error={errors.displayName} disabled={!writable} />
          <TextInput label="Recipient name" value={cfg.recipientName} onChange={(e) => set('recipientName', e.target.value)} error={errors.recipientName} disabled={!writable} />
          <TextInput label="Recipient city" value={cfg.recipientCity} onChange={(e) => set('recipientCity', e.target.value)} error={errors.recipientCity} disabled={!writable} />
          <TextInput label="Recipient country (2-letter code)" maxLength={2} value={cfg.recipientCountry} onChange={(e) => set('recipientCountry', e.target.value.toUpperCase())} error={errors.recipientCountry} disabled={!writable} />
          <TextInput label="Countries clients may send from" value={countries} onChange={(e) => setCountries(e.target.value)} hint="Comma-separated 2-letter codes, for example NG, GB, US." error={errors.supportedCountries} disabled={!writable} />
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Currencies accepted</legend>
            <div className="flex flex-wrap gap-3">
              {CURRENCIES.map((code) => (
                <label key={code} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 rounded border-slate-300 text-brand-600" disabled={!writable} checked={cfg.supportedCurrencies.includes(code)} onChange={(e) => set('supportedCurrencies', e.target.checked ? [...cfg.supportedCurrencies, code] : cfg.supportedCurrencies.filter((c) => c !== code))} />{code}</label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Sender details required</legend>
            <div className="flex flex-wrap gap-3">
              {SENDER_REQUIREMENT_OPTIONS.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 rounded border-slate-300 text-brand-600" disabled={!writable} checked={cfg.requiredSenderFields.includes(option)} onChange={(e) => set('requiredSenderFields', e.target.checked ? [...cfg.requiredSenderFields, option] : cfg.requiredSenderFields.filter((o) => o !== option))} />{option.replace(/_/g, ' ')}</label>
              ))}
            </div>
          </fieldset>
          <SelectInput label="MTCN (tracking number)" value={cfg.mtcnRequirement} onChange={(e) => set('mtcnRequirement', e.target.value)} disabled={!writable}>
            {WU_MTCN_REQUIREMENTS.map((option) => (<option key={option} value={option}>{option.replace(/_/g, ' ')}</option>))}
          </SelectInput>
          <SelectInput label="Receipt" value={cfg.receiptRequirement} onChange={(e) => set('receiptRequirement', e.target.value)} disabled={!writable}>
            {WU_RECEIPT_REQUIREMENTS.map((option) => (<option key={option} value={option}>{option}</option>))}
          </SelectInput>
        </div>
        <TextArea label="Instructions for clients" value={cfg.instructions} onChange={(e) => set('instructions', e.target.value)} error={errors.instructions} disabled={!writable} />
        <TextArea label="Additional notes" value={cfg.additionalNotes} onChange={(e) => set('additionalNotes', e.target.value)} error={errors.additionalNotes} disabled={!writable} />
        {writable && <Button type="submit" loading={busy}>Save Western Union settings</Button>}
      </form>
    </Card>
  );
}
