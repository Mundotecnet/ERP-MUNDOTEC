import { ActiveBadge, CatalogField, CatalogPage } from '@/components/catalog-page';
import { Input } from '@/components/ui/input';

interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

interface Form {
  code: string;
  name: string;
  address: string;
  phone: string;
  isActive: boolean;
}

export function BranchesPage(): JSX.Element {
  return (
    <CatalogPage<Branch, Form, Form>
      title="Sucursales"
      singular="sucursal"
      endpoint="/branches"
      queryKey={['branches']}
      rowKey={(b) => b.id}
      rowLabel={(b) => `${b.code} — ${b.name}`}
      search={{
        placeholder: 'Código o nombre',
        matches: (b, q) => b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
      }}
      // Los selectores del form de Usuarios usan queryKey ['branches'] — el
      // invalidate de la key principal ya los refresca. Sumamos ['users']
      // para que la tabla de Usuarios refleje sucursal-default si acaba de
      // desactivarse.
      extraInvalidate={[['users']]}
      columns={[
        { header: 'Código', render: (b) => <span className="font-mono">{b.code}</span> },
        { header: 'Nombre', render: (b) => b.name },
        { header: 'Dirección', render: (b) => b.address ?? '—' },
        { header: 'Teléfono', render: (b) => b.phone ?? '—' },
        { header: 'Estado', render: (b) => <ActiveBadge active={b.isActive} /> },
      ]}
      emptyCreate={() => ({ code: '', name: '', address: '', phone: '', isActive: true })}
      rowToUpdate={(b) => ({
        code: b.code,
        name: b.name,
        address: b.address ?? '',
        phone: b.phone ?? '',
        isActive: b.isActive,
      })}
      renderCreateForm={({ values, setValues }) => (
        <BranchForm values={values} setValues={setValues} />
      )}
      renderUpdateForm={({ values, setValues }) => (
        <BranchForm values={values} setValues={setValues} />
      )}
      buildCreatePayload={(f) => {
        if (!f.code.trim()) return 'El código es requerido.';
        if (!f.name.trim()) return 'El nombre es requerido.';
        return {
          code: f.code.trim(),
          name: f.name.trim(),
          address: f.address.trim() || null,
          phone: f.phone.trim() || null,
          isActive: f.isActive,
        };
      }}
      buildUpdatePayload={(f) => {
        if (!f.code.trim()) return 'El código es requerido.';
        if (!f.name.trim()) return 'El nombre es requerido.';
        return {
          code: f.code.trim(),
          name: f.name.trim(),
          address: f.address.trim() || null,
          phone: f.phone.trim() || null,
          isActive: f.isActive,
        };
      }}
    />
  );
}

function BranchForm({
  values,
  setValues,
}: {
  values: Form;
  setValues: React.Dispatch<React.SetStateAction<Form>>;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <CatalogField
        label="Código"
        htmlFor="br-code"
        hint="Identificador corto (máx. 20). Único por empresa."
      >
        <Input
          id="br-code"
          autoFocus
          maxLength={20}
          value={values.code}
          onChange={(e) => setValues((v) => ({ ...v, code: e.target.value }))}
        />
      </CatalogField>
      <CatalogField label="Nombre" htmlFor="br-name">
        <Input
          id="br-name"
          maxLength={150}
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />
      </CatalogField>
      <CatalogField label="Dirección" htmlFor="br-address">
        <Input
          id="br-address"
          maxLength={300}
          value={values.address}
          onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))}
        />
      </CatalogField>
      <CatalogField label="Teléfono" htmlFor="br-phone">
        <Input
          id="br-phone"
          maxLength={50}
          value={values.phone}
          onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
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
  );
}
