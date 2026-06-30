import { ActiveBadge, CatalogField, CatalogPage } from '@/components/catalog-page';
import { Input } from '@/components/ui/input';

interface Currency {
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
  isActive: boolean;
}

interface CreateForm {
  code: string;
  name: string;
  symbol: string;
  decimals: string;
  isActive: boolean;
}

// `code` queda fuera del form de update: es la PK y se usa como FK por valor
// en company.currency_code, exchange_rate.currency_code y
// price_list.currency_code. Renombrarla rompería referencias en cascada;
// para sustituirla hay que crear otra y migrar manualmente.
interface UpdateForm {
  name: string;
  symbol: string;
  decimals: string;
  isActive: boolean;
}

function parseDecimals(s: string): number | null {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 6) return null;
  return n;
}

export function CurrenciesPage(): JSX.Element {
  return (
    <CatalogPage<Currency, CreateForm, UpdateForm>
      title="Monedas"
      singular="moneda"
      endpoint="/currencies"
      queryKey={['currencies']}
      rowKey={(c) => c.code}
      rowLabel={(c) => `${c.code} — ${c.name}`}
      columns={[
        { header: 'Código', render: (c) => <span className="font-mono">{c.code}</span> },
        { header: 'Nombre', render: (c) => c.name },
        { header: 'Símbolo', render: (c) => c.symbol ?? '—' },
        { header: 'Decimales', render: (c) => c.decimals },
        { header: 'Estado', render: (c) => <ActiveBadge active={c.isActive} /> },
      ]}
      emptyCreate={() => ({
        code: '',
        name: '',
        symbol: '',
        decimals: '2',
        isActive: true,
      })}
      rowToUpdate={(c) => ({
        name: c.name,
        symbol: c.symbol ?? '',
        decimals: String(c.decimals),
        isActive: c.isActive,
      })}
      renderCreateForm={({ values, setValues }) => (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CatalogField
            label="Código ISO"
            htmlFor="cur-code"
            hint="3 letras mayúsculas (ej. USD, CRC). Inmutable una vez creada."
          >
            <Input
              id="cur-code"
              maxLength={3}
              value={values.code}
              onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
              autoFocus
            />
          </CatalogField>
          <CatalogField label="Nombre" htmlFor="cur-name">
            <Input
              id="cur-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            />
          </CatalogField>
          <CatalogField label="Símbolo" htmlFor="cur-symbol">
            <Input
              id="cur-symbol"
              maxLength={6}
              value={values.symbol}
              onChange={(e) => setValues((v) => ({ ...v, symbol: e.target.value }))}
            />
          </CatalogField>
          <CatalogField label="Decimales" htmlFor="cur-decimals" hint="0 a 6">
            <Input
              id="cur-decimals"
              type="number"
              min={0}
              max={6}
              value={values.decimals}
              onChange={(e) => setValues((v) => ({ ...v, decimals: e.target.value }))}
            />
          </CatalogField>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(e) => setValues((v) => ({ ...v, isActive: e.target.checked }))}
            />
            Activa
          </label>
        </div>
      )}
      renderUpdateForm={({ values, setValues }) => (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CatalogField label="Nombre" htmlFor="cur-name-edit">
            <Input
              id="cur-name-edit"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            />
          </CatalogField>
          <CatalogField label="Símbolo" htmlFor="cur-symbol-edit">
            <Input
              id="cur-symbol-edit"
              maxLength={6}
              value={values.symbol}
              onChange={(e) => setValues((v) => ({ ...v, symbol: e.target.value }))}
            />
          </CatalogField>
          <CatalogField label="Decimales" htmlFor="cur-decimals-edit" hint="0 a 6">
            <Input
              id="cur-decimals-edit"
              type="number"
              min={0}
              max={6}
              value={values.decimals}
              onChange={(e) => setValues((v) => ({ ...v, decimals: e.target.value }))}
            />
          </CatalogField>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(e) => setValues((v) => ({ ...v, isActive: e.target.checked }))}
            />
            Activa
          </label>
        </div>
      )}
      buildCreatePayload={(f) => {
        if (!/^[A-Z]{3}$/.test(f.code)) return 'Código ISO-4217 de 3 letras mayúsculas.';
        if (!f.name.trim()) return 'El nombre es requerido.';
        const dec = parseDecimals(f.decimals);
        if (dec === null) return 'Decimales debe ser un entero entre 0 y 6.';
        return {
          code: f.code,
          name: f.name.trim(),
          symbol: f.symbol.trim() || null,
          decimals: dec,
          isActive: f.isActive,
        };
      }}
      buildUpdatePayload={(f) => {
        if (!f.name.trim()) return 'El nombre es requerido.';
        const dec = parseDecimals(f.decimals);
        if (dec === null) return 'Decimales debe ser un entero entre 0 y 6.';
        return {
          name: f.name.trim(),
          symbol: f.symbol.trim() || null,
          decimals: dec,
          isActive: f.isActive,
        };
      }}
    />
  );
}
