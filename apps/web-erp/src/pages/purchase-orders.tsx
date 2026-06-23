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

const PO_STATUSES = ['DRAFT', 'APPROVED', 'RECEIVED', 'CANCELLED'] as const;
type PoStatus = (typeof PO_STATUSES)[number];
type StatusFilter = '' | PoStatus;

interface POLine {
  id: string;
  productId: string;
  productSku: string;
  quantity: string;
  receivedQty: string;
  unitCost: string;
  taxRate: string;
  lineTotal: string;
}

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  status: PoStatus;
  supplierId: string;
  supplierName: string;
  branchId: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  baseTotal: string;
  notes: string | null;
  lines: POLine[];
}

interface Partner {
  id: string;
  legalName: string;
  partnerType: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  currencyCode: string;
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
interface CompanyOverview {
  currencyCode: string;
}

const lineSchema = z.object({
  productId: z.string().min(1, 'Requerido'),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Decimal > 0'),
  unitCost: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0'),
  taxRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0')
    .optional(),
});

const poSchema = z.object({
  supplierId: z.string().min(1, 'Requerido'),
  branchId: z.string().optional(),
  orderNumber: z.string().min(1, 'Requerido').max(30),
  orderDate: z.string().optional(),
  expectedDate: z.string().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'ISO 3 letras'),
  exchangeRate: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Decimal > 0')
    .optional(),
  notes: z.string().max(300).optional(),
  lines: z.array(lineSchema).min(1, 'Al menos una línea'),
});
type POFormValues = z.infer<typeof poSchema>;

const STATUS_STYLE: Record<PoStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  APPROVED: 'bg-blue-100 text-blue-800',
  RECEIVED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

