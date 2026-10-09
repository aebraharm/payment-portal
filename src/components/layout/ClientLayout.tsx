import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useClientAuth } from '../../context/ClientAuthContext';
import { useBranding } from '../../context/BrandingContext';
import { BrandLogo } from './BrandLogo';
import { IconList, IconLogout, IconMenu, IconSupport, IconWallet, IconHome, IconX } from '../ui/Icons';
import { PageLoader } from '../ui/Spinner';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: IconHome, end: true },
  { to: '/pay', label: 'Make a payment', icon: IconWallet, end: false },
  { to: '/transactions', label: 'Transactions', icon: IconList, end: false },
  { to: '/support', label: 'Support', icon: IconSupport, end: false },
];

export function ClientLayout() {
  const { client, loading, logout } = useClientAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return <PageLoader label="Loading your client portal…" />;
  if (!client) return null; // guard handles redirect

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-brand-700"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center" aria-label="Go to dashboard">
            <BrandLogo size="sm" />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Client navigation">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-navy-900'
                  }`
                }
                style={({ isActive }) => (isActive ? { color: 'var(--brand-primary-dark)' } : undefined)}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-navy-900">{client.fullName}</p>
              <p className="text-xs text-slate-500">{client.clientCode}</p>
            </div>
            <button
              onClick={handleLogout}
              className="hidden items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-red-600 sm:flex"
            >
              <IconLogout className="h-4 w-4" />
              Sign out
            </button>
            <button
              className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 md:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              <IconMenu className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-navy-900/40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-0 flex h-full w-72 flex-col bg-white shadow-card-hover animate-slide-down">
              <div className="flex items-center justify-between border-b border-slate-100 p-4">
                <BrandLogo size="sm" />
                <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
                  <IconX className="h-5 w-5" />
                </button>
              </div>
              <div className="border-b border-slate-100 p-4">
                <p className="font-semibold text-navy-900">{client.fullName}</p>
                <p className="text-sm text-slate-500">{client.clientCode}</p>
              </div>
              <nav className="flex-1 space-y-1 p-4" aria-label="Client navigation mobile">
                {NAV_ITEMS.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium ${
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                      }`
                    }
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <div className="border-t border-slate-100 p-4">
                <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                  <IconLogout className="h-5 w-5" />
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-500 sm:px-6">
          {branding?.footerText ? (
            <p>{branding.footerText}</p>
          ) : (
            <p>Secure client payment portal. All payment submissions are reviewed before verification.</p>
          )}
          <div className="mt-2 flex flex-wrap justify-center gap-4">
            <Link to="/legal/terms" className="hover:text-brand-600">Terms</Link>
            <Link to="/legal/privacy" className="hover:text-brand-600">Privacy</Link>
            <Link to="/legal/refund" className="hover:text-brand-600">Refund policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export type { ReactNode };
