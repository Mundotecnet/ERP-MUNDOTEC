import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SalesOrdersPage } from '@/pages/sales-orders';

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
        <SalesOrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const CUSTOMER = { id: '10', legalName: 'Cliente A', partnerType: 'CUSTOMER' as const };
const PRODUCT = { id: '5', sku: 'P-1', name: 'Producto 1', isInventoried: true };
const WAREHOUSE = { id: '20', code: 'WH-1', name: 'Central' };
const SO_CONFIRMED_DETAIL = {
  id: '1',
  orderNumber: 'SO-001',
  status: 'CONFIRMED' as const,
  customerId: '10',
  customerName: 'Cliente A',
  branchId: null,
  salespersonId: null,
  salespersonName: null,
  quotationId: null,
  quotationNumber: null,
  orderDate: '2026-06-24',
  currencyCode: 'CRC',
  exchangeRate: '1',
  subtotal: '100',
  taxAmount: '13',
  discountAmount: '0',
  total: '113',
  baseTotal: '113',
  notes: null,
  lines: [
    {
      id: '1',
      productId: '5',
      productSku: 'P-1',
      quantity: '5',
      unitPrice: '20',
      discountRate: '0',
      taxRate: '0.13',
      lineTotal: '113',
      // PR-38 — la OV creada desde una cotización viene con el nivel propagado.
      priceListId: '102',
      priceListName: 'Precio 2',
    },
  ],
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/sales-orders/1') return { data: SO_CONFIRMED_DETAIL };
    if (url.startsWith('/sales-orders')) return { data: [SO_CONFIRMED_DETAIL] };
    if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
    if (url === '/branches') return { data: [] };
    if (url === '/products') return { data: [PRODUCT] };
    if (url === '/warehouses') return { data: [WAREHOUSE] };
    if (url.startsWith('/users')) {
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

describe('SalesOrdersPage', () => {
  it('renderiza la lista con badge y botón Facturar para CONFIRMED', async () => {
    setup();
    expect(await screen.findByText('SO-001')).toBeInTheDocument();
    const spans = screen.getAllByText('CONFIRMED', { selector: 'span' });
    expect(spans.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /facturar/i })).toBeInTheDocument();
  });

  it('POST /sales-orders con payload que incluye array lines', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...SO_CONFIRMED_DETAIL, id: '99' } });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nueva ov/i }));

    const cust = document.getElementById('so-cust') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(cust.options).some((o) => o.value === '10')).toBe(true));
    await user.selectOptions(cust, '10');
    await user.type(document.getElementById('so-num') as HTMLInputElement, 'SO-NEW');
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    await user.clear(screen.getByLabelText(/cantidad línea 1/i));
    await user.type(screen.getByLabelText(/cantidad línea 1/i), '3');
    await user.clear(screen.getByLabelText(/precio línea 1/i));
    await user.type(screen.getByLabelText(/precio línea 1/i), '100');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/sales-orders');
    expect(body).toMatchObject({
      customerId: '10',
      orderNumber: 'SO-NEW',
      currencyCode: 'CRC',
      lines: [{ productId: '5', quantity: '3', unitPrice: '100', discountRate: '0', taxRate: '0' }],
    });
  });

  it('clic en "Facturar" abre dialog y al emitir llama POST /invoices con salesOrderId', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { id: '99', invoiceNumber: 'INV-FROM-SO' },
    });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /facturar/i }));

    // Esperar a que el dialog cargue almacenes.
    const wh = document.getElementById('inv-wh') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(wh.options).some((o) => o.value === '20')).toBe(true));
    await user.selectOptions(wh, '20');
    await user.type(screen.getByLabelText(/nº factura/i), 'INV-FROM-SO');
    await user.click(screen.getByRole('button', { name: /emitir factura/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/invoices');
    expect(body).toMatchObject({
      customerId: '10',
      salesOrderId: '1',
      warehouseId: '20',
      invoiceNumber: 'INV-FROM-SO',
      lines: [
        {
          productId: '5',
          quantity: '5',
          unitPrice: '20',
          taxRate: '0.13',
          // PR-38 — la propagación SO→Factura copia el priceListId de la línea.
          priceListId: '102',
        },
      ],
    });
  });

  it('OV con salespersonId huérfano preserva la opción en el selector de vendedor', async () => {
    const SO_WITH_OLD_SP = {
      ...SO_CONFIRMED_DETAIL,
      status: 'DRAFT' as const,
      salespersonId: '888',
      salespersonName: 'Ex Vendedor SO',
    };
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/sales-orders/1') return { data: SO_WITH_OLD_SP };
      if (url.startsWith('/sales-orders')) return { data: [SO_WITH_OLD_SP] };
      if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
      if (url === '/branches') return { data: [] };
      if (url === '/products') return { data: [PRODUCT] };
      if (url === '/warehouses') return { data: [WAREHOUSE] };
      if (url.startsWith('/users')) {
        return {
          data: {
            data: [{ id: '7', fullName: 'Vendedor Vigente', isSalesperson: true }],
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
      const opt = document.querySelector('#so-sp option[value="888"]');
      expect(opt?.textContent).toBe('Ex Vendedor SO');
    });
    expect(document.querySelector('#so-sp option[value="7"]')?.textContent).toBe(
      'Vendedor Vigente',
    );
  });
});

