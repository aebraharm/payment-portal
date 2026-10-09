import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Tabs } from '../../components/ui/Tabs';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  IconBank,
  IconGlobe,
  IconPlus,
  IconSettings,
  IconTrash,
  IconWallet,
} from '../../components/ui/Icons';

interface SchemaResponse {
  currencyFields: Record<string, Array<{ key: string; label: string; required?: boolean; multiline?: boolean; patternHint?: string }>>;
  transferTypes: Record<string, Array<{ value: string; label: string }>>;
  wuSenderInfoOptions: string[];
  wuRecipientInfoOptions: string[];
  cardLabel: string;
}

interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  enabled: boolean;
  sort_order: number;
}

interface MethodRow {
  code: string;
  name: string;
  enabled: boolean;
  sort_order: number;
  config: Record<string, unknown>;
}

interface BankProfile {
  id: number;
  currency: string;
  profileName: string;
  transferTypes: string[];
  fields: Record<string, string>;
  enabled: boolean;
  sortOrder: number;
}

interface WUConfig {
  displayName: string;
  currencies: string[];
  countries: string[];
  recipientName: string | null;
  recipientLocation: string | null;
  countryOfReceipt: string | null;
  instructions: string | null;
  requiredSenderInfo: string[];
  requiredRecipientInfo: string[];
  mtcnRequired: boolean;
  receiptRequired: boolean;
  additionalNotes: string | null;
  clientInstructions: string | null;
  helpText: string | null;
  enabled: boolean;
}

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'];

