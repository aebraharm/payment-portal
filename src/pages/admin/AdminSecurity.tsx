import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatDateTime } from '../../lib/format';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { PageHeader, Table, TableHead, TableRow, Th, Td } from '../../components/shared';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import { CopyField } from '../../components/ui/CopyField';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { Tabs } from '../../components/ui/Tabs';
import { IconBell, IconKey, IconPlus, IconShield, IconTrash } from '../../components/ui/Icons';

export function AdminSecurity() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'audit';
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Security & audit"
        description="Authentication events, administrative actions, active sessions and administrator accounts."
      />
      <Tabs
        tabs={[
          { id: 'audit', label: 'Audit log' },
          { id: 'sessions', label: 'Active sessions' },
          { id: 'notifications', label: 'Notifications' },
          { id: 'admins', label: 'Administrators' },
        ]}
        active={tab}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
      />
      {tab === 'audit' && <AuditTab />}
      {tab === 'sessions' && <SessionsTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'admins' && <AdminsTab />}
    </div>
  );
}

// ------------------------------------------------------------------ audit --

function AuditTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [data, setData] = useState<{ total: number; logs: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (action) params.set('action', action);
      const result = await api.get<{ total: number; page: number; pageSize: number; logs: any[] }>(`/api/admin/audit-logs?${params}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load audit logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, action]);

  if (loading && !data) return <PageLoader label="Loading audit logs…" />;

  return (
    <Card>
      <CardHeader title="Audit log" description="Sensitive administrative and authentication events. Credentials are redacted." />
      <div className="mb-4 sm:w-72">
        <Select
          label="Filter by action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All actions' },
            { value: 'admin_login', label: 'Admin login' },
            { value: 'admin_login_failed', label: 'Admin login failed' },
            { value: 'payment_verified', label: 'Payment verified' },
            { value: 'payment_rejected', label: 'Payment rejected' },
            { value: 'payment_confirmation_submitted', label: 'Confirmation submitted' },
            { value: 'settings_updated', label: 'Settings updated' },
            { value: 'bank_instructions_updated', label: 'Bank instructions changed' },
            { value: 'client_access_code_reset', label: 'Access code reset' },
          ]}
        />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {data && data.logs.length === 0 ? (
        <EmptyState icon={<IconShield className="h-8 w-8" />} title="No audit events" />
      ) : (
        <>
          <Table>
            <TableHead>
              <tr>
                <Th>Time</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>IP</Th>
              </tr>
            </TableHead>
            <tbody>
              {data?.logs.map((log) => (
                <TableRow key={log.id}>
                  <Td>
                    <span className="text-sm text-slate-500">{formatDateTime(log.created_at)}</span>
                  </Td>
                  <Td>
                    <Badge tone={log.actor_type === 'admin' ? 'blue' : log.actor_type === 'client' ? 'violet' : 'slate'}>
                      {log.actor_type}
                      {log.actor_id ? ` #${log.actor_id}` : ''}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="text-sm font-medium text-navy-900">{log.action.replace(/_/g, ' ')}</span>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-500">
                      {log.entity || '—'}
                      {log.entity_id ? ` #${log.entity_id}` : ''}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-400">{log.ip || '—'}</span>
                  </Td>
                </TableRow>
              ))}
            </tbody>
          </Table>
          {data && <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} />}
        </>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- sessions --

