import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { Shell } from '@/layout/shell';

vi.mock('@/auth/auth-context', () => ({
  useAuth: vi.fn(),
}));

function setup(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<div>Home</div>} />
          <Route path="product-categories" element={<div>Categorías</div>} />
          <Route path="taxes" element={<div>Impuestos</div>} />
          <Route path="currencies" element={<div>Monedas</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Shell navegación', () => {
  beforeEach(() => {
    // Aislar estado de expansión entre tests (persistido en localStorage).
    window.localStorage.removeItem('erp.nav.openGroups');
  });

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
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /usuarios/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /roles/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sucursales/i })).not.toBeInTheDocument();
    // Sin ningún permiso `catalogs.*.read`, el grupo Catálogos no aparece.
    expect(screen.queryByRole('button', { name: /catálogos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^monedas$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /configuración/i })).not.toBeInTheDocument();
  });

  it('muestra el grupo Catálogos cuando hay al menos un permiso catalogs.*.read', async () => {
    const perms = ['catalogs.product-category.read', 'catalogs.tax.read'];
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: '1',
        email: 'a@x',
        fullName: 'Ana',
        username: 'ana',
        companyId: '1',
        permissions: perms,
      },
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
      error: null,
      hasPermission: (code) => perms.includes(code),
    });
    setup();
    const groupBtn = await screen.findByRole('button', { name: /catálogos/i });
    expect(groupBtn).toHaveAttribute('aria-expanded', 'false');
    // Los hijos no se muestran hasta abrir.
    expect(screen.queryByRole('link', { name: /categorías/i })).not.toBeInTheDocument();
    await userEvent.click(groupBtn);
    expect(groupBtn).toHaveAttribute('aria-expanded', 'true');
    // Sólo los items con permiso aparecen dentro.
    expect(screen.getByRole('link', { name: /categorías/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /impuestos/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^monedas$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /departamentos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /unidades/i })).not.toBeInTheDocument();
  });

  it('expande automáticamente el grupo cuando la ruta activa pertenece a un hijo', async () => {
    const perms = ['catalogs.currency.read'];
    const { useAuth } = await import('@/auth/auth-context');
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: '1',
        email: 'a@x',
        fullName: 'Ana',
        username: 'ana',
        companyId: '1',
        permissions: perms,
      },
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
      error: null,
      hasPermission: (code) => perms.includes(code),
    });
    setup('/currencies');
    // Aunque arranque cerrado, el effect lo abre porque la ruta activa es hija.
    expect(await screen.findByRole('link', { name: /^monedas$/i })).toBeInTheDocument();
  });

  it('muestra todas las entradas a un usuario con todos los permisos', async () => {
    const all = [
      'branch.read',
      'users.read',
      'roles.read',
      'catalogs.currency.read',
      'catalogs.tax.read',
      'catalogs.uom.read',
      'catalogs.department.read',
      'catalogs.product-category.read',
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
    for (const label of ['Dashboard', 'Sucursales', 'Usuarios', 'Roles', 'Configuración']) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
    const groupBtn = screen.getByRole('button', { name: /catálogos/i });
    await userEvent.click(groupBtn);
    for (const label of ['Categorías', 'Departamentos', 'Unidades', 'Impuestos', 'Monedas']) {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}$`, 'i') })).toBeInTheDocument();
    }
  });
});
