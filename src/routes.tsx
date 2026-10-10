import { Route, Routes } from 'react-router-dom';
import { RequireAdmin, RequireClient } from './components/RequireAuth';
import { ClientLayout } from './components/layout/ClientLayout';
import { AdminLayout } from './components/layout/AdminLayout';

import { ClientLogin } from './pages/client/ClientLogin';
import { ClientDashboard } from './pages/client/ClientDashboard';
import { PaySelectInvoice } from './pages/client/PaySelectInvoice';
import { PaySelectMethod } from './pages/client/PaySelectMethod';
import { PayInstructions } from './pages/client/PayInstructions';
import { PaySubmit } from './pages/client/PaySubmit';
import { ClientTransactions } from './pages/client/ClientTransactions';
import { ClientTransactionDetail } from './pages/client/ClientTransactionDetail';
import { Support } from './pages/client/Support';
import { Legal } from './pages/client/Legal';

import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminChangePassword } from './pages/admin/AdminChangePassword';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminClients } from './pages/admin/AdminClients';
import { AdminClientDetail } from './pages/admin/AdminClientDetail';
import { AdminInvoices } from './pages/admin/AdminInvoices';
import { AdminInvoiceForm } from './pages/admin/AdminInvoiceForm';
import { AdminInvoiceDetail } from './pages/admin/AdminInvoiceDetail';
import { AdminPaymentSettings } from './pages/admin/AdminPaymentSettings';
import { AdminTransactions } from './pages/admin/AdminTransactions';
import { AdminTransactionReview } from './pages/admin/AdminTransactionReview';
import { AdminBrandingSettings } from './pages/admin/AdminBrandingSettings';
import { AdminSecurity } from './pages/admin/AdminSecurity';

/**
 * The single source of truth for client-side routes.
 *
 * Kept separate from `App` so the exact same route table can be rendered under
 * `BrowserRouter` in the browser and under `MemoryRouter` in tests (deep links,
 * refresh, redirects). Every path here must also resolve to `index.html` on the
 * host — see the SPA fallback in `netlify.toml` and the catch-all in
 * `server/app.js`.
 */
export function AppRoutes() {
  return (
    <Routes>
      {/* Client portal */}
      <Route path="/login" element={<ClientLogin />} />
      <Route element={<RequireClient />}>
        <Route element={<ClientLayout />}>
          <Route path="/" element={<ClientDashboard />} />
          <Route path="/pay" element={<PaySelectInvoice />} />
          <Route path="/pay/:invoiceId" element={<PaySelectMethod />} />
          <Route path="/pay/:invoiceId/instructions" element={<PayInstructions />} />
          <Route path="/pay/:invoiceId/submit" element={<PaySubmit />} />
          <Route path="/transactions" element={<ClientTransactions />} />
          <Route path="/transactions/:id" element={<ClientTransactionDetail />} />
          <Route path="/support" element={<Support />} />
          <Route path="/legal/:slug" element={<Legal />} />
        </Route>
      </Route>

      {/* Admin portal */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/change-password" element={<AdminChangePassword />} />
      <Route element={<RequireAdmin />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/clients" element={<AdminClients />} />
          <Route path="/admin/clients/:id" element={<AdminClientDetail />} />
          <Route path="/admin/invoices" element={<AdminInvoices />} />
          <Route path="/admin/invoices/new" element={<AdminInvoiceForm />} />
          <Route path="/admin/invoices/:id" element={<AdminInvoiceDetail />} />
          <Route path="/admin/payments" element={<AdminPaymentSettings />} />
          <Route path="/admin/transactions" element={<AdminTransactions />} />
          <Route path="/admin/transactions/:id" element={<AdminTransactionReview />} />
          <Route path="/admin/settings" element={<AdminBrandingSettings />} />
          <Route path="/admin/security" element={<AdminSecurity />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <p className="text-6xl font-bold text-brand-200">404</p>
      <h1 className="text-xl font-bold text-navy-900">Page not found</h1>
      <p className="text-sm text-slate-500">The page you are looking for does not exist.</p>
      <a href="/" className="btn btn-primary">
        Go to the portal
      </a>
    </div>
  );
}
