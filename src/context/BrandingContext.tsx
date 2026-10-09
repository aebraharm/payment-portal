/* eslint-disable react-refresh/only-export-components -- context files export a provider component plus its hook */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

export interface Branding {
  agencyName: string;
  siteTitle: string;
  logoPath: string;
  faviconPath: string;
  contactEmail: string;
  contactPhone: string;
  whatsappNumber: string;
  officeAddress: string;
  websiteUrl: string;
  primaryColor: string;
  secondaryColor: string;
  loginHeading: string;
  loginDescription: string;
  welcomeMessage: string;
  footerText: string;
  termsAndConditions: string;
  privacyPolicy: string;
  refundPolicy: string;
  paymentInstructions: string;
  paymentDisclaimer: string;
  supportEmail: string;
  supportPhone: string;
}

export interface PublicConfig {
  branding: Branding;
  currencies: Array<{ code: string; name: string; symbol: string }>;
  paymentMethods: Array<{ code: string; name: string; available: boolean; label?: string }>;
  cardLabel: string;
  receiptMaxSizeMb: number;
  allowedReceiptTypes: string[];
}

interface BrandingContextValue {
  branding: Branding | null;
  config: PublicConfig | null;
  loading: boolean;
  logoUrl: string;
  reload: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

function isValidHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** Darken a hex color by a fraction (for hover states). */
function darken(hex: string, amount = 0.12): string {
  if (!isValidHexColor(hex)) return hex;
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const num = parseInt(full.slice(1), 16);
  const r = Math.round(((num >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((num >> 8) & 0xff) * (1 - amount));
  const b = Math.round((num & 0xff) * (1 - amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function applyBrandColors(branding: Branding) {
  const root = document.documentElement;
  const primary = isValidHexColor(branding.primaryColor) ? branding.primaryColor : '#2563eb';
  const secondary = isValidHexColor(branding.secondaryColor) ? branding.secondaryColor : '#0b2447';
  root.style.setProperty('--brand-primary', primary);
  root.style.setProperty('--brand-primary-dark', darken(primary));
  root.style.setProperty('--brand-secondary', secondary);
  // A soft tint of the primary color for informational panels.
  root.style.setProperty('--brand-primary-soft', `${primary}14`);
  root.style.setProperty('--brand-secondary-soft', `${secondary}0f`);
  if (branding.siteTitle) document.title = branding.siteTitle;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const data = await api.get<PublicConfig>('/api/public/branding');
      setConfig(data);
      applyBrandColors(data.branding);
    } catch {
      // Branding is optional; fall back to defaults.
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const value = useMemo<BrandingContextValue>(() => {
    const branding = config?.branding || null;
    return {
      branding,
      config,
      loading,
      logoUrl: branding?.logoPath ? '/api/public/branding/logo' : '',
      reload,
    };
  }, [config, loading]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider');
  return ctx;
}

/** Display name for the agency: configured name, else a neutral placeholder. */
export function useAgencyName(): string {
  const { branding } = useBranding();
  return branding?.agencyName?.trim() || 'Payment Portal';
}