function SessionsTab() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ sessions: any[] }>('/api/admin/sessions');
      setSessions(result.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sessions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (id: number) => {
    setRevoking(id);
    try {
      await api.post(`/api/admin/sessions/${id}/revoke`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke the session.');
    } finally {
      setRevoking(null);
    }
  };

  if (loading) return <PageLoader label="Loading sessions…" />;

  return (
    <Card>
      <CardHeader title="Active sessions" description="All currently valid admin and client sessions. Revoking a session signs the actor out immediately." />
      {error && <Alert tone="error">{error}</Alert>}
      {sessions.length === 0 ? (
        <EmptyState icon={<IconShield className="h-8 w-8" />} title="No active sessions" />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <Th>Actor</Th>
              <Th>Type</Th>
              <Th>IP</Th>
              <Th>Created</Th>
              <Th>Expires</Th>
              <Th></Th>
            </tr>
          </TableHead>
          <tbody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <Td>
                  <span className="text-sm font-medium text-navy-900">{s.actor_label || `#${s.actor_id}`}</span>
                </Td>
                <Td>
                  <Badge tone={s.actor_type === 'admin' ? 'blue' : 'violet'}>{s.actor_type}</Badge>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-slate-400">{s.ip || '—'}</span>
                </Td>
                <Td>
                  <span className="text-sm text-slate-500">{formatDateTime(s.created_at)}</span>
                </Td>
                <Td>
                  <span className="text-sm text-slate-500">{formatDateTime(s.expires_at)}</span>
                </Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => revoke(s.id)} loading={revoking === s.id}>
                    <IconTrash className="h-4 w-4" />
                    Revoke
                  </Button>
                </Td>
              </TableRow>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ----------------------------------------------------------- notifications --

function NotificationsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ total: number; notifications: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (status) params.set('status', status);
      const result = await api.get<{ total: number; notifications: any[] }>(`/api/admin/notifications?${params}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load notifications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  if (loading && !data) return <PageLoader label="Loading notifications…" />;

  const toneFor = (s: string) => (s === 'sent' ? 'green' : s === 'failed' ? 'red' : s === 'skipped_not_configured' ? 'amber' : 'slate');

  return (
    <Card>
      <CardHeader
        title="Notifications"
        description="Email delivery requires SMTP configuration. Without it, notifications are stored and marked 'not configured' — nothing is pretended to be sent."
      />
      <div className="mb-4 sm:w-72">
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All' },
            { value: 'sent', label: 'Sent' },
            { value: 'failed', label: 'Failed' },
            { value: 'skipped_not_configured', label: 'Email not configured' },
            { value: 'pending', label: 'Pending' },
          ]}
        />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {data && data.notifications.length === 0 ? (
        <EmptyState icon={<IconBell className="h-8 w-8" />} title="No notifications" />
      ) : (
        <>
          <Table>
            <TableHead>
              <tr>
                <Th>Time</Th>
                <Th>Type</Th>
                <Th>Recipient</Th>
                <Th>Subject</Th>
                <Th>Status</Th>
              </tr>
            </TableHead>
            <tbody>
              {data?.notifications.map((n) => (
                <TableRow key={n.id}>
                  <Td>
                    <span className="text-sm text-slate-500">{formatDateTime(n.created_at)}</span>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-600">{n.type.replace(/_/g, ' ')}</span>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-500">{n.recipient || '—'}</span>
                  </Td>
                  <Td>
                    <span className="text-sm font-medium text-navy-900">{n.subject}</span>
                  </Td>
                  <Td>
                    <Badge tone={toneFor(n.status)}>{n.status.replace(/_/g, ' ')}</Badge>
                  </Td>
                </TableRow>
              ))}
            </tbody>
          </Table>
          {data && <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} />}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- admins --

function AdminsTab() {
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ admins: any[] }>('/api/admin/admins');
      setAdmins(result.admins);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load administrators.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading && admins.length === 0) return <PageLoader label="Loading administrators…" />;

  return (
    <Card>
      <CardHeader
        title="Administrator accounts"
        description="Requires the superadmin role. New accounts must change their password on first login."
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <IconPlus className="h-4 w-4" />
            New administrator
          </Button>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      <Table>
        <TableHead>
          <tr>
            <Th>Email</Th>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Status</Th>
            <Th>Last login</Th>
            <Th></Th>
          </tr>
        </TableHead>
        <tbody>
          {admins.map((a) => (
            <TableRow key={a.id}>
              <Td>
                <span className="text-sm font-medium text-navy-900">{a.email}</span>
              </Td>
              <Td>
                <span className="text-sm text-slate-600">{a.full_name || '—'}</span>
              </Td>
              <Td>
                <Badge tone={a.role === 'superadmin' ? 'violet' : a.role === 'admin' ? 'blue' : 'slate'}>{a.role}</Badge>
              </Td>
              <Td>
                <Badge tone={a.status === 'active' ? 'green' : 'red'}>{a.status}</Badge>
              </Td>
              <Td>
                <span className="text-sm text-slate-500">{a.last_login_at ? formatDateTime(a.last_login_at) : 'Never'}</span>
              </Td>
              <Td>
                <AdminRowActions admin={a} onChanged={load} />
              </Td>
            </TableRow>
          ))}
        </tbody>
      </Table>
      <CreateAdminModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
      />
    </Card>
  );
}

function AdminRowActions({ admin, onChanged }: { admin: any; onChanged: () => void }) {
  const [resetOpen, setResetOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/admins/${admin.id}`, payload);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update the administrator.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ temporaryPassword: string }>(`/api/admin/admins/${admin.id}/password-reset`);
      setTempPassword(result.temporaryPassword);
      setResetOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Select
        label="Role"
        value={admin.role}
        onChange={(e) => update({ role: e.target.value })}
        options={[
          { value: 'superadmin', label: 'Superadmin' },
          { value: 'admin', label: 'Admin' },
          { value: 'reviewer', label: 'Reviewer' },
        ]}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => update({ status: admin.status === 'active' ? 'disabled' : 'active' })}
        disabled={busy}
      >
        {admin.status === 'active' ? 'Disable' : 'Enable'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)} disabled={busy}>
        <IconKey className="h-4 w-4" />
        Reset password
      </Button>
      <ConfirmModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={resetPassword}
        loading={busy}
        tone="danger"
        title={`Reset password for ${admin.email}?`}
        description="A temporary password is generated and shown once. The administrator must change it on next sign-in. All their sessions are revoked."
        confirmLabel="Reset password"
      />
      <Modal
        open={!!tempPassword}
        onClose={() => setTempPassword(null)}
        title="Temporary password"
        footer={<Button onClick={() => setTempPassword(null)}>Done</Button>}
      >
        <Alert tone="success">Share this temporary password securely. It is shown only once.</Alert>
        <div className="mt-4">
          <CopyField label="Temporary password (show once)" value={tempPassword || ''} />
        </div>
      </Modal>
    </div>
  );
}

function CreateAdminModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('admin');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/api/admin/admins', { email, password, fullName, role });
      onClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the administrator.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New administrator"
      description="The new administrator must change this password on first sign-in."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-admin-form" loading={submitting}>
            Create administrator
          </Button>
        </>
      }
    >
      <form id="create-admin-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Input label="Initial password" type="password" hint="At least 10 characters. Must be changed on first login." value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          options={[
            { value: 'superadmin', label: 'Superadmin' },
            { value: 'admin', label: 'Admin' },
            { value: 'reviewer', label: 'Reviewer' },
          ]}
        />
      </form>
    </Modal>
  );
}
