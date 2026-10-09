// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { PublicConfigProvider } from '../../src/lib/config';
import { ToastProvider } from '../../src/components/ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const publicConfig = {
  branding: {
    agencyName: 'Northbridge Visa Services',
    websiteTitle: 'Northbridge Payments',
    primaryColor: '#1d4ed8',
    secondaryColor: '#0b1f44',
    loginHeading: 'Northbridge client sign in',
    loginDescription: 'Use the name on your file and your access code.',
    clientWelcomeMessage: 'Welcome back.',
    footerText: 'Northbridge Visa Services',
    logoUrl: null,
    faviconUrl: null,
  },
  contact: { supportEmail: 'help@northbridge.example', phone: '', whatsappEnabled: false, whatsappNumber: '', address: '', websiteUrl: '', supportHours: '' },
  policies: { termsText: '', privacyText: '', refundText: '', paymentDisclaimer: '', feesNotice: '', nextStepsText: '' },
  labels: { helpSenderName: '', helpTransferReference: '', helpTransactionId: '', helpReceipt: '', clientNotice: '', supportHelpText: '' },
  workflow: { requireReceipt: true, requireSenderName: true, requireTransferReference: true, requireTransactionId: false, confirmationInstructions: 'Send your receipt.', maxReceiptMegabytes: 5 },
  receipts: { acceptedTypes: ['PDF', 'JPEG', 'PNG'] },
  payments: {
    currencies: [{ code: 'USD', name: 'US dollar', enabled: true, hasBankProfile: true }],
    bankTransfer: { enabled: true },
    westernUnion: { enabled: false, displayName: 'Western Union', supportedCurrencies: [], supportedCountries: [], clientHelpText: '', supportText: '' },
    card: { enabled: false, label: 'Not available in your region' },
  },
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PublicConfigProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </PublicConfigProvider>
    </MemoryRouter>,
  );
}

describe('application shell', () => {
  it('shows the sign-in page using the agency wording from the server, not from code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(publicConfig), { status: 200, headers: { 'content-type': 'application/json' } }))),
    );
    renderAt('/client/login');
    expect(await screen.findByRole('heading', { name: 'Northbridge client sign in' })).toBeTruthy();
    expect(screen.getByLabelText(/Full name/)).toBeTruthy();
    expect(screen.getByLabelText(/Access code/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getAllByText(/help@northbridge\.example/).length).toBeGreaterThan(0);
  });

  it('sends a signed-out visitor to the admin sign-in page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/public/config')) return Promise.resolve(new Response(JSON.stringify(publicConfig), { status: 200, headers: { 'content-type': 'application/json' } }));
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Please sign in to continue.' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
      }),
    );
    renderAt('/admin');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});
