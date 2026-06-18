import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { Shell } from '@/layout/shell';

vi.mock('@/auth/auth-context', () => ({
  useAuth: vi.fn(),
}));

function setup() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<div>Home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Shell navegación', () => {
  it('muestra sólo entradas para los permisos del usuario (HU-6.2 menú dinámico)', async () => {
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: '1',
        email: 'a@x',
        fullName: 'Ana',
        username: 'ana',
        companyId: '1',
        permissions: ['users.read', 'roles.read'],
      },
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
      error: null,
      hasPermission: (code) => ['users.read', 'roles.read'].includes(code),
    });
    setup();
    // Dashboard siempre se muestra (no requiere permiso).
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /usuarios/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /roles/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sucursales/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /monedas/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /configuración/i })).not.toBeInTheDocument();
  });

  it('muestra todas las entradas a un usuario con todos los permisos', async () => {
    const all = [
      'branch.read',
      'users.read',
      'roles.read',
      'catalogs.currency.read',
      'params.read',
    ];
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: '1',
        email: 'a@x',
        fullName: 'Ana',
        username: 'ana',
        companyId: '1',
        permissions: all,
      },
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
      error: null,
      hasPermission: (code) => all.includes(code),
    });
    setup();
    for (const label of [
      'Dashboard',
      'Sucursales',
      'Usuarios',
      'Roles',
      'Monedas',
      'Configuración',
    ]) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
  });
});
