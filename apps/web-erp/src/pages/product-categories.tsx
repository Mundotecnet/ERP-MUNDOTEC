import { useQuery } from '@tanstack/react-query';

import { ActiveBadge, CatalogField, CatalogPage } from '@/components/catalog-page';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface Category {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
}

interface CreateForm {
  name: string;
  parentId: string;
  isActive: boolean;
}

interface UpdateForm {
  name: string;
  parentId: string;
  isActive: boolean;
}

function ParentSelect({
  value,
  onChange,
  excludeId,
}: {
  value: string;
  onChange(v: string): void;
  excludeId?: string;
}): JSX.Element {
  const q = useQuery<Category[]>({
    queryKey: ['product-categories'],
    queryFn: async () => (await api.get('/product-categories')).data,
  });
  const options = (q.data ?? []).filter((c) => c.id !== excludeId);
  return (
    <select
      id="cat-parent"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      <option value="">— Sin categoría padre —</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function ProductCategoriesPage(): JSX.Element {
  return (
    <CatalogPage<Category, CreateForm, UpdateForm>
      title="Categorías de producto"
      singular="categoría"
      endpoint="/product-categories"
      queryKey={['product-categories']}
      rowKey={(c) => c.id}
      rowLabel={(c) => c.name}
      search={{
        placeholder: 'Nombre de categoría',
        matches: (c, q) => c.name.toLowerCase().includes(q),
      }}
      // Cuando se crea/edita/borra una categoría, los selectores del form de
      // productos también deben refrescar.
      extraInvalidate={[['products']]}
      columns={[
        { header: 'Nombre', render: (c) => c.name },
        {
          header: 'Padre',
          render: (c) => (c.parentId ? <span className="font-mono">#{c.parentId}</span> : '—'),
        },
        { header: 'Estado', render: (c) => <ActiveBadge active={c.isActive} /> },
      ]}
      emptyCreate={() => ({ name: '', parentId: '', isActive: true })}
      rowToUpdate={(c) => ({
        name: c.name,
        parentId: c.parentId ?? '',
        isActive: c.isActive,
      })}
      renderCreateForm={({ values, setValues }) => (
        <div className="grid grid-cols-1 gap-4">
          <CatalogField label="Nombre" htmlFor="cat-name">
            <Input
              id="cat-name"
              autoFocus
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            />
          </CatalogField>
          <CatalogField label="Categoría padre (opcional)" htmlFor="cat-parent">
            <ParentSelect
              value={values.parentId}
              onChange={(parentId) => setValues((v) => ({ ...v, parentId }))}
            />
          </CatalogField>
          <label className="flex items-center gap-2 text-sm">
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
        <div className="grid grid-cols-1 gap-4">
          <CatalogField label="Nombre" htmlFor="cat-name-edit">
            <Input
              id="cat-name-edit"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            />
          </CatalogField>
          <CatalogField label="Categoría padre" htmlFor="cat-parent-edit">
            <ParentSelect
              value={values.parentId}
              onChange={(parentId) => setValues((v) => ({ ...v, parentId }))}
            />
          </CatalogField>
          <label className="flex items-center gap-2 text-sm">
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
        if (!f.name.trim()) return 'El nombre es requerido.';
        return {
          name: f.name.trim(),
          parentId: f.parentId || null,
          isActive: f.isActive,
        };
      }}
      buildUpdatePayload={(f) => {
        if (!f.name.trim()) return 'El nombre es requerido.';
        return {
          name: f.name.trim(),
          parentId: f.parentId || null,
          isActive: f.isActive,
        };
      }}
    />
  );
}
