import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { api, ApiError, setCsrfToken } from './api';
import { LoadingBlock } from '../components/ui';

export interface ClientSession {
  client: { id: string; fullName: string; clientCode: string };
  csrfToken: string;
}

export interface AdminSession {
  admin: { id: string; email: string; displayName: string; role: string; roleLabel: string };
  csrfToken: string;
  mustChangePassword: boolean;
  permissions: string[];
}

export interface GateContext<T> {
  session: T;
  reload: () => Promise<void>;
}

export function useGate<T>(): GateContext<T> {
  return useOutletContext<GateContext<T>>();
}

/** Loads the session for a portal area. Anyone without a valid session is sent to that area's sign-in page. */
function useSessionLoader<T extends { csrfToken: string }>(path: string) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'anonymous' | 'error'; session: T | null }>({ status: 'loading', session: null });
  const load = async () => {
    try {
      const session = await api.get<T>(path);
      setCsrfToken(session.csrfToken);
      setState({ status: 'ready', session });
    } catch (error) {
      setCsrfToken(null);
      const anonymous = error instanceof ApiError && (error.status === 401 || error.status === 403);
      setState({ status: anonymous ? 'anonymous' : 'error', session: null });
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return { state, reload: load };
}

export function ClientGate() {
  const { state, reload } = useSessionLoader<ClientSession>('/client/auth/session');
  if (state.status === 'loading') return <div className="mx-auto max-w-5xl px-4 py-16"><LoadingBlock label="Checking your session" rows={4} /></div>;
  if (state.status === 'anonymous') return <Navigate to="/client/login" replace />;
  if (state.status === 'error' || !state.session) return <SessionError onRetry={reload} />;
  return <Outlet context={{ session: state.session, reload: reload as () => Promise<void> }} />;
}

export function AdminGate() {
  const location = useLocation();
  const { state, reload } = useSessionLoader<AdminSession>('/admin/auth/session');
  if (state.status === 'loading') return <div className="mx-auto max-w-5xl px-4 py-16"><LoadingBlock label="Checking your session" rows={4} /></div>;
  if (state.status === 'anonymous') return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  if (state.status === 'error' || !state.session) return <SessionError onRetry={reload} />;
  const mustChange = state.session.mustChangePassword;
  if (mustChange && location.pathname !== '/admin/change-password') return <Navigate to="/admin/change-password" replace />;
  if (!mustChange && location.pathname === '/admin/change-password') return <Navigate to="/admin" replace />;
  return <Outlet context={{ session: state.session, reload: reload as () => Promise<void> }} />;
}

function SessionError({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-slate-800">We could not confirm your session because of a server problem.</p>
      <button type="button" onClick={() => void onRetry()} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
        Try again
      </button>
    </div>
  );
}
