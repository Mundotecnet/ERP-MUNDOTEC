import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import * as React from 'react';
import {
  useFieldArray,
  useForm,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'] as const;
type QuoteStatus = (typeof QUOTE_STATUSES)[number];
type StatusFilter = '' | QuoteStatus;

interface QuoteLine {
  id: string;
  productId: string | null;
  productSku: string | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
  lineTotal: string;
  // PR-37 — nivel de precio aplicado al cotizar (informativo).
  priceListId: string | null;
  priceListName: string | null;
}

// PR-37 — vista de precios del producto (devuelta por GET /products/:id/pricing).
interface PricingLevelView {
  priceListId: string;
  name: string;
  salePrice: string;
  marginPct: string;
  outOfMargin: boolean;
}
interface ProductPricingView {
  productId: string;
  costPrice: string;
  minMarginPct: string;
  outOfMargin: boolean;
  levels: PricingLevelView[];
}

interface Quotation {
  id: string;
  quoteNumber: string;
  status: QuoteStatus;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  quoteDate: string;
  validUntil: string | null;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  baseTotal: string;
  notes: string | null;
  convertedSalesOrderId: string | null;
  lines: QuoteLine[];
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
  discountRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0')
    .optional(),
  taxRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal ≥ 0')
    .optional(),
  // PR-37 — opcional; cuando hay producto el LineRow lo defaultea a P1.
  priceListId: z.string().optional(),
});

const quoteSchema = z.object({
  customerId: z.string().optional(),
  branchId: z.string().optional(),
  salespersonId: z.string().optional(),
  quoteNumber: z.string().min(1, 'Requerido').max(30),
  quoteDate: z.string().optional(),
  validUntil: z.string().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'ISO 3 letras'),
  exchangeRate: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Decimal > 0')
    .optional(),
  notes: z.string().max(300).optional(),
  lines: z.array(lineSchema).min(1, 'Al menos una línea'),
});
type QuoteFormValues = z.infer<typeof quoteSchema>;

const STATUS_STYLE: Record<QuoteStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SENT: 'bg-blue-100 text-blue-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-orange-100 text-orange-800',
  CONVERTED: 'bg-purple-100 text-purple-800',
};

