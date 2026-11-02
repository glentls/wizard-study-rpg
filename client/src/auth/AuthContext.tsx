import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setSignedOutHandler } from '../api/client';
import type { Me } from '../api/types';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthValue {
  status: Status;
  me: Me | null;
  reload: () => Promise<Me | null>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; timezone: string; accept_terms: boolean; analytics_opt_in: boolean }) => Promise<void>;
  logout: (allDevices?: boolean) => Promise<void>;
  signedOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const signedOut = useCallback(() => {
    setAccessToken(null);
    setMe(null);
    setStatus('anonymous');
  }, []);

  const reload = useCallback(async () => {
    const next = await api.get<Me>('/v1/me');
    setMe(next);
    setStatus('authenticated');
    return next;
  }, []);

  // Restore the session from the refresh cookie on first load (FOC-05: reload must not lose state).
  useEffect(() => {
    setSignedOutHandler(signedOut);
    refreshSession().then((ok) => (ok ? reload().catch(signedOut) : signedOut()));
  }, [reload, signedOut]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      reload,
      signedOut,
      login: async (email, password) => {
        const res = await api.post<{ access_token: string }>('/v1/auth/login', { email, password, device_label: navigator.userAgent.slice(0, 80) });
        setAccessToken(res.access_token);
        await reload();
      },
      register: async (input) => {
        const res = await api.post<{ access_token: string }>('/v1/auth/register', { ...input, device_label: navigator.userAgent.slice(0, 80) });
        setAccessToken(res.access_token);
        await reload();
      },
      logout: async (allDevices = false) => {
        await api.post('/v1/auth/logout', { all_devices: allDevices }).catch(() => undefined);
        signedOut();
      },
    }),
    [status, me, reload, signedOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Narrowed accessor for pages that only render once signed in with a wizard. */
export function useMe(): Me & { wizard: NonNullable<Me['wizard']> } {
  const { me } = useAuth();
  if (!me?.wizard) throw new Error('useMe used before onboarding');
  return me as Me & { wizard: NonNullable<Me['wizard']> };
}
