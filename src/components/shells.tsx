import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api, setCsrfToken } from '../lib/api';
import { usePublicConfig } from '../lib/config';
import { Button, cx } from './ui';

export function Brand() {
  const { config } = usePublicConfig();
  const name = config?.branding.agencyName ?? '';
  return (
    <Link to="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-offset-4">
      {config?.branding.logoUrl ? (
        <img src={config.branding.logoUrl} alt="" className="h-9 w-auto max-w-[160px] object-contain" />
      ) : (
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          {name.slice(0, 1) || '•'}
        </span>
      )}
      <span className="text-sm font-semibold text-slate-900">{name || ' '}</span>
    </Link>
  );
}

export function Footer() {
  const { config } = usePublicConfig();
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>{config?.branding.footerText ?? ''}</p>
        {config?.contact.supportEmail && (
          <a className="font-medium text-brand-700 hover:underline" href={`mailto:${config.contact.supportEmail}`}>
            {config.contact.supportEmail}
          </a>
        )}
      </div>
    </footer>
  );
}

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-white via-white to-brand-50/60">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Brand />
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}

export function SkipLink() {
  return (
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg">
      Skip to content
    </a>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  );

export function ClientLayout({ children, clientName }: { children: ReactNode; clientName: string }) {
  const navigate = useNavigate();
  async function signOut() {
    try {
      await api.post('/client/auth/logout');
    } finally {
      setCsrfToken(null);
      navigate('/client/login', { replace: true });
    }
  }
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <SkipLink />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <Brand />
            <nav aria-label="Client navigation" className="flex items-center gap-1">
              <NavLink to="/client" end className={navClass}>
                Dashboard
              </NavLink>
              <NavLink to="/client/security" className={navClass}>
                Security
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{clientName}</span>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}

export interface AdminNavItem {
  to: string;
  label: string;
  permission: string;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin', label: 'Overview', permission: 'dashboard:read' },
  { to: '/admin/clients', label: 'Clients', permission: 'clients:read' },
  { to: '/admin/invoices', label: 'Invoices', permission: 'invoices:read' },
  { to: '/admin/submissions', label: 'Payment review', permission: 'payments:read' },
  { to: '/admin/payment-config', label: 'Payment setup', permission: 'payments:read' },
  { to: '/admin/notifications', label: 'Notifications', permission: 'notifications:read' },
  { to: '/admin/settings', label: 'Settings & branding', permission: 'settings:read' },
  { to: '/admin/reports', label: 'Reports', permission: 'reports:export' },
  { to: '/admin/audit', label: 'Audit log', permission: 'audit:read' },
  { to: '/admin/users', label: 'Admin users', permission: 'users:manage' },
];

export function AdminLayout({ children, adminName, roleLabel, permissions }: { children: ReactNode; adminName: string; roleLabel: string; permissions: string[] }) {
  const navigate = useNavigate();
  const items = ADMIN_NAV.filter((item) => permissions.includes(item.permission));
  async function signOut() {
    try {
      await api.post('/admin/auth/logout');
    } finally {
      setCsrfToken(null);
      navigate('/admin/login', { replace: true });
    }
  }
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 lg:flex-row">
      <SkipLink />
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-4 lg:py-6">
          <Brand />
        </div>
        <nav aria-label="Admin navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/admin'} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{adminName}</p>
            <p className="text-xs text-slate-500">{roleLabel}</p>
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </header>
        <main id="main" className="page-enter mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
