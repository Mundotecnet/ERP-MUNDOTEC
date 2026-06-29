import { ActiveBadge, CatalogField, CatalogPage } from '@/components/catalog-page';
import { Input } from '@/components/ui/input';

interface Tax {
  id: string;
  name: string;
  rate: string;
  isActive: boolean;
}

interface Form {
  name: string;
  ratePct: string;
  isActive: boolean;
}

function parsePct(s: string): number | null {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

export function TaxesPage(): JSX.Element {
  return (
    <CatalogPage<Tax, Form, Form>
      title="Impuestos"
      singular="impuesto"
      endpoint="/taxes"
      queryKey={['taxes']}
      rowKey={(t) => t.id}
      rowLabel={(t) => t.name}
      search={{
        placeholder: 'Nombre del impuesto',
        matches: (t, q) => t.name.toLowerCase().includes(q),
      }}
      extraInvalidate={[['products']]}
      columns={[
        { header: 'Nombre', render: (t) => t.name },
        {
          header: 'Tasa',
          render: (t) => `${(Number(t.rate) * 100).toFixed(2)} %`,
        },
        { header: 'Estado', render: (t) => <ActiveBadge active={t.isActive} /> },
      ]}
      emptyCreate={() => ({ name: '', ratePct: '13', isActive: true })}
      rowToUpdate={(t) => ({
        name: t.name,
        ratePct: (Number(t.rate) * 100).toString(),
        isActive: t.isActive,
      })}
      renderCreateForm={({ values, setValues }) => (
        <TaxForm values={values} setValues={setValues} />
      )}
      renderUpdateForm={({ values, setValues }) => (
        <TaxForm values={values} setValues={setValues} />
      )}
      buildCreatePayload={(f) => {
        if (!f.name.trim()) return 'El nombre es requerido.';
        const pct = parsePct(f.ratePct);
        if (pct === null) return 'La tasa debe estar entre 0 y 100.';
        // Backend espera fracción 0..1.
        return { name: f.name.trim(), rate: pct / 100, isActive: f.isActive };
      }}
      buildUpdatePayload={(f) => {
        if (!f.name.trim()) return 'El nombre es requerido.';
        const pct = parsePct(f.ratePct);
        if (pct === null) return 'La tasa debe estar entre 0 y 100.';
        return { name: f.name.trim(), rate: pct / 100, isActive: f.isActive };
      }}
    />
  );
}

function TaxForm({
  values,
  setValues,
}: {
  values: Form;
  setValues: React.Dispatch<React.SetStateAction<Form>>;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <CatalogField label="Nombre" htmlFor="tax-name">
        <Input
          id="tax-name"
          autoFocus
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />
      </CatalogField>
      <CatalogField label="Tasa %" htmlFor="tax-rate" hint="0 a 100 (ej. 13).">
        <Input
          id="tax-rate"
          inputMode="decimal"
          value={values.ratePct}
          onChange={(e) => setValues((v) => ({ ...v, ratePct: e.target.value }))}
        />
      </CatalogField>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(e) => setValues((v) => ({ ...v, isActive: e.target.checked }))}
        />
        Activo
      </label>
    </div>
  );
}
