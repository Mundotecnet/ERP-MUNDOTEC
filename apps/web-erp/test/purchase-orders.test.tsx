import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PurchaseOrdersPage } from '@/pages/purchase-orders';

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
        <PurchaseOrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SUPPLIER = {
  id: '10',
  legalName: 'Proveedor A',
  partnerType: 'SUPPLIER' as const,
  currencyCode: 'CRC',
};
const PRODUCT = { id: '5', sku: 'P-1', name: 'Producto 1', isInventoried: true };
const PO_DRAFT = {
  id: '1',
  orderNumber: 'OC-001',
  status: 'DRAFT' as const,
  supplierId: '10',
  supplierName: 'Proveedor A',
  branchId: null,
  orderDate: '2026-06-20',
  expectedDate: null,
  currencyCode: 'CRC',
  exchangeRate: '1',
  subtotal: '100',
  taxAmount: '13',
  total: '113',
  baseTotal: '113',
  notes: null,
  lines: [],
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/purchase-orders?status=APPROVED')) return { data: [] };
    if (url.startsWith('/purchase-orders')) return { data: [PO_DRAFT] };
    if (url === '/partners?type=SUPPLIER') return { data: [SUPPLIER] };
    if (url === '/branches') return { data: [] };
    if (url === '/products') return { data: [PRODUCT] };
    if (url === '/companies/current') return { data: { currencyCode: 'CRC' } };
    return { data: [] };
  });
  vi.mocked(api.post).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PurchaseOrdersPage', () => {
  it('renderiza la lista con badge de estado', async () => {
    setup();
    expect(await screen.findByText('OC-001')).toBeInTheDocument();
    // El chip de filtro y el badge de la fila ambos dicen "DRAFT": buscamos el span
    // (badge) para no chocar con el botón del chip.
    const spans = screen.getAllByText('DRAFT', { selector: 'span' });
    expect(spans.length).toBeGreaterThanOrEqual(1);
    // "Proveedor A" aparece en el option del filtro y en la celda; verificamos la celda.
    expect(screen.getAllByText('Proveedor A', { selector: 'td' }).length).toBeGreaterThanOrEqual(1);
  });

  it('crea una OC con líneas y envía payload con array `lines`', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...PO_DRAFT, id: '99' } });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nueva oc/i }));

    // El dialog usa id="po-sup"; el filtro usa "f-supplier". Apuntamos al del dialog.
    const supplierSelect = (await screen.findByRole('combobox', { name: '' }).catch(() => null)) as
      | HTMLSelectElement
      | null
      | undefined;
    // En su lugar, document.getElementById es el método más fiable cuando hay duplicado.
    const supplier =
      (document.getElementById('po-sup') as HTMLSelectElement | null) ?? supplierSelect;
    if (!supplier) throw new Error('select po-sup no encontrado');
    await waitFor(() => {
      expect(Array.from(supplier.options).some((o) => o.value === '10')).toBe(true);
    });
    await user.selectOptions(supplier, '10');
    await user.type(document.getElementById('po-num') as HTMLInputElement, 'OC-NEW');
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    await user.clear(screen.getByLabelText(/cantidad línea 1/i));
    await user.type(screen.getByLabelText(/cantidad línea 1/i), '10');
    await user.clear(screen.getByLabelText(/costo línea 1/i));
    await user.type(screen.getByLabelText(/costo línea 1/i), '5');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/purchase-orders');
    expect(body).toMatchObject({
      supplierId: '10',
      orderNumber: 'OC-NEW',
      currencyCode: 'CRC',
      lines: [{ productId: '5', quantity: '10', unitCost: '5', taxRate: '0' }],
    });
  });

  it('clic en "Aprobar" llama al endpoint /:id/approve', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...PO_DRAFT, status: 'APPROVED' } });
    setup();
    const user = userEvent.setup();
    await screen.findByText('OC-001');
    await user.click(screen.getByRole('button', { name: /aprobar/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/purchase-orders/1/approve', {}));
  });
});
