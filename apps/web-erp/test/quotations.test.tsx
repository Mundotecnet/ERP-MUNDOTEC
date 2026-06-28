import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuotationsPage } from '@/pages/quotations';

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
        <QuotationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const CUSTOMER = { id: '10', legalName: 'Cliente A', partnerType: 'CUSTOMER' as const };
const QUOTE = {
  id: '1',
  quoteNumber: 'Q-001',
  status: 'ACCEPTED' as const,
  customerId: '10',
  customerName: 'Cliente A',
  branchId: null,
  salespersonId: null,
  salespersonName: null,
  quoteDate: '2026-06-24',
  validUntil: null,
  currencyCode: 'CRC',
  exchangeRate: '1',
  subtotal: '100',
  taxAmount: '13',
  discountAmount: '0',
  total: '113',
  baseTotal: '113',
  notes: null,
  convertedSalesOrderId: null,
  lines: [],
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/quotations')) {
      // /quotations/:id devuelve el detalle, no la lista.
      return url.match(/\/quotations\/[^?]+$/) ? { data: QUOTE } : { data: [QUOTE] };
    }
    if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
    if (url === '/branches') return { data: [] };
    if (url === '/products') return { data: [] };
    if (url.startsWith('/users')) {
      // /users responde paginado.
      return { data: { data: [], total: 0, page: 1, pageSize: 200 } };
    }
    if (url === '/companies/current') return { data: { currencyCode: 'CRC' } };
    return { data: [] };
  });
  vi.mocked(api.post).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('QuotationsPage', () => {
  it('renderiza la lista con badge de estado y soporte de prospecto', async () => {
    setup();
    expect(await screen.findByText('Q-001')).toBeInTheDocument();
    // El chip de filtro y el badge de la fila ambos dicen "ACCEPTED": buscamos el span.
    const spans = screen.getAllByText('ACCEPTED', { selector: 'span' });
    expect(spans.length).toBeGreaterThanOrEqual(1);
    // "Cliente A" aparece en el option del filtro y en la celda — verificamos la celda.
    expect(screen.getAllByText('Cliente A', { selector: 'td' }).length).toBeGreaterThanOrEqual(1);
    // El botón "Convertir" aparece solo cuando ACCEPTED.
    expect(screen.getByRole('button', { name: /^convertir$/i })).toBeInTheDocument();
  });

  it('POST /quotations con payload que incluye una línea libre (sin productId)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...QUOTE, id: '99' } });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nueva cotización/i }));

    await user.type(document.getElementById('q-num') as HTMLInputElement, 'Q-NEW');
    await user.type(screen.getByLabelText(/descripción línea 1/i), 'Servicio libre');
    await user.clear(screen.getByLabelText(/cantidad línea 1/i));
    await user.type(screen.getByLabelText(/cantidad línea 1/i), '1');
    await user.clear(screen.getByLabelText(/precio línea 1/i));
    await user.type(screen.getByLabelText(/precio línea 1/i), '500');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/quotations');
    expect(body).toMatchObject({
      customerId: null,
      quoteNumber: 'Q-NEW',
      currencyCode: 'CRC',
      lines: [
        {
          productId: null,
          description: 'Servicio libre',
          quantity: '1',
          unitPrice: '500',
        },
      ],
    });
  });

  it('al confirmar el dialog "Convertir" llama /quotations/:id/convert con orderNumber', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { salesOrder: { id: '77', orderNumber: 'SO-FROM-Q' } },
    });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /convertir/i }));

    await user.type(screen.getByLabelText(/nº orden de venta/i), 'SO-FROM-Q');
    // 2 botones "Convertir": el de la fila y el del dialog. El del dialog es el último
    // (ya que el dialog se renderiza después). Lo seleccionamos por posición.
    const convertButtons = screen.getAllByRole('button', { name: /^convertir$/i });
    await user.click(convertButtons[convertButtons.length - 1]);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/quotations/1/convert');
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ orderNumber: 'SO-FROM-Q' });
  });

  it('pide /users con isSalesperson=true y renderiza vendedores del payload paginado', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/quotations')) {
        return url.match(/\/quotations\/[^?]+$/) ? { data: QUOTE } : { data: [QUOTE] };
      }
      if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
      if (url === '/branches') return { data: [] };
      if (url === '/products') return { data: [] };
      if (url.startsWith('/users')) {
        return {
          data: {
            data: [{ id: '7', fullName: 'Vendedor Activo', isSalesperson: true }],
            total: 1,
            page: 1,
            pageSize: 200,
          },
        };
      }
      if (url === '/companies/current') return { data: { currencyCode: 'CRC' } };
      return { data: [] };
    });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nueva cotización/i }));

    const usersCalls = vi
      .mocked(api.get)
      .mock.calls.filter((c) => String(c[0]).startsWith('/users'));
    expect(usersCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(usersCalls[0][0])).toContain('isSalesperson=true');

    await waitFor(() => {
      const opt = document.querySelector('#q-sp option[value="7"]');
      expect(opt?.textContent).toBe('Vendedor Activo');
    });
  });

  it('al editar una cotización con vendedor ya removido de la lista, conserva la opción', async () => {
    const QUOTE_WITH_OLD_SP = {
      ...QUOTE,
      status: 'DRAFT' as const,
      salespersonId: '999',
      salespersonName: 'Ex Vendedor',
    };
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.match(/\/quotations\/[^?]+$/)) return { data: QUOTE_WITH_OLD_SP };
      if (url.startsWith('/quotations')) return { data: [QUOTE_WITH_OLD_SP] };
      if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
      if (url === '/branches') return { data: [] };
      if (url === '/products') return { data: [] };
      if (url.startsWith('/users')) {
        // El usuario 999 ya no aparece en la lista filtrada (ya no es vendedor).
        return {
          data: {
            data: [{ id: '7', fullName: 'Otro Vendedor', isSalesperson: true }],
            total: 1,
            page: 1,
            pageSize: 200,
          },
        };
      }
      if (url === '/companies/current') return { data: { currencyCode: 'CRC' } };
      return { data: [] };
    });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^editar$/i }));

    await waitFor(() => {
      const opt = document.querySelector('#q-sp option[value="999"]');
      expect(opt?.textContent).toBe('Ex Vendedor');
    });
    // y el vendedor "vigente" también está
    expect(document.querySelector('#q-sp option[value="7"]')?.textContent).toBe('Otro Vendedor');
  });
});

