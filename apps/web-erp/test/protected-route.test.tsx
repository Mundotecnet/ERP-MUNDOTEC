import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from '@/auth/protected-route';

vi.mock('@/auth/auth-context', () => ({
  useAuth: vi.fn(),
}));

function setup() {
  return render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route element={<ProtectedRoute permission="branch.read" />}>
          <Route path="/private" element={<div>PRIVADO</div>} />
        </Route>
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('redirige a /login si no hay sesión', async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
      error: null,
      hasPermission: () => false,
    });
    setup();
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });

  it('muestra el contenido si el usuario tiene el permiso', async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: '1',
        email: 'a@x',
        fullName: 'Ana',
        username: 'ana',
        companyId: '1',
        permissions: ['branch.read'],
      },
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
      error: null,
      hasPermission: (code: string) => code === 'branch.read',
    });
    setup();
    expect(screen.getByText('PRIVADO')).toBeInTheDocument();
  });

  it('bloquea con mensaje "Sin permiso" si el usuario está logueado pero le falta el perm', async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: '1',
        email: 'a@x',
        fullName: 'Ana',
        username: 'ana',
        companyId: '1',
        permissions: [],
      },
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
      error: null,
      hasPermission: () => false,
    });
    setup();
    expect(screen.getByText(/sin permiso/i)).toBeInTheDocument();
    expect(screen.queryByText('PRIVADO')).not.toBeInTheDocument();
  });
});
