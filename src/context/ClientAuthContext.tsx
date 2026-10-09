/* eslint-disable react-refresh/only-export-components -- context files export a provider component plus its hook */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

export interface ClientUser {
  id: number;
  clientCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

interface ClientAuthContextValue {
  client: ClientUser | null;
  loading: boolean;
  login: (fullName: string, accessCode: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const ClientAuthContext = createContext<ClientAuthContextValue | undefined>(undefined);

export function ClientAuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ClientUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ client: ClientUser }>('/api/client/auth/me');
      setClient(data.client);
    } catch {
      setClient(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (fullName: string, accessCode: string) => {
    const data = await api.post<{ client: ClientUser }>('/api/client/auth/login', { fullName, accessCode });
    setClient(data.client);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/client/auth/logout');
    } finally {
      setClient(null);
    }
  }, []);

  const value = useMemo(() => ({ client, loading, login, logout, refresh }), [client, loading, login, logout, refresh]);
  return <ClientAuthContext.Provider value={value}>{children}</ClientAuthContext.Provider>;
}

export function useClientAuth(): ClientAuthContextValue {
  const ctx = useContext(ClientAuthContext);
  if (!ctx) throw new Error('useClientAuth must be used within ClientAuthProvider');
  return ctx;
}
