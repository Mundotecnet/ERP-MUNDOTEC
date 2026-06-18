import * as React from 'react';

import { api } from '@/lib/api';

import { authStorage, type StoredUser } from './storage';

export interface SessionUser extends StoredUser {
  username: string;
  permissions: string[];
}

interface AuthContextValue {
  /** `null` mientras se carga `/auth/me` la primera vez. */
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  login(input: { username: string; password: string; companyId?: string }): Promise<void>;
  logout(): Promise<void>;
  /** Pequeño helper para chequear permisos en componentes y rutas. */
  hasPermission(code: string): boolean;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: StoredUser & { id: string };
}

interface MeResponse extends StoredUser {
  username: string;
  permissions: string[];
}

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  // Boot: si hay accessToken en storage, intenta cargar /auth/me; si falla, limpia.
  React.useEffect(() => {
    if (!authStorage.getAccessToken()) {
      setLoading(false);
      return;
    }
    api
      .get<MeResponse>('/auth/me')
      .then((res) => {
        const session: SessionUser = res.data;
        authStorage.setUser({
          id: session.id,
          email: session.email,
          fullName: session.fullName,
          companyId: session.companyId,
        });
        setUser(session);
      })
      .catch(() => {
        authStorage.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = React.useCallback<AuthContextValue['login']>(
    async ({ username, password, companyId }) => {
      setError(null);
      try {
        const res = await api.post<LoginResponse>('/auth/login', {
          username,
          password,
          ...(companyId ? { companyId } : {}),
        });
        authStorage.setAccessToken(res.data.accessToken);
        authStorage.setRefreshToken(res.data.refreshToken);
        authStorage.setUser(res.data.user);
        const me = await api.get<MeResponse>('/auth/me');
        setUser(me.data);
      } catch (err) {
        const msg =
          err instanceof Error && 'response' in err
            ? readApiError(err as unknown as { response?: { data?: { message?: string } } })
            : 'No se pudo iniciar sesión.';
        setError(msg);
        throw err;
      }
    },
    [],
  );

  const logout = React.useCallback<AuthContextValue['logout']>(async () => {
    const refreshToken = authStorage.getRefreshToken();
    if (refreshToken) {
      try {
        await api.post('/auth/logout', { refreshToken });
      } catch {
        // El backend responde 204 incluso con tokens inválidos; ignoramos red.
      }
    }
    authStorage.clear();
    setUser(null);
  }, []);

  const hasPermission = React.useCallback(
    (code: string) => Boolean(user?.permissions.includes(code)),
    [user],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, loading, error, login, logout, hasPermission }),
    [user, loading, error, login, logout, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function readApiError(err: { response?: { data?: { message?: string } } }): string {
  return err.response?.data?.message ?? 'No se pudo iniciar sesión.';
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider.');
  return ctx;
}
