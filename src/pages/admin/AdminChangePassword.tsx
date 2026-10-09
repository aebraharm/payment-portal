import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Alert } from '../../components/ui/Alert';
import { IconLock } from '../../components/ui/Icons';

export function AdminChangePassword() {
  const { admin, setMustChangePassword, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!admin) {
    navigate('/admin/login', { replace: true });
    return null;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 10) {
      setError('The new password must be at least 10 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different from the current password.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/admin/auth/change-password', { currentPassword, newPassword });
      setMustChangePassword(false);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to change the password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-navy-900 to-navy-800 px-4 py-10">
      <div className="w-full max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <BrandLogo size="md" showName={false} />
          <p className="mt-4 text-sm text-blue-200">Administrator sign in</p>
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-bold">Set a new password</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {admin.mustChangePassword
              ? 'For security, you must change the initial password before continuing.'
              : 'Change your administrator password.'}
          </p>

          {error && (
            <Alert tone="error" className="mt-5">
              {error}
            </Alert>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              icon={<IconLock className="h-4 w-4" />}
              required
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 10 characters. Use a strong, unique password."
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              icon={<IconLock className="h-4 w-4" />}
              required
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              icon={<IconLock className="h-4 w-4" />}
              required
            />
            <Button type="submit" className="w-full btn-lg" loading={submitting} loadingText="Saving…">
              Save new password
            </Button>
          </form>
          <button
            className="mt-4 w-full text-center text-sm text-slate-400 hover:text-slate-600"
            onClick={async () => {
              await logout();
              navigate('/admin/login', { replace: true });
            }}
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
