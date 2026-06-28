import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InvoicesPage } from '@/pages/invoices';

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
        <InvoicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const CUSTOMER = { id: '10', legalName: 'Cliente A', partnerType: 'CUSTOMER' as const };
const PRODUCT = { id: '5', sku: 'P-1', name: 'Producto 1', isInventoried: true };
const WAREHOUSE = { id: '20', code: 'WH-1', name: 'Central' };
const INVOICE = {
  id: '1',
  invoiceNumber: 'INV-001',
  status: 'ISSUED' as const,
  customerId: '10',
  customerName: 'Cliente A',
  branchId: null,
  salespersonId: null,
  salespersonName: null,
  salesOrderId: null,
  salesOrderNumber: null,
  invoiceDate: '2026-06-24',
  dueDate: null,
  currencyCode: 'CRC',
  exchangeRate: '1',
  subtotal: '100',
  taxAmount: '13',
  total: '113',
  baseTotal: '113',
  paidAmount: '0',
  balance: '113',
  lines: [],
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/invoices')) return { data: [INVOICE] };
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

describe('InvoicesPage', () => {
  it('renderiza la lista con badge ISSUED y balance pendiente', async () => {
    setup();
    expect(await screen.findByText('INV-001')).toBeInTheDocument();
    const spans = screen.getAllByText('ISSUED', { selector: 'span' });
    expect(spans.length).toBeGreaterThanOrEqual(1);
    // El balance pendiente (113) está en la fila.
    expect(screen.getAllByText('113', { selector: 'td' }).length).toBeGreaterThanOrEqual(1);
  });

  it('emisión directa: POST /invoices con producto + servicio (línea libre)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...INVOICE, id: '99' } });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nueva factura/i }));

    const cust = document.getElementById('i-cust') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(cust.options).some((o) => o.value === '10')).toBe(true));
    await user.selectOptions(cust, '10');
    await user.selectOptions(document.getElementById('i-wh') as HTMLSelectElement, '20');
    await user.type(document.getElementById('i-num') as HTMLInputElement, 'INV-NEW');

    // Primera línea: producto
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    await user.clear(screen.getByLabelText(/cantidad línea 1/i));
    await user.type(screen.getByLabelText(/cantidad línea 1/i), '2');
    await user.clear(screen.getByLabelText(/precio línea 1/i));
    await user.type(screen.getByLabelText(/precio línea 1/i), '50');

    // Agregar línea de servicio libre
    await user.click(screen.getByRole('button', { name: /\+ línea/i }));
    await user.type(screen.getByLabelText(/descripción línea 2/i), 'Cargo extra');
    await user.clear(screen.getByLabelText(/cantidad línea 2/i));
    await user.type(screen.getByLabelText(/cantidad línea 2/i), '1');
    await user.clear(screen.getByLabelText(/precio línea 2/i));
    await user.type(screen.getByLabelText(/precio línea 2/i), '25');

    await user.click(screen.getByRole('button', { name: /emitir factura/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/invoices');
    expect(body).toMatchObject({
      customerId: '10',
      warehouseId: '20',
      invoiceNumber: 'INV-NEW',
      currencyCode: 'CRC',
      lines: [
        { productId: '5', description: null, quantity: '2', unitPrice: '50' },
        { productId: null, description: 'Cargo extra', quantity: '1', unitPrice: '25' },
      ],
    });
    expect((body as { salesOrderId?: unknown }).salesOrderId).toBeUndefined();
  });

  it('selector de vendedor consume /users con isSalesperson=true (payload paginado)', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/invoices')) return { data: [INVOICE] };
      if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
      if (url === '/branches') return { data: [] };
      if (url === '/products') return { data: [PRODUCT] };
      if (url === '/warehouses') return { data: [WAREHOUSE] };
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
    await user.click(await screen.findByRole('button', { name: /nueva factura/i }));

    const usersCalls = vi
      .mocked(api.get)
      .mock.calls.filter((c) => String(c[0]).startsWith('/users'));
    expect(usersCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(usersCalls[0][0])).toContain('isSalesperson=true');

    await waitFor(() => {
      const opt = document.querySelector('#i-sp option[value="7"]');
      expect(opt?.textContent).toBe('Vendedor Activo');
    });
  });
});

describe('InvoicesPage — selector de nivel de precio por línea (PR-38)', () => {
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
    ],
  };

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/invoices')) return { data: [INVOICE] };
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
    await user.click(await screen.findByRole('button', { name: /nueva factura/i }));
    await waitFor(() => screen.getByLabelText(/producto línea 1/i));
    return user;
  }

  it('al elegir producto: default Precio 1 y precio autocompleta a 142.86; margen ef. ≈ 30 %', async () => {
    const user = await openCreate();
    const cust = document.getElementById('i-cust') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(cust.options).some((o) => o.value === '10')).toBe(true));
    await user.selectOptions(cust, '10');
    await user.selectOptions(document.getElementById('i-wh') as HTMLSelectElement, '20');

    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    const levelSelect = (await screen.findByTestId('inv-line-level-0')) as HTMLSelectElement;
    await waitFor(() => expect(levelSelect.value).toBe('101'));
    expect((screen.getByLabelText(/precio línea 1/i) as HTMLInputElement).value).toBe('142.86');
    await waitFor(() =>
      expect(screen.getByTestId('inv-line-margin-0').textContent).toMatch(/30\.00 %/),
    );
  });

  it('POST /invoices envía priceListId del nivel elegido y null para líneas libres', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...INVOICE, id: '99' } });
    const user = await openCreate();
    const cust = document.getElementById('i-cust') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(cust.options).some((o) => o.value === '10')).toBe(true));
    await user.selectOptions(cust, '10');
    await user.selectOptions(document.getElementById('i-wh') as HTMLSelectElement, '20');
    await user.type(document.getElementById('i-num') as HTMLInputElement, 'INV-LVL');

    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    const levelSelect = (await screen.findByTestId('inv-line-level-0')) as HTMLSelectElement;
    await waitFor(() => expect(levelSelect.value).toBe('101'));
    await user.selectOptions(levelSelect, '102');

    // Segunda línea libre (servicio sin producto).
    await user.click(screen.getByRole('button', { name: /\+ línea/i }));
    await user.type(screen.getByLabelText(/descripción línea 2/i), 'Servicio');
    await user.clear(screen.getByLabelText(/precio línea 2/i));
    await user.type(screen.getByLabelText(/precio línea 2/i), '50');

    await user.click(screen.getByRole('button', { name: /emitir factura/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0];
    const lines = (body as { lines: Array<{ priceListId: string | null }> }).lines;
    expect(lines[0].priceListId).toBe('102');
    expect(lines[1].priceListId).toBe(null);
  });
});
