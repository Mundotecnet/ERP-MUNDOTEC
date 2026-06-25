import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import * as React from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

const SO_STATUSES = ['DRAFT', 'CONFIRMED', 'INVOICED', 'CANCELLED'] as const;
type SoStatus = (typeof SO_STATUSES)[number];
type StatusFilter = '' | SoStatus;

interface SoLine {
  id: string;
  productId: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
  lineTotal: string;
}

interface SalesOrder {
  id: string;
  orderNumber: string;
  status: SoStatus;
  customerId: string;
  customerName: string;
  branchId: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  quotationId: string | null;
  quotationNumber: string | null;
  orderDate: string;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  baseTotal: string;
  notes: string | null;
  lines: SoLine[];
}

interface Partner {
  id: string;
  legalName: string;
  partnerType: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
}
interface Branch {
  id: string;
  code: string;
  name: string;
}
interface Product {
  id: string;
  sku: string;
  name: string;
  isInventoried: boolean;
}
interface Warehouse {
  id: string;
  code: string;
  name: string;
}
interface AppUser {
  id: string;
  fullName: string;
}
interface CompanyOverview {
  currencyCode: string;
}

const lineSchema = z.object({
  productId: z.string().min(1, 'Requerido'),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Decimal > 0'),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0'),
  discountRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0')
    .optional(),
  taxRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0')
    .optional(),
});

const soSchema = z.object({
  customerId: z.string().min(1, 'Requerido'),
  branchId: z.string().optional(),
  salespersonId: z.string().optional(),
  orderNumber: z.string().min(1, 'Requerido').max(30),
  orderDate: z.string().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'ISO 3 letras'),
  exchangeRate: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Decimal > 0')
    .optional(),
  notes: z.string().max(300).optional(),
  lines: z.array(lineSchema).min(1, 'Al menos una línea'),
});
type SoFormValues = z.infer<typeof soSchema>;

const STATUS_STYLE: Record<SoStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  INVOICED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

