import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, setCsrfToken } from '../../lib/api';
import { PublicLayout } from '../../components/shells';
import { Alert, Button, Card, TextInput } from '../../components/ui';
import { fieldErrorsFrom, formMessageFrom } from '../../components/forms';
import { ADMIN_PASSWORD_MIN_LENGTH } from '../../../shared/constants';
import { useGate, type AdminSession } from '../../lib/session';

function AuthCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <PublicLayout>
      <div className="page-enter mx-auto max-w-md px-4 py-12 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
        <Card className="mt-6">{children}</Card>
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link to="/admin/login" className="font-medium text-brand-700 hover:underline">
            Admin sign in
          </Link>
          {' · '}
          <Link to="/client/login" className="font-medium text-brand-700 hover:underline">
            Client sign in
          </Link>
        </p>
      </div>
    </PublicLayout>
  );
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await api.post<{ csrfToken: string; mustChangePassword: boolean }>('/admin/auth/login', { email, password });
      setCsrfToken(result.csrfToken);
      navigate(result.mustChangePassword ? '/admin/change-password' : from, { replace: true });
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(formMessageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Staff sign in" description="For agency staff only. Sign-in attempts are logged.">
      <form onSubmit={submit} noValidate className="space-y-5">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/admin/forgot-password" className="font-medium text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

export function AdminForgotPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/auth/password-reset/request', { email });
      setSent(true);
    } catch (error) {
      setFormError(formMessageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Reset your password" description="If an account exists for this email, we will send a link that expires in 30 minutes.">
      {sent ? (
        <Alert tone="success" title="Check your email.">
          If the address belongs to an admin account, a reset link is on its way. The link can be used once.
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" loading={busy} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function AdminResetPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The one-time token is read from the URL fragment, then removed from the address bar.
    const match = /#token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
    setToken(match?.[1] ?? null);
    if (match) window.history.replaceState(null, '', '/admin/reset-password');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    if (password !== confirm) {
      setErrors({ confirm: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/auth/password-reset/confirm', { token, newPassword: password });
      setDone(true);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(formMessageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Reset link needed">
        <Alert tone="warning">This link is incomplete or has already been used. Request a new reset link.</Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" description={`Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`}>
      {done ? (
        <Alert tone="success" title="Your password has been changed.">
          <Link to="/admin/login" className="font-medium underline">Sign in with your new password</Link>
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <TextInput label="New password" type="password" autoComplete="new-password" required minLength={ADMIN_PASSWORD_MIN_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} error={errors.newPassword} />
          <TextInput label="Confirm new password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <Button type="submit" loading={busy} className="w-full">
            Save new password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function AdminChangePasswordPage() {
  const { session, reload } = useGate<AdminSession>();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    if (next !== confirm) {
      setErrors({ confirm: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/auth/change-password', { currentPassword: current, newPassword: next });
      await reload();
      navigate('/admin', { replace: true });
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(formMessageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <div className="page-enter mx-auto max-w-md px-4 py-12 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Set a new password</h1>
        <p className="mt-2 text-sm text-slate-600">
          Signed in as {session.admin.email}. Your account requires a new password before you can continue. Use at least {ADMIN_PASSWORD_MIN_LENGTH} characters.
        </p>
        <Card className="mt-6">
          <form onSubmit={submit} noValidate className="space-y-5">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <TextInput label="Current password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.currentPassword} />
            <TextInput label="New password" type="password" autoComplete="new-password" required minLength={ADMIN_PASSWORD_MIN_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} error={errors.newPassword} />
            <TextInput label="Confirm new password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
            <Button type="submit" loading={busy} className="w-full">
              Save and continue
            </Button>
          </form>
        </Card>
      </div>
    </PublicLayout>
  );
}
