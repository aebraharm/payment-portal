import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../../src/api/client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    details?: Array<{ path?: string; message: string }>;
    constructor(status: number, body: any) {
      super(body?.error?.message || 'Request failed');
      this.name = 'ApiError';
      this.status = status;
      this.code = body?.error?.code;
      this.details = body?.error?.details;
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

import { ClientLogin } from '../../src/pages/client/ClientLogin';
import { BrandingProvider } from '../../src/context/BrandingContext';
import { ClientAuthProvider } from '../../src/context/ClientAuthContext';

const BRANDING = {
  agencyName: 'Test Migration Agency',
  primaryColor: '#0b5fff',
  secondaryColor: '#06255c',
  loginHeading: 'Client portal sign in',
  loginDescription: 'Use your name and access code',
  supportEmail: 'help@example.com',
  supportPhone: '+1 555 0100',
  supportAddress: '1 Test Street',
  clientWelcomeMessage: 'Welcome',
  termsOfService: 'Terms',
  privacyPolicy: 'Privacy',
  refundPolicy: 'Refunds',
  cardLabel: 'Not available in your region',
  paymentMethods: [],
  currencies: [],
  legalPages: [],
};

function renderLogin() {
  return render(
    <BrandingProvider>
      <ClientAuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <ClientLogin />
        </MemoryRouter>
      </ClientAuthProvider>
    </BrandingProvider>
  );
}

describe('ClientLogin page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockImplementation((path: string) => {
      if (path === '/api/public/branding') return Promise.resolve({ branding: BRANDING });
      if (path === '/api/client/auth/me') {
        const err = new Error('unauthorized') as Error & { status: number };
        err.status = 401;
        return Promise.reject(err);
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
  });

  it('renders the branding heading from the API (not hardcoded)', async () => {
    renderLogin();
    expect(await screen.findByText('Client portal sign in')).toBeInTheDocument();
    expect(screen.getByText('Use your name and access code')).toBeInTheDocument();
    expect(screen.getByText('Test Migration Agency')).toBeInTheDocument();
  });

  it('shows validation errors when submitting an empty form', async () => {
    const user = userEvent.setup();
    renderLogin();
    await screen.findByText('Client portal sign in');
    await user.click(screen.getByRole('button', { name: /sign in securely/i }));
    expect(await screen.findByText('Enter your full name as registered with the agency.')).toBeInTheDocument();
    expect(screen.getByText('Enter the access code issued to you.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalledWith('/api/client/auth/login', expect.anything());
  });

  it('submits credentials to the client login endpoint', async () => {
    const user = userEvent.setup();
    mockPost.mockImplementation((path: string) => {
      if (path === '/api/client/auth/login') {
        return Promise.resolve({ client: { id: 1, fullName: 'Adaeze Okafor', clientCode: 'CL-2026-0001', status: 'active' } });
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
    renderLogin();
    await screen.findByText('Client portal sign in');
    await user.type(screen.getByLabelText(/full name/i), 'Adaeze Okafor');
    await user.type(screen.getByLabelText(/access code/i), 'czgv7euz');
    await user.click(screen.getByRole('button', { name: /sign in securely/i }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/client/auth/login', {
        fullName: 'Adaeze Okafor',
        accessCode: 'CZGV7EUZ',
      });
    });
  });

  it('displays the server error message on failed login', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../../src/api/client');
    mockPost.mockImplementation((path: string) => {
      if (path === '/api/client/auth/login') {
        return Promise.reject(new ApiError(401, { error: { code: 'unauthorized', message: 'Invalid full name or access code.' } }));
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
    renderLogin();
    await screen.findByText('Client portal sign in');
    await user.type(screen.getByLabelText(/full name/i), 'Wrong Person');
    await user.type(screen.getByLabelText(/access code/i), 'WRONGCODE');
    await user.click(screen.getByRole('button', { name: /sign in securely/i }));
    expect(await screen.findByText('Invalid full name or access code.')).toBeInTheDocument();
  });
});
