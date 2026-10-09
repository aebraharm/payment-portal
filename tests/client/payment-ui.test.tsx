// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentOptionsCard, ReferenceCard } from '../../src/pages/client/ClientPages';
import { CARD_UNAVAILABLE_LABEL, CONFIRM_SENT_LABEL } from '../../shared/constants';
import type { ClientReference, PaymentOptions } from '../../src/lib/clientTypes';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const options: PaymentOptions = {
  outstanding: '1000.00',
  partialPaymentsAllowed: false,
  currency: { code: 'USD', name: 'United States Dollar', payable: true, note: 'This invoice is payable only in USD.' },
  methods: [
    { method: 'bank_transfer', label: 'Bank transfer', available: true, reason: null, bankAccounts: [{ id: 'bank-1', label: 'Main USD account', transferTypeLabel: 'Domestic ACH (United States)' }] },
    { method: 'western_union', label: 'Western Union', available: false, reason: 'Western Union is not available right now.', bankAccounts: [] },
    { method: 'card', label: CARD_UNAVAILABLE_LABEL, available: false, reason: CARD_UNAVAILABLE_LABEL, bankAccounts: [] },
  ],
};

function reference(overrides: Partial<ClientReference> = {}): ClientReference {
  return {
    id: 'ref-1',
    reference: 'PAY-20261009-ABC123',
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-2026-00001',
    method: 'bank_transfer',
    methodLabel: 'Bank transfer',
    currency: 'USD',
    amount: '1000.00',
    amountFormatted: 'USD 1,000.00',
    status: 'awaiting_payment',
    statusLabel: 'Awaiting payment',
    tone: 'info',
    issuedAt: '2026-10-09T10:00:00.000Z',
    instructions: {
      method: 'bank_transfer',
      methodLabel: 'Bank transfer',
      currency: 'USD',
      amount: '1000.00',
      reference: 'PAY-20261009-ABC123',
      invoiceNumber: 'INV-2026-00001',
      issuedAt: '2026-10-09T10:00:00.000Z',
      bank: {
        profileLabel: 'Main USD account',
        transferType: 'ach',
        transferTypeLabel: 'Domestic ACH (United States)',
        fields: [{ key: 'routing_number', label: 'Routing number', value: '021000021', sensitive: true }],
        additionalInstructions: '',
      },
      westernUnion: null,
      requirements: { senderName: 'required', senderCountry: 'hidden', transferReference: 'required', transactionId: 'hidden', receipt: 'required' },
      transactionIdLabel: 'Transaction ID',
      guidance: { referenceInstruction: 'Quote this reference with your transfer.', paymentDisclaimer: 'Sending money does not mark the invoice paid.' },
    } as unknown as ClientReference['instructions'],
    submissions: [],
    canSubmitConfirmation: true,
    confirmationBlockedReason: null,
    ...overrides,
  };
}

describe('payment options', () => {
  it('shows the card option disabled with the exact label and offers no card fields', () => {
    render(<PaymentOptionsCard invoiceId="inv-1" options={options} onCreated={() => undefined} />);
    const card = screen.getByRole('radio', { name: CARD_UNAVAILABLE_LABEL });
    expect((card as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText(/card number|cvv|cvc|expiry|expiration/i)).toBeNull();
    expect(screen.queryByRole('textbox', { name: /card/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/payment successful/i);
  });

  it('shows the unavailable reason for a method that cannot be used', () => {
    render(<PaymentOptionsCard invoiceId="inv-1" options={options} onCreated={() => undefined} />);
    expect(screen.getByText('Western Union is not available right now.')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Western Union' }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('confirmation of a sent payment', () => {
  it('uses the exact confirmation label and opens the form without sending anything to the server', () => {
    expect(CONFIRM_SENT_LABEL).toBe('I HAVE SENT THE MONEY');
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchSpy);
    render(<ReferenceCard reference={reference()} highlighted={false} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_SENT_LABEL }));
    expect(screen.getByRole('dialog', { name: 'Tell us about your payment' })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/payment successful/i);
    expect(document.body.textContent).toMatch(/not marked paid|does not mark your invoice paid|not verified/i);
  });

  it('is disabled with the server reason when a confirmation is already in progress', () => {
    render(
      <ReferenceCard
        reference={reference({ canSubmitConfirmation: false, confirmationBlockedReason: 'A confirmation for this reference is already waiting for review.' })}
        highlighted={false}
        onChanged={() => undefined}
      />,
    );
    const button = screen.getByRole('button', { name: CONFIRM_SENT_LABEL }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('A confirmation for this reference is already waiting for review.')).toBeTruthy();
  });

  it('asks for the fields the reference requires and the receipt before it will submit', () => {
    render(<ReferenceCard reference={reference()} highlighted={false} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_SENT_LABEL }));
    const dialog = screen.getByRole('dialog', { name: 'Tell us about your payment' });
    expect(within(dialog).getByLabelText(/Name of sender/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Transfer reference you used/)).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Transaction ID/)).toBeNull();
    expect(within(dialog).getByText(/PDF, JPEG or PNG/)).toBeTruthy();
  });
});

describe('frontend standards', () => {
  const root = path.resolve(process.cwd(), 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : /\.(tsx?|css)$/.test(name) ? [full] : [];
    });

  it('honours reduced-motion preferences in the stylesheet', () => {
    const css = readFileSync(path.join(root, 'index.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('does not hard-code agency, bank, or staff details in frontend code', () => {
    const forbidden = [/portal11@gmail\.com/i, /correct-horse/i, /021000021/, /Test Bank/, /Agency Ltd/, /Amina Yusuf/, /Bida/, /Niger State/, /\b\d{9,}\b/];
    const offenders: string[] = [];
    for (const file of files(root)) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(text)) offenders.push(`${path.relative(root, file)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
