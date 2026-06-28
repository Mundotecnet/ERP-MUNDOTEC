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
  minMarginPct: '0.6', // 60 %; agregado out_of_margin true porque P1=50% < 60%.
  outOfMargin: true,
  levels: [
    {
      priceListId: '11',
      name: 'Precio 1',
      salePrice: '200',
      marginPct: '0.5',
      outOfMargin: true,
    },
    {
      priceListId: '12',
      name: 'Precio 2',
      salePrice: '160',
      marginPct: '0.375',
      outOfMargin: true,
    },
    {
      priceListId: '13',
      name: 'Precio 3',
      salePrice: '300',
      marginPct: '0.6667',
      outOfMargin: false,
    },
  ],
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

describe('ProductsPage — pestaña Precios 3 niveles (HU-11.2)', () => {
  async function openPricingTab(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: /editar/i }));
    await waitFor(() => screen.getByRole('heading', { name: /editar producto/i }));
    await user.click(screen.getByRole('button', { name: 'Precios' }));
    // Espera a que GET /products/1/pricing complete y rehidrate la tabla.
    await waitFor(() =>
      expect((document.getElementById('pricing-cost') as HTMLInputElement)?.value).toBe('100'),
    );
    return user;
  }

  it('renderiza costo + margen mínimo (entero) + tabla con 3 niveles y badge agregado', async () => {
    await openPricingTab();
    expect((document.getElementById('pricing-cost') as HTMLInputElement).value).toBe('100');
    // 0.6 → entero 60 (UX en porcentaje entero).
    expect((document.getElementById('pricing-min-margin') as HTMLInputElement).value).toBe('60');

    // 3 filas en la tabla.
    expect(screen.getByTestId('pricing-levels-table')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-level-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-level-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-level-row-2')).toBeInTheDocument();

    // Conversión fracción → entero por nivel.
    expect((document.getElementById('pricing-margin-0') as HTMLInputElement).value).toBe('50');
    expect((document.getElementById('pricing-margin-1') as HTMLInputElement).value).toBe('37.5');
    expect((document.getElementById('pricing-margin-2') as HTMLInputElement).value).toBe('66.67');
    expect((document.getElementById('pricing-price-0') as HTMLInputElement).value).toBe('200');
    expect((document.getElementById('pricing-price-1') as HTMLInputElement).value).toBe('160');
    expect((document.getElementById('pricing-price-2') as HTMLInputElement).value).toBe('300');

    // Badge agregado porque P1 y P2 están bajo el piso (60 %).
    expect(screen.getByTestId('out-of-margin-badge')).toBeInTheDocument();
    // Pero P3 (66.67 %) no muestra chip "Fuera".
    expect(screen.getByTestId('pricing-level-out-0')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-level-out-1')).toBeInTheDocument();
    expect(screen.queryByTestId('pricing-level-out-2')).not.toBeInTheDocument();
  });

  it('recálculo bidireccional por fila (cost compartido): editar precio P2 actualiza margen P2 sin tocar P1/P3', async () => {
    const user = await openPricingTab();

    // Estado inicial: cost=100, P1=200/50%, P2=160/37.5%, P3=300/66.67%.
    const price1 = document.getElementById('pricing-price-1') as HTMLInputElement;
    await user.clear(price1);
    await user.type(price1, '150');
    // cost=100, price=150 → margin=0.3333 → entero "33.33".
    await waitFor(() =>
      expect((document.getElementById('pricing-margin-1') as HTMLInputElement).value).toBe('33.33'),
    );
    // P1 y P3 intactos.
    expect((document.getElementById('pricing-margin-0') as HTMLInputElement).value).toBe('50');
    expect((document.getElementById('pricing-margin-2') as HTMLInputElement).value).toBe('66.67');
  });

  it('editar margen en entero recalcula precio redondeado a 2 dec. 30 → price=142.86', async () => {
    const user = await openPricingTab();

    const margin0 = document.getElementById('pricing-margin-0') as HTMLInputElement;
    await user.clear(margin0);
    await user.type(margin0, '30');
    // cost=100, margin=0.3 → price=142.8571 → redondeado a 142.86 (PR-35).
    await waitFor(() =>
      expect((document.getElementById('pricing-price-0') as HTMLInputElement).value).toBe('142.86'),
    );
  });

  it('editar precio recalcula margen efectivo del precio redondeado (PR-35)', async () => {
    const user = await openPricingTab();

    // cost=100 (del fixture), tipear price=142.86 (ya redondeado) →
    // margen efectivo = (142.86 - 100) / 142.86 = 0.29997 → entero "30".
    const price0 = document.getElementById('pricing-price-0') as HTMLInputElement;
    await user.clear(price0);
    await user.type(price0, '142.86');
    await waitFor(() =>
      expect((document.getElementById('pricing-margin-0') as HTMLInputElement).value).toBe('30'),
    );

    // Si el usuario tipeara precio con más decimales (142.8571), el cliente
    // lo redondea defensivamente para calcular el margen efectivo del precio
    // que va a quedar guardado.
    await user.clear(price0);
    await user.type(price0, '142.8571');
    await waitFor(() =>
      expect((document.getElementById('pricing-margin-0') as HTMLInputElement).value).toBe('30'),
    );
  });

  it('cambiar costo recalcula precio de cada nivel respetando su margen vigente', async () => {
    const user = await openPricingTab();

    const cost = document.getElementById('pricing-cost') as HTMLInputElement;
    await user.clear(cost);
    await user.type(cost, '200');

    // P1 margin=0.5 → price=200/(1-0.5)=400
    // P2 margin=0.375 → price=200/(1-0.375)=320
    // P3 margin=0.6667 → price=200/(1-0.6667)≈600.06
    await waitFor(() =>
      expect((document.getElementById('pricing-price-0') as HTMLInputElement).value).toBe('400'),
    );
    expect((document.getElementById('pricing-price-1') as HTMLInputElement).value).toBe('320');
    expect((document.getElementById('pricing-price-2') as HTMLInputElement).value).toBe('600.06');
  });

  it('al guardar envía PATCH con minMarginPct como fracción y levels[] convertidos', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ data: PRICING_A });
    const user = await openPricingTab();

    await user.click(screen.getByRole('button', { name: /guardar precios/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.patch).mock.calls[0];
    expect(url).toBe('/products/1/pricing');
    expect(body).toMatchObject({
      costPrice: '100',
      minMarginPct: '0.6', // 60 entero → 0.6 fracción.
      levels: [
        { priceListId: '11', salePrice: '200', marginPct: '0.5' },
        { priceListId: '12', salePrice: '160', marginPct: '0.375' },
        { priceListId: '13', salePrice: '300', marginPct: '0.6667' },
      ],
    });
  });
});

