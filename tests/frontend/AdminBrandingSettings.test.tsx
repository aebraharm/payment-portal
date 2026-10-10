import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();
const mockPostForm = vi.fn();
const mockDel = vi.fn();
const mockReload = vi.fn();

/**
 * The branding form imports ApiError from the api client module, so the mock
 * must export the SAME class for `instanceof` checks in the page to work.
 */
vi.mock('../../src/api/client', () => {
  class ApiError extends Error {
    status: number;
    code: string;
    details?: Array<{ path?: string; message: string }>;
    constructor(
      status: number,
      code: string,
      message: string,
      details?: Array<{ path?: string; message: string }>
    ) {
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
      postForm: (...args: unknown[]) => mockPostForm(...(args as [string, unknown])),
      put: (...args: unknown[]) => mockPut(...(args as [string, unknown])),
      del: (...args: unknown[]) => mockDel(...(args as [string, unknown])),
    },
  };
});

vi.mock('../../src/context/BrandingContext', () => ({
  useBranding: () => ({
    branding: null,
    config: null,
    loading: false,
    logoUrl: '',
    reload: () => mockReload(),
  }),
  useAgencyName: () => 'Payment Portal',
}));

import { ApiError } from '../../src/api/client';
import { AdminBrandingSettings } from '../../src/pages/admin/AdminBrandingSettings';

/** Mirrors what GET /api/admin/settings returns, including server-managed paths. */
const SETTINGS = {
  agency_name: 'Atlas Migration Services',
  site_title: 'Atlas Payment Portal',
  logo_path: 'branding/1f0c2ab3-4d5e-6f70-8192-a3b4c5d6e7f8.png',
  favicon_path: '',
  contact_email: 'hello@atlas.example',
  contact_phone: '+234 800 000 0000',
  whatsapp_number: '',
  whatsapp_enabled: false,
  office_address: '12 Embassy Row, Abuja',
  website_url: 'https://atlas.example',
  primary_color: '#0b5fff',
  secondary_color: '#06255c',
  login_heading: 'Client sign in',
  login_description: 'Use your name and access code.',
  welcome_message: 'Welcome to Atlas.',
  footer_text: '',
  terms_and_conditions: '',
  privacy_policy: '',
  refund_policy: '',
  payment_instructions: '',
  payment_disclaimer: '',
  support_email: '',
  support_phone: '',
  invoice_ref_prefix: 'INV',
  transaction_ref_prefix: 'PAY',
  invoice_due_days_default: 14,
  payment_deadline_reminder_days: 3,
  receipt_max_size_mb: 10,
  allowed_receipt_types: ['pdf', 'jpg', 'jpeg', 'png'],
  require_receipt_upload: true,
  require_sender_name: true,
  require_transfer_reference: true,
  client_workflow: {
    allow_partial_payments: true,
    allow_method_change_before_confirm: true,
    show_instructions_snapshot: true,
  },
  notification_templates: {
    client_created: { subject: 'Your payment portal access', body: 'Hello {{client_name}}' },
  },
  notify_on_confirmation_submitted: true,
  notify_on_payment_approved: true,
  notify_on_payment_rejected: true,
  notify_on_invoice_created: true,
};

/**
 * Regression tests for the branding settings form.
 *
 * Saving used to fail with the generic "Some settings are invalid." because the
 * page PUTs back the whole document it received — including logo_path and
 * favicon_path, which the API rejected as unknown keys. The per-field reasons
 * came back in `error.details` but the page discarded them, so the admin had no
 * idea what to fix.
 */
