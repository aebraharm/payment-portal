import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface PublicConfig {
  branding: {
    agencyName: string;
    websiteTitle: string;
    primaryColor: string;
    secondaryColor: string;
    loginHeading: string;
    loginDescription: string;
    clientWelcomeMessage: string;
    footerText: string;
    logoUrl: string | null;
    faviconUrl: string | null;
  };
  contact: {
    supportEmail: string;
    phone: string;
    whatsappEnabled: boolean;
    whatsappNumber: string;
    address: string;
    websiteUrl: string;
    supportHours: string;
  };
  policies: { termsText: string; privacyText: string; refundText: string; paymentDisclaimer: string; feesNotice: string; nextStepsText: string };
  labels: { helpSenderName: string; helpTransferReference: string; helpTransactionId: string; helpReceipt: string; clientNotice: string; supportHelpText: string };
  workflow: {
    requireReceipt: boolean;
    requireSenderName: boolean;
    requireTransferReference: boolean;
    requireTransactionId: boolean;
    confirmationInstructions: string;
    maxReceiptMegabytes: number;
  };
  receipts: { acceptedTypes: string[] };
  payments: {
    currencies: { code: string; name: string; enabled: boolean; hasBankProfile: boolean }[];
    bankTransfer: { enabled: boolean };
    westernUnion: { enabled: boolean; displayName: string; supportedCurrencies: string[]; supportedCountries: string[]; clientHelpText: string; supportText: string };
    card: { enabled: false; label: string };
  };
}

const ConfigContext = createContext<{ config: PublicConfig | null; error: string | null }>({ config: null, error: null });

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Applies published branding at runtime: colours, title and favicon all come from the server. */
function applyBranding(config: PublicConfig): void {
  const root = document.documentElement;
  if (HEX.test(config.branding.primaryColor)) root.style.setProperty('--color-brand-600', config.branding.primaryColor);
  if (HEX.test(config.branding.secondaryColor)) root.style.setProperty('--color-brand-950', config.branding.secondaryColor);
  if (config.branding.websiteTitle) document.title = config.branding.websiteTitle;
  if (config.branding.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = config.branding.faviconUrl;
  }
}

export function PublicConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<PublicConfig>('/public/config')
      .then((value) => {
        if (!active) return;
        setConfig(value);
        applyBranding(value);
      })
      .catch(() => {
        if (active) setError('We could not load the portal settings. Refresh the page to try again.');
      });
    return () => {
      active = false;
    };
  }, []);

  return <ConfigContext.Provider value={{ config, error }}>{children}</ConfigContext.Provider>;
}

export function usePublicConfig() {
  return useContext(ConfigContext);
}