export function PurchaseOrdersPage(): JSX.Element {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('');
  const [supplierFilter, setSupplierFilter] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [editing, setEditing] = React.useState<PurchaseOrder | null>(null);
  const [viewing, setViewing] = React.useState<PurchaseOrder | null>(null);
  const [creating, setCreating] = React.useState(false);

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (supplierFilter) params.set('supplierId', supplierFilter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const ordersQ = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', qs],
    queryFn: async () => (await api.get(`/purchase-orders${qs ? `?${qs}` : ''}`)).data,
  });
  const partnersQ = useQuery<Partner[]>({
    queryKey: ['partners', 'suppliers'],
    queryFn: async () => (await api.get('/partners?type=SUPPLIER')).data,
  });
  const branchesQ = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  const productsQ = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/products')).data,
  });
  const companyQ = useQuery<CompanyOverview>({
    queryKey: ['company'],
    queryFn: async () => (await api.get('/companies/current')).data,
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
  const cancelMut = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/purchase-orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });

  function close() {
    setEditing(null);
    setCreating(false);
    setViewing(null);
  }

  async function openEdit(po: PurchaseOrder) {
    const detail = (await api.get(`/purchase-orders/${po.id}`)).data as PurchaseOrder;
    setEditing(detail);
  }
  async function openView(po: PurchaseOrder) {
    const detail = (await api.get(`/purchase-orders/${po.id}`)).data as PurchaseOrder;
    setViewing(detail);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Órdenes de compra</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nueva OC
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-supplier">Proveedor</Label>
              <Select
                id="f-supplier"
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
              >
                <option value="">— Todos —</option>
                {(partnersQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.legalName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-from">Desde</Label>
              <Input
                id="f-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-to">Hasta</Label>
              <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-1">
            <StatusChip active={statusFilter === ''} onClick={() => setStatusFilter('')}>
              Todos
            </StatusChip>
            {PO_STATUSES.map((s) => (
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
                    <th className="py-2 pr-4 font-medium">Proveedor</th>
                    <th className="py-2 pr-4 font-medium">Estado</th>
                    <th className="py-2 pr-4 font-medium text-right">Total</th>
                    <th className="py-2 pr-4 font-medium" aria-label="acciones" />
                  </tr>
                </thead>
                <tbody>
                  {ordersQ.data!.map((po) => (
                    <tr key={po.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs">{po.orderNumber}</td>
                      <td className="py-2 pr-4 text-xs">{po.orderDate}</td>
                      <td className="py-2 pr-4">{po.supplierName}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[po.status]}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {po.total} {po.currencyCode}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {po.status === 'DRAFT' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(po)}>
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Aprobar OC ${po.orderNumber}?`))
                                  approveMut.mutate(po.id);
                              }}
                            >
                              Aprobar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Eliminar OC ${po.orderNumber}?`))
                                  deleteMut.mutate(po.id);
                              }}
                            >
                              Eliminar
                            </Button>
                          </>
                        )}
                        {po.status === 'APPROVED' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openView(po)}>
                              Ver
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Cancelar OC ${po.orderNumber}?`))
                                  cancelMut.mutate(po.id);
                              }}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                        {(po.status === 'RECEIVED' || po.status === 'CANCELLED') && (
                          <Button size="sm" variant="ghost" onClick={() => openView(po)}>
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
        <POEditorDialog
          mode={creating ? 'create' : 'edit'}
          po={editing}
          suppliers={(partnersQ.data ?? []).filter(
            (p) => p.partnerType === 'SUPPLIER' || p.partnerType === 'BOTH',
          )}
          branches={branchesQ.data ?? []}
          products={(productsQ.data ?? []).filter((p) => p.isInventoried)}
          companyCurrency={companyQ.data?.currencyCode ?? 'USD'}
          onClose={close}
        />
      )}
      {viewing && <POViewDialog po={viewing} onClose={close} />}
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

interface POEditorProps {
  mode: 'create' | 'edit';
  po: PurchaseOrder | null;
  suppliers: Partner[];
  branches: Branch[];
  products: Product[];
  companyCurrency: string;
  onClose(): void;
}

function POEditorDialog(props: POEditorProps): JSX.Element {
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<POFormValues>({
    resolver: zodResolver(poSchema),
    defaultValues: props.po
      ? {
          supplierId: props.po.supplierId,
          branchId: props.po.branchId ?? '',
          orderNumber: props.po.orderNumber,
          orderDate: props.po.orderDate,
          expectedDate: props.po.expectedDate ?? '',
          currencyCode: props.po.currencyCode,
          exchangeRate: props.po.exchangeRate,
          notes: props.po.notes ?? '',
          lines: props.po.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            taxRate: l.taxRate,
          })),
        }
      : {
          supplierId: '',
          branchId: '',
          orderNumber: '',
          orderDate: '',
          expectedDate: '',
          currencyCode: props.companyCurrency,
          exchangeRate: '1',
          notes: '',
          lines: [{ productId: '', quantity: '1', unitCost: '0', taxRate: '0' }],
        },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const currency = watch('currencyCode');
  const lines = watch('lines');
  const needsExchangeRate = currency !== props.companyCurrency;

  // Totales client-side (informativos; el server recalcula al guardar).
  const totals = React.useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const q = parseFloat(l.quantity || '0');
      const c = parseFloat(l.unitCost || '0');
      const r = parseFloat(l.taxRate || '0');
      if (Number.isFinite(q) && Number.isFinite(c)) {
        subtotal += q * c;
        if (Number.isFinite(r)) tax += q * c * r;
      }
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [lines]);

  const mutation = useMutation({
    mutationFn: async (v: POFormValues) => {
      const payload = {
        supplierId: v.supplierId,
        branchId: v.branchId?.trim() ? v.branchId.trim() : null,
        orderNumber: v.orderNumber,
        orderDate: v.orderDate || undefined,
        expectedDate: v.expectedDate || undefined,
        currencyCode: v.currencyCode,
        exchangeRate: needsExchangeRate ? v.exchangeRate : undefined,
        notes: v.notes?.trim() ? v.notes.trim() : null,
        lines: v.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          taxRate: l.taxRate ?? '0',
        })),
      };
      if (props.mode === 'create') return (await api.post('/purchase-orders', payload)).data;
      return (await api.patch(`/purchase-orders/${props.po!.id}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
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
          <CardTitle>{props.mode === 'create' ? 'Nueva orden de compra' : 'Editar OC'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            noValidate
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Proveedor" htmlFor="po-sup" error={errors.supplierId?.message}>
                <SelectInput id="po-sup" {...register('supplierId')}>
                  <option value="">— Seleccionar —</option>
                  {props.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.legalName}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Sucursal" htmlFor="po-br" error={errors.branchId?.message}>
                <SelectInput id="po-br" {...register('branchId')}>
                  <option value="">— Sin sucursal —</option>
                  {props.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Nº orden" htmlFor="po-num" error={errors.orderNumber?.message}>
                <Input id="po-num" {...register('orderNumber')} />
              </Field>
              <Field label="Fecha" htmlFor="po-date" error={errors.orderDate?.message}>
                <Input id="po-date" type="date" {...register('orderDate')} />
              </Field>
              <Field label="Fecha esperada" htmlFor="po-exp" error={errors.expectedDate?.message}>
                <Input id="po-exp" type="date" {...register('expectedDate')} />
              </Field>
              <Field label="Moneda" htmlFor="po-cur" error={errors.currencyCode?.message}>
                <Input
                  id="po-cur"
                  maxLength={3}
                  {...register('currencyCode', {
                    setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                  })}
                />
              </Field>
              {needsExchangeRate && (
                <Field label="Tipo de cambio" htmlFor="po-er" error={errors.exchangeRate?.message}>
                  <Input id="po-er" inputMode="decimal" {...register('exchangeRate')} />
                </Field>
              )}
              <Field label="Notas" htmlFor="po-notes" error={errors.notes?.message} fullWidth>
                <Input id="po-notes" {...register('notes')} />
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
                    append({ productId: '', quantity: '1', unitCost: '0', taxRate: '0' })
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
                      <th className="py-2 pr-2 font-medium text-right">Costo</th>
                      <th className="py-2 pr-2 font-medium text-right">Imp. %</th>
                      <th className="py-2 pr-2 font-medium text-right">Total línea</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, idx) => {
                      const q = parseFloat(lines[idx]?.quantity || '0');
                      const c = parseFloat(lines[idx]?.unitCost || '0');
                      const r = parseFloat(lines[idx]?.taxRate || '0');
                      const lineTotal =
                        Number.isFinite(q) && Number.isFinite(c)
                          ? q * c * (1 + (Number.isFinite(r) ? r : 0))
                          : 0;
                      return (
                        <tr key={field.id} className="border-b last:border-b-0">
                          <td className="py-1 pr-2">
                            <SelectInput
                              aria-label={`Producto línea ${idx + 1}`}
                              {...register(`lines.${idx}.productId`)}
                            >
                              <option value="">— Seleccionar —</option>
                              {props.products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.sku} — {p.name}
                                </option>
                              ))}
                            </SelectInput>
                            {errors.lines?.[idx]?.productId && (
                              <span className="text-xs text-destructive">
                                {errors.lines[idx]?.productId?.message}
                              </span>
                            )}
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
                              aria-label={`Costo línea ${idx + 1}`}
                              {...register(`lines.${idx}.unitCost`)}
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

function POViewDialog({ po, onClose }: { po: PurchaseOrder; onClose(): void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            OC {po.orderNumber} —{' '}
            <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[po.status]}`}>
              {po.status}
            </span>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Info label="Proveedor" value={po.supplierName} />
            <Info label="Fecha" value={po.orderDate} />
            <Info label="Moneda" value={po.currencyCode} />
            <Info label="Tipo cambio" value={po.exchangeRate} />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-2 font-medium">SKU</th>
                <th className="py-2 pr-2 font-medium text-right">Cant.</th>
                <th className="py-2 pr-2 font-medium text-right">Recibida</th>
                <th className="py-2 pr-2 font-medium text-right">Costo</th>
                <th className="py-2 pr-2 font-medium text-right">Imp.</th>
                <th className="py-2 pr-2 font-medium text-right">Total línea</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 font-mono text-xs">{l.productSku}</td>
                  <td className="py-2 pr-2 text-right">{l.quantity}</td>
                  <td className="py-2 pr-2 text-right">{l.receivedQty}</td>
                  <td className="py-2 pr-2 text-right">{l.unitCost}</td>
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
                {po.subtotal} {po.currencyCode}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Impuestos</span>
              <span className="font-mono">{po.taxAmount}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Total</span>
              <span className="font-mono">{po.total}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Total en moneda base</span>
              <span className="font-mono">{po.baseTotal}</span>
            </div>
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
    <div className={`flex flex-col gap-1 ${props.fullWidth ? 'md:col-span-2' : ''}`}>
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
