import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LoginPage } from '@/pages/login';

vi.mock('@/auth/auth-context', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

interface AuthMockShape {
  user: {
    id: string;
    email: string;
    fullName: string;
    username: string;
    companyId: string;
    permissions: string[];
  } | null;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  loading: boolean;
  error: string | null;
  hasPermission: (code: string) => boolean;
}

let lastMock: AuthMockShape;

function buildAuth(overrides: Partial<AuthMockShape> = {}): AuthMockShape {
  const value: AuthMockShape = {
    user: null,
    login: vi.fn(async () => undefined),
    logout: vi.fn(),
    loading: false,
    error: null,
    hasPermission: () => false,
    ...overrides,
  };
  lastMock = value;
  return value;
}

describe('LoginPage', () => {
  beforeEach(async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReset();
  });

  it('renderiza usuario y contraseña', async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue(buildAuth());
    setup();
    expect(screen.getByRole('heading', { name: /iniciar sesión/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/usuario o correo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument();
  });

  it('valida los campos vacíos antes de llamar al backend', async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue(buildAuth());
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /entrar/i }));
    const required = await screen.findAllByText('Requerido');
    expect(required.length).toBeGreaterThanOrEqual(2);
  });

  it('llama al login con los valores ingresados', async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue(buildAuth());
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/usuario o correo/i), 'alice');
    await user.type(screen.getByLabelText(/contraseña/i), 'Secret123!');
    await user.click(screen.getByRole('button', { name: /entrar/i }));
    expect(lastMock.login).toHaveBeenCalledWith({
      username: 'alice',
      password: 'Secret123!',
      companyId: undefined,
    });
  });

  it('redirige al dashboard si ya hay sesión activa', async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue(
      buildAuth({
        user: {
          id: '1',
          email: 'a@x',
          fullName: 'Ana',
          username: 'ana',
          companyId: '1',
          permissions: [],
        },
      }),
    );
    setup();
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });
});
