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
    if (url.startsWith('/quotations')) return { data: [QUOTE] };
    if (url === '/partners?type=CUSTOMER') return { data: [CUSTOMER] };
    if (url === '/branches') return { data: [] };
    if (url === '/products') return { data: [] };
    if (url === '/users') return { data: [] };
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
});
