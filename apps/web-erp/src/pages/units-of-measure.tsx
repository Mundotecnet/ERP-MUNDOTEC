import { ActiveBadge, CatalogField, CatalogPage } from '@/components/catalog-page';
import { Input } from '@/components/ui/input';

interface Uom {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface CreateForm {
  code: string;
  name: string;
  isActive: boolean;
}

interface UpdateForm {
  code: string;
  name: string;
  isActive: boolean;
}

const CODE_RE = /^[A-Z0-9_-]{1,10}$/;

export function UnitsOfMeasurePage(): JSX.Element {
  return (
    <CatalogPage<Uom, CreateForm, UpdateForm>
      title="Unidades de medida"
      singular="unidad"
      endpoint="/units-of-measure"
      queryKey={['uoms']}
      rowKey={(u) => u.id}
      rowLabel={(u) => `${u.code} — ${u.name}`}
      search={{
        placeholder: 'Código o nombre',
        matches: (u, q) => u.code.toLowerCase().includes(q) || u.name.toLowerCase().includes(q),
      }}
      extraInvalidate={[['products']]}
      columns={[
        { header: 'Código', render: (u) => <span className="font-mono">{u.code}</span> },
        { header: 'Nombre', render: (u) => u.name },
        { header: 'Estado', render: (u) => <ActiveBadge active={u.isActive} /> },
      ]}
      emptyCreate={() => ({ code: '', name: '', isActive: true })}
      rowToUpdate={(u) => ({ code: u.code, name: u.name, isActive: u.isActive })}
      renderCreateForm={({ values, setValues }) => (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CatalogField
            label="Código"
            htmlFor="uom-code"
            hint="Mayúsculas, dígitos, guion o guion bajo (máx. 10)."
          >
            <Input
              id="uom-code"
              autoFocus
              maxLength={10}
              value={values.code}
              onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
            />
          </CatalogField>
          <CatalogField label="Nombre" htmlFor="uom-name">
            <Input
              id="uom-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
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
          <CatalogField
            label="Código"
            htmlFor="uom-code-edit"
            hint="Mayúsculas, dígitos, guion o guion bajo (máx. 10)."
          >
            <Input
              id="uom-code-edit"
              maxLength={10}
              value={values.code}
              onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
            />
          </CatalogField>
          <CatalogField label="Nombre" htmlFor="uom-name-edit">
            <Input
              id="uom-name-edit"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
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
        if (!CODE_RE.test(f.code))
          return 'Código inválido. Mayúsculas, dígitos, guion o guion bajo.';
        if (!f.name.trim()) return 'El nombre es requerido.';
        return { code: f.code, name: f.name.trim(), isActive: f.isActive };
      }}
      buildUpdatePayload={(f) => {
        if (!CODE_RE.test(f.code))
          return 'Código inválido. Mayúsculas, dígitos, guion o guion bajo.';
        if (!f.name.trim()) return 'El nombre es requerido.';
        return { code: f.code, name: f.name.trim(), isActive: f.isActive };
      }}
    />
  );
}