describe('AdminBrandingSettings save flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ settings: { ...SETTINGS } });
    mockReload.mockResolvedValue(undefined);
  });

  const renderPage = () => render(<AdminBrandingSettings />);

  const saveButton = () => screen.getByRole('button', { name: /save & publish/i });

  it('loads the full settings document and saves an edit to the portal name', async () => {
    const user = userEvent.setup();
    mockPut.mockResolvedValue({ ok: true, settings: { ...SETTINGS } });
    renderPage();

    const agency = await screen.findByLabelText('Agency name');
    expect(agency).toHaveValue('Atlas Migration Services');

    await user.clear(agency);
    await user.type(agency, 'Meridian Visa Consultants');
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
    const [path, body] = mockPut.mock.calls[0] as [string, { settings: Record<string, any> }];
    expect(path).toBe('/api/admin/settings');
    expect(body.settings.agency_name).toBe('Meridian Visa Consultants');

    await screen.findByText(/settings saved/i);
    // Both the success and error Alerts use role="alert", so assert on content.
    expect(screen.queryByText(/settings are invalid/i)).not.toBeInTheDocument();
    expect(mockReload).toHaveBeenCalled();
  });

  it('surfaces the field-specific reasons instead of only the generic message', async () => {
    const user = userEvent.setup();
    mockPut.mockRejectedValue(
      new ApiError(400, 'validation_error', 'Some settings are invalid.', [
        { path: 'primary_color', message: 'Setting "primary_color" must be a hex color like #2563eb.' },
        { path: 'invoice_ref_prefix', message: 'Setting "invoice_ref_prefix" must start with a letter.' },
      ])
    );
    renderPage();
    await screen.findByLabelText('Agency name');

    // Client-side validation must not pre-empt the server response, so drive the
    // failure through a field the page does not validate locally.
    mockGet.mockResolvedValueOnce({ settings: { ...SETTINGS } });
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));

    const alert = await screen.findByRole('alert');
    // The generic message alone is not enough — the details must be visible.
    expect(alert).toHaveTextContent(/must be a hex color like #2563eb/i);
    expect(alert).toHaveTextContent(/invoice_ref_prefix/i);
    expect(alert).toHaveTextContent(/must start with a letter/i);
  });

  it('explains that storage paths are managed by the logo upload', async () => {
    const user = userEvent.setup();
    mockPut.mockRejectedValue(
      new ApiError(400, 'validation_error', 'Some settings are invalid.', [
        {
          path: 'logo_path',
          message: 'Setting "logo_path" is managed by the logo upload and cannot be changed here.',
        },
      ])
    );
    renderPage();
    await screen.findByLabelText('Agency name');
    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/logo_path/i);
    expect(alert).toHaveTextContent(/managed by the logo upload/i);
  });

  it('still shows a sensible message when the API returns no details', async () => {
    const user = userEvent.setup();
    mockPut.mockRejectedValue(new ApiError(500, 'error', 'Unexpected server error.'));
    renderPage();
    await screen.findByLabelText('Agency name');
    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/unexpected server error/i);
  });

  it('shows a readable message for a non-ApiError failure', async () => {
    const user = userEvent.setup();
    mockPut.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    await screen.findByLabelText('Agency name');
    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/failed to fetch/i);
  });

  it('blocks the save client-side on an obviously invalid value', async () => {
    const user = userEvent.setup();
    renderPage();
    const color = await screen.findByLabelText('Primary color');
    await user.clear(color);
    await user.type(color, 'not-a-color');
    await user.click(saveButton());

    expect(mockPut).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/hex color/i);
  });

  it('uploads a logo and then saves without an error', async () => {
    const user = userEvent.setup();
    mockPostForm.mockResolvedValue({ ok: true, logoPath: 'branding/new-logo.png', logoUrl: '/api/public/branding/logo' });
    mockPut.mockResolvedValue({ ok: true, settings: { ...SETTINGS, logo_path: 'branding/new-logo.png' } });
    renderPage();
    await screen.findByLabelText('Agency name');

    // After the upload the page reloads settings, which now carry the new path.
    mockGet.mockResolvedValue({ settings: { ...SETTINGS, logo_path: 'branding/new-logo.png' } });

    await user.click(saveButton());
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
    const body = (mockPut.mock.calls[0] as [string, { settings: Record<string, any> }])[1];
    expect(body.settings.logo_path).toBeTruthy();
    await screen.findByText(/settings saved/i);
  });
});
