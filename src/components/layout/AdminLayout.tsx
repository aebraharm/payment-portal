import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { BrandLogo } from './BrandLogo';
import { PageLoader } from '../ui/Spinner';
import {
  IconDoc,
  IconHome,
  IconList,
  IconLogout,
  IconMenu,
  IconSettings,
  IconShield,
  IconUsers,
  IconWallet,
  IconX,
} from '../ui/Icons';

const NAV_SECTIONS: Array<{ title: string; items: Array<{ to: string; label: string; icon: typeof IconHome }> }> = [
  {
    title: 'Overview',
    items: [{ to: '/admin', label: 'Dashboard', icon: IconHome }],
  },
  {
    title: 'Management',
    items: [
      { to: '/admin/clients', label: 'Clients', icon: IconUsers },
      { to: '/admin/invoices', label: 'Invoices', icon: IconDoc },
      { to: '/admin/transactions', label: 'Payment review', icon: IconList },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { to: '/admin/payments', label: 'Payment settings', icon: IconWallet },
      { to: '/admin/settings', label: 'Branding & settings', icon: IconSettings },
    ],
  },
  {
    title: 'Security',
    items: [{ to: '/admin/security', label: 'Security & audit', icon: IconShield }],
  },
];

function SidebarContent({ onNavigate, role }: { onNavigate?: () => void; role: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 p-4">
        <BrandLogo size="sm" />
        <p className="mt-1 text-xs text-slate-400">Admin Portal</p>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto p-4 thin-scrollbar" aria-label="Admin navigation">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/admin'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-navy-900'
                    }`
                  }
                  style={({ isActive }) => (isActive ? { color: 'var(--brand-primary-dark)' } : undefined)}
                >
                  <item.icon className="h-4.5 w-4.5 h-5 w-5 shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-100 p-4 text-xs text-slate-400">
        Role: <span className="font-semibold capitalize text-slate-600">{role}</span>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const { admin, loading, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (loading) return <PageLoader label="Loading admin portal…" />;
  if (!admin) return null;

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <SidebarContent role={admin.role} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-900/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-card-hover animate-slide-up">
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <span className="text-sm font-semibold text-navy-900">Admin Portal</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
                <IconX className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent role={admin.role} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
              <IconMenu className="h-6 w-6" />
            </button>
            <span className="text-sm font-semibold text-navy-900 lg:hidden">Admin Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-navy-900">{admin.fullName || admin.email}</p>
              <p className="text-xs capitalize text-slate-500">{admin.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-red-600"
            >
              <IconLogout className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
