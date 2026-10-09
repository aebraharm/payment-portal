import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { useBranding } from '../../context/BrandingContext';
import { ApiError } from '../../api/client';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Alert } from '../../components/ui/Alert';
import { IconLock, IconMail } from '../../components/ui/Icons';

export function AdminLogin() {
  const { branding } = useBranding();
  const { admin, login } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string })?.from || '/admin';

  if (admin && !admin.mustChangePassword) {
    return <Navigate to={from} replace />;
  }
  if (admin && admin.mustChangePassword) {
    return <Navigate to="/admin/change-password" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      if (result.mustChangePassword) {
        navigate('/admin/change-password', { replace: true });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to sign in right now. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-navy-900 to-navy-800 px-4 py-10">
      <div className="w-full max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <div className="inline-flex rounded-2xl bg-white/10 p-3 backdrop-blur">
            <BrandLogo size="md" showName={false} />
          </div>
          <p className="mt-4 text-lg font-semibold text-white">{branding?.agencyName || 'Payment Portal'}</p>
          <p className="mt-1 text-sm text-blue-200">Administrator sign in</p>
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-bold">Admin Portal</h1>
          <p className="mt-1.5 text-sm text-slate-500">Restricted area. Authorized administrators only.</p>

          {error && (
            <Alert tone="error" className="mt-5">
              {error}
            </Alert>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <Input
              label="Email"
              type="email"
              autoComplete="username"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={<IconMail className="h-4 w-4" />}
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<IconLock className="h-4 w-4" />}
              required
            />
            <Button type="submit" className="w-full btn-lg" loading={submitting} loadingText="Signing in…">
              <IconLock className="h-4 w-4" />
              Sign in
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-blue-200/70">
          All administrative actions are logged. If you did not request access, contact your system administrator.
        </p>
      </div>
    </div>
  );
}
