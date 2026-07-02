/**
 * Tests vitest para UsersPage (PR Sprint 11 — usuario ↔ sucursal).
 *
 * Cubre:
 *  - Render de la lista con columna "Sucursal default" resuelta al code+name.
 *  - Alta de usuario con selección de default + branches: 2 requests
 *    coordinados (POST /users + PUT /users/:id/branches).
 *  - Edición: precarga assignedBranchIds y defaultBranchId desde
 *    GET /users/:id/branches; guarda con PATCH + PUT.
 *  - Con accessAll=true, el hint del multiselect informa que opera todas.
 *  - Validación local: default fuera del set (sin accessAll) muestra error
 *    sin llegar a la API.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersPage } from '@/pages/users';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '@/lib/api';

const USERS = {
  data: [
    {
      id: '1',
      username: 'alice',
      email: 'a@x',
      fullName: 'Alice',
      isActive: true,
      isSalesperson: false,
      commissionPct: '0',
      defaultBranchId: '10',
      lastLoginAt: null,
    },
    {
      id: '2',
      username: 'bob',
      email: 'b@x',
      fullName: 'Bob',
      isActive: true,
      isSalesperson: true,
      commissionPct: '0.05',
      defaultBranchId: null,
      lastLoginAt: null,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 100,
};

const BRANCHES = [
  { id: '10', code: 'CTR', name: 'Central' },
  { id: '11', code: 'A2', name: 'Sucursal A2' },
  { id: '12', code: 'A3', name: 'Sucursal A3' },
];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/users/1/branches')) {
      return {
        data: {
          branchIds: ['10', '11'],
          assignedBranchIds: ['10', '11'],
          defaultBranchId: '10',
          accessAll: false,
        },
      };
    }
    if (url.startsWith('/users/2/branches')) {
      return {
        data: {
          branchIds: ['10', '11', '12'],
          assignedBranchIds: [],
          defaultBranchId: null,
          accessAll: true,
        },
      };
    }
    if (url.startsWith('/users')) return { data: USERS };
    if (url === '/branches') return { data: BRANCHES };
    return { data: [] };
  });
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UsersPage', () => {
  it('lista usuarios y muestra la sucursal default resuelta a code — name', async () => {
    setup();
    expect(await screen.findByText('alice')).toBeInTheDocument();
    // alice tiene defaultBranchId=10 → "CTR — Central".
    expect(screen.getByText('CTR — Central')).toBeInTheDocument();
    // bob no tiene default → "—".
    const bobRow = screen.getByText('bob').closest('tr')!;
    expect(within(bobRow).getByText('—')).toBeInTheDocument();
  });

  it('crear: POST /users + PUT /users/:id/branches con el set y default', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: '99' } });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    setup();
    await screen.findByText('alice');
    await userEvent.click(screen.getByRole('button', { name: /nuevo usuario/i }));

    await userEvent.type(screen.getByLabelText(/^usuario/i), 'newone');
    await userEvent.type(screen.getByLabelText(/^correo/i), 'new@x.com');
    await userEvent.type(screen.getByLabelText(/^contraseña/i), 'Secret-1!Aa');
    await userEvent.type(screen.getByLabelText(/nombre completo/i), 'New One');
    // Elegimos primero las branches (para que el default valide).
    await userEvent.selectOptions(screen.getByLabelText(/sucursales permitidas/i), ['10', '11']);
    await userEvent.selectOptions(screen.getByLabelText(/sucursal por defecto/i), '10');

    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({
        username: 'newone',
        email: 'new@x.com',
        password: 'Secret-1!Aa',
        fullName: 'New One',
        isActive: true,
        isSalesperson: false,
      }),
    );
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith('/users/99/branches', {
      branchIds: ['10', '11'],
      defaultBranchId: '10',
    });
  });

  it('editar: precarga assignedBranchIds del server; PATCH + PUT al guardar', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    setup();
    await screen.findByText('alice');
    // Alice: fila 1, click Editar.
    const row = screen.getByText('alice').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /editar/i }));

    // Espera a que la precarga de branches complete y el select refleje 10+11.
    const branchesSelect = (await screen.findByLabelText(
      /sucursales permitidas/i,
    )) as HTMLSelectElement;
    await waitFor(() => {
      const selected = Array.from(branchesSelect.selectedOptions).map((o) => o.value);
      expect(selected.sort()).toEqual(['10', '11']);
    });

    // Cambio: agregar A3 (id=12) y mover default a 11.
    await userEvent.selectOptions(branchesSelect, ['10', '11', '12']);
    await userEvent.selectOptions(screen.getByLabelText(/sucursal por defecto/i), '11');
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith(
      '/users/1',
      expect.not.objectContaining({ password: expect.anything() }),
    );
    expect(api.put).toHaveBeenCalledWith('/users/1/branches', {
      branchIds: ['10', '11', '12'],
      defaultBranchId: '11',
    });
  });

  it('con accessAll=true, el hint informa que opera todas', async () => {
    setup();
    await screen.findByText('bob');
    const row = screen.getByText('bob').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /editar/i }));

    expect(await screen.findByText(/branch\.access_all/i)).toBeInTheDocument();
    expect(screen.getByText(/opera TODAS las sucursales/i)).toBeInTheDocument();
  });

  it('validación local: default fuera del set (sin accessAll) muestra error y no llama API', async () => {
    setup();
    await screen.findByText('alice');
    await userEvent.click(screen.getByRole('button', { name: /nuevo usuario/i }));

    await userEvent.type(screen.getByLabelText(/^usuario/i), 'x');
    await userEvent.type(screen.getByLabelText(/^correo/i), 'x@x.com');
    await userEvent.type(screen.getByLabelText(/^contraseña/i), 'S-1!Aa');
    await userEvent.type(screen.getByLabelText(/nombre completo/i), 'X');
    await userEvent.selectOptions(screen.getByLabelText(/sucursales permitidas/i), ['10']);
    // Default = 11, que NO está en las permitidas.
    await userEvent.selectOptions(screen.getByLabelText(/sucursal por defecto/i), '11');

    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(screen.getByText(/entre las sucursales permitidas/i)).toBeInTheDocument(),
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });
});