describe('QuotationsPage — selector de nivel de precio por línea (PR-37)', () => {
  const PRODUCT = { id: '5', sku: 'P-1', name: 'Producto X' };
  const PRICING = {
    productId: '5',
    costPrice: '100',
    minMarginPct: '0',
    outOfMargin: false,
    levels: [
      {
        priceListId: '101',
        name: 'Precio 1',
        salePrice: '142.86',
        marginPct: '0.3',
        outOfMargin: false,
      },
      {
        priceListId: '102',
        name: 'Precio 2',
        salePrice: '180',
        marginPct: '0.4444',
        outOfMargin: false,
      },
      {
        priceListId: '103',
        name: 'Precio 3',
        salePrice: '250',
        marginPct: '0.6',
        outOfMargin: false,
      },
    ],
  };

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/quotations')) {
        return url.match(/\/quotations\/[^?]+$/) ? { data: QUOTE } : { data: [QUOTE] };
      }
      if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
      if (url === '/branches') return { data: [] };
      if (url === '/products') return { data: [PRODUCT] };
      if (url === '/products/5/pricing') return { data: PRICING };
      if (url.startsWith('/users')) {
        return { data: { data: [], total: 0, page: 1, pageSize: 200 } };
      }
      if (url === '/companies/current') return { data: { currencyCode: 'CRC' } };
      return { data: [] };
    });
  });

  async function openCreate() {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nueva cotización/i }));
    await waitFor(() => screen.getByLabelText(/producto línea 1/i));
    return user;
  }

  it('al elegir producto: nivel default Precio 1 y precio autocompletado a 142.86; margen ef. = 30 %', async () => {
    const user = await openCreate();

    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    // El selector de nivel aparece tras cargar pricing.
    const levelSelect = await screen.findByTestId('quote-line-level-0');
    await waitFor(() => expect((levelSelect as HTMLSelectElement).value).toBe('101'));
    expect((screen.getByLabelText(/precio línea 1/i) as HTMLInputElement).value).toBe('142.86');
    // Margen efectivo = (142.86-100)/142.86 ≈ 30 %.
    await waitFor(() =>
      expect(screen.getByTestId('quote-line-margin-0').textContent).toMatch(/30\.00 %/),
    );
  });

  it('al cambiar a Precio 2: autocompleta precio a 180 y margen ef. ≈ 44.44 %', async () => {
    const user = await openCreate();
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    const levelSelect = (await screen.findByTestId('quote-line-level-0')) as HTMLSelectElement;
    await waitFor(() => expect(levelSelect.value).toBe('101'));

    await user.selectOptions(levelSelect, '102');
    await waitFor(() =>
      expect((screen.getByLabelText(/precio línea 1/i) as HTMLInputElement).value).toBe('180'),
    );
    expect(screen.getByTestId('quote-line-margin-0').textContent).toMatch(/44\.44 %/);
  });

  it('el override manual del precio no se pisa al re-renderizar; margen ef. refleja el precio override', async () => {
    const user = await openCreate();
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    const levelSelect = (await screen.findByTestId('quote-line-level-0')) as HTMLSelectElement;
    await waitFor(() => expect(levelSelect.value).toBe('101'));

    // El vendedor sobreescribe el precio (descuento de venta).
    const priceInput = screen.getByLabelText(/precio línea 1/i) as HTMLInputElement;
    await user.clear(priceInput);
    await user.type(priceInput, '130');
    expect(priceInput.value).toBe('130');
    // Margen efectivo recalculado al precio override: (130-100)/130 ≈ 23.08 %.
    await waitFor(() =>
      expect(screen.getByTestId('quote-line-margin-0').textContent).toMatch(/23\.08 %/),
    );
    // El nivel sigue siendo P1 (no se desasocia automáticamente).
    expect(levelSelect.value).toBe('101');
  });

  it('POST /quotations envía priceListId del nivel elegido en la línea', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...QUOTE, id: '99' } });
    const user = await openCreate();
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    const levelSelect = (await screen.findByTestId('quote-line-level-0')) as HTMLSelectElement;
    await waitFor(() => expect(levelSelect.value).toBe('101'));
    await user.selectOptions(levelSelect, '103');
    await waitFor(() =>
      expect((screen.getByLabelText(/precio línea 1/i) as HTMLInputElement).value).toBe('250'),
    );

    await user.type(document.getElementById('q-num') as HTMLInputElement, 'Q-LVL');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0];
    expect((body as { lines: Array<{ priceListId: string | null }> }).lines[0].priceListId).toBe(
      '103',
    );
  });

  it('línea libre (sin producto) deshabilita el selector y no envía priceListId', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...QUOTE, id: '99' } });
    const user = await openCreate();

    const levelSelect = screen.getByTestId('quote-line-level-0') as HTMLSelectElement;
    expect(levelSelect.disabled).toBe(true);

    await user.type(screen.getByLabelText(/descripción línea 1/i), 'Servicio libre');
    await user.clear(screen.getByLabelText(/precio línea 1/i));
    await user.type(screen.getByLabelText(/precio línea 1/i), '50');
    await user.type(document.getElementById('q-num') as HTMLInputElement, 'Q-FREE');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0];
    expect((body as { lines: Array<{ priceListId: string | null }> }).lines[0].priceListId).toBe(
      null,
    );
  });
});
