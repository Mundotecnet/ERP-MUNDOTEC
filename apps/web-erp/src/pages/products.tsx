import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  uomId: string;
  taxId: string | null;
  costPrice: string;
  salePrice: string;
  priceCurrency: string;
  isInventoried: boolean;
  trackingType: string;
  warrantyMonths: number;
  minStock: string;
  maxStock: string;
  isActive: boolean;
  departmentId: string | null;
}

interface Category {
  id: string;
  name: string;
}
interface Uom {
  id: string;
  code: string;
  name: string;
}
interface Tax {
  id: string;
  name: string;
}
interface Department {
  id: string;
  name: string;
}

const TRACKING_TYPES = ['NONE', 'SERIAL', 'LOT'] as const;

const productSchema = z.object({
  sku: z.string().min(1, 'Requerido').max(60),
  name: z.string().min(1, 'Requerido').max(200),
  barcode: z.string().max(60).optional(),
  description: z.string().optional(),
  uomId: z.string().min(1, 'Requerido'),
  categoryId: z.string().optional(),
  taxId: z.string().optional(),
  departmentId: z.string().optional(),
  costPrice: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal con hasta 4 decimales')
    .optional(),
  salePrice: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal con hasta 4 decimales')
    .optional(),
  priceCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Código ISO de 3 letras')
    .optional(),
  trackingType: z.enum(TRACKING_TYPES).optional(),
  warrantyMonths: z.coerce.number().int().min(0).optional(),
  isInventoried: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
type ProductFormValues = z.infer<typeof productSchema>;

function emptyForm(): ProductFormValues {
  return {
    sku: '',
    name: '',
    barcode: '',
    description: '',
    uomId: '',
    categoryId: '',
    taxId: '',
    departmentId: '',
    costPrice: '0',
    salePrice: '0',
    priceCurrency: 'USD',
    trackingType: 'NONE',
    warrantyMonths: 0,
    isInventoried: true,
    isActive: true,
  };
}

function productToForm(p: Product): ProductFormValues {
  return {
    sku: p.sku,
    name: p.name,
    barcode: p.barcode ?? '',
    description: p.description ?? '',
    uomId: p.uomId,
    categoryId: p.categoryId ?? '',
    taxId: p.taxId ?? '',
    departmentId: p.departmentId ?? '',
    costPrice: p.costPrice,
    salePrice: p.salePrice,
    priceCurrency: p.priceCurrency,
    trackingType: p.trackingType as (typeof TRACKING_TYPES)[number],
    warrantyMonths: p.warrantyMonths,
    isInventoried: p.isInventoried,
    isActive: p.isActive,
  };
}

interface ApiPayload {
  sku: string;
  name: string;
  barcode: string | null;
  description: string | null;
  uomId: string;
  categoryId: string | null;
  taxId: string | null;
  departmentId: string | null;
  costPrice: string;
  salePrice: string;
  priceCurrency: string;
  trackingType: string;
  warrantyMonths: number;
  isInventoried: boolean;
  isActive: boolean;
}

function formToPayload(v: ProductFormValues): ApiPayload {
  return {
    sku: v.sku,
    name: v.name,
    barcode: v.barcode?.trim() ? v.barcode.trim() : null,
    description: v.description?.trim() ? v.description.trim() : null,
    uomId: v.uomId,
    categoryId: v.categoryId?.trim() ? v.categoryId.trim() : null,
    taxId: v.taxId?.trim() ? v.taxId.trim() : null,
    departmentId: v.departmentId?.trim() ? v.departmentId.trim() : null,
    costPrice: v.costPrice ?? '0',
    salePrice: v.salePrice ?? '0',
    priceCurrency: v.priceCurrency ?? 'USD',
    trackingType: v.trackingType ?? 'NONE',
    warrantyMonths: v.warrantyMonths ?? 0,
    isInventoried: v.isInventoried ?? true,
    isActive: v.isActive ?? true,
  };
}

export function ProductsPage(): JSX.Element {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [creating, setCreating] = React.useState(false);

  const productsQ = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/products')).data,
  });
  const categoriesQ = useQuery<Category[]>({
    queryKey: ['product-categories'],
    queryFn: async () => (await api.get('/product-categories')).data,
  });
  const uomsQ = useQuery<Uom[]>({
    queryKey: ['uoms'],
    queryFn: async () => (await api.get('/units-of-measure')).data,
  });
  const taxesQ = useQuery<Tax[]>({
    queryKey: ['taxes'],
    queryFn: async () => (await api.get('/taxes')).data,
  });
  const departmentsQ = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: async () => (await api.get('/departments')).data,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const list = productsQ.data ?? [];
  const filtered = React.useMemo(() => {
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode?.toLowerCase().includes(q) ?? false),
    );
  }, [list, search]);

  function onClose() {
    setEditing(null);
    setCreating(false);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Productos</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nuevo producto
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-1">
            <Label htmlFor="search">Buscar</Label>
            <Input
              id="search"
              placeholder="SKU, nombre o código de barras"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {productsQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {productsQ.error && (
            <p className="text-sm text-destructive">No se pudieron cargar los productos.</p>
          )}
          {!productsQ.isLoading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin resultados.</p>
          )}
          {filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">SKU</th>
                    <th className="py-2 pr-4 font-medium">Nombre</th>
                    <th className="py-2 pr-4 font-medium">Precio</th>
                    <th className="py-2 pr-4 font-medium">Tracking</th>
                    <th className="py-2 pr-4 font-medium">Activo</th>
                    <th className="py-2 pr-4 font-medium" aria-label="acciones" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs">{p.sku}</td>
                      <td className="py-2 pr-4">{p.name}</td>
                      <td className="py-2 pr-4">
                        {p.salePrice} {p.priceCurrency}
                      </td>
                      <td className="py-2 pr-4 text-xs">{p.trackingType}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            p.isActive
                              ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-800'
                              : 'rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                          }
                        >
                          {p.isActive ? 'Sí' : 'No'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`¿Eliminar "${p.name}"?`)) deleteMut.mutate(p.id);
                          }}
                        >
                          Eliminar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <ProductDialog
          mode={creating ? 'create' : 'edit'}
          initial={editing ? productToForm(editing) : emptyForm()}
          productId={editing?.id ?? null}
          categories={categoriesQ.data ?? []}
          uoms={uomsQ.data ?? []}
          taxes={taxesQ.data ?? []}
          departments={departmentsQ.data ?? []}
          onClose={onClose}
        />
      )}
    </>
  );
}

