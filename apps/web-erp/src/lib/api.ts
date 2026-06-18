import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { authStorage } from '@/auth/storage';

/**
 * Cliente axios con base `/api` (proxy a backend en dev; reverse proxy en prod).
 *
 * Interceptors:
 *  - request: añade `Authorization: Bearer <accessToken>` si hay sesión.
 *  - response: ante un 401 intenta refrescar UNA vez con el refreshToken; si el
 *    refresh falla, limpia la sesión y deja que la UI redirija a /login.
 */
export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const accessToken = authStorage.getAccessToken();
  if (accessToken && config.headers) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/** Promesa única en vuelo para evitar refresh paralelos. */
let pendingRefresh: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await axios.post<{ accessToken: string }>(
      '/api/auth/refresh',
      { refreshToken },
      { headers: { 'Content-Type': 'application/json' } },
    );
    authStorage.setAccessToken(res.data.accessToken);
    return res.data.accessToken;
  } catch {
    authStorage.clear();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    if (!original || original._retry) throw error;
    if (error.response?.status !== 401) throw error;
    // El refresh y sus failures no se reintentan.
    if (original.url?.includes('/auth/refresh') || original.url?.includes('/auth/login')) {
      throw error;
    }

    pendingRefresh ??= refreshAccessToken();
    const newToken = await pendingRefresh;
    pendingRefresh = null;

    if (!newToken) throw error;
    original._retry = true;
    if (original.headers) original.headers.Authorization = `Bearer ${newToken}`;
    return api.request(original);
  },
);
