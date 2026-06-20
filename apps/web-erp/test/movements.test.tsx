import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MovementsPage } from '@/pages/movements';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '@/lib/api';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MovementsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PRODUCTS = [
  { id: '1', sku: 'SKU-001', name: 'Producto inventariado', isInventoried: true },
  { id: '2', sku: 'SVC-001', name: 'Servicio (no inv)', isInventoried: false },
];
const WAREHOUSES = [
  { id: '10', code: 'WH-A', name: 'Central' },
  { id: '20', code: 'WH-B', name: 'Sucursal' },
];
const KARDEX = [
  {
    id: '100',
    productId: '1',
    productSku: 'SKU-001',
    warehouseId: '10',
    warehouseCode: 'WH-A',
    movementType: 'IN',
    quantity: '10',
    unitCost: '5',
    balanceQty: '10',
    movementDate: '2026-06-19T15:00:00.000Z',
    sourceDoc: null,
    notes: null,
  },
];

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/products') return { data: PRODUCTS };
    if (url === '/warehouses') return { data: WAREHOUSES };
    if (url.startsWith('/stock-movements')) return { data: KARDEX };
    return { data: [] };
  });
  vi.mocked(api.post).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MovementsPage', () => {
  it('renderiza los tres tabs y arranca en "Nuevo movimiento"', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /nuevo movimiento/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /transferencia/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^kardex$/i })).toBeInTheDocument();
    // El form del primer tab está visible.
    expect(screen.getByLabelText(/producto/i)).toBeInTheDocument();
  });

  it('el select de Producto del form de movimiento omite los no inventariados', async () => {
    setup();
    // Espera a que TanStack Query traiga los productos (aparece la option con SKU).
    await screen.findByRole('option', { name: /SKU-001/i });
    const select = screen.getByLabelText(/producto/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('1');
    expect(options).not.toContain('2');
  });

  it('envía POST /stock-movements con el payload correcto', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { ...KARDEX[0], balanceQty: '10', unitCost: '5', warehouseCode: 'WH-A' },
    });
    setup();
    const user = userEvent.setup();
    await screen.findByRole('option', { name: /SKU-001/i });
    await user.selectOptions(screen.getByLabelText(/producto/i), '1');
    await user.selectOptions(screen.getByLabelText(/almacén/i), '10');
    await user.type(screen.getByLabelText(/cantidad/i), '10');
    await user.clear(screen.getByLabelText(/costo unitario/i));
    await user.type(screen.getByLabelText(/costo unitario/i), '5');
    await user.click(screen.getByRole('button', { name: /^registrar movimiento$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/stock-movements');
    expect(body).toMatchObject({
      productId: '1',
      warehouseId: '10',
      movementType: 'IN',
      quantity: '10',
      unitCost: '5',
      notes: null,
    });
  });

  it('al cambiar a Transferencia y enviar, POST /stock-movements/transfer con el payload correcto', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        out: { balanceQty: '0', warehouseCode: 'WH-A' },
        in: { balanceQty: '5', warehouseCode: 'WH-B' },
      },
    });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /transferencia/i }));

    await screen.findByRole('option', { name: /SKU-001/i });
    await user.selectOptions(screen.getByLabelText(/producto/i), '1');
    await user.selectOptions(screen.getByLabelText(/almacén origen/i), '10');
    await user.selectOptions(screen.getByLabelText(/almacén destino/i), '20');
    await user.type(screen.getByLabelText(/cantidad/i), '5');
    await user.click(screen.getByRole('button', { name: /^transferir$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/stock-movements/transfer');
    expect(body).toMatchObject({
      productId: '1',
      fromWarehouseId: '10',
      toWarehouseId: '20',
      quantity: '5',
      notes: null,
    });
  });

  it('valida que origen ≠ destino en la transferencia (no llama al backend)', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /transferencia/i }));

    await screen.findByRole('option', { name: /SKU-001/i });
    await user.selectOptions(screen.getByLabelText(/producto/i), '1');
    await user.selectOptions(screen.getByLabelText(/almacén origen/i), '10');
    await user.selectOptions(screen.getByLabelText(/almacén destino/i), '10');
    await user.type(screen.getByLabelText(/cantidad/i), '5');
    await user.click(screen.getByRole('button', { name: /^transferir$/i }));

    expect(await screen.findByText(/distintos/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('en el tab Kardex muestra los movimientos del backend', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^kardex$/i }));
    expect(await screen.findByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('IN')).toBeInTheDocument();
    expect(screen.getByText('WH-A')).toBeInTheDocument();
  });
});