interface ProductDialogProps {
  mode: 'create' | 'edit';
  initial: ProductFormValues;
  productId: string | null;
  categories: Category[];
  uoms: Uom[];
  taxes: Tax[];
  departments: Department[];
  onClose: () => void;
}

function ProductDialog(props: ProductDialogProps): JSX.Element {
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: props.initial,
  });

  const mutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const payload = formToPayload(values);
      if (props.mode === 'create') {
        return (await api.post('/products', payload)).data;
      }
      return (await api.patch(`/products/${props.productId}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      props.onClose();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
            'No se pudo guardar.')
          : 'No se pudo guardar.';
      setServerError(msg);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{props.mode === 'create' ? 'Nuevo producto' : 'Editar producto'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            noValidate
          >
            <Field label="SKU" htmlFor="sku" error={errors.sku?.message}>
              <Input id="sku" {...register('sku')} />
            </Field>
            <Field label="Nombre" htmlFor="name" error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </Field>
            <Field label="Código de barras" htmlFor="barcode" error={errors.barcode?.message}>
              <Input id="barcode" {...register('barcode')} />
            </Field>
            <Field label="Unidad de medida" htmlFor="uomId" error={errors.uomId?.message}>
              <SelectInput id="uomId" {...register('uomId')}>
                <option value="">— Seleccionar —</option>
                {props.uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Categoría" htmlFor="categoryId" error={errors.categoryId?.message}>
              <SelectInput id="categoryId" {...register('categoryId')}>
                <option value="">— Sin categoría —</option>
                {props.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Impuesto" htmlFor="taxId" error={errors.taxId?.message}>
              <SelectInput id="taxId" {...register('taxId')}>
                <option value="">— Sin impuesto —</option>
                {props.taxes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Departamento" htmlFor="departmentId" error={errors.departmentId?.message}>
              <SelectInput id="departmentId" {...register('departmentId')}>
                <option value="">— Sin departamento —</option>
                {props.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Tracking" htmlFor="trackingType" error={errors.trackingType?.message}>
              <SelectInput id="trackingType" {...register('trackingType')}>
                {TRACKING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Costo" htmlFor="costPrice" error={errors.costPrice?.message}>
              <Input id="costPrice" inputMode="decimal" {...register('costPrice')} />
            </Field>
            <Field label="Precio venta" htmlFor="salePrice" error={errors.salePrice?.message}>
              <Input id="salePrice" inputMode="decimal" {...register('salePrice')} />
            </Field>
            <Field label="Moneda" htmlFor="priceCurrency" error={errors.priceCurrency?.message}>
              <Input
                id="priceCurrency"
                maxLength={3}
                {...register('priceCurrency', {
                  setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                })}
              />
            </Field>
            <Field
              label="Garantía (meses)"
              htmlFor="warrantyMonths"
              error={errors.warrantyMonths?.message}
            >
              <Input
                id="warrantyMonths"
                type="number"
                min={0}
                {...register('warrantyMonths', { valueAsNumber: true })}
              />
            </Field>

            <Field
              label="Descripción"
              htmlFor="description"
              error={errors.description?.message}
              fullWidth
            >
              <Input id="description" {...register('description')} />
            </Field>

            <div className="md:col-span-2 flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isInventoried')} />
                Se inventaría
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isActive')} />
                Activo
              </label>
            </div>

            {serverError && (
              <div className="md:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </div>
            )}

            <div className="md:col-span-2 flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={props.onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {mutation.isPending ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field(props: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}): JSX.Element {
  return (
    <div className={`flex flex-col gap-1 ${props.fullWidth ? 'md:col-span-2' : ''}`}>
      <Label htmlFor={props.htmlFor}>{props.label}</Label>
      {props.children}
      {props.error && <span className="text-xs text-destructive">{props.error}</span>}
    </div>
  );
}

const SelectInput = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`}
    {...props}
  />
));
SelectInput.displayName = 'SelectInput';