export function AdminPaymentSettings() {
  const [tab, setTab] = useState('general');
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [methods, setMethods] = useState<MethodRow[]>([]);
  const [profiles, setProfiles] = useState<BankProfile[]>([]);
  const [wu, setWu] = useState<WUConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [schemaRes, currenciesRes, methodsRes, profilesRes, wuRes] = await Promise.all([
        api.get<SchemaResponse>('/api/admin/payment-config/schema'),
        api.get<{ currencies: CurrencyRow[] }>('/api/admin/currencies'),
        api.get<{ methods: MethodRow[] }>('/api/admin/payment-methods'),
        api.get<{ profiles: BankProfile[] }>('/api/admin/bank-instructions'),
        api.get<{ config: WUConfig }>('/api/admin/western-union'),
      ]);
      setSchema(schemaRes);
      setCurrencies(currenciesRes.currencies);
      setMethods(methodsRes.methods);
      setProfiles(profilesRes.profiles);
      setWu(wuRes.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load payment settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const flashSaved = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(null), 3000);
  };

  if (loading) return <PageLoader label="Loading payment settings…" />;
  if (error || !schema || !wu) {
    return (
      <Alert tone="error" title="Unable to load payment settings">
        {error}
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Payment settings"
        description="Configure currencies, payment methods, bank instructions and Western Union. Changes apply to new payment instructions immediately."
      />
      {saved && <Alert tone="success">{saved}</Alert>}

      <Tabs
        tabs={[
          { id: 'general', label: 'General', icon: <IconSettings className="h-4 w-4" /> },
          { id: 'USD', label: 'USD', icon: <IconBank className="h-4 w-4" /> },
          { id: 'CAD', label: 'CAD', icon: <IconBank className="h-4 w-4" /> },
          { id: 'EUR', label: 'EUR', icon: <IconBank className="h-4 w-4" /> },
          { id: 'GBP', label: 'GBP', icon: <IconBank className="h-4 w-4" /> },
          { id: 'western_union', label: 'Western Union', icon: <IconGlobe className="h-4 w-4" /> },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'general' && (
        <GeneralTab
          currencies={currencies}
          methods={methods}
          cardLabel={schema.cardLabel}
          onSaved={flashSaved}
          onChanged={load}
        />
      )}
      {CURRENCIES.includes(tab) && (
        <BankProfilesTab
          currency={tab}
          schema={schema}
          profiles={profiles.filter((p) => p.currency === tab)}
          onChanged={load}
          onSaved={flashSaved}
        />
      )}
      {tab === 'western_union' && <WesternUnionTab config={wu} currencies={currencies} schema={schema} onSaved={flashSaved} onChanged={load} />}
    </div>
  );
}

// ------------------------------------------------------------- General tab --

function GeneralTab({
  currencies,
  methods,
  cardLabel,
  onSaved,
  onChanged,
}: {
  currencies: CurrencyRow[];
  methods: MethodRow[];
  cardLabel: string;
  onSaved: (msg: string) => void;
  onChanged: () => void;
}) {
  const [localCurrencies, setLocalCurrencies] = useState(currencies);
  const [localMethods, setLocalMethods] = useState(methods);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);

  useEffect(() => setLocalCurrencies(currencies), [currencies]);
  useEffect(() => setLocalMethods(methods), [methods]);

  const saveCurrencies = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put('/api/admin/currencies', {
        currencies: localCurrencies.map((c, i) => ({
          code: c.code,
          name: c.name,
          symbol: c.symbol,
          enabled: c.enabled,
          sortOrder: i,
        })),
      });
      onSaved('Currency settings saved.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save currencies.');
    } finally {
      setSaving(false);
    }
  };

  const saveMethods = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put('/api/admin/payment-methods', {
        methods: localMethods.map((m, i) => ({ code: m.code, name: m.name, enabled: m.enabled, sortOrder: i })),
      });
      onSaved('Payment method availability saved.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save payment methods.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Currencies" description="Enable the currencies clients can pay in. Only enabled currencies appear in client workflows." />
        {error && <Alert tone="error">{error}</Alert>}
        <div className="space-y-3">
          {localCurrencies.map((c, i) => (
            <div key={c.code} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <span className="w-12 font-mono text-sm font-bold text-navy-900">{c.code}</span>
              <div className="min-w-0 flex-1">
                <Input aria-label={`${c.code} name`} value={c.name} onChange={(e) => {
                  const next = [...localCurrencies];
                  next[i].name = e.target.value;
                  setLocalCurrencies(next);
                }} />
              </div>
              <div className="w-20">
                <Input aria-label={`${c.code} symbol`} value={c.symbol} onChange={(e) => {
                  const next = [...localCurrencies];
                  next[i].symbol = e.target.value;
                  setLocalCurrencies(next);
                }} />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => {
                    const next = [...localCurrencies];
                    next[i].enabled = e.target.checked;
                    setLocalCurrencies(next);
                  }}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Enabled
              </label>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Button onClick={saveCurrencies} loading={saving}>
            Save currencies
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Payment methods" description="Enable or disable the payment methods clients can choose. Disabling a method prevents new selections immediately." />
        <div className="space-y-3">
          {localMethods.map((m, i) => {
            const isCard = m.code === 'card';
            return (
              <div key={m.code} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <span className="min-w-0 flex-1 text-sm font-semibold text-navy-900">{m.name}</span>
                {isCard && <Badge tone="amber">{cardLabel}</Badge>}
                {isCard ? (
                  <Button variant="secondary" size="sm" onClick={() => setCardOpen(true)}>
                    Configure
                  </Button>
                ) : (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={(e) => {
                        const next = [...localMethods];
                        next[i].enabled = e.target.checked;
                        setLocalMethods(next);
                      }}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Enabled
                  </label>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4">
          <Button onClick={saveMethods} loading={saving}>
            Save method availability
          </Button>
        </div>
      </Card>

      <CardOpenModal open={cardOpen} onClose={() => setCardOpen(false)} methods={methods} cardLabel={cardLabel} onSaved={onSaved} onChanged={onChanged} />
    </div>
  );
}

function CardOpenModal({
  open,
  onClose,
  methods,
  cardLabel,
  onSaved,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  methods: MethodRow[];
  cardLabel: string;
  onSaved: (msg: string) => void;
  onChanged: () => void;
}) {
  const card = methods.find((m) => m.code === 'card');
  const config = (card?.config || {}) as { processorName?: string | null; regionVerified?: boolean };
  const [enabled, setEnabled] = useState(!!card?.enabled);
  const [processorName, setProcessorName] = useState(config.processorName || '');
  const [regionVerified, setRegionVerified] = useState(!!config.regionVerified);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put('/api/admin/card-config', { enabled, processorName, regionVerified });
      onSaved('Card payment configuration saved.');
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save card configuration.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Card payment configuration"
      description={`The client-facing label is fixed: "${cardLabel}".`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} loading={saving}>
            Save configuration
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Alert tone="info" title={cardLabel}>
          In this version the card option is always shown to clients as unavailable. Enabling it here only records
          that a processor and regional eligibility are in place — a real provider integration (hosted checkout) is
          required before clients can actually pay by card. No card numbers are ever collected by this portal.
        </Alert>
        <Input
          label="Payment processor name"
          placeholder="e.g. Stripe, Flutterwave, Paystack"
          value={processorName}
          onChange={(e) => setProcessorName(e.target.value)}
          hint="Required before card payments can be enabled."
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={regionVerified} onChange={(e) => setRegionVerified(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Regional eligibility verified
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Mark card payments as configured
        </label>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------- Bank profile tabs --

function BankProfilesTab({
  currency,
  schema,
  profiles,
  onChanged,
  onSaved,
}: {
  currency: string;
  schema: SchemaResponse;
  profiles: BankProfile[];
  onChanged: () => void;
  onSaved: (msg: string) => void;
}) {
  const [editing, setEditing] = useState<BankProfile | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BankProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleEnabled = async (profile: BankProfile) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/bank-instructions/${profile.id}/enable`, { enabled: !profile.enabled });
      onSaved(`Profile ${profile.enabled ? 'disabled' : 'enabled'}.`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update the profile.');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/admin/bank-instructions/${deleteTarget.id}`);
      setDeleteTarget(null);
      onSaved('Profile deleted.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the profile.');
    } finally {
      setBusy(false);
    }
  };

  const fields = schema.currencyFields[currency] || [];
  const transferTypes = schema.transferTypes[currency] || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`${currency} bank instructions`}
          description="Multiple profiles per currency are supported. Clients see the first enabled profile. Changes apply to newly issued instructions only — historical snapshots are preserved."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <IconPlus className="h-4 w-4" />
              New profile
            </Button>
          }
        />
        {error && <Alert tone="error">{error}</Alert>}
        {profiles.length === 0 ? (
          <EmptyState
            icon={<IconBank className="h-10 w-10" />}
            title={`No ${currency} instruction profiles`}
            description={`Clients cannot pay in ${currency} by bank transfer until you add a profile.`}
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <IconPlus className="h-4 w-4" />
                New profile
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {profiles.map((profile) => (
              <div key={profile.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-navy-900">{profile.profileName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {profile.transferTypes
                        .map((t) => transferTypes.find((tt) => tt.value === t)?.label || t)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={profile.enabled ? 'green' : 'slate'}>{profile.enabled ? 'Enabled' : 'Disabled'}</Badge>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(profile)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleEnabled(profile)} disabled={busy}>
                      {profile.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setDeleteTarget(profile)}
                      aria-label="Delete profile"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  {Object.entries(profile.fields)
                    .filter(([, v]) => String(v).trim())
                    .slice(0, 6)
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <dt className="text-slate-400">{fields.find((f) => f.key === k)?.label || k}</dt>
                        <dd className="truncate font-mono text-slate-600">{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ProfileFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        currency={currency}
        schema={schema}
        profile={null}
        onSaved={(msg) => {
          setCreateOpen(false);
          onSaved(msg);
          onChanged();
        }}
      />
      <ProfileFormModal
        open={!!editing}
        onClose={() => setEditing(null)}
        currency={currency}
        schema={schema}
        profile={editing}
        onSaved={(msg) => {
          setEditing(null);
          onSaved(msg);
          onChanged();
        }}
      />
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        loading={busy}
        tone="danger"
        title="Delete this instruction profile?"
        description={
          deleteTarget
            ? `"${deleteTarget.profileName}" (${deleteTarget.currency}) will be deleted. Profiles referenced by issued payment references cannot be deleted.`
            : ''
        }
        confirmLabel="Delete profile"
      />
    </div>
  );
}

function ProfileFormModal({
  open,
  onClose,
  currency,
  schema,
  profile,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  currency: string;
  schema: SchemaResponse;
  profile: BankProfile | null;
  onSaved: (msg: string) => void;
}) {
  const fields = schema.currencyFields[currency] || [];
  const transferTypes = schema.transferTypes[currency] || [];
  const [profileName, setProfileName] = useState(profile?.profileName || '');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(profile?.transferTypes || []);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(profile?.fields || {});
  const [enabled, setEnabled] = useState(profile ? profile.enabled : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProfileName(profile?.profileName || '');
      setSelectedTypes(profile?.transferTypes || []);
      setFieldValues(profile?.fields || {});
      setEnabled(profile ? profile.enabled : true);
      setError(null);
    }
  }, [open, profile]);

  const toggleType = (value: string) => {
    setSelectedTypes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        currency,
        profileName,
        transferTypes: selectedTypes,
        fields: fieldValues,
        enabled,
        sortOrder: profile?.sortOrder ?? 0,
      };
      if (profile) {
        await api.put(`/api/admin/bank-instructions/${profile.id}`, payload);
        onSaved('Profile updated.');
      } else {
        await api.post('/api/admin/bank-instructions', payload);
        onSaved('Profile created.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={profile ? `Edit ${currency} profile` : `New ${currency} profile`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bank-profile-form" loading={saving} loadingText="Saving…">
            {profile ? 'Save changes' : 'Create profile'}
          </Button>
        </>
      }
    >
      <form id="bank-profile-form" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Profile name" placeholder="e.g. Primary USD account" value={profileName} onChange={(e) => setProfileName(e.target.value)} required />
        <div>
          <p className="field-label">Supported transfer types *</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {transferTypes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleType(t.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedTypes.includes(t.value)
                    ? 'border-brand-400 bg-brand-50 text-brand-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
                aria-pressed={selectedTypes.includes(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) =>
            f.multiline ? (
              <div key={f.key} className="sm:col-span-2">
                <Textarea
                  label={`${f.label}${f.required ? ' *' : ''}`}
                  value={fieldValues[f.key] || ''}
                  onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.value })}
                  required={f.required}
                />
              </div>
            ) : (
              <Input
                key={f.key}
                label={`${f.label}${f.required ? ' *' : ''}`}
                value={fieldValues[f.key] || ''}
                onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.value })}
                required={f.required}
                hint={f.patternHint}
              />
            )
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Profile enabled (clients can use it)
        </label>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------ Western Union tab --

const WU_SENDER_LABELS: Record<string, string> = {
  sender_full_name: 'Sender full name',
  sender_address: 'Sender address',
  sender_phone: 'Sender phone',
  sender_id_document: 'Sender ID document',
};

const WU_RECIPIENT_LABELS: Record<string, string> = {
  recipient_full_name: 'Recipient full name',
  recipient_phone: 'Recipient phone',
  recipient_address: 'Recipient address',
};

function WesternUnionTab({
  config,
  currencies,
  schema,
  onSaved,
  onChanged,
}: {
  config: WUConfig;
  currencies: CurrencyRow[];
  schema: SchemaResponse;
  onSaved: (msg: string) => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<WUConfig>(config);
  const [countriesText, setCountriesText] = useState((config.countries || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(config);
    setCountriesText((config.countries || []).join(', '));
  }, [config]);

  const set = <K extends keyof WUConfig>(key: K, value: WUConfig[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleCurrency = (code: string) => {
    setForm((prev) => ({
      ...prev,
      currencies: prev.currencies.includes(code)
        ? prev.currencies.filter((c) => c !== code)
        : [...prev.currencies, code],
    }));
  };

  const toggleArray = (key: 'requiredSenderInfo' | 'requiredRecipientInfo', value: string) => {
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value],
    }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.put('/api/admin/western-union', {
        ...form,
        countries: countriesText
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      });
      onSaved('Western Union configuration saved.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the Western Union configuration.');
    } finally {
      setSaving(false);
    }
  };

  const enabledCurrencies = currencies.filter((c) => c.enabled);

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader
          title="Western Union configuration"
          description="Configure the dedicated Western Union transfer option independently of bank transfers. Submitted transfers remain unverified until reviewed."
          action={<Badge tone={form.enabled ? 'green' : 'slate'}>{form.enabled ? 'Enabled' : 'Disabled'}</Badge>}
        />
        {error && <Alert tone="error">{error}</Alert>}
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Display name" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} required />
            <Input label="Recipient name" value={form.recipientName || ''} onChange={(e) => set('recipientName', e.target.value)} required={form.enabled} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Recipient location" value={form.recipientLocation || ''} onChange={(e) => set('recipientLocation', e.target.value)} />
            <Input label="Country of receipt" value={form.countryOfReceipt || ''} onChange={(e) => set('countryOfReceipt', e.target.value)} />
          </div>
          <div>
            <p className="field-label">Supported currencies *</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {enabledCurrencies.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleCurrency(c.code)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.currencies.includes(c.code)
                      ? 'border-brand-400 bg-brand-50 text-brand-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                  aria-pressed={form.currencies.includes(c.code)}
                >
                  {c.code}
                </button>
              ))}
            </div>
          </div>
          <Input
            label="Supported countries / regions"
            hint="Comma-separated, e.g. Nigeria, Ghana, Kenya"
            value={countriesText}
            onChange={(e) => setCountriesText(e.target.value)}
          />
          <Textarea label="Transfer instructions" value={form.instructions || ''} onChange={(e) => set('instructions', e.target.value)} />
          <Textarea label="Client-facing instructions" hint="Step-by-step guidance shown to clients after they select Western Union." value={form.clientInstructions || ''} onChange={(e) => set('clientInstructions', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="field-label">Required sender information</p>
              <div className="mt-2 space-y-1.5">
                {schema.wuSenderInfoOptions.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={form.requiredSenderInfo.includes(opt)}
                      onChange={() => toggleArray('requiredSenderInfo', opt)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {WU_SENDER_LABELS[opt] || opt}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="field-label">Required recipient information</p>
              <div className="mt-2 space-y-1.5">
                {schema.wuRecipientInfoOptions.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={form.requiredRecipientInfo.includes(opt)}
                      onChange={() => toggleArray('requiredRecipientInfo', opt)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {WU_RECIPIENT_LABELS[opt] || opt}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.mtcnRequired} onChange={(e) => set('mtcnRequired', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Require MTCN / transfer tracking reference
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.receiptRequired} onChange={(e) => set('receiptRequired', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Require receipt upload
            </label>
          </div>
          <Textarea label="Additional notes" value={form.additionalNotes || ''} onChange={(e) => set('additionalNotes', e.target.value)} />
          <Textarea label="Help and support text" value={form.helpText || ''} onChange={(e) => set('helpText', e.target.value)} />
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Enable Western Union for clients
          </label>
          {!form.enabled && (
            <Alert tone="info">Western Union is disabled. Clients will not see this option.</Alert>
          )}
          <div>
            <Button type="submit" loading={saving} loadingText="Saving…">
              <IconWallet className="h-4 w-4" />
              Save Western Union configuration
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
