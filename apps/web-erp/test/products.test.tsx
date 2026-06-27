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
  marginPct: '0.397',
  minMarginPct: '0',
  outOfMargin: false,
  priceCurrency: 'USD',
  isInventoried: true,
  trackingType: 'SERIAL',
  warrantyMonths: 12,
  minStock: '0',
  maxStock: '0',
  isActive: true,
  departmentId: null,
};

const PRICING_A = {
  productId: '1',
  sku: 'SKU-001',
  name: 'Switch 24 puertos',
  priceCurrency: 'USD',
  costPrice: '100',
  salePrice: '200',
  marginPct: '0.5',
  minMarginPct: '0.6', // por encima del margen efectivo → out_of_margin
  outOfMargin: true,
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/products') return { data: [PRODUCT_A] };
    if (url === '/products/1/pricing') return { data: PRICING_A };
    if (url === '/products/1/pricing/history') return { data: [] };
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
      isActive: true,
      isInventoried: true,
      categoryId: null,
      taxId: null,
      departmentId: null,
      barcode: null,
    });
    // PR-32: los campos de precio no viajan por POST /products; viven en
    // la pestaña Precios (PATCH /products/:id/pricing).
    expect((body as { costPrice?: unknown }).costPrice).toBeUndefined();
    expect((body as { salePrice?: unknown }).salePrice).toBeUndefined();
    expect((body as { priceCurrency?: unknown }).priceCurrency).toBeUndefined();
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

describe('ProductsPage — pestaña Precios (HU-11.1)', () => {
  async function openPricingTab(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: /editar/i }));
    await waitFor(() => screen.getByRole('heading', { name: /editar producto/i }));
    await user.click(screen.getByRole('button', { name: 'Precios' }));
    // Espera a que GET /products/1/pricing complete y rehidrate.
    await waitFor(() =>
      expect((document.getElementById('pricing-cost') as HTMLInputElement)?.value).toBe('100'),
    );
    return user;
  }

  it('renderiza costo/margen/precio/margen mínimo y badge "fuera de margen"', async () => {
    await openPricingTab();
    expect((document.getElementById('pricing-cost') as HTMLInputElement).value).toBe('100');
    expect((document.getElementById('pricing-price') as HTMLInputElement).value).toBe('200');
    expect((document.getElementById('pricing-margin') as HTMLInputElement).value).toBe('0.5');
    expect((document.getElementById('pricing-min-margin') as HTMLInputElement).value).toBe('0.6');
    expect(screen.getByTestId('out-of-margin-badge')).toBeInTheDocument();
  });

  it('recálculo bidireccional en vivo: editar precio actualiza margen y viceversa', async () => {
    const user = await openPricingTab();

    // Editar precio → margen recalculado. cost=100, price=150 → margin=0.3333.
    const priceInput = document.getElementById('pricing-price') as HTMLInputElement;
    await user.clear(priceInput);
    await user.type(priceInput, '150');
    await waitFor(() =>
      expect((document.getElementById('pricing-margin') as HTMLInputElement).value).toBe('0.3333'),
    );

    // Editar margen → precio recalculado. cost=100, margin=0.25 → price=133.3333.
    const marginInput = document.getElementById('pricing-margin') as HTMLInputElement;
    await user.clear(marginInput);
    await user.type(marginInput, '0.25');
    await waitFor(() =>
      expect((document.getElementById('pricing-price') as HTMLInputElement).value).toBe('133.3333'),
    );
  });

  it('al guardar envía PATCH /products/:id/pricing con el payload completo', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ data: PRICING_A });
    const user = await openPricingTab();

    const reason = document.getElementById('pricing-reason') as HTMLInputElement;
    await user.type(reason, 'ajuste de prueba');
    await user.click(screen.getByRole('button', { name: /guardar precios/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.patch).mock.calls[0];
    expect(url).toBe('/products/1/pricing');
    expect(body).toMatchObject({
      costPrice: '100',
      salePrice: '200',
      marginPct: '0.5',
      minMarginPct: '0.6',
      reason: 'ajuste de prueba',
    });
  });
});

describe('ProductsPage — pestaña Precios en modo creación (PR-33)', () => {
  it('al abrir la pestaña en "Nuevo producto" NO llama GET /products/:id/pricing y el recálculo funciona en cliente', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nuevo producto/i }));
    await waitFor(() => screen.getByRole('heading', { name: /nuevo producto/i }));
    await user.click(screen.getByRole('button', { name: 'Precios' }));

    // Esperar un tick para que cualquier fetch espurio tenga tiempo de ocurrir.
    await waitFor(() => expect(document.getElementById('pricing-cost')).toBeInTheDocument());
    const pricingFetchCalls = vi
      .mocked(api.get)
      .mock.calls.filter((c) => String(c[0]).includes('/pricing'));
    expect(pricingFetchCalls).toHaveLength(0);
    // Sin botón "Guardar precios" propio en creación.
    expect(screen.queryByRole('button', { name: /guardar precios/i })).not.toBeInTheDocument();
    // Sin sección de historial.
    expect(screen.queryByText(/historial de cambios/i)).not.toBeInTheDocument();

    // Recálculo bidireccional: cost=200, margen=0.25 → precio=266.6667.
    const costInput = document.getElementById('pricing-cost') as HTMLInputElement;
    await user.clear(costInput);
    await user.type(costInput, '200');
    const marginInput = document.getElementById('pricing-margin') as HTMLInputElement;
    await user.clear(marginInput);
    await user.type(marginInput, '0.25');
    await waitFor(() =>
      expect((document.getElementById('pricing-price') as HTMLInputElement).value).toBe('266.6667'),
    );
  });

  it('al Guardar desde General crea el producto y luego aplica el pricing en una sola operación', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...PRODUCT_A, id: '99' } });
    vi.mocked(api.patch).mockResolvedValueOnce({ data: { productId: '99' } });

    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nuevo producto/i }));
    await waitFor(() => screen.getByRole('heading', { name: /nuevo producto/i }));

    // Carga la pestaña Precios y captura valores antes de guardar.
    await user.click(screen.getByRole('button', { name: 'Precios' }));
    const costInput = document.getElementById('pricing-cost') as HTMLInputElement;
    await user.clear(costInput);
    await user.type(costInput, '150');
    const marginInput = document.getElementById('pricing-margin') as HTMLInputElement;
    await user.clear(marginInput);
    await user.type(marginInput, '0.3');
    await waitFor(() =>
      expect((document.getElementById('pricing-price') as HTMLInputElement).value).toBe('214.2857'),
    );

    // Vuelve a General para completar SKU + nombre + UM y guardar.
    await user.click(screen.getByRole('button', { name: 'General' }));
    await user.type(screen.getByLabelText('SKU'), 'SKU-NEW');
    await user.type(screen.getByLabelText('Nombre'), 'Producto con precio');
    await user.selectOptions(screen.getByLabelText(/unidad de medida/i), '5');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    // POST /products primero, después PATCH /products/99/pricing.
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/products');
    const [patchUrl, patchBody] = vi.mocked(api.patch).mock.calls[0];
    expect(patchUrl).toBe('/products/99/pricing');
    expect(patchBody).toMatchObject({
      costPrice: '150',
      marginPct: '0.3',
      salePrice: '214.2857',
      minMarginPct: '0',
    });
  });
});
