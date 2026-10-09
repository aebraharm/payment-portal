// The public configuration the browser needs before anyone signs in. It contains only published values
// and never includes bank details, internal notes, or anything about other clients.

import {
  CARD_UNAVAILABLE_LABEL,
  CURRENCIES,
  RECEIPT_MIME_TYPES,
  RECEIPT_TYPE_LABELS,
  SENDER_REQUIREMENT_OPTIONS,
  type PaymentMethod,
} from '../../shared/constants';
import type { Deps } from '../deps';
import { readPublished } from './settings';
import { getWesternUnion, listCurrencies, listMethodStates } from './paymentConfig';

export async function publicConfig(deps: Deps) {
  const { db, config } = deps;
  const settings = await readPublished(db);
  const currencies = await listCurrencies(db);
  const methods: Record<PaymentMethod, boolean> = await listMethodStates(db);
  const wu = await getWesternUnion(db);
  const assetUrl = (id: string | null) => (id ? `/api/public/assets/${id}` : null);
  const bankEnabledCurrencies = await db.query<{ currency: string }>(
    `SELECT DISTINCT currency FROM bank_profiles WHERE enabled AND archived_at IS NULL`,
  );
  const bankCurrencies = new Set(bankEnabledCurrencies.rows.map((row) => row.currency));

  return {
    branding: {
      agencyName: settings.branding.agencyName,
      websiteTitle: settings.branding.websiteTitle || settings.branding.agencyName,
      primaryColor: settings.branding.primaryColor,
      secondaryColor: settings.branding.secondaryColor,
      loginHeading: settings.branding.loginHeading,
      loginDescription: settings.branding.loginDescription,
      clientWelcomeMessage: settings.branding.clientWelcomeMessage,
      footerText: settings.branding.footerText,
      logoUrl: assetUrl(settings.branding.logoAssetId),
      faviconUrl: assetUrl(settings.branding.faviconAssetId),
    },
    contact: settings.contact,
    policies: settings.policies,
    labels: settings.labels,
    workflow: {
      requireReceipt: settings.workflow.requireReceipt,
      requireSenderName: settings.workflow.requireSenderName,
      requireTransferReference: settings.workflow.requireTransferReference,
      requireTransactionId: settings.workflow.requireTransactionId,
      confirmationInstructions: settings.workflow.confirmationInstructions,
      maxReceiptMegabytes: Math.min(settings.workflow.maxReceiptMegabytes, Math.floor(config.receiptMaxBytes / (1024 * 1024))),
    },
    receipts: {
      acceptedTypes: RECEIPT_MIME_TYPES.map((type) => RECEIPT_TYPE_LABELS[type]),
    },
    payments: {
      currencies: currencies.map((row) => ({
        code: row.code,
        name: row.name,
        enabled: row.enabled && CURRENCIES.includes(row.code),
        hasBankProfile: bankCurrencies.has(row.code),
      })),
      bankTransfer: { enabled: methods.bank_transfer },
      westernUnion: {
        enabled: methods.western_union && wu.enabled && wu.ready,
        displayName: wu.config.displayName,
        supportedCurrencies: wu.config.supportedCurrencies,
        supportedCountries: wu.config.supportedCountries,
        clientHelpText: wu.config.clientHelpText,
        supportText: wu.config.supportText,
        senderFieldsRequired: wu.config.requiredSenderFields,
        mtcnRequirement: wu.config.mtcnRequirement,
        receiptRequirement: wu.config.receiptRequirement,
      },
      card: { enabled: false, label: CARD_UNAVAILABLE_LABEL },
    },
    senderRequirementOptions: SENDER_REQUIREMENT_OPTIONS,
  };
}
