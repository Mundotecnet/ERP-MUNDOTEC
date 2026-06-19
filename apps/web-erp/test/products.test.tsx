import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductsPage } from '@/pages/products';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '@/lib/api';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PRODUCT_A = {
  id: '1',
  sku: 'SKU-001',
  barcode: '7501234567890',
  name: 'Switch 24 puertos',
  description: 'Gigabit',
  categoryId: '10',
  uomId: '5',
  taxId: '7',
  costPrice: '120.5',
  salePrice: '199.99',
  priceCurrency: 'USD',
  isInventoried: true,
  trackingType: 'SERIAL',
  warrantyMonths: 12,
  minStock: '0',
  maxStock: '0',
  isActive: true,
  departmentId: null,
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/products') return { data: [PRODUCT_A] };
    if (url === '/product-categories') return { data: [{ id: '10', name: 'Networking' }] };
    if (url === '/units-of-measure') return { data: [{ id: '5', code: 'UND', name: 'Unidad' }] };
    if (url === '/taxes') return { data: [{ id: '7', name: 'IVA 13%' }] };
    if (url === '/departments') return { data: [{ id: '3', name: 'Bodega' }] };
    return { data: [] };
  });
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProductsPage', () => {
  it('lista los productos del backend', async () => {
    setup();
    expect(await screen.findByText('Switch 24 puertos')).toBeInTheDocument();
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('199.99 USD')).toBeInTheDocument();
  });

  it('filtra por SKU al escribir en el buscador', async () => {
    setup();
    await screen.findByText('Switch 24 puertos');
    const search = screen.getByLabelText(/buscar/i);
    await userEvent.type(search, 'no-existe');
    expect(screen.queryByText('Switch 24 puertos')).not.toBeInTheDocument();
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
  });

  it('abre el dialog "Nuevo producto" y valida SKU/nombre requeridos', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nuevo producto/i }));
    expect(await screen.findByRole('heading', { name: /nuevo producto/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^guardar$/i }));
    const required = await screen.findAllByText('Requerido');
    expect(required.length).toBeGreaterThanOrEqual(2);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('envía POST /products con el payload correcto al guardar', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...PRODUCT_A, id: '99' } });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nuevo producto/i }));

    await user.type(screen.getByLabelText('SKU'), 'SKU-NEW');
    await user.type(screen.getByLabelText('Nombre'), 'Producto nuevo');
    await user.selectOptions(screen.getByLabelText(/unidad de medida/i), '5');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/products');
    expect(body).toMatchObject({
      sku: 'SKU-NEW',
      name: 'Producto nuevo',
      uomId: '5',
      trackingType: 'NONE',
      priceCurrency: 'USD',
      isActive: true,
      isInventoried: true,
      categoryId: null,
      taxId: null,
      departmentId: null,
      barcode: null,
    });
  });

  it('llama DELETE /products/:id cuando se confirma eliminar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.delete).mockResolvedValueOnce({ data: undefined });
    setup();
    const user = userEvent.setup();
    await screen.findByText('Switch 24 puertos');
    await user.click(screen.getByRole('button', { name: /eliminar/i }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/products/1'));
  });
});
