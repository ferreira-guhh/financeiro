import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, getToken, post, setToken, setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setTokenState] = useState(getToken);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    qc.clear();
  }, [qc]);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  const me = useQuery({ queryKey: ['me', token], queryFn: () => get<User>('/auth/me'), enabled: Boolean(token), retry: false });

  const finish = (res: { token: string }) => {
    setToken(res.token);
    setTokenState(res.token);
  };

  const value: AuthState = {
    user: token ? (me.data ?? null) : null,
    loading: Boolean(token) && me.isLoading,
    login: async (email, password) => finish(await post<{ token: string }>('/auth/login', { email, password })),
    register: async (name, email, password) => finish(await post<{ token: string }>('/auth/register', { name, email, password })),
    logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