describe('ProductsPage — pestaña Precios en modo creación', () => {
  it('NO llama GET /products/:id/pricing y la tabla de 3 niveles funciona localmente', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nuevo producto/i }));
    await waitFor(() => screen.getByRole('heading', { name: /nuevo producto/i }));
    await user.click(screen.getByRole('button', { name: 'Precios' }));

    await waitFor(() => expect(document.getElementById('pricing-cost')).toBeInTheDocument());
    const pricingFetchCalls = vi
      .mocked(api.get)
      .mock.calls.filter((c) => String(c[0]).includes('/pricing'));
    expect(pricingFetchCalls).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /guardar precios/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/historial de cambios/i)).not.toBeInTheDocument();
    // 3 filas en la tabla.
    expect(screen.getByTestId('pricing-level-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-level-row-2')).toBeInTheDocument();

    // Recálculo local: cost=200, margen P1=25 (entero) → precio=266.6667
    // → redondeado a 266.67 (PR-35).
    const cost = document.getElementById('pricing-cost') as HTMLInputElement;
    await user.clear(cost);
    await user.type(cost, '200');
    const margin0 = document.getElementById('pricing-margin-0') as HTMLInputElement;
    await user.clear(margin0);
    await user.type(margin0, '25');
    await waitFor(() =>
      expect((document.getElementById('pricing-price-0') as HTMLInputElement).value).toBe('266.67'),
    );
  });

  it('al Guardar desde General: POST /products → GET /pricing (para ids) → PATCH /pricing con levels mapeados', async () => {
    const NEW_PRICING = {
      ...PRICING_A,
      productId: '99',
      costPrice: '0',
      minMarginPct: '0',
      outOfMargin: false,
      levels: PRICING_A.levels.map((l) => ({
        ...l,
        salePrice: '0',
        marginPct: '0',
        outOfMargin: false,
      })),
    };
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...PRODUCT_A, id: '99' } });
    // El extra GET tras el POST (para resolver priceListId).
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/products') return { data: [PRODUCT_A] };
      if (url === '/products/99/pricing') return { data: NEW_PRICING };
      if (url === '/products/1/pricing') return { data: PRICING_A };
      if (url === '/products/1/pricing/history') return { data: [] };
      if (url === '/product-categories') return { data: [{ id: '10', name: 'Networking' }] };
      if (url === '/units-of-measure') return { data: [{ id: '5', code: 'UND', name: 'Unidad' }] };
      if (url === '/taxes') return { data: [{ id: '7', name: 'IVA 13%' }] };
      if (url === '/departments') return { data: [{ id: '3', name: 'Bodega' }] };
      return { data: [] };
    });
    vi.mocked(api.patch).mockResolvedValueOnce({ data: NEW_PRICING });

    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nuevo producto/i }));
    await waitFor(() => screen.getByRole('heading', { name: /nuevo producto/i }));

    // Pongo costo + margen P1 en la pestaña Precios (% entero).
    await user.click(screen.getByRole('button', { name: 'Precios' }));
    const cost = document.getElementById('pricing-cost') as HTMLInputElement;
    await user.clear(cost);
    await user.type(cost, '150');
    const margin0 = document.getElementById('pricing-margin-0') as HTMLInputElement;
    await user.clear(margin0);
    await user.type(margin0, '30');
    await waitFor(() =>
      expect((document.getElementById('pricing-price-0') as HTMLInputElement).value).toBe('214.29'),
    );

    // Completa General + guardar.
    await user.click(screen.getByRole('button', { name: 'General' }));
    await user.type(screen.getByLabelText('SKU'), 'SKU-NEW');
    await user.type(screen.getByLabelText('Nombre'), 'Producto con precio');
    await user.selectOptions(screen.getByLabelText(/unidad de medida/i), '5');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/products');

    const [patchUrl, patchBody] = vi.mocked(api.patch).mock.calls[0];
    expect(patchUrl).toBe('/products/99/pricing');
    // PR-35: el precio P1 va redondeado a 214.29 (no 214.2857).
    expect(patchBody).toMatchObject({
      costPrice: '150',
      minMarginPct: '0',
      levels: [
        { priceListId: '11', salePrice: '214.29', marginPct: '0.3' },
        { priceListId: '12', salePrice: '0', marginPct: '0' },
        { priceListId: '13', salePrice: '0', marginPct: '0' },
      ],
    });
  });
});
