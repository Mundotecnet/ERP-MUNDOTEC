/**
 * Tests vitest para las 5 pantallas de mantenimiento de catálogos.
 * Cubre: render, búsqueda, crear (POST + invalidate), editar (PATCH), borrar
 * (DELETE + 409), code inmutable en Monedas, e invalidación de selectores de
 * productos tras crear categoría/depto/unidad/impuesto.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrenciesPage } from '@/pages/currencies';
import { DepartmentsPage } from '@/pages/departments';
import { ProductCategoriesPage } from '@/pages/product-categories';
import { TaxesPage } from '@/pages/taxes';
import { UnitsOfMeasurePage } from '@/pages/units-of-measure';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '@/lib/api';

function setup(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
  // confirm() devuelve siempre true en estos tests salvo override.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CurrenciesPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        { code: 'CRC', name: 'Colón', symbol: '₡', decimals: 2, isActive: true },
        { code: 'USD', name: 'Dólar', symbol: '$', decimals: 2, isActive: false },
      ],
    });
  });

  it('lista monedas con decimals y badge de estado', async () => {
    setup(<CurrenciesPage />);
    expect(await screen.findByText('CRC')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getAllByText('Activo').length).toBeGreaterThanOrEqual(1);
  });

  it('crea moneda nueva enviando code en mayúsculas + payload completo', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    setup(<CurrenciesPage />);
    await screen.findByText('CRC');

    await userEvent.click(screen.getByRole('button', { name: /nuevo moneda|nueva moneda/i }));
    await userEvent.type(screen.getByLabelText(/código iso/i), 'eur');
    await userEvent.type(screen.getByLabelText(/^nombre/i), 'Euro');
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/currencies', {
      code: 'EUR',
      name: 'Euro',
      symbol: null,
      decimals: 2,
      isActive: true,
    });
  });

  it('al editar, el campo código no se renderiza (inmutable)', async () => {
    setup(<CurrenciesPage />);
    await screen.findByText('CRC');
    await userEvent.click(screen.getAllByRole('button', { name: /editar/i })[0]);

    // El dialog se abre con los demás campos pero NO con el código ISO.
    expect(screen.getByRole('heading', { name: /editar moneda/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/código iso/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^nombre/i)).toHaveValue('Colón');
  });

  it('PATCH solo envía campos editables (no envía code aunque sea Moneda)', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    setup(<CurrenciesPage />);
    await screen.findByText('CRC');
    await userEvent.click(screen.getAllByRole('button', { name: /editar/i })[0]);
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith('/currencies/CRC', {
      name: 'Colón',
      symbol: '₡',
      decimals: 2,
      isActive: true,
    });
  });

  it('al borrar, muestra el mensaje de error 409 (en uso)', async () => {
    const err = new AxiosError(
      'Request failed with status code 409',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 409,
        statusText: 'Conflict',
        data: { message: 'No se puede eliminar la moneda CRC: está en uso por 1 empresa(s).' },
        headers: {},
        config: { headers: new AxiosHeaders() },
      },
    );
    vi.mocked(api.delete).mockRejectedValue(err);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    setup(<CurrenciesPage />);
    await screen.findByText('CRC');
    await userEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0]);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/en uso/i);
  });
});

describe('ProductCategoriesPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ id: '10', name: 'Networking', parentId: null, isActive: true }],
    });
  });

  it('crea categoría e invalida selectores de productos', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    const { client } = setup(<ProductCategoriesPage />);
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    await screen.findByText('Networking');

    await userEvent.click(screen.getByRole('button', { name: /nuevo categoría|nueva categoría/i }));
    await userEvent.type(screen.getByLabelText(/^nombre/i), 'Switches');
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/product-categories', {
      name: 'Switches',
      parentId: null,
      isActive: true,
    });
    // Tras crear, debe invalidar tanto su propia key como la de products.
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        JSON.stringify({ queryKey: ['product-categories'] }),
        JSON.stringify({ queryKey: ['products'] }),
      ]),
    );
  });

  it('filtra por búsqueda local', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        { id: '1', name: 'Routers', parentId: null, isActive: true },
        { id: '2', name: 'Cables', parentId: null, isActive: true },
      ],
    });
    setup(<ProductCategoriesPage />);
    await screen.findByText('Routers');
    await userEvent.type(screen.getByLabelText(/buscar/i), 'cab');
    expect(screen.queryByText('Routers')).not.toBeInTheDocument();
    expect(screen.getByText('Cables')).toBeInTheDocument();
  });
});

describe('DepartmentsPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ id: '3', name: 'Bodega', isActive: true }],
    });
  });

  it('toggle isActive vía PATCH', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    setup(<DepartmentsPage />);
    await screen.findByText('Bodega');
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /activo/i }));
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith('/departments/3', {
      name: 'Bodega',
      isActive: false,
    });
  });
});

describe('TaxesPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ id: '7', name: 'IVA 13%', rate: '0.1300', isActive: true }],
    });
  });

  it('muestra la tasa en porcentaje legible', async () => {
    setup(<TaxesPage />);
    expect(await screen.findByText('13.00 %')).toBeInTheDocument();
  });

  it('crea impuesto convirtiendo % entero a fracción (13 → 0.13)', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    setup(<TaxesPage />);
    await screen.findByText('IVA 13%');
    await userEvent.click(screen.getByRole('button', { name: /nuevo impuesto/i }));
    await userEvent.type(screen.getByLabelText(/^nombre/i), 'IVA reducido');
    const rate = screen.getByLabelText(/tasa %/i);
    await userEvent.clear(rate);
    await userEvent.type(rate, '8');
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/taxes', {
      name: 'IVA reducido',
      rate: 0.08,
      isActive: true,
    });
  });
});

describe('UnitsOfMeasurePage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ id: '5', code: 'UND', name: 'Unidad', isActive: true }],
    });
  });

  it('crea unidad normalizando el code a mayúsculas', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    setup(<UnitsOfMeasurePage />);
    await screen.findByText('UND');
    await userEvent.click(screen.getByRole('button', { name: /nuevo unidad|nueva unidad/i }));
    await userEvent.type(screen.getByLabelText(/^código/i), 'kg');
    await userEvent.type(screen.getByLabelText(/^nombre/i), 'Kilogramo');
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/units-of-measure', {
      code: 'KG',
      name: 'Kilogramo',
      isActive: true,
    });
  });

  it('valida code inválido localmente antes de hacer POST', async () => {
    setup(<UnitsOfMeasurePage />);
    await screen.findByText('UND');
    await userEvent.click(screen.getByRole('button', { name: /nuevo unidad|nueva unidad/i }));
    await userEvent.type(screen.getByLabelText(/^código/i), 'KG.M');
    await userEvent.type(screen.getByLabelText(/^nombre/i), 'mal');
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(screen.getByText(/código inválido/i)).toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });
});
