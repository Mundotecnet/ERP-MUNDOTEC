/**
 * Tests vitest para BranchesPage (PR Sprint 12).
 *
 * Cubre:
 *  - Lista con badge Activo/Inactivo y campos code/name/address/phone.
 *  - Búsqueda local por code o nombre.
 *  - Crear: POST con payload completo (dirección/teléfono vacíos → null).
 *  - Editar: PATCH con solo los campos modificados vía payload completo.
 *  - Borrar: DELETE con manejo de 409 amistoso.
 *  - Al crear/editar invalida ['branches'] y ['users'] (los selectores de
 *    Usuarios se enteran del alta sin reload manual).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BranchesPage } from '@/pages/branches';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '@/lib/api';

const CENTRAL = {
  id: '10',
  code: 'CTR',
  name: 'Central',
  address: 'Av. 1',
  phone: '2222-2222',
  isActive: true,
};
const SUCURSAL = {
  id: '11',
  code: 'A2',
  name: 'Sucursal Alajuela',
  address: null,
  phone: null,
  isActive: false,
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BranchesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: [CENTRAL, SUCURSAL] });
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BranchesPage', () => {
  it('lista sucursales con badge de estado y campos vacíos en —', async () => {
    setup();
    expect(await screen.findByText('CTR')).toBeInTheDocument();
    expect(screen.getByText('Central')).toBeInTheDocument();
    expect(screen.getByText('Av. 1')).toBeInTheDocument();
    expect(screen.getByText('2222-2222')).toBeInTheDocument();
    // SUCURSAL tiene address y phone = null → "—".
    const row2 = screen.getByText('A2').closest('tr')!;
    expect(within(row2).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(within(row2).getByText('Inactivo')).toBeInTheDocument();
  });

  it('filtra por code o por nombre localmente', async () => {
    setup();
    await screen.findByText('Central');
    await userEvent.type(screen.getByLabelText(/buscar/i), 'alaju');
    expect(screen.queryByText('Central')).not.toBeInTheDocument();
    expect(screen.getByText('Sucursal Alajuela')).toBeInTheDocument();
  });

  it("crea sucursal e invalida ['branches'] + ['users']", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    const { client } = setup();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    await screen.findByText('Central');

    await userEvent.click(screen.getByRole('button', { name: /nuevo sucursal|nueva sucursal/i }));
    await userEvent.type(screen.getByLabelText(/^código/i), 'HRD');
    await userEvent.type(screen.getByLabelText(/^nombre/i), 'Heredia');
    // dirección y teléfono en blanco → null en el payload.
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/branches', {
      code: 'HRD',
      name: 'Heredia',
      address: null,
      phone: null,
      isActive: true,
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        JSON.stringify({ queryKey: ['branches'] }),
        JSON.stringify({ queryKey: ['users'] }),
      ]),
    );
  });

  it('editar: precarga los valores actuales y hace PATCH con el payload completo', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    setup();
    await screen.findByText('Central');
    // Editar CTR (primera fila).
    const row = screen.getByText('Central').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /editar/i }));

    // Los inputs traen los valores actuales.
    expect(screen.getByLabelText(/^código/i)).toHaveValue('CTR');
    expect(screen.getByLabelText(/^nombre/i)).toHaveValue('Central');

    // Cambiar nombre y desactivar.
    const nameInput = screen.getByLabelText(/^nombre/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Central renombrada');
    await userEvent.click(screen.getByRole('checkbox', { name: /activa/i }));

    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith('/branches/10', {
      code: 'CTR',
      name: 'Central renombrada',
      address: 'Av. 1',
      phone: '2222-2222',
      isActive: false,
    });
  });

  it('DELETE 409 muestra el mensaje del backend vía alert', async () => {
    const err = new AxiosError(
      'Request failed with status code 409',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 409,
        statusText: 'Conflict',
        data: {
          message:
            'No se puede eliminar la sucursal "CTR — Central": está en uso por 2 almacén(es), 3 orden(es) de compra.',
        },
        headers: {},
        config: { headers: new AxiosHeaders() },
      },
    );
    vi.mocked(api.delete).mockRejectedValue(err);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    setup();
    await screen.findByText('Central');
    const row = screen.getByText('Central').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /eliminar/i }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/en uso/i);
  });
});
