import { useEffect, useState, type FormEvent } from 'react';
import { api, downloadFile, errorMessage } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, CheckboxField, EmptyState, Modal, PageHeader, SelectInput, Tabs, TextArea, TextInput, useToast } from '../../components/ui';
import { ROLE_LABELS } from '../../../shared/constants';
import { AdminFrame, LoadProblem, PageSkeleton, can, useGateSession } from './AdminShared';
import { fieldErrorsFrom, formMessageFrom } from '../../components/forms';

type SettingsGroup = 'branding' | 'contact' | 'policies' | 'workflow' | 'operations' | 'labels' | 'notifications';

interface SettingRecord {
  draft: Record<string, unknown>;
  published: Record<string, unknown>;
  hasUnpublishedChanges: boolean;
  draftUpdatedAt: string | null;
  publishedAt: string | null;
}

type FieldSpec = { key: string; label: string; kind?: 'text' | 'textarea' | 'email' | 'color' | 'number' | 'numberList' | 'boolean' | 'select'; options?: string[]; hint?: string };

const GROUPS: Record<Exclude<SettingsGroup, 'notifications'>, { title: string; description: string; fields: FieldSpec[] }> = {
  branding: {
    title: 'Branding',
    description: 'Name, colours and wording used across the portal. Changes apply after you publish.',
    fields: [
      { key: 'agencyName', label: 'Agency name' },
      { key: 'websiteTitle', label: 'Browser title', hint: 'Leave empty to use the agency name.' },
      { key: 'primaryColor', label: 'Primary colour', kind: 'color' },
      { key: 'secondaryColor', label: 'Dark accent colour', kind: 'color' },
      { key: 'loginHeading', label: 'Client sign-in heading' },
      { key: 'loginDescription', label: 'Client sign-in description', kind: 'textarea' },
      { key: 'clientWelcomeMessage', label: 'Dashboard welcome message', kind: 'textarea' },
      { key: 'footerText', label: 'Footer text' },
    ],
  },
  contact: {
    title: 'Contact',
    description: 'How clients reach your team. Shown in the portal and in notifications.',
    fields: [
      { key: 'supportEmail', label: 'Support email', kind: 'email' },
      { key: 'phone', label: 'Phone' },
      { key: 'whatsappEnabled', label: 'Show WhatsApp contact', kind: 'boolean' },
      { key: 'whatsappNumber', label: 'WhatsApp number' },
      { key: 'address', label: 'Office address', kind: 'textarea' },
      { key: 'websiteUrl', label: 'Website' },
      { key: 'supportHours', label: 'Support hours' },
    ],
  },
  policies: {
    title: 'Policies',
    description: 'Short texts shown to clients. Have these reviewed before publishing.',
    fields: [
      { key: 'termsText', label: 'Terms', kind: 'textarea' },
      { key: 'privacyText', label: 'Privacy', kind: 'textarea' },
      { key: 'refundText', label: 'Refund policy', kind: 'textarea' },
      { key: 'paymentDisclaimer', label: 'Payment disclaimer', kind: 'textarea' },
      { key: 'feesNotice', label: 'Fees notice', kind: 'textarea' },
      { key: 'nextStepsText', label: 'Next steps text', kind: 'textarea' },
    ],
  },
  workflow: {
    title: 'Confirmation workflow',
    description: 'What clients must provide when they confirm a payment.',
    fields: [
      { key: 'requireReceipt', label: 'Require a receipt', kind: 'boolean' },
      { key: 'requireSenderName', label: 'Require sender name', kind: 'boolean' },
      { key: 'requireTransferReference', label: 'Require transfer reference', kind: 'boolean' },
      { key: 'requireTransactionId', label: 'Require transaction ID', kind: 'boolean' },
      { key: 'confirmationInstructions', label: 'Instructions shown after sending', kind: 'textarea' },
      { key: 'notifyAdminOnSubmission', label: 'Email staff when a confirmation is submitted', kind: 'boolean' },
      { key: 'defaultPartialPaymentsAllowed', label: 'New invoices allow partial payments by default', kind: 'boolean' },
      { key: 'maxReceiptMegabytes', label: 'Maximum receipt size (MB)', kind: 'number', hint: 'Capped by the server limit of 5 MB.' },
    ],
  },
  operations: {
    title: 'Operations',
    description: 'Reference prefix, invoice numbering, due dates and reminder timing.',
    fields: [
      { key: 'referencePrefix', label: 'Payment reference prefix', hint: '2 to 8 letters or digits, for example PAY.' },
      { key: 'invoiceNumberFormat', label: 'Invoice number format', hint: 'Must include {SEQ} or {SEQ:5}. You may also use {YYYY}, for example INV-{YYYY}-{SEQ:5}.' },
      { key: 'defaultDueDays', label: 'Default days from issue to due date', kind: 'number' },
      { key: 'reminderDaysBefore', label: 'Send reminders this many days before the due date', kind: 'numberList', hint: 'Comma-separated, for example 7, 3, 1. Up to five values. Use 0 for the due date itself.' },
      { key: 'overdueReminderEveryDays', label: 'Repeat overdue reminders every (days)', kind: 'number' },
    ],
  },
  labels: {
    title: 'Labels',
    description: 'Wording for the forms clients fill in.',
    fields: [
      { key: 'helpSenderName', label: 'Help text: sender name', kind: 'textarea' },
      { key: 'helpTransferReference', label: 'Help text: transfer reference', kind: 'textarea' },
      { key: 'helpTransactionId', label: 'Help text: transaction ID', kind: 'textarea' },
      { key: 'helpReceipt', label: 'Help text: receipt', kind: 'textarea' },
      { key: 'clientNotice', label: 'Notice shown to clients', kind: 'textarea' },
      { key: 'supportHelpText', label: 'Support help text', kind: 'textarea' },
    ],
  },
};

