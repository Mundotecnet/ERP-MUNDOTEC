import { ActiveBadge, CatalogField, CatalogPage } from '@/components/catalog-page';
import { Input } from '@/components/ui/input';

interface Department {
  id: string;
  name: string;
  isActive: boolean;
}

interface Form {
  name: string;
  isActive: boolean;
}

export function DepartmentsPage(): JSX.Element {
  return (
    <CatalogPage<Department, Form, Form>
      title="Departamentos"
      singular="departamento"
      endpoint="/departments"
      queryKey={['departments']}
      rowKey={(d) => d.id}
      rowLabel={(d) => d.name}
      search={{
        placeholder: 'Nombre del departamento',
        matches: (d, q) => d.name.toLowerCase().includes(q),
      }}
      extraInvalidate={[['products']]}
      columns={[
        { header: 'Nombre', render: (d) => d.name },
        { header: 'Estado', render: (d) => <ActiveBadge active={d.isActive} /> },
      ]}
      emptyCreate={() => ({ name: '', isActive: true })}
      rowToUpdate={(d) => ({ name: d.name, isActive: d.isActive })}
      renderCreateForm={({ values, setValues }) => (
        <DeptForm values={values} setValues={setValues} />
      )}
      renderUpdateForm={({ values, setValues }) => (
        <DeptForm values={values} setValues={setValues} />
      )}
      buildCreatePayload={(f) => {
        if (!f.name.trim()) return 'El nombre es requerido.';
        return { name: f.name.trim(), isActive: f.isActive };
      }}
      buildUpdatePayload={(f) => {
        if (!f.name.trim()) return 'El nombre es requerido.';
        return { name: f.name.trim(), isActive: f.isActive };
      }}
    />
  );
}

function DeptForm({
  values,
  setValues,
}: {
  values: Form;
  setValues: React.Dispatch<React.SetStateAction<Form>>;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4">
      <CatalogField label="Nombre" htmlFor="dept-name">
        <Input
          id="dept-name"
          autoFocus
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />
      </CatalogField>
      <label className="flex items-center gap-2 text-sm">
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
