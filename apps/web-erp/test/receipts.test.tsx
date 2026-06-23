import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReceiptsPage } from '@/pages/receipts';

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
        <ReceiptsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const APPROVED_PO = {
  id: '10',
  orderNumber: 'OC-101',
  status: 'APPROVED',
  supplierName: 'Proveedor A',
  lines: [
    {
      id: '1',
      productId: '5',
      productSku: 'P-1',
      quantity: '10',
      receivedQty: '3',
      unitCost: '4',
    },
  ],
};

const WAREHOUSE = { id: '20', code: 'WH-1', name: 'Central' };
const PRODUCT = { id: '5', sku: 'P-1', name: 'Producto 1', isInventoried: true };
const RECEIPT = {
  id: '1',
  receiptNumber: 'GR-001',
  receiptDate: '2026-06-20',
  warehouseId: '20',
  warehouseCode: 'WH-1',
  purchaseOrderId: '10',
  purchaseOrderNumber: 'OC-101',
  lines: [],
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/purchase-orders?status=APPROVED') return { data: [APPROVED_PO] };
    if (url.startsWith('/goods-receipts')) return { data: [RECEIPT] };
    if (url === '/warehouses') return { data: [WAREHOUSE] };
    if (url === '/products') return { data: [PRODUCT] };
    return { data: [] };
  });
  vi.mocked(api.post).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReceiptsPage', () => {
  it('renderiza la lista de recepciones', async () => {
    setup();
    expect(await screen.findByText('GR-001')).toBeInTheDocument();
    expect(screen.getByText('WH-1')).toBeInTheDocument();
    expect(screen.getByText('OC-101')).toBeInTheDocument();
  });

  it('modo "Contra OC" precarga la cantidad pendiente (10 − 3 = 7)', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nueva recepción/i }));

    // El dialog usa id="r-po"; el filtro usa "f-po". Apuntamos al del dialog.
    const poSelect = document.getElementById('r-po') as HTMLSelectElement;
    await waitFor(() =>
      expect(Array.from(poSelect.options).some((o) => o.value === '10')).toBe(true),
    );
    await user.selectOptions(poSelect, '10');

    const qty = await screen.findByLabelText(/cantidad línea 1/i);
    await waitFor(() => expect((qty as HTMLInputElement).value).toBe('7'));
  });

  it('modo "Recepción directa" envía POST sin purchaseOrderId y con unitCost', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: RECEIPT });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nueva recepción/i }));
    await user.click(screen.getByRole('button', { name: /recepción directa/i }));

    const whSelect = document.getElementById('r-wh') as HTMLSelectElement;
    await waitFor(() =>
      expect(Array.from(whSelect.options).some((o) => o.value === '20')).toBe(true),
    );
    await user.selectOptions(whSelect, '20');
    await user.type(document.getElementById('r-num') as HTMLInputElement, 'GR-NEW');
    await user.selectOptions(screen.getByLabelText(/producto línea 1/i), '5');
    await user.clear(screen.getByLabelText(/cantidad línea 1/i));
    await user.type(screen.getByLabelText(/cantidad línea 1/i), '4');
    await user.clear(screen.getByLabelText(/costo línea 1/i));
    await user.type(screen.getByLabelText(/costo línea 1/i), '15');
    await user.click(screen.getByRole('button', { name: /confirmar recepción/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/goods-receipts');
    expect(body).toMatchObject({
      warehouseId: '20',
      receiptNumber: 'GR-NEW',
      lines: [{ productId: '5', quantity: '4', unitCost: '15' }],
    });
    expect((body as { purchaseOrderId?: unknown }).purchaseOrderId).toBeUndefined();
  });
});