export function QuotationsPage(): JSX.Element {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('');
  const [customerFilter, setCustomerFilter] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [editing, setEditing] = React.useState<Quotation | null>(null);
  const [viewing, setViewing] = React.useState<Quotation | null>(null);
  const [converting, setConverting] = React.useState<Quotation | null>(null);
  const [creating, setCreating] = React.useState(false);

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (customerFilter) params.set('customerId', customerFilter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const quotesQ = useQuery<Quotation[]>({
    queryKey: ['quotations', qs],
    queryFn: async () => (await api.get(`/quotations${qs ? `?${qs}` : ''}`)).data,
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
  const usersQ = useQuery<AppUser[]>({
    queryKey: ['users', 'salespeople'],
    queryFn: async () => {
      const res = await api.get('/users?isSalesperson=true&pageSize=200');
      // /users responde paginado { data, total, page, pageSize }; otros endpoints planos.
      return Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
    },
  });
  const companyQ = useQuery<CompanyOverview>({
    queryKey: ['company'],
    queryFn: async () => (await api.get('/companies/current')).data,
  });

  const sendMut = useMutation({
    mutationFn: async (id: string) => api.post(`/quotations/${id}/send`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
  const acceptMut = useMutation({
    mutationFn: async (id: string) => api.post(`/quotations/${id}/accept`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
  const rejectMut = useMutation({
    mutationFn: async (id: string) => api.post(`/quotations/${id}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
  const expireMut = useMutation({
    mutationFn: async (id: string) => api.post(`/quotations/${id}/expire`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/quotations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });

  function close() {
    setEditing(null);
    setCreating(false);
    setViewing(null);
    setConverting(null);
  }

  async function openEdit(q: Quotation) {
    const detail = (await api.get(`/quotations/${q.id}`)).data as Quotation;
    setEditing(detail);
  }
  async function openView(q: Quotation) {
    const detail = (await api.get(`/quotations/${q.id}`)).data as Quotation;
    setViewing(detail);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Cotizaciones</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nueva cotización
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="q-f-customer">Cliente</Label>
              <Select
                id="q-f-customer"
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
              <Label htmlFor="q-f-from">Desde</Label>
              <Input
                id="q-f-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="q-f-to">Hasta</Label>
              <Input id="q-f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-1">
            <StatusChip active={statusFilter === ''} onClick={() => setStatusFilter('')}>
              Todos
            </StatusChip>
            {QUOTE_STATUSES.map((s) => (
              <StatusChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s}
              </StatusChip>
            ))}
          </div>

          {quotesQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!quotesQ.isLoading && (quotesQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin cotizaciones.</p>
          )}
          {(quotesQ.data ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Nº</th>
                    <th className="py-2 pr-4 font-medium">Fecha</th>
                    <th className="py-2 pr-4 font-medium">Cliente</th>
                    <th className="py-2 pr-4 font-medium">Estado</th>
                    <th className="py-2 pr-4 font-medium text-right">Total</th>
                    <th className="py-2 pr-4 font-medium" aria-label="acciones" />
                  </tr>
                </thead>
                <tbody>
                  {quotesQ.data!.map((q) => (
                    <tr key={q.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs">{q.quoteNumber}</td>
                      <td className="py-2 pr-4 text-xs">{q.quoteDate}</td>
                      <td className="py-2 pr-4">
                        {q.customerName ?? (
                          <span className="text-muted-foreground">(Prospecto)</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[q.status]}`}>
                          {q.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {q.total} {q.currencyCode}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {q.status === 'DRAFT' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(q)}>
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Enviar ${q.quoteNumber}?`)) sendMut.mutate(q.id);
                              }}
                            >
                              Enviar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Eliminar ${q.quoteNumber}?`)) deleteMut.mutate(q.id);
                              }}
                            >
                              Eliminar
                            </Button>
                          </>
                        )}
                        {q.status === 'SENT' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(q)}>
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Aceptar ${q.quoteNumber}?`)) acceptMut.mutate(q.id);
                              }}
                            >
                              Aceptar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Rechazar ${q.quoteNumber}?`)) rejectMut.mutate(q.id);
                              }}
                            >
                              Rechazar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Marcar ${q.quoteNumber} como expirada?`))
                                  expireMut.mutate(q.id);
                              }}
                            >
                              Expirar
                            </Button>
                          </>
                        )}
                        {q.status === 'ACCEPTED' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openView(q)}>
                              Ver
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConverting(q)}>
                              Convertir
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Rechazar ${q.quoteNumber}?`)) rejectMut.mutate(q.id);
                              }}
                            >
                              Rechazar
                            </Button>
                          </>
                        )}
                        {(q.status === 'REJECTED' ||
                          q.status === 'EXPIRED' ||
                          q.status === 'CONVERTED') && (
                          <Button size="sm" variant="ghost" onClick={() => openView(q)}>
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
        <QuoteEditorDialog
          mode={creating ? 'create' : 'edit'}
          quote={editing}
          customers={(Array.isArray(customersQ.data) ? customersQ.data : []).filter(
            (p) => p.partnerType === 'CUSTOMER' || p.partnerType === 'BOTH',
          )}
          branches={Array.isArray(branchesQ.data) ? branchesQ.data : []}
          products={Array.isArray(productsQ.data) ? productsQ.data : []}
          users={Array.isArray(usersQ.data) ? usersQ.data : []}
          companyCurrency={companyQ.data?.currencyCode ?? 'USD'}
          onClose={close}
        />
      )}
      {viewing && <QuoteViewDialog quote={viewing} onClose={close} />}
      {converting && <ConvertDialog quote={converting} onClose={close} />}
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
  quote: Quotation | null;
  customers: Partner[];
  branches: Branch[];
  products: Product[];
  users: AppUser[];
  companyCurrency: string;
  onClose(): void;
}

