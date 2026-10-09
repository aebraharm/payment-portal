import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useBranding } from '../../context/BrandingContext';
import { useClientAuth } from '../../context/ClientAuthContext';
import { api, ApiError } from '../../api/client';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Alert } from '../../components/ui/Alert';
import { IconKey, IconLock, IconUsers } from '../../components/ui/Icons';

export function ClientLogin() {
  const { branding } = useBranding();
  const { client, login } = useClientAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [fullName, setFullName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showReset, setShowReset] = useState(false);

  const from = (location.state as { from?: string })?.from || '/';

  if (client) {
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const errors: Record<string, string> = {};
    if (fullName.trim().length < 2) errors.fullName = 'Enter your full name as registered with the agency.';
    if (accessCode.trim().length < 4) errors.accessCode = 'Enter the access code issued to you.';
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      await login(fullName.trim(), accessCode.trim());
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const d of err.details) {
            if (d.path) mapped[d.path] = d.message;
          }
          setFieldErrors(mapped);
        }
      } else {
        setError('Unable to sign in right now. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-10">
      <div className="w-full max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <BrandLogo size="lg" className="justify-center" />
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-bold">{branding?.loginHeading || 'Client sign in'}</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {branding?.loginDescription || 'Sign in with your full name and the access code issued by our team.'}
          </p>

          {error && (
            <Alert tone="error" className="mt-5">
              {error}
            </Alert>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <Input
              label="Full name"
              autoComplete="name"
              placeholder="e.g. Jane Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              error={fieldErrors.fullName}
              icon={<IconUsers className="h-4 w-4" />}
              required
            />
            <Input
              label="Access code"
              autoComplete="off"
              placeholder="Enter your 8-character access code"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              error={fieldErrors.accessCode}
              icon={<IconKey className="h-4 w-4" />}
              required
            />
            <Button type="submit" className="w-full btn-lg" loading={submitting} loadingText="Signing you in…">
              <IconLock className="h-4 w-4" />
              Sign in securely
            </Button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-500">
            <button type="button" className="link" onClick={() => setShowReset((v) => !v)}>
              Forgot your access code?
            </button>
          </div>

          {showReset && <AccessCodeReset onDone={() => setShowReset(false)} />}
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          Payments are only marked as received after review by our team. Never share your access code.
        </p>
      </div>
    </div>
  );
}

function AccessCodeReset({ onDone }: { onDone: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/api/client/auth/access-reset-request', { fullName, email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <Alert tone="info" className="mt-5">
        If the details match an account, our team will contact you with a new access code.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-navy-800">Request a new access code</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      <Input label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={submitting} loadingText="Sending…">
          Send request
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
