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
  marginPct: string;
  minMarginPct: string;
  outOfMargin: boolean;
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

// Schema de la pestaña "General" — los campos de precio (costo, margen,
// precio, margen mínimo, moneda) viven exclusivamente en la pestaña "Precios"
// y se manejan vía PATCH /products/:id/pricing.
const productSchema = z.object({
  sku: z.string().min(1, 'Requerido').max(60),
  name: z.string().min(1, 'Requerido').max(200),
  barcode: z.string().max(60).optional(),
  description: z.string().optional(),
  uomId: z.string().min(1, 'Requerido'),
  categoryId: z.string().optional(),
  taxId: z.string().optional(),
  departmentId: z.string().optional(),
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
  // El estado de la pestaña Precios vive acá (lifted) para que en modo
  // creación el "Guardar" del form general también persista los precios sin
  // necesidad de fetch ni de id previo.
  const pricingForm = usePricingForm();

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
        // Crea producto primero, después aplica el pricing si el usuario
        // tocó algo en la pestaña Precios. El bug PR-33 era que la pestaña
        // intentaba GET /products/:id/pricing sin id — ahora la pestaña en
        // create modo es totalmente local y el id solo aparece tras el POST.
        const created = (await api.post('/products', payload)).data;
        if (pricingForm.isDirty()) {
          await api.patch(`/products/${created.id}/pricing`, pricingForm.buildPayload());
        }
        return created;
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

  const [activeTab, setActiveTab] = React.useState<'general' | 'pricing'>('general');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>{props.mode === 'create' ? 'Nuevo producto' : 'Editar producto'}</CardTitle>
          <div className="mt-3 flex gap-1 border-b">
            <TabButton
              active={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
              id="tab-general"
            >
              General
            </TabButton>
            <TabButton
              active={activeTab === 'pricing'}
              onClick={() => setActiveTab('pricing')}
              id="tab-pricing"
            >
              Precios
            </TabButton>
          </div>
        </CardHeader>
        <CardContent>
          {activeTab === 'general' && (
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
              <Field
                label="Departamento"
                htmlFor="departmentId"
                error={errors.departmentId?.message}
              >
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
          )}

          {activeTab === 'pricing' && (
            <PricingTab
              mode={props.mode}
              productId={props.productId}
              form={pricingForm}
              onClose={props.onClose}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TabButton(props: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  id: string;
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      id={props.id}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className={[
        'px-3 py-1.5 text-sm border-b-2 -mb-px',
        props.active
          ? 'border-primary text-primary font-medium'
          : 'border-transparent text-muted-foreground',
        props.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:text-foreground',
      ].join(' ')}
    >
      {props.children}
    </button>
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

// ============================================================================
// PR-32 — Pestaña Precios (costo, margen, precio, margen mínimo + historial)
// ============================================================================
// El margen es **sobre el precio de venta**: margin = (price - cost) / price.
// El recálculo es bidireccional en vivo: si el usuario edita precio el margen
// se actualiza; si edita margen el precio se actualiza. Cambiar costo
// recalcula el precio respetando el margen vigente (si > 0).
//
// TODO PR-33: el costo se derivará del kardex (promedio ponderado al recibir
// compras) y dejará de ser editable directamente desde acá. En PR-32 sigue
// siendo el valor inicial / manual del catálogo.

interface PricingView {
  productId: string;
  sku: string;
  name: string;
  priceCurrency: string;
  costPrice: string;
  salePrice: string;
  marginPct: string;
  minMarginPct: string;
  outOfMargin: boolean;
}

interface PricingHistoryEntry {
  id: string;
  changeType: string;
  source: string | null;
  reason: string | null;
  costValue: string | null;
  marginPct: string | null;
  oldValue: string | null;
  newValue: string;
  changedByName: string | null;
  changedAt: string;
}

function parseNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt4(n: number): string {
  if (!Number.isFinite(n)) return '';
  return n
    .toFixed(4)
    .replace(/\.?0+$/, '')
    .replace(/^$/, '0');
}

// Cliente: las mismas fórmulas del backend (pricing.formula.ts). Replicamos
// acá la versión número-flotante solo para la UI en vivo; el server tiene la
// versión decimal precisa y valida cualquier valor que mandemos.
function clientPriceFromMargin(cost: number, margin: number): number {
  if (!(cost > 0) || margin >= 1 || margin < 0) return 0;
  return cost / (1 - margin);
}
function clientMarginFromPrice(cost: number, price: number): number {
  if (!(price > 0) || price < cost) return 0;
  const raw = (price - cost) / price;
  return raw >= 0.9999 ? 0.9999 : raw;
}

interface PricingFormHandle {
  costStr: string;
  salePriceStr: string;
  marginPctStr: string;
  minMarginPctStr: string;
  reason: string;
  setReason(v: string): void;
  setMinMarginPctStr(v: string): void;
  onChangeCost(v: string): void;
  onChangePrice(v: string): void;
  onChangeMargin(v: string): void;
  hydrate(p: {
    costPrice: string;
    salePrice: string;
    marginPct: string;
    minMarginPct: string;
  }): void;
  isDirty(): boolean;
  buildPayload(): Record<string, string>;
}

function usePricingForm(): PricingFormHandle {
  const [costStr, setCostStr] = React.useState('0');
  const [salePriceStr, setSalePriceStr] = React.useState('0');
  const [marginPctStr, setMarginPctStr] = React.useState('0');
  const [minMarginPctStr, setMinMarginPctStr] = React.useState('0');
  const [reason, setReason] = React.useState('');

  const cost = parseNum(costStr);
  const margin = parseNum(marginPctStr);

  function onChangeCost(v: string) {
    setCostStr(v);
    const c = parseNum(v);
    if (c > 0 && margin > 0 && margin < 1) {
      setSalePriceStr(fmt4(clientPriceFromMargin(c, margin)));
    }
  }
  function onChangePrice(v: string) {
    setSalePriceStr(v);
    const p = parseNum(v);
    setMarginPctStr(fmt4(clientMarginFromPrice(cost, p)));
  }
  function onChangeMargin(v: string) {
    setMarginPctStr(v);
    const m = parseNum(v);
    setSalePriceStr(fmt4(clientPriceFromMargin(cost, m)));
  }

  function hydrate(p: {
    costPrice: string;
    salePrice: string;
    marginPct: string;
    minMarginPct: string;
  }) {
    setCostStr(p.costPrice);
    setSalePriceStr(p.salePrice);
    setMarginPctStr(p.marginPct);
    setMinMarginPctStr(p.minMarginPct);
  }

  function isDirty(): boolean {
    // En modo creación, sirve para decidir si vale la pena llamar a PATCH
    // /products/:id/pricing tras el POST. Si el usuario no tocó nada de
    // precios queda como '0' por defecto y omitimos el PATCH.
    return (
      costStr !== '0' ||
      salePriceStr !== '0' ||
      marginPctStr !== '0' ||
      minMarginPctStr !== '0' ||
      reason.trim().length > 0
    );
  }

  function buildPayload(): Record<string, string> {
    const payload: Record<string, string> = {
      costPrice: costStr,
      salePrice: salePriceStr,
      marginPct: marginPctStr,
      minMarginPct: minMarginPctStr,
    };
    if (reason.trim()) payload.reason = reason.trim();
    return payload;
  }

  return {
    costStr,
    salePriceStr,
    marginPctStr,
    minMarginPctStr,
    reason,
    setReason,
    setMinMarginPctStr,
    onChangeCost,
    onChangePrice,
    onChangeMargin,
    hydrate,
    isDirty,
    buildPayload,
  };
}

function PricingTab(props: {
  mode: 'create' | 'edit';
  productId: string | null;
  form: PricingFormHandle;
  onClose(): void;
}): JSX.Element {
  const { form } = props;
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const isEdit = props.mode === 'edit' && props.productId !== null;

  // Fetch del pricing existente y del historial: SOLO en edición. En creación
  // no hay productId todavía; cualquier GET acá tiraría 404 y la pestaña
  // mostraría error (el bug que motivó este PR).
  const pricingQ = useQuery<PricingView>({
    queryKey: ['pricing', props.productId],
    queryFn: async () => (await api.get(`/products/${props.productId}/pricing`)).data,
    enabled: isEdit,
  });
  const historyQ = useQuery<PricingHistoryEntry[]>({
    queryKey: ['pricing-history', props.productId],
    queryFn: async () => (await api.get(`/products/${props.productId}/pricing/history`)).data,
    enabled: isEdit,
  });

  // Hidrata el form solo cuando el server devuelve datos (no en creación).
  // Intencionalmente NO incluimos `form.hydrate` como dep: su identidad
  // cambia en cada render (closure sobre setState) y reejectaría el efecto
  // pisando lo que esté escribiendo el usuario.
  React.useEffect(() => {
    if (isEdit && pricingQ.data) {
      form.hydrate(pricingQ.data);
    }
  }, [isEdit, pricingQ.data]);

  const margin = parseNum(form.marginPctStr);
  const minMargin = parseNum(form.minMarginPctStr);
  const outOfMargin = minMargin > 0 && margin < minMargin;

  const mutation = useMutation({
    mutationFn: async () => {
      return (await api.patch(`/products/${props.productId}/pricing`, form.buildPayload())).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing', props.productId] });
      qc.invalidateQueries({ queryKey: ['pricing-history', props.productId] });
      qc.invalidateQueries({ queryKey: ['products'] });
      form.setReason('');
      setServerError(null);
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

  if (isEdit && pricingQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando precios…</p>;
  }
  if (isEdit && (pricingQ.error || !pricingQ.data)) {
    return <p className="text-sm text-destructive">No se pudieron cargar los precios.</p>;
  }

  // En creación, todavía no sabemos la moneda del producto (se asigna
  // server-side al hacer POST). Mostramos las etiquetas sin sufijo de moneda.
  const currency = isEdit && pricingQ.data ? pricingQ.data.priceCurrency : '';
  const currencyLabel = currency ? ` (${currency})` : '';

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {isEdit
          ? 'El margen se calcula sobre el precio de venta. Cambia cualquier campo y los demás se recalculan en vivo. El costo se guarda manualmente por ahora; en una próxima entrega lo derivaremos del kardex de compras (promedio ponderado).'
          : 'Define costo, margen, precio y margen mínimo para el nuevo producto. Se guardarán automáticamente cuando confirmes el producto desde la pestaña General. El recálculo es bidireccional: editás un campo y los otros se ajustan.'}
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={`Costo${currencyLabel}`} htmlFor="pricing-cost">
          <Input
            id="pricing-cost"
            inputMode="decimal"
            value={form.costStr}
            onChange={(e) => form.onChangeCost(e.target.value)}
          />
        </Field>
        <Field label="Margen %" htmlFor="pricing-margin">
          <Input
            id="pricing-margin"
            inputMode="decimal"
            value={form.marginPctStr}
            onChange={(e) => form.onChangeMargin(e.target.value)}
            aria-describedby="pricing-margin-hint"
          />
          <span id="pricing-margin-hint" className="text-xs text-muted-foreground">
            Fracción (0.30 = 30 %)
          </span>
        </Field>
        <Field label={`Precio venta${currencyLabel}`} htmlFor="pricing-price">
          <Input
            id="pricing-price"
            inputMode="decimal"
            value={form.salePriceStr}
            onChange={(e) => form.onChangePrice(e.target.value)}
          />
        </Field>
        <Field label="Margen mínimo %" htmlFor="pricing-min-margin">
          <Input
            id="pricing-min-margin"
            inputMode="decimal"
            value={form.minMarginPctStr}
            onChange={(e) => form.setMinMarginPctStr(e.target.value)}
          />
        </Field>
        {isEdit && (
          <Field label="Motivo del cambio (opcional)" htmlFor="pricing-reason" fullWidth>
            <Input
              id="pricing-reason"
              maxLength={250}
              value={form.reason}
              onChange={(e) => form.setReason(e.target.value)}
              placeholder="Ej.: ajuste por nueva lista de proveedor"
            />
          </Field>
        )}
      </div>

      {outOfMargin && (
        <div
          role="alert"
          data-testid="out-of-margin-badge"
          className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          ⚠ Fuera de margen: el margen efectivo ({(margin * 100).toFixed(2)} %) está por debajo del
          piso configurado ({(minMargin * 100).toFixed(2)} %).
        </div>
      )}

      {serverError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {serverError}
        </div>
      )}

      {isEdit && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cerrar
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando…' : 'Guardar precios'}
          </Button>
        </div>
      )}

      {isEdit && (
        <div className="mt-2">
          <h4 className="mb-2 text-sm font-semibold">Historial de cambios</h4>
          {historyQ.isLoading && <p className="text-xs text-muted-foreground">Cargando…</p>}
          {historyQ.data && historyQ.data.length === 0 && (
            <p className="text-xs text-muted-foreground">Sin movimientos registrados.</p>
          )}
          {historyQ.data && historyQ.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left uppercase text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Fecha</th>
                    <th className="py-1 pr-3 font-medium">Usuario</th>
                    <th className="py-1 pr-3 font-medium">Costo</th>
                    <th className="py-1 pr-3 font-medium">Margen</th>
                    <th className="py-1 pr-3 font-medium">Precio</th>
                    <th className="py-1 pr-3 font-medium">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {historyQ.data.map((h) => (
                    <tr key={h.id} className="border-b last:border-b-0">
                      <td className="py-1 pr-3 whitespace-nowrap">
                        {new Date(h.changedAt).toLocaleString()}
                      </td>
                      <td className="py-1 pr-3">{h.changedByName ?? '—'}</td>
                      <td className="py-1 pr-3">{h.costValue ?? '—'}</td>
                      <td className="py-1 pr-3">{h.marginPct ?? '—'}</td>
                      <td className="py-1 pr-3">{h.newValue}</td>
                      <td className="py-1 pr-3">{h.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
