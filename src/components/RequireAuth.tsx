import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useClientAuth } from '../context/ClientAuthContext';
import { PageLoader } from './ui/Spinner';

/** Protect client routes: redirect to client login when unauthenticated. */
export function RequireClient() {
  const { client, loading } = useClientAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Loading your client portal…" />;
  if (!client) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Protect admin routes: redirect to admin login when unauthenticated. */
export function RequireAdmin() {
  const { admin, loading } = useAdminAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Loading admin portal…" />;
  if (!admin) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  // First login with bootstrap credentials forces a password change.
  if (admin.mustChangePassword && location.pathname !== '/admin/change-password') {
    return <Navigate to="/admin/change-password" replace />;
  }
  return <Outlet />;
}
