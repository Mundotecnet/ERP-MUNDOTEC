/**
 * Persiste tokens en `localStorage`. Para Sprint 1 de frontend esto basta;
 * más adelante (sprints de hardening) podría moverse a cookies httpOnly +
 * endpoint de bootstrap, pero requiere cambios backend que no entran en HU-6.2.
 */
const ACCESS_KEY = 'mundotec.accessToken';
const REFRESH_KEY = 'mundotec.refreshToken';
const USER_KEY = 'mundotec.user';

export interface StoredUser {
  id: string;
  email: string;
  fullName: string;
  companyId: string;
}

export const authStorage = {
  getAccessToken(): string | null {
    try {
      return localStorage.getItem(ACCESS_KEY);
    } catch {
      return null;
    }
  },
  setAccessToken(token: string): void {
    try {
      localStorage.setItem(ACCESS_KEY, token);
    } catch {
      // ignored: in private mode localStorage can throw
    }
  },
  getRefreshToken(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  setRefreshToken(token: string): void {
    try {
      localStorage.setItem(REFRESH_KEY, token);
    } catch {
      // ignored
    }
  },
  getUser(): StoredUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as StoredUser) : null;
    } catch {
      return null;
    }
  },
  setUser(user: StoredUser): void {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      // ignored
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignored
    }
  },
};
