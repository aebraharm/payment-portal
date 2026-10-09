import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { useBranding } from '../../context/BrandingContext';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { FileUpload } from '../../components/ui/FileUpload';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { Tabs } from '../../components/ui/Tabs';
import { IconCheck, IconEye, IconTrash, IconUpload } from '../../components/ui/Icons';

type Settings = Record<string, any>;

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function AdminBrandingSettings() {
  const { reload } = useBranding();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState('branding');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Settings | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ settings: Settings }>('/api/admin/settings');
      setSettings(result.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const set = <K extends string>(key: K, value: Settings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setPreview(null);
  };

  const validate = (): string | null => {
    if (!settings) return null;
    if (!settings.site_title?.trim()) return 'Website title is required.';
    for (const key of ['primary_color', 'secondary_color']) {
      if (settings[key] && !HEX_RE.test(settings[key])) return `${key === 'primary_color' ? 'Primary' : 'Secondary'} color must be a hex color like #2563eb.`;
    }
    for (const key of ['contact_email', 'support_email']) {
      const v = settings[key];
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `${key} must be a valid email address.`;
    }
    if (settings.website_url && !/^https?:\/\/\S+$/i.test(settings.website_url)) {
      return 'Website URL must be a valid http(s) URL.';
    }
    const prefixRe = /^[A-Za-z][A-Za-z0-9-]{0,9}$/;
    if (!prefixRe.test(settings.invoice_ref_prefix || '')) return 'Invoice reference prefix must start with a letter (max 10 chars, letters/digits/dashes).';
    if (!prefixRe.test(settings.transaction_ref_prefix || '')) return 'Transaction reference prefix must start with a letter (max 10 chars, letters/digits/dashes).';
    return null;
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    const validationError = validate();
    if (validationError) {
      setMessage(null);
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.put('/api/admin/settings', { settings });
      setMessage('Settings saved. Changes are live across the portals.');
      setPreview(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const onPreview = async () => {
    if (!settings) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const result = await api.post<{ preview: Settings }>('/api/admin/settings/preview', { settings });
      setPreview(result.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate preview.');
    } finally {
      setPreviewing(false);
    }
  };

  const onLogoUpload = async () => {
    if (!logoFile) return;
    setLogoBusy(true);
    setLogoError(null);
    try {
      const formData = new FormData();
      formData.append('logo', logoFile);
      await api.postForm('/api/admin/settings/logo', formData);
      setLogoFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
      await reload();
      setMessage('Logo uploaded.');
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Unable to upload the logo.');
    } finally {
      setLogoBusy(false);
    }
  };

  const onLogoRemove = async () => {
    setLogoBusy(true);
    setLogoError(null);
    try {
      await api.del('/api/admin/settings/logo');
      await load();
      await reload();
      setMessage('Logo removed.');
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Unable to remove the logo.');
    } finally {
      setLogoBusy(false);
    }
  };

  if (loading || !settings) return <PageLoader label="Loading settings…" />;

  const previewBranding = preview || {
    agencyName: settings.agency_name,
    siteTitle: settings.site_title,
    loginHeading: settings.login_heading,
    loginDescription: settings.login_description,
    welcomeMessage: settings.welcome_message,
    footerText: settings.footer_text,
    primaryColor: settings.primary_color,
    secondaryColor: settings.secondary_color,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Branding & settings"
        description="All agency information is editable here and saved to the database — no code changes required. Secrets and credentials are never stored in these settings."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      <Tabs
        tabs={[
          { id: 'branding', label: 'Branding' },
          { id: 'content', label: 'Content & legal' },
          { id: 'workflow', label: 'Workflow & notifications' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <form onSubmit={onSave}>
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            {tab === 'branding' && (
              <>
                <Card>
                  <CardHeader title="Identity" description="Shown across both portals." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Agency name" value={settings.agency_name || ''} onChange={(e) => set('agency_name', e.target.value)} hint="Leave empty to show the neutral product name." />
                    <Input label="Website title" value={settings.site_title || ''} onChange={(e) => set('site_title', e.target.value)} required />
                    <Input label="Contact email" type="email" value={settings.contact_email || ''} onChange={(e) => set('contact_email', e.target.value)} />
                    <Input label="Telephone number" value={settings.contact_phone || ''} onChange={(e) => set('contact_phone', e.target.value)} />
                    <Input label="Office address" value={settings.office_address || ''} onChange={(e) => set('office_address', e.target.value)} />
                    <Input label="Website URL" value={settings.website_url || ''} onChange={(e) => set('website_url', e.target.value)} placeholder="https://…" />
                    <Input label="WhatsApp number" value={settings.whatsapp_number || ''} onChange={(e) => set('whatsapp_number', e.target.value)} />
                    <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={!!settings.whatsapp_enabled}
                        onChange={(e) => set('whatsapp_enabled', e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Show WhatsApp contact
                    </label>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Brand colors" description="Applied live across both portals." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Input label="Primary color" value={settings.primary_color || ''} onChange={(e) => set('primary_color', e.target.value)} placeholder="#2563eb" />
                      <div className="mt-2 h-8 w-full rounded-lg border border-slate-200" style={{ backgroundColor: HEX_RE.test(settings.primary_color || '') ? settings.primary_color : '#2563eb' }} aria-hidden="true" />
                    </div>
                    <div>
                      <Input label="Secondary (navy) color" value={settings.secondary_color || ''} onChange={(e) => set('secondary_color', e.target.value)} placeholder="#0b2447" />
                      <div className="mt-2 h-8 w-full rounded-lg border border-slate-200" style={{ backgroundColor: HEX_RE.test(settings.secondary_color || '') ? settings.secondary_color : '#0b2447' }} aria-hidden="true" />
                    </div>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Logo" description="PNG, JPG or WebP, up to 2 MB. If no logo is configured, a neutral placeholder is shown." />
                  {logoError && <Alert tone="error">{logoError}</Alert>}
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <BrandLogo size="md" />
                    </div>
                    <div className="flex-1">
                      <FileUpload
                        label="Upload new logo"
                        accept=".png,.jpg,.jpeg,.webp"
                        maxSizeMb={2}
                        value={logoFile}
                        onChange={setLogoFile}
                      />
                      <div className="mt-3 flex gap-2">
                        <Button type="button" size="sm" onClick={onLogoUpload} disabled={!logoFile} loading={logoBusy}>
                          <IconUpload className="h-4 w-4" />
                          Upload logo
                        </Button>
                        {settings.logo_path && (
                          <Button type="button" variant="danger" size="sm" onClick={onLogoRemove} loading={logoBusy}>
                            <IconTrash className="h-4 w-4" />
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Login & welcome content" />
                  <div className="space-y-4">
                    <Input label="Client login heading" value={settings.login_heading || ''} onChange={(e) => set('login_heading', e.target.value)} />
                    <Textarea label="Client login description" value={settings.login_description || ''} onChange={(e) => set('login_description', e.target.value)} />
                    <Textarea label="Client portal welcome message" value={settings.welcome_message || ''} onChange={(e) => set('welcome_message', e.target.value)} />
                    <Textarea label="Footer text" value={settings.footer_text || ''} onChange={(e) => set('footer_text', e.target.value)} />
                  </div>
                </Card>
              </>
            )}

            {tab === 'content' && (
              <>
                <Card>
                  <CardHeader title="Support contacts" description="Shown on client dashboards and the support page." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Support email" type="email" value={settings.support_email || ''} onChange={(e) => set('support_email', e.target.value)} />
                    <Input label="Support phone" value={settings.support_phone || ''} onChange={(e) => set('support_phone', e.target.value)} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Payment instructions & disclaimer" description="Shown to clients with their payment instructions." />
                  <div className="space-y-4">
                    <Textarea label="General payment instructions" rows={4} value={settings.payment_instructions || ''} onChange={(e) => set('payment_instructions', e.target.value)} />
                    <Textarea label="Payment disclaimer" rows={3} value={settings.payment_disclaimer || ''} onChange={(e) => set('payment_disclaimer', e.target.value)} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Legal pages" description="Published on the client portal footer links." />
                  <div className="space-y-4">
                    <Textarea label="Terms and conditions" rows={6} value={settings.terms_and_conditions || ''} onChange={(e) => set('terms_and_conditions', e.target.value)} />
                    <Textarea label="Privacy policy" rows={6} value={settings.privacy_policy || ''} onChange={(e) => set('privacy_policy', e.target.value)} />
                    <Textarea label="Refund policy" rows={6} value={settings.refund_policy || ''} onChange={(e) => set('refund_policy', e.target.value)} />
                  </div>
                </Card>
              </>
            )}

            {tab === 'workflow' && (
              <>
                <Card>
                  <CardHeader title="References & deadlines" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Invoice reference prefix" value={settings.invoice_ref_prefix || ''} onChange={(e) => set('invoice_ref_prefix', e.target.value)} />
                    <Input label="Transaction reference prefix" value={settings.transaction_ref_prefix || ''} onChange={(e) => set('transaction_ref_prefix', e.target.value)} />
                    <Input label="Default invoice due days" type="number" min={1} max={365} value={String(settings.invoice_due_days_default ?? 14)} onChange={(e) => set('invoice_due_days_default', Number(e.target.value))} />
                    <Input label="Payment deadline reminder (days)" type="number" min={0} max={60} value={String(settings.payment_deadline_reminder_days ?? 3)} onChange={(e) => set('payment_deadline_reminder_days', Number(e.target.value))} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Receipt uploads" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Maximum receipt size (MB)" type="number" min={1} max={50} value={String(settings.receipt_max_size_mb ?? 10)} onChange={(e) => set('receipt_max_size_mb', Number(e.target.value))} />
                    <div>
                      <p className="field-label">Allowed receipt types</p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {['pdf', 'jpg', 'jpeg', 'png'].map((t) => (
                          <label key={t} className="flex items-center gap-2 text-sm text-slate-600">
                            <input
                              type="checkbox"
                              checked={(settings.allowed_receipt_types || []).includes(t)}
                              onChange={(e) => {
                                const current: string[] = settings.allowed_receipt_types || ['pdf', 'jpg', 'jpeg', 'png'];
                                set('allowed_receipt_types', e.target.checked ? [...current, t] : current.filter((x) => x !== t));
                              }}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            {t.toUpperCase()}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Confirmation requirements" description="Required fields when a client confirms a payment." />
                  <div className="space-y-2">
                    {[
                      ['require_receipt_upload', 'Require receipt / proof of transfer upload'],
                      ['require_sender_name', 'Require sender / remitter name'],
                      ['require_transfer_reference', 'Require bank / transfer reference'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={settings[key] !== false}
                          onChange={(e) => set(key, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Client workflow options" />
                  <div className="space-y-2">
                    {[
                      ['allow_partial_payments', 'Allow partial payments by default'],
                      ['allow_method_change_before_confirm', 'Allow clients to change method before confirming'],
                      ['show_instructions_snapshot', 'Show instruction snapshots on transaction history'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={settings.client_workflow?.[key] !== false}
                          onChange={(e) => set('client_workflow', { ...(settings.client_workflow || {}), [key]: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Notification toggles" description="Emails are sent only when SMTP is configured; otherwise notifications are stored and marked accordingly." />
                  <div className="space-y-2">
                    {[
                      ['notify_on_confirmation_submitted', 'New payment confirmation submitted'],
                      ['notify_on_payment_approved', 'Payment approved / verified'],
                      ['notify_on_payment_rejected', 'Payment rejected'],
                      ['notify_on_invoice_created', 'Invoice created'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={settings[key] !== false}
                          onChange={(e) => set(key, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Notification templates" description='Use {{client_name}}, {{invoice_ref}}, {{payment_ref}}, {{amount}}, {{currency}}, {{due_date}}, {{reason}} as placeholders.' />
                  <div className="space-y-4">
                    {Object.entries(settings.notification_templates || {}).map(([key, tpl]: [string, any]) => (
                      <div key={key} className="rounded-xl border border-slate-200 p-4">
                        <p className="mb-2 text-sm font-semibold text-navy-800">{key.replace(/_/g, ' ')}</p>
                        <div className="space-y-2">
                          <Input
                            label="Subject"
                            value={tpl.subject || ''}
                            onChange={(e) =>
                              set('notification_templates', {
                                ...settings.notification_templates,
                                [key]: { ...tpl, subject: e.target.value },
                              })
                            }
                          />
                          <Textarea
                            label="Body"
                            rows={3}
                            value={tpl.body || ''}
                            onChange={(e) =>
                              set('notification_templates', {
                                ...settings.notification_templates,
                                [key]: { ...tpl, body: e.target.value },
                              })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}

            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={saving} loadingText="Saving…">
                <IconCheck className="h-4 w-4" />
                Save & publish
              </Button>
              <Button type="button" variant="secondary" onClick={onPreview} loading={previewing}>
                <IconEye className="h-4 w-4" />
                Preview changes
              </Button>
            </div>
          </div>

          {/* Live preview panel */}
          <div className="xl:sticky xl:top-24 xl:self-start">
            <Card>
              <CardHeader
                title="Preview"
                description={preview ? 'Unpublished changes (from Preview)' : 'Current published branding'}
              />
              <div className="space-y-4">
                <div
                  className="rounded-xl border p-5"
                  style={{
                    borderColor: 'var(--border)',
                    backgroundColor: `${previewBranding.primaryColor || '#2563eb'}0d`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl font-bold text-white"
                      style={{ backgroundColor: previewBranding.primaryColor || '#2563eb' }}
                    >
                      {(previewBranding.agencyName || 'P').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-navy-900">{previewBranding.agencyName || 'Payment Portal'}</p>
                      <p className="text-xs text-slate-500">{previewBranding.siteTitle}</p>
                    </div>
                  </div>
                  <h2 className="mt-4 text-sm font-bold" style={{ color: previewBranding.secondaryColor || '#0b2447' }}>
                    {previewBranding.loginHeading}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">{previewBranding.loginDescription}</p>
                  <button
                    type="button"
                    className="mt-3 rounded-xl px-4 py-2 text-xs font-semibold text-white"
                    style={{ backgroundColor: previewBranding.primaryColor || '#2563eb' }}
                  >
                    Sign in securely
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-400">Welcome message</p>
                  <p className="mt-1 text-sm text-slate-700">{previewBranding.welcomeMessage || '—'}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-400">Footer</p>
                  <p className="mt-1 text-sm text-slate-700">{previewBranding.footerText || '—'}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-400">Actual portal branding</p>
                  <div className="mt-2">
                    <BrandLogo size="sm" />
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
