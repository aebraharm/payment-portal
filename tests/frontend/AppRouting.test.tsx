import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../../src/api/client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    details?: Array<{ path?: string; message: string }>;
    constructor(status: number, code: string, message: string, details?: Array<{ path?: string; message: string }>) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }
  return {
    ApiError,
    api: {
      get: (...args: unknown[]) => mockGet(...(args as [string])),
      post: (...args: unknown[]) => mockPost(...(args as [string, unknown])),
      postForm: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
    },
  };
});

import { AppRoutes } from '../../src/routes';
import { BrandingProvider } from '../../src/context/BrandingContext';
import { ClientAuthProvider } from '../../src/context/ClientAuthContext';
import { AdminAuthProvider } from '../../src/context/AdminAuthContext';

const BRANDING = {
  agencyName: 'Test Migration Agency',
  siteTitle: 'Test Portal',
  logoPath: '',
  faviconPath: '',
  contactEmail: 'help@example.com',
  contactPhone: '+1 555 0100',
  officeAddress: '1 Test Street',
  websiteUrl: '',
  primaryColor: '#2563eb',
  secondaryColor: '#0b2447',
  loginHeading: 'Client portal sign in',
  loginDescription: 'Use your name and access code',
  welcomeMessage: 'Welcome',
  footerText: '',
  termsAndConditions: '',
  privacyPolicy: '',
  refundPolicy: '',
  paymentInstructions: '',
  paymentDisclaimer: '',
  supportEmail: 'help@example.com',
  supportPhone: '+1 555 0100',
};

/** Lets a test assert the route the router actually landed on. */
function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <BrandingProvider>
      <ClientAuthProvider>
        <AdminAuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
            <LocationProbe />
          </MemoryRouter>
        </AdminAuthProvider>
      </ClientAuthProvider>
    </BrandingProvider>
  );
}

const location = () => screen.getByTestId('location').textContent;

describe('SPA routing (deep link + refresh)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockImplementation((path: string) => {
      if (path === '/api/public/branding') return Promise.resolve({ branding: BRANDING });
      // Signed out: both portals report no session, as the API does with no cookie.
      return Promise.reject(Object.assign(new Error('unauthorized'), { status: 401 }));
    });
    mockPost.mockRejectedValue(new Error('unexpected POST'));
  });

  it('renders the admin sign-in page for a direct visit to /admin/login', async () => {
    renderAt('/admin/login');
    await waitFor(() => expect(location()).toBe('/admin/login'));
    expect(await screen.findByRole('heading', { name: 'Admin Portal' })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });

  it('renders the same page on refresh, with no server route of its own', async () => {
    // A refresh is a cold start at the same URL: nothing may be cached in
    // history, so mount twice and compare.
    const first = renderAt('/admin/login');
    await screen.findByRole('heading', { name: 'Admin Portal' });
    first.unmount();
    renderAt('/admin/login');
    expect(await screen.findByRole('heading', { name: 'Admin Portal' })).toBeInTheDocument();
    expect(location()).toBe('/admin/login');
  });

  it('protects /admin and sends the visitor to the admin login', async () => {
    renderAt('/admin');
    await waitFor(() => expect(location()).toBe('/admin/login'));
  });

  it('protects client routes by sending the visitor to the client login', async () => {
    renderAt('/transactions');
    await waitFor(() => expect(location()).toBe('/login'));
  });

  it('shows the in-app 404 for unknown paths instead of index.html', async () => {
    renderAt('/not-a-real-page');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(location()).toBe('/not-a-real-page');
  });
});

describe('Admin Portal link on the client login page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockImplementation((path: string) => {
      if (path === '/api/public/branding') return Promise.resolve({ branding: BRANDING });
      return Promise.reject(Object.assign(new Error('unauthorized'), { status: 401 }));
    });
  });

  it('is visible on /login', async () => {
    renderAt('/login');
    const link = await screen.findByRole('link', { name: /admin portal/i });
    expect(link).toHaveAttribute('href', '/admin/login');
  });

  it('navigates to the admin sign-in page without a full page load', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(await screen.findByRole('link', { name: /admin portal/i }));
    await waitFor(() => expect(location()).toBe('/admin/login'));
    expect(await screen.findByRole('heading', { name: 'Admin Portal' })).toBeInTheDocument();
  });

  it('reuses the real admin authentication flow, not a parallel one', async () => {
    const user = userEvent.setup();
    mockPost.mockImplementation((path: string) => {
      if (path === '/api/admin/auth/login') {
        return Promise.reject(new Error('network down'));
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
    renderAt('/login');
    await user.click(await screen.findByRole('link', { name: /admin portal/i }));
    await screen.findByRole('heading', { name: 'Admin Portal' });

    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorseBattery');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // The link lands on the genuine admin login, which posts to the genuine
    // admin endpoint with the entered credentials.
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/api/admin/auth/login', {
        email: 'admin@example.com',
        password: 'CorrectHorseBattery',
      })
    );
  });

  it('surfaces the server response on that shared flow', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../../src/api/client');
    mockPost.mockImplementation((path: string) => {
      if (path === '/api/admin/auth/login') {
        return Promise.reject(new ApiError(401, 'unauthorized', 'Invalid email or password.'));
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
    renderAt('/admin/login');
    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });
});
