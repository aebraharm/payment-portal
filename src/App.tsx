import { BrowserRouter } from 'react-router-dom';
import { BrandingProvider } from './context/BrandingContext';
import { ClientAuthProvider } from './context/ClientAuthContext';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { AppRoutes } from './routes';

/**
 * Providers + the history-boundary. The route table itself lives in
 * `./routes` so it can be tested without a live `BrowserRouter`.
 */
export default function App() {
  return (
    <BrandingProvider>
      <ClientAuthProvider>
        <AdminAuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AdminAuthProvider>
      </ClientAuthProvider>
    </BrandingProvider>
  );
}