type AssetKind = 'logo' | 'favicon';

export function AdminSettingsPage() {
  const session = useGateSession();
  const writable = can(session, 'settings:write');
  const [tab, setTab] = useState<Exclude<SettingsGroup, 'notifications'>>('branding');
  const settings = useAsync(() => api.get<{ settings: Record<string, SettingRecord> }>('/admin/settings'), []);
  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader title="Settings and branding" description="Edits are saved as a draft first. Publish when you are ready. Clients only see published values." />
        {settings.loading && <PageSkeleton />}
        {settings.error ? <LoadProblem error={settings.error} onRetry={settings.reload} /> : null}
        {settings.data && (
          <>
            <Tabs
              label="Settings groups"
              value={tab}
              onChange={(value) => setTab(value as typeof tab)}
              items={(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((key) => ({ value: key, label: GROUPS[key].title }))}
            />
            <SettingsGroupEditor key={tab} group={tab} record={settings.data.settings[tab]} writable={writable} onChanged={settings.reload} />
            {tab === 'branding' && <BrandingAssets writable={writable} onChanged={settings.reload} />}
          </>
        )}
      </div>
    </AdminFrame>
  );
}

function SettingsGroupEditor({ group, record, writable, onChanged }: { group: Exclude<SettingsGroup, 'notifications'>; record: SettingRecord; writable: boolean; onChanged: () => void }) {
  const spec = GROUPS[group];
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, unknown>>(record.draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(record.draft);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setErrors({});
    setFormError(null);
    try {
      await action();
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(formMessageFrom(error) ?? errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2" title={spec.title} description={spec.description}
        actions={<div className="flex flex-wrap gap-2">{record.hasUnpublishedChanges || dirty ? <Badge tone="warning">Unpublished changes</Badge> : <Badge tone="success">Up to date</Badge>}</div>}>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <form className="mt-4 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void run('save', async () => { await api.put(`/admin/settings/${group}`, draft); toast('success', 'Draft saved. It is not live until you publish.'); onChanged(); }); }}>
          {spec.fields.map((field) => {
            const value = draft[field.key];
            const error = errors[field.key];
            const set = (next: unknown) => setDraft({ ...draft, [field.key]: next });
            if (field.kind === 'boolean') {
              return <CheckboxField key={field.key} label={field.label} checked={value === true} disabled={!writable} onChange={(e) => set(e.target.checked)} error={error} />;
            }
            if (field.kind === 'numberList') {
              const list = Array.isArray(value) ? (value as number[]) : [];
              return (
                <TextInput key={field.key} label={field.label} value={list.join(', ')} disabled={!writable} onChange={(e) => set(e.target.value.split(',').map((part) => part.trim()).filter((part) => part !== '').map(Number))} error={error} hint={field.hint} />
              );
            }
            if (field.kind === 'textarea') {
              return <TextArea key={field.key} label={field.label} value={String(value ?? '')} disabled={!writable} onChange={(e) => set(e.target.value)} error={error} hint={field.hint} />;
            }
            if (field.kind === 'color') {
              return (
                <div key={field.key} className="flex flex-wrap items-end gap-3">
                  <TextInput label={field.label} value={String(value ?? '')} disabled={!writable} onChange={(e) => set(e.target.value)} error={error} hint="Six-digit hex colour, for example #1d4ed8." className="max-w-xs" />
                  <input type="color" aria-label={`${field.label} picker`} value={/^#[0-9a-fA-F]{6}$/.test(String(value ?? '')) ? String(value) : '#1d4ed8'} disabled={!writable} onChange={(e) => set(e.target.value)} className="mb-1 h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1" />
                </div>
              );
            }
            return (
              <TextInput
                key={field.key}
                label={field.label}
                type={field.kind === 'email' ? 'email' : field.kind === 'number' ? 'number' : 'text'}
                value={String(value ?? '')}
                disabled={!writable}
                onChange={(e) => set(field.kind === 'number' ? Number(e.target.value) : e.target.value)}
                error={error}
                hint={field.hint}
              />
            );
          })}
          {writable && (
            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" variant="secondary" loading={busy === 'save'} disabled={!dirty}>Save draft</Button>
              <Button loading={busy === 'publish'} disabled={dirty || !record.hasUnpublishedChanges} onClick={() => void run('publish', async () => { await api.post(`/admin/settings/${group}/publish`); toast('success', 'Published. Clients now see these values.'); onChanged(); })}>Publish</Button>
              <Button variant="ghost" loading={busy === 'discard'} disabled={!record.hasUnpublishedChanges} onClick={() => { if (window.confirm('Discard the unpublished draft?')) void run('discard', async () => { await api.post(`/admin/settings/${group}/discard`); toast('info', 'Draft discarded.'); onChanged(); }); }}>Discard draft</Button>
            </div>
          )}
        </form>
      </Card>
      {group === 'branding' ? <BrandingPreview draft={draft} /> : <Card title="Last published" description={record.publishedAt ? `Published ${formatDateTime(record.publishedAt)}` : 'Not published yet.'}><p className="text-sm text-slate-600">Save, then publish to make these values visible to clients.</p></Card>}
    </div>
  );
}

function BrandingPreview({ draft }: { draft: Record<string, unknown> }) {
  const primary = /^#[0-9a-fA-F]{6}$/.test(String(draft.primaryColor)) ? String(draft.primaryColor) : '#1d4ed8';
  return (
    <Card title="Preview" description="Shows your unpublished draft. Nothing is live until you publish.">
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 px-4 py-3" style={{ background: '#ffffff' }}>
          <span className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: primary }}>{String(draft.agencyName ?? '').slice(0, 1)}</span>
          <span className="text-sm font-semibold text-slate-900">{String(draft.agencyName ?? '')}</span>
        </div>
        <div className="space-y-2 border-t border-slate-100 px-4 py-4">
          <p className="text-base font-semibold text-slate-900">{String(draft.loginHeading ?? '')}</p>
          <p className="text-sm text-slate-600">{String(draft.loginDescription ?? '')}</p>
          <span className="inline-block rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: primary }}>Sign in</span>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{String(draft.footerText ?? '')}</p>
      </div>
    </Card>
  );
}

function BrandingAssets({ writable, onChanged }: { writable: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<AssetKind>('logo');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('kind', kind);
    form.set('receipt', file, file.name);
    try {
      const result = await api.upload<{ asset: { id: string } }>('/admin/branding/assets', form);
      await api.put('/admin/settings/branding', { ...(await currentBranding()), [kind === 'logo' ? 'logoAssetId' : 'faviconAssetId']: result.asset.id });
      toast('success', `${kind === 'logo' ? 'Logo' : 'Favicon'} uploaded. Publish branding to make it live.`);
      setFile(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Logo and favicon" description="PNG, JPEG, WebP or SVG-free images only. Files are checked on upload and stored in the database.">
      {error && <Alert tone="danger">{error}</Alert>}
      {writable ? (
        <div className="flex flex-wrap items-end gap-3">
          <SelectInput label="Image type" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            <option value="logo">Logo</option>
            <option value="favicon">Favicon</option>
          </SelectInput>
          <div className="space-y-1.5">
            <label htmlFor="asset-file" className="block text-sm font-medium text-slate-800">Image file</label>
            <input id="asset-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-800" />
          </div>
          <Button variant="secondary" disabled={!file} loading={busy} onClick={() => void upload()}>Upload</Button>
        </div>
      ) : (
        <p className="text-sm text-slate-600">You can view branding but not change it.</p>
      )}
    </Card>
  );
}

async function currentBranding(): Promise<Record<string, unknown>> {
  const result = await api.get<{ settings: Record<string, SettingRecord> }>('/admin/settings');
  return result.settings.branding.draft;
}

export function AdminNotificationsPage() {
  const session = useGateSession();
  const writable = can(session, 'notifications:write');
  const [status, setStatus] = useState('');
  const list = useAsync(() => api.get<{ notifications: NotificationRow[]; delivery: { configured: boolean } }>(`/admin/notifications${status ? `?status=${status}` : ''}`), [status]);
  const settings = useAsync(() => api.get<{ settings: Record<string, SettingRecord> }>('/admin/settings'), []);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader title="Notifications" description="Email delivery status and message templates. A message is reported as sent only after the mail server accepts it." />
        {list.data && !list.data.delivery.configured && (
          <Alert tone="warning" title="Email delivery is not configured.">Messages are recorded as “not configured” and nothing is emailed until SMTP settings are provided on the server.</Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Card title="Message log">
          <div className="mb-4 max-w-xs">
            <SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {['sent', 'failed', 'not_configured', 'skipped', 'duplicate', 'disabled'].map((value) => (<option key={value} value={value}>{value.replace(/_/g, ' ')}</option>))}
            </SelectInput>
          </div>
          {list.loading && <PageSkeleton />}
          {list.error ? <LoadProblem error={list.error} onRetry={list.reload} /> : null}
          {list.data && list.data.notifications.length === 0 && <EmptyState title="No messages yet" />}
          {list.data && list.data.notifications.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {list.data.notifications.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{row.subject}</p>
                    <p className="text-xs text-slate-500">To {row.recipientAddress} · {formatDateTime(row.createdAt)}{row.lastError ? ` · ${row.lastError}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'}>{row.status.replace(/_/g, ' ')}</Badge>
                    {writable && row.status === 'failed' && (
                      <Button variant="secondary" onClick={async () => { try { const result = await api.post<{ outcome: string }>(`/admin/notifications/${row.id}/retry`); toast(result.outcome === 'sent' ? 'success' : 'info', `Retry result: ${result.outcome.replace(/_/g, ' ')}.`); list.reload(); } catch (err) { setError(errorMessage(err)); } }}>Retry</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Message templates" description="Use placeholders such as {{clientName}} and {{invoiceNumber}}. Unknown placeholders are rejected.">
          {settings.data && (
            <ul className="divide-y divide-slate-100">
              {Object.entries(settings.data.settings.notifications.draft).map(([key, value]) => (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{templateLabel(key)}</p>
                    <p className="text-xs text-slate-500">{String((value as { subject?: string }).subject ?? '')}</p>
                  </div>
                  {writable && <Button variant="secondary" onClick={() => setEditing(key)}>Edit<span className="sr-only"> {templateLabel(key)}</span></Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {editing && settings.data && (
          <TemplateDialog
            templateKey={editing}
            initial={settings.data.settings.notifications.draft[editing] as { subject: string; body: string }}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); toast('success', 'Template draft saved. Publish to use it.'); settings.reload(); }}
          />
        )}
      </div>
    </AdminFrame>
  );
}

interface NotificationRow {
  id: string;
  subject: string;
  recipientAddress: string;
  status: string;
  createdAt: string;
  lastError: string | null;
}

function templateLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function TemplateDialog({ templateKey, initial, onClose, onSaved }: { templateKey: string; initial: { subject: string; body: string }; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      api.post<{ subject: string; body: string }>('/admin/notifications/preview', { subject, body }).then(setPreview).catch(() => setPreview(null));
    }, 300);
    return () => window.clearTimeout(id);
  }, [subject, body]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const all = await api.get<{ settings: Record<string, SettingRecord> }>('/admin/settings');
      const draft = { ...all.settings.notifications.draft, [templateKey]: { subject, body } };
      await api.put('/admin/settings/notifications', draft);
      onSaved();
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      setFormError(formMessageFrom(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Edit: ${templateLabel(templateKey)}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="template-form" loading={busy}>Save draft</Button></>}>
      <form id="template-form" noValidate onSubmit={save} className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextInput label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} error={errors[`${templateKey}.subject`]} />
        <TextArea label="Body" value={body} onChange={(e) => setBody(e.target.value)} error={errors[`${templateKey}.body`]} rows={6} />
        <div className="rounded-xl bg-slate-50 p-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Preview with sample values</p>
          <p className="mt-2 font-semibold text-slate-900">{preview?.subject ?? '—'}</p>
          <p className="mt-2 whitespace-pre-wrap text-slate-700">{preview?.body ?? ''}</p>
        </div>
      </form>
    </Modal>
  );
}

export function AdminAuditPage() {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const events = useAsync(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (entityType) params.set('entityType', entityType);
    if (action) params.set('action', action);
    return api.get<{ events: AuditRow[] }>(`/admin/audit?${params.toString()}`);
  }, [entityType, action]);
  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader title="Audit log" description="Append-only. Entries cannot be edited or deleted, including by administrators." />
        <Card>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <SelectInput label="Record type" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              <option value="">All</option>
              {['admin_user', 'client', 'invoice', 'submission', 'receipt', 'settings', 'payment_config', 'notification'].map((v) => (<option key={v} value={v}>{v.replace(/_/g, ' ')}</option>))}
            </SelectInput>
            <TextInput label="Action contains" placeholder="for example verify or login" value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          {events.loading && <PageSkeleton />}
          {events.error ? <LoadProblem error={events.error} onRetry={events.reload} /> : null}
          {events.data && events.data.events.length === 0 && <EmptyState title="No events match" />}
          {events.data && events.data.events.length > 0 && (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">Audit events</caption>
                <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th scope="col" className="px-2 py-2 font-medium">When</th><th scope="col" className="px-2 py-2 font-medium">Who</th><th scope="col" className="px-2 py-2 font-medium">Action</th><th scope="col" className="px-2 py-2 font-medium">Details</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {events.data.events.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-2 py-2 text-slate-600">{formatDateTime(row.occurredAt)}</td>
                      <td className="px-2 py-2 text-slate-700">{row.actorType}</td>
                      <td className="px-2 py-2 font-mono text-xs text-slate-800">{row.action}</td>
                      <td className="px-2 py-2 text-slate-700">{row.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AdminFrame>
  );
}

interface AuditRow { id: number; occurredAt: string; actorType: string; action: string; summary: string }

export function AdminUsersPage() {
  const session = useGateSession();
  const writable = can(session, 'users:manage');
  const users = useAsync(() => api.get<{ users: AdminUserRow[] }>('/admin/users'), []);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader title="Admin users" description="Roles limit what each person can see and change. Every change is audited." actions={writable ? <Button onClick={() => setCreating(true)}>Add admin user</Button> : undefined} />
        {error && <Alert tone="danger">{error}</Alert>}
        {link && <Alert tone="info" title="One-time setup link (shown once)"><code className="break-all text-xs">{link}</code></Alert>}
        <Card>
          {users.loading && <PageSkeleton />}
          {users.error ? <LoadProblem error={users.error} onRetry={users.reload} /> : null}
          {users.data && (
            <ul className="divide-y divide-slate-100">
              {users.data.users.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{u.displayName} <span className="text-xs font-normal text-slate-500">{u.email}</span></p>
                    <p className="text-xs text-slate-500">{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role} · {u.status}{u.mustChangePassword ? ' · must change password' : ''}{u.lastLoginAt ? ` · last sign-in ${formatDateTime(u.lastLoginAt)}` : ''}</p>
                  </div>
                  {writable && u.id !== session.admin.id && (
                    <div className="flex flex-wrap items-center gap-2">
                      <SelectInput label={`Role for ${u.email}`} value={u.role} onChange={async (e) => { try { await api.patch(`/admin/users/${u.id}`, { role: e.target.value }); toast('success', 'Role updated.'); users.reload(); } catch (err) { setError(errorMessage(err)); } }}>
                        <option value="super_admin">Super admin</option>
                        <option value="finance_reviewer">Finance reviewer</option>
                        <option value="viewer">Viewer</option>
                      </SelectInput>
                      <Button variant="secondary" onClick={async () => { try { await api.patch(`/admin/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' }); users.reload(); } catch (err) { setError(errorMessage(err)); } }}>{u.status === 'active' ? 'Disable' : 'Enable'}</Button>
                      <Button variant="ghost" onClick={async () => { try { const r = await api.post<{ resetUrl?: string; activationUrl?: string }>(`/admin/users/${u.id}/reset-link`); setLink(r.resetUrl ?? r.activationUrl ?? null); } catch (err) { setError(errorMessage(err)); } }}>Reset link</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <NewAdminDialog open={creating} onClose={() => setCreating(false)} onCreated={(url) => { setCreating(false); setLink(url); users.reload(); }} />
      </div>
    </AdminFrame>
  );
}

interface AdminUserRow { id: string; email: string; displayName: string; role: string; status: string; mustChangePassword: boolean; lastLoginAt: string | null }

function NewAdminDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (url: string | null) => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('viewer');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title="Add admin user" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="new-admin" loading={busy}>Create user</Button></>}>
      <form id="new-admin" noValidate className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErrors({}); setFormError(null); try { const r = await api.post<{ resetUrl?: string; activationUrl?: string }>('/admin/users', { email, displayName, role }); onCreated(r.resetUrl ?? r.activationUrl ?? null); } catch (err) { setErrors(fieldErrorsFrom(err)); setFormError(formMessageFrom(err)); } finally { setBusy(false); } }}>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextInput label="Display name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} error={errors.displayName} />
        <SelectInput label="Role" value={role} onChange={(e) => setRole(e.target.value)} error={errors.role}>
          <option value="super_admin">Super admin</option>
          <option value="finance_reviewer">Finance reviewer</option>
          <option value="viewer">Viewer</option>
        </SelectInput>
        <p className="text-xs text-slate-500">The new user sets their own password using a one-time link.</p>
      </form>
    </Modal>
  );
}

export function AdminReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  async function download(kind: 'submissions' | 'ledger') {
    setBusy(kind);
    setError(null);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (kind === 'submissions' && status) params.set('status', status);
    try {
      await downloadFile(`/admin/reports/${kind}.csv?${params.toString()}`);
      toast('success', 'Export downloaded. Exports are logged in the audit trail.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <AdminFrame>
      <div className="page-enter space-y-6">
        <PageHeader title="Reports" description="CSV exports for accounting. Amounts are exact decimals in each invoice's own currency." />
        {error && <Alert tone="danger">{error}</Alert>}
        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <SelectInput label="Confirmation status (submissions only)" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {['submitted', 'under_review', 'info_requested', 'verified', 'rejected', 'superseded'].map((v) => (<option key={v} value={v}>{v.replace(/_/g, ' ')}</option>))}
            </SelectInput>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button loading={busy === 'submissions'} onClick={() => void download('submissions')}>Download confirmations CSV</Button>
            <Button variant="secondary" loading={busy === 'ledger'} onClick={() => void download('ledger')}>Download ledger CSV</Button>
          </div>
        </Card>
      </div>
    </AdminFrame>
  );
}

