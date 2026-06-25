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

const INVOICE_STATUSES = ['ISSUED', 'PARTIAL', 'PAID', 'CANCELLED'] as const;
type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
type StatusFilter = '' | InvoiceStatus;

interface InvoiceLine {
  id: string;
  productId: string | null;
  productSku: string | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  lineTotal: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  customerId: string;
  customerName: string;
  branchId: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  baseTotal: string;
  paidAmount: string;
  balance: string;
  lines: InvoiceLine[];
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
  productId: z.string().optional(),
  description: z.string().max(250).optional(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Decimal > 0'),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0'),
  taxRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0')
    .optional(),
});

const invSchema = z.object({
  customerId: z.string().min(1, 'Requerido'),
  branchId: z.string().optional(),
  salespersonId: z.string().optional(),
  warehouseId: z.string().min(1, 'Requerido'),
  invoiceNumber: z.string().min(1, 'Requerido').max(40),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'ISO 3 letras'),
  exchangeRate: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Decimal > 0')
    .optional(),
  lines: z.array(lineSchema).min(1, 'Al menos una línea'),
});
type InvFormValues = z.infer<typeof invSchema>;

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  ISSUED: 'bg-blue-100 text-blue-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  PAID: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

export function InvoicesPage(): JSX.Element {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('');
  const [customerFilter, setCustomerFilter] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [viewing, setViewing] = React.useState<Invoice | null>(null);
  const [creating, setCreating] = React.useState(false);

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (customerFilter) params.set('customerId', customerFilter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const invoicesQ = useQuery<Invoice[]>({
    queryKey: ['invoices', qs],
    queryFn: async () => (await api.get(`/invoices${qs ? `?${qs}` : ''}`)).data,
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

  const cancelMut = useMutation({
    mutationFn: async (id: string) => api.post(`/invoices/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });

  function close() {
    setCreating(false);
    setViewing(null);
  }

  async function openView(i: Invoice) {
    const detail = (await api.get(`/invoices/${i.id}`)).data as Invoice;
    setViewing(detail);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Facturas</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nueva factura
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="inv-f-customer">Cliente</Label>
              <Select
                id="inv-f-customer"
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
              <Label htmlFor="inv-f-from">Desde</Label>
              <Input
                id="inv-f-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="inv-f-to">Hasta</Label>
              <Input id="inv-f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-1">
            <StatusChip active={statusFilter === ''} onClick={() => setStatusFilter('')}>
              Todos
            </StatusChip>
            {INVOICE_STATUSES.map((s) => (
              <StatusChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s}
              </StatusChip>
            ))}
          </div>

          {invoicesQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!invoicesQ.isLoading && (invoicesQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin facturas.</p>
          )}
          {(invoicesQ.data ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Nº</th>
                    <th className="py-2 pr-4 font-medium">Fecha</th>
                    <th className="py-2 pr-4 font-medium">Cliente</th>
                    <th className="py-2 pr-4 font-medium">OV</th>
                    <th className="py-2 pr-4 font-medium">Estado</th>
                    <th className="py-2 pr-4 font-medium text-right">Total</th>
                    <th className="py-2 pr-4 font-medium text-right">Balance</th>
                    <th className="py-2 pr-4 font-medium" aria-label="acciones" />
                  </tr>
                </thead>
                <tbody>
                  {invoicesQ.data!.map((i) => (
                    <tr key={i.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs">{i.invoiceNumber}</td>
                      <td className="py-2 pr-4 text-xs">{i.invoiceDate}</td>
                      <td className="py-2 pr-4">{i.customerName}</td>
                      <td className="py-2 pr-4 text-xs">
                        {i.salesOrderNumber ? (
                          <span className="font-mono">{i.salesOrderNumber}</span>
                        ) : (
                          <span className="text-muted-foreground">Directa</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[i.status]}`}>
                          {i.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {i.total} {i.currencyCode}
                      </td>
                      <td className="py-2 pr-4 text-right">{i.balance}</td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openView(i)}>
                          Ver
                        </Button>
                        {(i.status === 'ISSUED' || i.status === 'PARTIAL') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (
                                confirm(
                                  `Cancelar ${i.invoiceNumber}? El kardex NO se revierte automáticamente.`,
                                )
                              )
                                cancelMut.mutate(i.id);
                            }}
                          >
                            Cancelar
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

      {creating && (
        <InvoiceEditorDialog
          customers={(Array.isArray(customersQ.data) ? customersQ.data : []).filter(
            (p) => p.partnerType === 'CUSTOMER' || p.partnerType === 'BOTH',
          )}
          branches={Array.isArray(branchesQ.data) ? branchesQ.data : []}
          products={Array.isArray(productsQ.data) ? productsQ.data : []}
          warehouses={Array.isArray(warehousesQ.data) ? warehousesQ.data : []}
          users={Array.isArray(usersQ.data) ? usersQ.data : []}
          companyCurrency={companyQ.data?.currencyCode ?? 'USD'}
          onClose={close}
        />
      )}
      {viewing && <InvoiceViewDialog inv={viewing} onClose={close} />}
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
  customers: Partner[];
  branches: Branch[];
  products: Product[];
  warehouses: Warehouse[];
  users: AppUser[];
  companyCurrency: string;
  onClose(): void;
}

function InvoiceEditorDialog(props: EditorProps): JSX.Element {
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);

  // Las listas vienen guarded del page, pero blindamos por si el caller cambia.
  const customersList = Array.isArray(props.customers) ? props.customers : [];
  const branchesList = Array.isArray(props.branches) ? props.branches : [];
  const productsList = Array.isArray(props.products) ? props.products : [];
  const warehousesList = Array.isArray(props.warehouses) ? props.warehouses : [];
  const usersList = Array.isArray(props.users) ? props.users : [];

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<InvFormValues>({
    resolver: zodResolver(invSchema),
    defaultValues: {
      customerId: '',
      branchId: '',
      salespersonId: '',
      warehouseId: '',
      invoiceNumber: '',
      invoiceDate: '',
      dueDate: '',
      currencyCode: props.companyCurrency,
      exchangeRate: '1',
      lines: [{ productId: '', description: '', quantity: '1', unitPrice: '0', taxRate: '0' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const currency = watch('currencyCode');
  const lines = watch('lines');
  const needsExchangeRate = currency !== props.companyCurrency;

  const totals = React.useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const q = parseFloat(l.quantity || '0');
      const p = parseFloat(l.unitPrice || '0');
      const t = parseFloat(l.taxRate || '0');
      if (Number.isFinite(q) && Number.isFinite(p)) {
        const lineSub = q * p;
        subtotal += lineSub;
        tax += lineSub * (Number.isFinite(t) ? t : 0);
      }
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [lines]);

  const mutation = useMutation({
    mutationFn: async (v: InvFormValues) => {
      const payload = {
        customerId: v.customerId,
        branchId: v.branchId?.trim() ? v.branchId.trim() : null,
        salespersonId: v.salespersonId?.trim() ? v.salespersonId.trim() : null,
        warehouseId: v.warehouseId,
        invoiceNumber: v.invoiceNumber,
        invoiceDate: v.invoiceDate || undefined,
        dueDate: v.dueDate || undefined,
        currencyCode: v.currencyCode,
        exchangeRate: needsExchangeRate ? v.exchangeRate : undefined,
        lines: v.lines.map((l) => ({
          productId: l.productId?.trim() ? l.productId.trim() : null,
          description: l.description?.trim() ? l.description.trim() : null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate ?? '0',
        })),
      };
      return (await api.post('/invoices', payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      props.onClose();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
            'No se pudo emitir.')
          : 'No se pudo emitir.';
      setServerError(msg);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Emisión directa de factura</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            noValidate
            className="flex flex-col gap-4"
          >
            <p className="text-xs text-muted-foreground">
              Emite una factura sin orden de venta previa. Se ejecuta atómicamente: kardex baja
              según las líneas inventariadas; si una línea dejaría saldo negativo, nada se guarda.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Cliente" htmlFor="i-cust" error={errors.customerId?.message}>
                <SelectInput id="i-cust" {...register('customerId')}>
                  <option value="">— Seleccionar —</option>
                  {customersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legalName}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Almacén" htmlFor="i-wh" error={errors.warehouseId?.message}>
                <SelectInput id="i-wh" {...register('warehouseId')}>
                  <option value="">— Seleccionar —</option>
                  {warehousesList.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Sucursal" htmlFor="i-br" error={errors.branchId?.message}>
                <SelectInput id="i-br" {...register('branchId')}>
                  <option value="">— Sin sucursal —</option>
                  {branchesList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Vendedor" htmlFor="i-sp" error={errors.salespersonId?.message}>
                <SelectInput id="i-sp" {...register('salespersonId')}>
                  <option value="">— Sin vendedor —</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Nº factura" htmlFor="i-num" error={errors.invoiceNumber?.message}>
                <Input id="i-num" {...register('invoiceNumber')} />
              </Field>
              <Field label="Fecha" htmlFor="i-date" error={errors.invoiceDate?.message}>
                <Input id="i-date" type="date" {...register('invoiceDate')} />
              </Field>
              <Field label="Vencimiento" htmlFor="i-due" error={errors.dueDate?.message}>
                <Input id="i-due" type="date" {...register('dueDate')} />
              </Field>
              <Field label="Moneda" htmlFor="i-cur" error={errors.currencyCode?.message}>
                <Input
                  id="i-cur"
                  maxLength={3}
                  {...register('currencyCode', {
                    setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                  })}
                />
              </Field>
              {needsExchangeRate && (
                <Field label="Tipo de cambio" htmlFor="i-er" error={errors.exchangeRate?.message}>
                  <Input id="i-er" inputMode="decimal" {...register('exchangeRate')} />
                </Field>
              )}
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
                      description: '',
                      quantity: '1',
                      unitPrice: '0',
                      taxRate: '0',
                    })
                  }
                >
                  + Línea
                </Button>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                Producto o descripción libre (al menos uno). Las líneas de servicio (sin producto)
                no mueven kardex.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-2 font-medium">Producto</th>
                      <th className="py-2 pr-2 font-medium">Descripción</th>
                      <th className="py-2 pr-2 font-medium text-right">Cant.</th>
                      <th className="py-2 pr-2 font-medium text-right">Precio</th>
                      <th className="py-2 pr-2 font-medium text-right">Imp %</th>
                      <th className="py-2 pr-2 font-medium text-right">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, idx) => {
                      const q = parseFloat(lines[idx]?.quantity || '0');
                      const p = parseFloat(lines[idx]?.unitPrice || '0');
                      const t = parseFloat(lines[idx]?.taxRate || '0');
                      const lineTotal =
                        Number.isFinite(q) && Number.isFinite(p)
                          ? q * p * (1 + (Number.isFinite(t) ? t : 0))
                          : 0;
                      return (
                        <tr key={field.id} className="border-b last:border-b-0">
                          <td className="py-1 pr-2">
                            <SelectInput
                              aria-label={`Producto línea ${idx + 1}`}
                              {...register(`lines.${idx}.productId`)}
                            >
                              <option value="">— (descripción libre) —</option>
                              {productsList.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.sku} — {p.name}
                                </option>
                              ))}
                            </SelectInput>
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              aria-label={`Descripción línea ${idx + 1}`}
                              {...register(`lines.${idx}.description`)}
                            />
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
                Totales informativos; el servidor los recalcula al emitir.
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
                {mutation.isPending ? 'Emitiendo…' : 'Emitir factura'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function InvoiceViewDialog({ inv, onClose }: { inv: Invoice; onClose(): void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            Factura {inv.invoiceNumber} —{' '}
            <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[inv.status]}`}>
              {inv.status}
            </span>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Info label="Cliente" value={inv.customerName} />
            <Info label="Fecha" value={inv.invoiceDate} />
            <Info label="Vencimiento" value={inv.dueDate ?? '—'} />
            <Info label="OV" value={inv.salesOrderNumber ?? 'Directa'} />
            <Info label="Vendedor" value={inv.salespersonName ?? '—'} />
            <Info label="Moneda" value={inv.currencyCode} />
            <Info label="Tipo cambio" value={inv.exchangeRate} />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-2 font-medium">SKU/Desc.</th>
                <th className="py-2 pr-2 font-medium text-right">Cant.</th>
                <th className="py-2 pr-2 font-medium text-right">Precio</th>
                <th className="py-2 pr-2 font-medium text-right">Imp</th>
                <th className="py-2 pr-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 font-mono text-xs">
                    {l.productSku ?? l.description ?? '—'}
                  </td>
                  <td className="py-2 pr-2 text-right">{l.quantity}</td>
                  <td className="py-2 pr-2 text-right">{l.unitPrice}</td>
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
                {inv.subtotal} {inv.currencyCode}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Impuestos</span>
              <span className="font-mono">{inv.taxAmount}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Total</span>
              <span className="font-mono">{inv.total}</span>
            </div>
            <div className="flex justify-between">
              <span>Pagado</span>
              <span className="font-mono">{inv.paidAmount}</span>
            </div>
            <div className="flex justify-between text-orange-700 font-semibold">
              <span>Balance pendiente</span>
              <span className="font-mono">{inv.balance}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Total en moneda base</span>
              <span className="font-mono">{inv.baseTotal}</span>
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
