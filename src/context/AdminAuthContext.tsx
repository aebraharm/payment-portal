/* eslint-disable react-refresh/only-export-components -- context files export a provider component plus its hook */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';

export interface AdminUser {
  id: number;
  email: string;
  role: 'superadmin' | 'admin' | 'reviewer';
  fullName: string | null;
  mustChangePassword?: boolean;
}

interface AdminAuthContextValue {
  admin: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setMustChangePassword: (value: boolean) => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ admin: AdminUser }>('/api/admin/auth/me');
      setAdmin(data.admin);
    } catch {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ admin: AdminUser; mustChangePassword: boolean }>('/api/admin/auth/login', {
      email,
      password,
    });
    setAdmin(data.admin);
    return { mustChangePassword: data.mustChangePassword };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/admin/auth/logout');
    } finally {
      setAdmin(null);
    }
  }, []);

  const setMustChangePassword = useCallback((value: boolean) => {
    setAdmin((prev) => (prev ? { ...prev, mustChangePassword: value } : prev));
  }, []);

  const value = useMemo(
    () => ({ admin, loading, login, logout, refresh, setMustChangePassword }),
    [admin, loading, login, logout, refresh, setMustChangePassword]
  );
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}

export { ApiError };
