import { Navigate, Route, Routes } from 'react-router-dom';
import { ClientGate, AdminGate } from './lib/session';
import { PublicLayout } from './components/shells';
import { ClientActivatePage, ClientLoginPage } from './pages/client/ClientAuthPages';
import { ClientDashboardPage, ClientInvoicePage, ClientSecurityPage } from './pages/client/ClientPages';
import { AdminChangePasswordPage, AdminForgotPage, AdminLoginPage, AdminResetPage } from './pages/admin/AdminAuthPages';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AdminClientDetailPage, AdminClientsPage } from './pages/admin/AdminClientPages';
import { AdminInvoiceDetailPage, AdminInvoicesPage } from './pages/admin/AdminInvoicePages';
import { AdminSubmissionDetailPage, AdminSubmissionsPage } from './pages/admin/AdminReviewPages';
import { AdminPaymentPage } from './pages/admin/AdminPaymentPages';
import { AdminAuditPage, AdminNotificationsPage, AdminReportsPage, AdminSettingsPage, AdminUsersPage } from './pages/admin/AdminSettingsPages';
import { Alert, Button } from './components/ui';
import { Link } from 'react-router-dom';

function NotFound() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">The page you asked for does not exist.</p>
        <Link to="/client/login" className="mt-6 inline-block">
          <Button>Go to sign in</Button>
        </Link>
        <div className="mt-6"><Alert tone="info">If you followed a link from an email, make sure you copied the whole address.</Alert></div>
      </div>
    </PublicLayout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/client/login" replace />} />
      <Route path="/client/login" element={<ClientLoginPage />} />
      <Route path="/client/activate" element={<ClientActivatePage />} />
      <Route element={<ClientGate />}>
        <Route path="/client" element={<ClientDashboardPage />} />
        <Route path="/client/invoices/:invoiceId" element={<ClientInvoicePage />} />
        <Route path="/client/security" element={<ClientSecurityPage />} />
      </Route>
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/forgot-password" element={<AdminForgotPage />} />
      <Route path="/admin/reset-password" element={<AdminResetPage />} />
      <Route element={<AdminGate />}>
        <Route path="/admin/change-password" element={<AdminChangePasswordPage />} />
        <Route path="/admin" element={<AdminOverviewPage />} />
        <Route path="/admin/clients" element={<AdminClientsPage />} />
        <Route path="/admin/clients/:clientId" element={<AdminClientDetailPage />} />
        <Route path="/admin/invoices" element={<AdminInvoicesPage />} />
        <Route path="/admin/invoices/:invoiceId" element={<AdminInvoiceDetailPage />} />
        <Route path="/admin/submissions" element={<AdminSubmissionsPage />} />
        <Route path="/admin/submissions/:submissionId" element={<AdminSubmissionDetailPage />} />
        <Route path="/admin/payment-config" element={<AdminPaymentPage />} />
        <Route path="/admin/settings" element={<AdminSettingsPage />} />
        <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
        <Route path="/admin/audit" element={<AdminAuditPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/reports" element={<AdminReportsPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