function QuoteEditorDialog(props: EditorProps): JSX.Element {
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const initial = props.quote;

  // Si el documento tiene un vendedor asignado que ya no aparece en la lista filtrada
  // (porque dejó de ser vendedor o quedó inactivo), lo inyectamos para no perder el valor.
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
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteSchema),
    defaultValues: initial
      ? {
          customerId: initial.customerId ?? '',
          branchId: initial.branchId ?? '',
          salespersonId: initial.salespersonId ?? '',
          quoteNumber: initial.quoteNumber,
          quoteDate: initial.quoteDate,
          validUntil: initial.validUntil ?? '',
          currencyCode: initial.currencyCode,
          exchangeRate: initial.exchangeRate,
          notes: initial.notes ?? '',
          lines: initial.lines.map((l) => ({
            productId: l.productId ?? '',
            description: l.description ?? '',
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountRate: l.discountRate,
            taxRate: l.taxRate,
            priceListId: l.priceListId ?? '',
          })),
        }
      : {
          customerId: '',
          branchId: '',
          salespersonId: '',
          quoteNumber: '',
          quoteDate: '',
          validUntil: '',
          currencyCode: props.companyCurrency,
          exchangeRate: '1',
          notes: '',
          lines: [
            {
              productId: '',
              description: '',
              quantity: '1',
              unitPrice: '0',
              discountRate: '0',
              taxRate: '0',
              priceListId: '',
            },
          ],
        },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const currency = watch('currencyCode');
  const lines = watch('lines');
  const needsExchangeRate = currency !== props.companyCurrency;

  // Totales client-side informativos.
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
        const lineTax = lineSub * (Number.isFinite(t) ? t : 0);
        subtotal += gross;
        discount += discValue;
        tax += lineTax;
      }
    }
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [lines]);

  const mutation = useMutation({
    mutationFn: async (v: QuoteFormValues) => {
      const payload = {
        customerId: v.customerId?.trim() ? v.customerId.trim() : null,
        branchId: v.branchId?.trim() ? v.branchId.trim() : null,
        salespersonId: v.salespersonId?.trim() ? v.salespersonId.trim() : null,
        quoteNumber: v.quoteNumber,
        quoteDate: v.quoteDate || undefined,
        validUntil: v.validUntil || undefined,
        currencyCode: v.currencyCode,
        exchangeRate: needsExchangeRate ? v.exchangeRate : undefined,
        notes: v.notes?.trim() ? v.notes.trim() : null,
        lines: v.lines.map((l) => ({
          productId: l.productId?.trim() ? l.productId.trim() : null,
          description: l.description?.trim() ? l.description.trim() : null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountRate: l.discountRate ?? '0',
          taxRate: l.taxRate ?? '0',
          priceListId: l.priceListId?.trim() ? l.priceListId.trim() : null,
        })),
      };
      if (props.mode === 'create') return (await api.post('/quotations', payload)).data;
      return (await api.patch(`/quotations/${props.quote!.id}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
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
          <CardTitle>
            {props.mode === 'create' ? 'Nueva cotización' : 'Editar cotización'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            noValidate
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Cliente (opcional)" htmlFor="q-cust" error={errors.customerId?.message}>
                <SelectInput id="q-cust" {...register('customerId')}>
                  <option value="">— Prospecto sin cliente —</option>
                  {customersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legalName}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Sucursal" htmlFor="q-br" error={errors.branchId?.message}>
                <SelectInput id="q-br" {...register('branchId')}>
                  <option value="">— Sin sucursal —</option>
                  {branchesList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Vendedor" htmlFor="q-sp" error={errors.salespersonId?.message}>
                <SelectInput id="q-sp" {...register('salespersonId')}>
                  <option value="">— Sin vendedor —</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Nº cotización" htmlFor="q-num" error={errors.quoteNumber?.message}>
                <Input id="q-num" {...register('quoteNumber')} />
              </Field>
              <Field label="Fecha" htmlFor="q-date" error={errors.quoteDate?.message}>
                <Input id="q-date" type="date" {...register('quoteDate')} />
              </Field>
              <Field label="Válida hasta" htmlFor="q-valid" error={errors.validUntil?.message}>
                <Input id="q-valid" type="date" {...register('validUntil')} />
              </Field>
              <Field label="Moneda" htmlFor="q-cur" error={errors.currencyCode?.message}>
                <Input
                  id="q-cur"
                  maxLength={3}
                  {...register('currencyCode', {
                    setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                  })}
                />
              </Field>
              {needsExchangeRate && (
                <Field label="Tipo de cambio" htmlFor="q-er" error={errors.exchangeRate?.message}>
                  <Input id="q-er" inputMode="decimal" {...register('exchangeRate')} />
                </Field>
              )}
              <Field label="Notas" htmlFor="q-notes" error={errors.notes?.message} fullWidth>
                <Input id="q-notes" {...register('notes')} />
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
                      description: '',
                      quantity: '1',
                      unitPrice: '0',
                      discountRate: '0',
                      taxRate: '0',
                      priceListId: '',
                    })
                  }
                >
                  + Línea
                </Button>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                Producto o descripción libre (al menos uno). Al elegir producto el nivel default es
                Precio 1; el precio se autocompleta y se puede sobreescribir.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-2 font-medium">Producto</th>
                      <th className="py-2 pr-2 font-medium">Descripción</th>
                      <th className="py-2 pr-2 font-medium">Nivel</th>
                      <th className="py-2 pr-2 font-medium text-right">Cant.</th>
                      <th className="py-2 pr-2 font-medium text-right">Precio</th>
                      <th className="py-2 pr-2 font-medium text-right">Margen ef.</th>
                      <th className="py-2 pr-2 font-medium text-right">Desc %</th>
                      <th className="py-2 pr-2 font-medium text-right">Imp %</th>
                      <th className="py-2 pr-2 font-medium text-right">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, idx) => (
                      <LineRow
                        key={field.id}
                        idx={idx}
                        register={register}
                        watch={watch}
                        setValue={setValue}
                        productsList={productsList}
                        showRemove={fields.length > 1}
                        onRemove={() => remove(idx)}
                      />
                    ))}
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

function QuoteViewDialog({ quote, onClose }: { quote: Quotation; onClose(): void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            Cotización {quote.quoteNumber} —{' '}
            <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[quote.status]}`}>
              {quote.status}
            </span>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Info label="Cliente" value={quote.customerName ?? '(Prospecto)'} />
            <Info label="Fecha" value={quote.quoteDate} />
            <Info label="Válida hasta" value={quote.validUntil ?? '—'} />
            <Info label="Vendedor" value={quote.salespersonName ?? '—'} />
            <Info label="Moneda" value={quote.currencyCode} />
            <Info label="Tipo cambio" value={quote.exchangeRate} />
            {quote.convertedSalesOrderId && (
              <Info label="OV creada" value={`#${quote.convertedSalesOrderId}`} />
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-2 font-medium">SKU/Desc.</th>
                <th className="py-2 pr-2 font-medium">Nivel</th>
                <th className="py-2 pr-2 font-medium text-right">Cant.</th>
                <th className="py-2 pr-2 font-medium text-right">Precio</th>
                <th className="py-2 pr-2 font-medium text-right">Desc</th>
                <th className="py-2 pr-2 font-medium text-right">Imp</th>
                <th className="py-2 pr-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 font-mono text-xs">
                    {l.productSku ?? l.description ?? '—'}
                  </td>
                  <td className="py-2 pr-2 text-xs">{l.priceListName ?? '—'}</td>
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
                {quote.subtotal} {quote.currencyCode}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Descuento</span>
              <span className="font-mono">-{quote.discountAmount}</span>
            </div>
            <div className="flex justify-between">
              <span>Impuestos</span>
              <span className="font-mono">{quote.taxAmount}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Total</span>
              <span className="font-mono">{quote.total}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Total en moneda base</span>
              <span className="font-mono">{quote.baseTotal}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConvertDialog({ quote, onClose }: { quote: Quotation; onClose(): void }): JSX.Element {
  const qc = useQueryClient();
  const [orderNumber, setOrderNumber] = React.useState('');
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [okMessage, setOkMessage] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/quotations/${quote.id}/convert`, {
        orderNumber: orderNumber.trim(),
      });
      return res.data as { salesOrder: { id: string; orderNumber: string } };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      setOkMessage(
        `Orden de venta ${data.salesOrder.orderNumber} creada (#${data.salesOrder.id}).`,
      );
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
            'No se pudo convertir.')
          : 'No se pudo convertir.';
      setServerError(msg);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Convertir {quote.quoteNumber} en orden de venta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Se creará una orden de venta en estado DRAFT con las líneas de la cotización (las líneas
            libres sin producto se omiten).
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="conv-num">Nº orden de venta</Label>
            <Input
              id="conv-num"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="SO-001"
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
              <Button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !orderNumber.trim()}
              >
                {mutation.isPending ? 'Convirtiendo…' : 'Convertir'}
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

// ============================================================================
// PR-37 — Fila de línea con selector de nivel + autocompletar precio + margen
// ============================================================================
// Cada fila tiene su propio hook de fetch a /products/:id/pricing (cacheado
// por React Query: una sola request por producto único en la cotización).
// Comportamiento:
// - Al elegir producto sin priceListId todavía → default Precio 1 y autocompleta.
// - Al cambiar nivel → autocompleta unitPrice con sale_price de ese nivel.
// - Si el usuario sobreescribe manualmente unitPrice → se respeta; el priceListId
//   no se desasocia (queda como "nivel de referencia").
// - Margen efectivo: (price - cost) / price * 100, solo cuando hay producto y
//   pricing cargado y price > cost.

function LineRow(props: {
  idx: number;
  register: UseFormRegister<QuoteFormValues>;
  watch: UseFormWatch<QuoteFormValues>;
  setValue: UseFormSetValue<QuoteFormValues>;
  productsList: Product[];
  showRemove: boolean;
  onRemove(): void;
}): JSX.Element {
  const { idx, register, watch, setValue, productsList, showRemove, onRemove } = props;
  const productId = watch(`lines.${idx}.productId`) ?? '';
  const priceListId = watch(`lines.${idx}.priceListId`) ?? '';
  const unitPriceStr = watch(`lines.${idx}.unitPrice`) ?? '0';
  const quantityStr = watch(`lines.${idx}.quantity`) ?? '0';
  const discountStr = watch(`lines.${idx}.discountRate`) ?? '0';
  const taxStr = watch(`lines.${idx}.taxRate`) ?? '0';

  const pricingQ = useQuery<ProductPricingView>({
    queryKey: ['pricing', productId],
    queryFn: async () => (await api.get(`/products/${productId}/pricing`)).data,
    enabled: !!productId,
  });

  // 1) Default a Precio 1 cuando llega pricing y la línea no tiene nivel.
  React.useEffect(() => {
    // Guard: el mock por defecto en tests devuelve {data:[]} para URLs no
    // mockeadas; .levels[] crashearía sin el `?.levels` defensivo.
    if (!pricingQ.data?.levels || priceListId) return;
    const first = pricingQ.data.levels[0];
    if (!first) return;
    setValue(`lines.${idx}.priceListId`, first.priceListId, { shouldDirty: true });
    setValue(`lines.${idx}.unitPrice`, first.salePrice, { shouldDirty: true });
  }, [pricingQ.data, productId]);

  // 2) Cuando el usuario cambia el nivel, autocompleta el precio.
  React.useEffect(() => {
    if (!pricingQ.data?.levels || !priceListId) return;
    const lvl = pricingQ.data.levels.find((l) => l.priceListId === priceListId);
    if (!lvl) return;
    if (unitPriceStr !== lvl.salePrice) {
      setValue(`lines.${idx}.unitPrice`, lvl.salePrice, { shouldDirty: true });
    }
  }, [pricingQ.data, priceListId]);

  const q = parseFloat(quantityStr || '0');
  const p = parseFloat(unitPriceStr || '0');
  const d = parseFloat(discountStr || '0');
  const t = parseFloat(taxStr || '0');
  const lineTotal =
    Number.isFinite(q) && Number.isFinite(p)
      ? q * p * (1 - (Number.isFinite(d) ? d : 0)) * (1 + (Number.isFinite(t) ? t : 0))
      : 0;

  // Margen efectivo de la línea: (price - cost) / price.
  const cost = pricingQ.data ? parseFloat(pricingQ.data.costPrice) : NaN;
  const effectiveMargin =
    Number.isFinite(cost) && cost > 0 && p > 0 && p >= cost ? ((p - cost) / p) * 100 : null;

  return (
    <tr className="border-b last:border-b-0" data-testid={`quote-line-row-${idx}`}>
      <td className="py-1 pr-2">
        <SelectInput
          aria-label={`Producto línea ${idx + 1}`}
          {...register(`lines.${idx}.productId`)}
        >
          <option value="">— (descripción libre) —</option>
          {productsList.map((prod) => (
            <option key={prod.id} value={prod.id}>
              {prod.sku} — {prod.name}
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
        <SelectInput
          aria-label={`Nivel línea ${idx + 1}`}
          data-testid={`quote-line-level-${idx}`}
          disabled={!productId || !pricingQ.data}
          {...register(`lines.${idx}.priceListId`)}
        >
          <option value="">—</option>
          {(pricingQ.data?.levels ?? []).map((lvl) => (
            <option key={lvl.priceListId} value={lvl.priceListId}>
              {lvl.name}
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
      <td
        className="py-1 pr-2 text-right text-xs tabular-nums"
        data-testid={`quote-line-margin-${idx}`}
      >
        {effectiveMargin === null ? '—' : `${effectiveMargin.toFixed(2)} %`}
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
      <td className="py-1 pr-2 text-right text-xs tabular-nums">{lineTotal.toFixed(4)}</td>
      <td className="py-1 text-right">
        {showRemove && (
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            🗑
          </Button>
        )}
      </td>
    </tr>
  );
}