export function SalesOrdersPage(): JSX.Element {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('');
  const [customerFilter, setCustomerFilter] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [editing, setEditing] = React.useState<SalesOrder | null>(null);
  const [viewing, setViewing] = React.useState<SalesOrder | null>(null);
  const [invoicing, setInvoicing] = React.useState<SalesOrder | null>(null);
  const [creating, setCreating] = React.useState(false);

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (customerFilter) params.set('customerId', customerFilter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const ordersQ = useQuery<SalesOrder[]>({
    queryKey: ['sales-orders', qs],
    queryFn: async () => (await api.get(`/sales-orders${qs ? `?${qs}` : ''}`)).data,
  });
  const customersQ = useQuery<Partner[]>({
    queryKey: ['partners', 'customers'],
    queryFn: async () => (await api.get('/partners?type=CUSTOMER')).data,
  });
  const branchesQ = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  const productsQ = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/products')).data,
  });
  const warehousesQ = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });
  const usersQ = useQuery<AppUser[]>({
    queryKey: ['users', 'salespeople'],
    queryFn: async () => {
      const res = await api.get('/users?isSalesperson=true&pageSize=200');
      return Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
    },
  });
  const companyQ = useQuery<CompanyOverview>({
    queryKey: ['company'],
    queryFn: async () => (await api.get('/companies/current')).data,
  });

  const confirmMut = useMutation({
    mutationFn: async (id: string) => api.post(`/sales-orders/${id}/confirm`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }),
  });
  const cancelMut = useMutation({
    mutationFn: async (id: string) => api.post(`/sales-orders/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/sales-orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }),
  });

  function close() {
    setEditing(null);
    setCreating(false);
    setViewing(null);
    setInvoicing(null);
  }

  async function openEdit(so: SalesOrder) {
    const detail = (await api.get(`/sales-orders/${so.id}`)).data as SalesOrder;
    setEditing(detail);
  }
  async function openView(so: SalesOrder) {
    const detail = (await api.get(`/sales-orders/${so.id}`)).data as SalesOrder;
    setViewing(detail);
  }
  async function openInvoice(so: SalesOrder) {
    const detail = (await api.get(`/sales-orders/${so.id}`)).data as SalesOrder;
    setInvoicing(detail);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Órdenes de venta</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nueva OV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="so-f-customer">Cliente</Label>
              <Select
                id="so-f-customer"
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
              >
                <option value="">— Todos —</option>
                {(customersQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="so-f-from">Desde</Label>
              <Input
                id="so-f-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="so-f-to">Hasta</Label>
              <Input id="so-f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-1">
            <StatusChip active={statusFilter === ''} onClick={() => setStatusFilter('')}>
              Todos
            </StatusChip>
            {SO_STATUSES.map((s) => (
              <StatusChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s}
              </StatusChip>
            ))}
          </div>

          {ordersQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!ordersQ.isLoading && (ordersQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin órdenes.</p>
          )}
          {(ordersQ.data ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Nº</th>
                    <th className="py-2 pr-4 font-medium">Fecha</th>
                    <th className="py-2 pr-4 font-medium">Cliente</th>
                    <th className="py-2 pr-4 font-medium">Origen</th>
                    <th className="py-2 pr-4 font-medium">Estado</th>
                    <th className="py-2 pr-4 font-medium text-right">Total</th>
                    <th className="py-2 pr-4 font-medium" aria-label="acciones" />
                  </tr>
                </thead>
                <tbody>
                  {ordersQ.data!.map((so) => (
                    <tr key={so.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs">{so.orderNumber}</td>
                      <td className="py-2 pr-4 text-xs">{so.orderDate}</td>
                      <td className="py-2 pr-4">{so.customerName}</td>
                      <td className="py-2 pr-4 text-xs">
                        {so.quotationNumber ? (
                          <span className="font-mono">{so.quotationNumber}</span>
                        ) : (
                          <span className="text-muted-foreground">Directa</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[so.status]}`}>
                          {so.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {so.total} {so.currencyCode}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {so.status === 'DRAFT' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(so)}>
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Confirmar OV ${so.orderNumber}?`))
                                  confirmMut.mutate(so.id);
                              }}
                            >
                              Confirmar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Eliminar OV ${so.orderNumber}?`))
                                  deleteMut.mutate(so.id);
                              }}
                            >
                              Eliminar
                            </Button>
                          </>
                        )}
                        {so.status === 'CONFIRMED' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openView(so)}>
                              Ver
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openInvoice(so)}>
                              Facturar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Cancelar OV ${so.orderNumber}?`))
                                  cancelMut.mutate(so.id);
                              }}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                        {(so.status === 'INVOICED' || so.status === 'CANCELLED') && (
                          <Button size="sm" variant="ghost" onClick={() => openView(so)}>
                            Ver
                          </Button>
                        )}
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
        <SoEditorDialog
          mode={creating ? 'create' : 'edit'}
          so={editing}
          customers={(Array.isArray(customersQ.data) ? customersQ.data : []).filter(
            (p) => p.partnerType === 'CUSTOMER' || p.partnerType === 'BOTH',
          )}
          branches={Array.isArray(branchesQ.data) ? branchesQ.data : []}
          products={(Array.isArray(productsQ.data) ? productsQ.data : []).filter(
            (p) => p.isInventoried,
          )}
          users={Array.isArray(usersQ.data) ? usersQ.data : []}
          companyCurrency={companyQ.data?.currencyCode ?? 'USD'}
          onClose={close}
        />
      )}
      {viewing && <SoViewDialog so={viewing} onClose={close} />}
      {invoicing && (
        <InvoiceFromSoDialog
          so={invoicing}
          warehouses={Array.isArray(warehousesQ.data) ? warehousesQ.data : []}
          onClose={close}
        />
      )}
    </>
  );
}

function StatusChip(props: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        props.active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      {props.children}
    </button>
  );
}

interface EditorProps {
  mode: 'create' | 'edit';
  so: SalesOrder | null;
  customers: Partner[];
  branches: Branch[];
  products: Product[];
  users: AppUser[];
  companyCurrency: string;
  onClose(): void;
}

function SoEditorDialog(props: EditorProps): JSX.Element {
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const initial = props.so;

  const usersList = React.useMemo(() => {
    const base = Array.isArray(props.users) ? props.users : [];
    const saved = initial?.salespersonId;
    if (!saved || base.some((u) => u.id === saved)) return base;
    return [...base, { id: saved, fullName: initial?.salespersonName ?? '(usuario sin acceso)' }];
  }, [props.users, initial?.salespersonId, initial?.salespersonName]);
  const customersList = Array.isArray(props.customers) ? props.customers : [];
  const branchesList = Array.isArray(props.branches) ? props.branches : [];
  const productsList = Array.isArray(props.products) ? props.products : [];

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SoFormValues>({
    resolver: zodResolver(soSchema),
    defaultValues: initial
      ? {
          customerId: initial.customerId,
          branchId: initial.branchId ?? '',
          salespersonId: initial.salespersonId ?? '',
          orderNumber: initial.orderNumber,
          orderDate: initial.orderDate,
          currencyCode: initial.currencyCode,
          exchangeRate: initial.exchangeRate,
          notes: initial.notes ?? '',
          lines: initial.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountRate: l.discountRate,
            taxRate: l.taxRate,
          })),
        }
      : {
          customerId: '',
          branchId: '',
          salespersonId: '',
          orderNumber: '',
          orderDate: '',
          currencyCode: props.companyCurrency,
          exchangeRate: '1',
          notes: '',
          lines: [
            { productId: '', quantity: '1', unitPrice: '0', discountRate: '0', taxRate: '0' },
          ],
        },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const currency = watch('currencyCode');
  const lines = watch('lines');
  const needsExchangeRate = currency !== props.companyCurrency;

  const totals = React.useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    for (const l of lines) {
      const q = parseFloat(l.quantity || '0');
      const p = parseFloat(l.unitPrice || '0');
      const d = parseFloat(l.discountRate || '0');
      const t = parseFloat(l.taxRate || '0');
      if (Number.isFinite(q) && Number.isFinite(p)) {
        const gross = q * p;
        const discValue = gross * (Number.isFinite(d) ? d : 0);
        const lineSub = gross - discValue;
        subtotal += gross;
        discount += discValue;
        tax += lineSub * (Number.isFinite(t) ? t : 0);
      }
    }
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [lines]);

  const mutation = useMutation({
    mutationFn: async (v: SoFormValues) => {
      const payload = {
        customerId: v.customerId,
        branchId: v.branchId?.trim() ? v.branchId.trim() : null,
        salespersonId: v.salespersonId?.trim() ? v.salespersonId.trim() : null,
        orderNumber: v.orderNumber,
        orderDate: v.orderDate || undefined,
        currencyCode: v.currencyCode,
        exchangeRate: needsExchangeRate ? v.exchangeRate : undefined,
        notes: v.notes?.trim() ? v.notes.trim() : null,
        lines: v.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountRate: l.discountRate ?? '0',
          taxRate: l.taxRate ?? '0',
        })),
      };
      if (props.mode === 'create') return (await api.post('/sales-orders', payload)).data;
      return (await api.patch(`/sales-orders/${props.so!.id}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
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
      <Card className="w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>{props.mode === 'create' ? 'Nueva orden de venta' : 'Editar OV'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            noValidate
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Cliente" htmlFor="so-cust" error={errors.customerId?.message}>
                <SelectInput id="so-cust" {...register('customerId')}>
                  <option value="">— Seleccionar —</option>
                  {customersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legalName}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Sucursal" htmlFor="so-br" error={errors.branchId?.message}>
                <SelectInput id="so-br" {...register('branchId')}>
                  <option value="">— Sin sucursal —</option>
                  {branchesList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Vendedor" htmlFor="so-sp" error={errors.salespersonId?.message}>
                <SelectInput id="so-sp" {...register('salespersonId')}>
                  <option value="">— Sin vendedor —</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Nº orden" htmlFor="so-num" error={errors.orderNumber?.message}>
                <Input id="so-num" {...register('orderNumber')} />
              </Field>
              <Field label="Fecha" htmlFor="so-date" error={errors.orderDate?.message}>
                <Input id="so-date" type="date" {...register('orderDate')} />
              </Field>
              <Field label="Moneda" htmlFor="so-cur" error={errors.currencyCode?.message}>
                <Input
                  id="so-cur"
                  maxLength={3}
                  {...register('currencyCode', {
                    setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                  })}
                />
              </Field>
              {needsExchangeRate && (
                <Field label="Tipo de cambio" htmlFor="so-er" error={errors.exchangeRate?.message}>
                  <Input id="so-er" inputMode="decimal" {...register('exchangeRate')} />
                </Field>
              )}
              <Field label="Notas" htmlFor="so-notes" error={errors.notes?.message} fullWidth>
                <Input id="so-notes" {...register('notes')} />
              </Field>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">Líneas</h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    append({
                      productId: '',
                      quantity: '1',
                      unitPrice: '0',
                      discountRate: '0',
                      taxRate: '0',
                    })
                  }
                >
                  + Línea
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-2 font-medium">Producto</th>
                      <th className="py-2 pr-2 font-medium text-right">Cant.</th>
                      <th className="py-2 pr-2 font-medium text-right">Precio</th>
                      <th className="py-2 pr-2 font-medium text-right">Desc %</th>
                      <th className="py-2 pr-2 font-medium text-right">Imp %</th>
                      <th className="py-2 pr-2 font-medium text-right">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, idx) => {
                      const q = parseFloat(lines[idx]?.quantity || '0');
                      const p = parseFloat(lines[idx]?.unitPrice || '0');
                      const d = parseFloat(lines[idx]?.discountRate || '0');
                      const t = parseFloat(lines[idx]?.taxRate || '0');
                      const lineTotal =
                        Number.isFinite(q) && Number.isFinite(p)
                          ? q *
                            p *
                            (1 - (Number.isFinite(d) ? d : 0)) *
                            (1 + (Number.isFinite(t) ? t : 0))
                          : 0;
                      return (
                        <tr key={field.id} className="border-b last:border-b-0">
                          <td className="py-1 pr-2">
                            <SelectInput
                              aria-label={`Producto línea ${idx + 1}`}
                              {...register(`lines.${idx}.productId`)}
                            >
                              <option value="">— Seleccionar —</option>
                              {productsList.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.sku} — {p.name}
                                </option>
                              ))}
                            </SelectInput>
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              inputMode="decimal"
                              aria-label={`Cantidad línea ${idx + 1}`}
                              {...register(`lines.${idx}.quantity`)}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              inputMode="decimal"
                              aria-label={`Precio línea ${idx + 1}`}
                              {...register(`lines.${idx}.unitPrice`)}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              inputMode="decimal"
                              aria-label={`Descuento línea ${idx + 1}`}
                              {...register(`lines.${idx}.discountRate`)}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              inputMode="decimal"
                              aria-label={`Impuesto línea ${idx + 1}`}
                              {...register(`lines.${idx}.taxRate`)}
                            />
                          </td>
                          <td className="py-1 pr-2 text-right text-xs tabular-nums">
                            {lineTotal.toFixed(4)}
                          </td>
                          <td className="py-1 text-right">
                            {fields.length > 1 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => remove(idx)}
                              >
                                🗑
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {errors.lines && typeof errors.lines.message === 'string' && (
                <p className="mt-2 text-xs text-destructive">{errors.lines.message}</p>
              )}
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-mono">
                  {totals.subtotal.toFixed(4)} {currency}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Descuento</span>
                <span className="font-mono">-{totals.discount.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Impuestos</span>
                <span className="font-mono">{totals.tax.toFixed(4)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="font-mono">{totals.total.toFixed(4)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Estos totales son orientativos; el servidor los recalcula al guardar.
              </p>
            </div>

            {serverError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </div>
            )}
            <div className="flex justify-end gap-2">
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

function SoViewDialog({ so, onClose }: { so: SalesOrder; onClose(): void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            OV {so.orderNumber} —{' '}
            <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[so.status]}`}>
              {so.status}
            </span>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Info label="Cliente" value={so.customerName} />
            <Info label="Fecha" value={so.orderDate} />
            <Info label="Vendedor" value={so.salespersonName ?? '—'} />
            <Info label="Origen" value={so.quotationNumber ?? 'Directa'} />
            <Info label="Moneda" value={so.currencyCode} />
            <Info label="Tipo cambio" value={so.exchangeRate} />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-2 font-medium">SKU</th>
                <th className="py-2 pr-2 font-medium text-right">Cant.</th>
                <th className="py-2 pr-2 font-medium text-right">Precio</th>
                <th className="py-2 pr-2 font-medium text-right">Desc</th>
                <th className="py-2 pr-2 font-medium text-right">Imp</th>
                <th className="py-2 pr-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {so.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 font-mono text-xs">{l.productSku}</td>
                  <td className="py-2 pr-2 text-right">{l.quantity}</td>
                  <td className="py-2 pr-2 text-right">{l.unitPrice}</td>
                  <td className="py-2 pr-2 text-right">{l.discountRate}</td>
                  <td className="py-2 pr-2 text-right">{l.taxRate}</td>
                  <td className="py-2 pr-2 text-right">{l.lineTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-mono">
                {so.subtotal} {so.currencyCode}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Descuento</span>
              <span className="font-mono">-{so.discountAmount}</span>
            </div>
            <div className="flex justify-between">
              <span>Impuestos</span>
              <span className="font-mono">{so.taxAmount}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Total</span>
              <span className="font-mono">{so.total}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InvoiceFromSoDialog({
  so,
  warehouses,
  onClose,
}: {
  so: SalesOrder;
  warehouses: Warehouse[];
  onClose(): void;
}): JSX.Element {
  const qc = useQueryClient();
  const [invoiceNumber, setInvoiceNumber] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [okMessage, setOkMessage] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customerId: so.customerId,
        salesOrderId: so.id,
        warehouseId,
        invoiceNumber: invoiceNumber.trim(),
        currencyCode: so.currencyCode,
        exchangeRate: so.exchangeRate,
        lines: so.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
        })),
      };
      const res = await api.post('/invoices', payload);
      return res.data as { id: string; invoiceNumber: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      setOkMessage(`Factura ${data.invoiceNumber} emitida (#${data.id}).`);
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
            'No se pudo facturar.')
          : 'No se pudo facturar.';
      setServerError(msg);
    },
  });

  const canSubmit = invoiceNumber.trim().length > 0 && warehouseId.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Facturar OV {so.orderNumber}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Se emitirá una factura ISSUED con las {so.lines.length} línea(s) de la OV. El stock
            saldrá del almacén seleccionado y la OV pasará a INVOICED.
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="inv-wh">Almacén</Label>
            <SelectInput
              id="inv-wh"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">— Seleccionar —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </SelectInput>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="inv-num">Nº factura</Label>
            <Input
              id="inv-num"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="INV-001"
            />
          </div>
          {serverError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}
          {okMessage && (
            <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
              {okMessage}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {okMessage ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!okMessage && (
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !canSubmit}>
                {mutation.isPending ? 'Emitiendo…' : 'Emitir factura'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span>{value}</span>
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
    <div className={`flex flex-col gap-1 ${props.fullWidth ? 'md:col-span-3' : ''}`}>
      <Label htmlFor={props.htmlFor}>{props.label}</Label>
      {props.children}
      {props.error && <span className="text-xs text-destructive">{props.error}</span>}
    </div>
  );
}

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className ?? ''}`}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

const SelectInput = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className ?? ''}`}
    {...props}
  />
));
SelectInput.displayName = 'SelectInput';