describe('SalesOrdersPage — selector de nivel de precio por línea (PR-38)', () => {
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
      if (url === '/sales-orders/1') return { data: SO_CONFIRMED_DETAIL };
      if (url.startsWith('/sales-orders')) return { data: [SO_CONFIRMED_DETAIL] };
      if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
      if (url === '/branches') return { data: [] };
      if (url === '/products') return { data: [PRODUCT] };
      if (url === '/products/5/pricing') return { data: PRICING };
      if (url === '/warehouses') return { data: [WAREHOUSE] };
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
    await user.click(await screen.findByRole('button', { name: /nueva ov/i }));
    await waitFor(() => screen.getByLabelText(/producto línea 1/i));
    return user;
  }

  it('al elegir producto: default Precio 1, precio autocompleta a 142.86 y margen ef. ≈ 30 %', async () => {
    const user = await openCreate();

    // El customerId es obligatorio en OV; lo seleccionamos antes.
    const cust = document.getElementById('so-cust') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(cust.options).some((o) => o.value === '10')).toBe(true));
    await user.selectOptions(cust, '10');

    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    const levelSelect = (await screen.findByTestId('so-line-level-0')) as HTMLSelectElement;
    await waitFor(() => expect(levelSelect.value).toBe('101'));
    expect((screen.getByLabelText(/precio línea 1/i) as HTMLInputElement).value).toBe('142.86');
    await waitFor(() =>
      expect(screen.getByTestId('so-line-margin-0').textContent).toMatch(/30\.00 %/),
    );
  });

  it('al cambiar a Precio 3 autocompleta precio a 250 y POST envía priceListId=103', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...SO_CONFIRMED_DETAIL, id: '99' } });
    const user = await openCreate();
    const cust = document.getElementById('so-cust') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(cust.options).some((o) => o.value === '10')).toBe(true));
    await user.selectOptions(cust, '10');
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    const levelSelect = (await screen.findByTestId('so-line-level-0')) as HTMLSelectElement;
    await waitFor(() => expect(levelSelect.value).toBe('101'));

    await user.selectOptions(levelSelect, '103');
    await waitFor(() =>
      expect((screen.getByLabelText(/precio línea 1/i) as HTMLInputElement).value).toBe('250'),
    );

    await user.type(document.getElementById('so-num') as HTMLInputElement, 'SO-LVL');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0];
    expect((body as { lines: Array<{ priceListId: string | null }> }).lines[0].priceListId).toBe(
      '103',
    );
  });

  it('override manual del precio se respeta; margen ef. refleja el override', async () => {
    const user = await openCreate();
    const cust = document.getElementById('so-cust') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(cust.options).some((o) => o.value === '10')).toBe(true));
    await user.selectOptions(cust, '10');
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    const levelSelect = (await screen.findByTestId('so-line-level-0')) as HTMLSelectElement;
    await waitFor(() => expect(levelSelect.value).toBe('101'));

    const priceInput = screen.getByLabelText(/precio línea 1/i) as HTMLInputElement;
    await user.clear(priceInput);
    await user.type(priceInput, '130');
    expect(priceInput.value).toBe('130');
    await waitFor(() =>
      expect(screen.getByTestId('so-line-margin-0').textContent).toMatch(/23\.08 %/),
    );
    expect(levelSelect.value).toBe('101'); // nivel no se desasocia
  });
});
