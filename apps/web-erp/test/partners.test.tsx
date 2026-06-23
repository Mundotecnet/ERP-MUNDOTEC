import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PartnersPage } from '@/pages/partners';

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
        <PartnersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PARTNER_A = {
  id: '1',
  partnerType: 'SUPPLIER' as const,
  code: 'SUP-001',
  legalName: 'Distribuidora ABC',
  tradeName: 'ABC',
  taxId: '3-101-700700',
  email: 'ventas@abc.cr',
  phone: '+506-2222-3333',
  address: 'San José',
  currencyCode: 'USD',
  creditLimit: '5000',
  creditDays: 30,
  isActive: true,
  customerCategoryId: null,
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/partners?') || url === '/partners') return { data: [PARTNER_A] };
    if (url === '/customer-categories') return { data: [{ id: '10', code: 'A', name: 'VIP' }] };
    return { data: [] };
  });
  vi.mocked(api.post).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PartnersPage', () => {
  it('renderiza la lista de terceros', async () => {
    setup();
    expect(await screen.findByText('Distribuidora ABC')).toBeInTheDocument();
    expect(screen.getByText('SUP-001')).toBeInTheDocument();
    expect(screen.getByText('Proveedor')).toBeInTheDocument();
  });

  it('al cambiar el chip de tipo refetchea con ?type=', async () => {
    setup();
    await screen.findByText('Distribuidora ABC');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clientes' }));
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.map((c) => c[0]);
      expect(calls.some((u) => u.includes('type=CUSTOMER'))).toBe(true);
    });
  });

  it('POST /partners con el payload correcto al crear un cliente', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...PARTNER_A, id: '99' } });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /nuevo tercero/i }));

    await user.selectOptions(screen.getByLabelText(/tipo/i), 'CUSTOMER');
    await user.type(screen.getByLabelText(/razón social/i), 'Cliente Final S.A.');
    await user.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/partners');
    expect(body).toMatchObject({
      partnerType: 'CUSTOMER',
      legalName: 'Cliente Final S.A.',
      currencyCode: 'USD',
      creditDays: 0,
      isActive: true,
      customerCategoryId: null,
    });
  });
});
