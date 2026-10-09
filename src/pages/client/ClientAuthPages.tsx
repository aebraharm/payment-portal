import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setCsrfToken } from '../../lib/api';
import { usePublicConfig } from '../../lib/config';
import { Alert, Button, Card, LoadingBlock, TextInput } from '../../components/ui';
import { PublicLayout } from '../../components/shells';
import { fieldErrorsFrom, formMessageFrom } from '../../components/forms';
import { ACCESS_CODE_MIN_LENGTH } from '../../../shared/constants';
import { formatDateTime } from '../../lib/format';

export function ClientLoginPage() {
  const navigate = useNavigate();
  const { config } = usePublicConfig();
  const [fullName, setFullName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await api.post<{ csrfToken: string }>('/client/auth/login', { fullName, accessCode });
      setCsrfToken(result.csrfToken);
      navigate('/client', { replace: true });
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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{config?.branding.loginHeading ?? 'Client sign in'}</h1>
        <p className="mt-2 text-sm text-slate-600">{config?.branding.loginDescription ?? ''}</p>
        <Card className="mt-6">
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <TextInput
              label="Full name"
              name="fullName"
              autoComplete="name"
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              error={errors.fullName}
              hint="Use the name on your file, exactly as it was given to us."
            />
            <TextInput
              label="Access code"
              name="accessCode"
              type="password"
              autoComplete="current-password"
              required
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              error={errors.accessCode}
              hint="Your access code comes from your invitation link. Your name alone is not enough to sign in."
            />
            <Button type="submit" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>
        </Card>
        <p className="mt-6 text-center text-sm text-slate-600">
          {config?.contact.supportEmail
            ? `Lost your access code or invitation? Email ${config.contact.supportEmail}.`
            : 'Lost your access code or invitation? Contact your case manager.'}
        </p>
      </div>
    </PublicLayout>
  );
}

type Inspection = { valid: boolean; clientName: string | null; expiresAt: string | null };

export function ClientActivatePage() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [checking, setChecking] = useState(true);
  const [accessCode, setAccessCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The token lives in the URL fragment so it is never sent to a server log or a Referer header.
    const match = /#token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
    const found = match?.[1] ?? null;
    setToken(found);
    if (!found) {
      setChecking(false);
      return;
    }
    api
      .post<Inspection>('/client/auth/activation/inspect', { token: found })
      .then((result) => setInspection(result))
      .catch(() => setInspection({ valid: false, clientName: null, expiresAt: null }))
      .finally(() => setChecking(false));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    if (accessCode !== confirmCode) {
      setErrors({ confirmCode: 'The two access codes do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/client/auth/activation/complete', { token, accessCode });
      setDone(true);
      window.history.replaceState(null, '', '/client/activate');
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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Activate your client portal</h1>
        <div className="mt-6">
          {checking && <LoadingBlock label="Checking your invitation" rows={2} />}
          {!checking && !token && <Alert tone="warning" title="This link is incomplete.">Open the full invitation link from your email. If you cannot find it, ask for a new invitation.</Alert>}
          {!checking && token && inspection && !inspection.valid && (
            <Alert tone="danger" title="This invitation can no longer be used.">
              It may have expired, already been used, or been replaced by a newer one. Ask your case manager for a new invitation.
            </Alert>
          )}
          {!checking && inspection?.valid && !done && (
            <Card title={`Welcome, ${inspection.clientName ?? ''}`} description={`Choose an access code of at least ${ACCESS_CODE_MIN_LENGTH} characters. You will use it with your full name to sign in.`}>
              <form onSubmit={onSubmit} noValidate className="space-y-5">
                {formError && <Alert tone="danger">{formError}</Alert>}
                <TextInput label="New access code" type="password" autoComplete="new-password" required minLength={ACCESS_CODE_MIN_LENGTH} value={accessCode} onChange={(e) => setAccessCode(e.target.value)} error={errors.accessCode} />
                <TextInput label="Confirm access code" type="password" autoComplete="new-password" required value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} error={errors.confirmCode} />
                {inspection.expiresAt && <p className="text-xs text-slate-500">This link expires on {formatDateTime(inspection.expiresAt)}.</p>}
                <Button type="submit" loading={busy} className="w-full">
                  Save access code
                </Button>
              </form>
            </Card>
          )}
          {done && (
            <Alert tone="success" title="Your access code is saved.">
              <Button className="mt-3" onClick={() => navigate('/client/login')}>Go to sign in</Button>
            </Alert>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

export function ClientLinkHint() {
  return (
    <p className="text-sm text-slate-600">
      Staff? <Link className="font-medium text-brand-700 hover:underline" to="/admin/login">Go to the admin sign in</Link>
    </p>
  );
}
