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

interface ReceiptLine {
  id: string;
  productId: string;
  productSku: string;
  quantity: string;
  unitCost: string;
}
interface GoodsReceipt {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  warehouseId: string;
  warehouseCode: string;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  lines: ReceiptLine[];
}

interface POLine {
  id: string;
  productId: string;
  productSku: string;
  quantity: string;
  receivedQty: string;
  unitCost: string;
}
interface PurchaseOrder {
  id: string;
  orderNumber: string;
  status: string;
  supplierName: string;
  warehouseId?: string | null;
  lines: POLine[];
}

interface Warehouse {
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

type Mode = 'po' | 'direct';

const receiptSchema = z
  .object({
    mode: z.enum(['po', 'direct']),
    purchaseOrderId: z.string().optional(),
    warehouseId: z.string().min(1, 'Requerido'),
    receiptNumber: z.string().min(1, 'Requerido').max(30),
    receiptDate: z.string().optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().min(1, 'Requerido'),
          quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Decimal > 0'),
          unitCost: z.string().optional(),
        }),
      )
      .min(1, 'Al menos una línea'),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'po' && !v.purchaseOrderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Seleccione una OC',
        path: ['purchaseOrderId'],
      });
    }
    if (v.mode === 'direct') {
      v.lines.forEach((l, idx) => {
        if (!l.unitCost || !/^\d+(\.\d{1,4})?$/.test(l.unitCost)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Costo unitario requerido en recepción sin OC',
            path: ['lines', idx, 'unitCost'],
          });
        }
      });
    }
  });
type ReceiptFormValues = z.infer<typeof receiptSchema>;

export function ReceiptsPage(): JSX.Element {
  const qc = useQueryClient();
  const [poFilter, setPoFilter] = React.useState('');
  const [warehouseFilter, setWarehouseFilter] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [viewing, setViewing] = React.useState<GoodsReceipt | null>(null);
  const [creating, setCreating] = React.useState(false);

  const params = new URLSearchParams();
  if (poFilter) params.set('purchaseOrderId', poFilter);
  if (warehouseFilter) params.set('warehouseId', warehouseFilter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const receiptsQ = useQuery<GoodsReceipt[]>({
    queryKey: ['goods-receipts', qs],
    queryFn: async () => (await api.get(`/goods-receipts${qs ? `?${qs}` : ''}`)).data,
  });
  const warehousesQ = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });
  const productsQ = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/products')).data,
  });
  const approvedPOsQ = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', 'approved'],
    queryFn: async () => (await api.get('/purchase-orders?status=APPROVED')).data,
  });

  async function openView(r: GoodsReceipt) {
    const detail = (await api.get(`/goods-receipts/${r.id}`)).data as GoodsReceipt;
    setViewing(detail);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Recepciones de mercancía</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nueva recepción
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-po">Orden de compra</Label>
              <SelectInput id="f-po" value={poFilter} onChange={(e) => setPoFilter(e.target.value)}>
                <option value="">— Todas —</option>
                {(approvedPOsQ.data ?? []).map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.orderNumber} — {po.supplierName}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-wh">Almacén</Label>
              <SelectInput
                id="f-wh"
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
              >
                <option value="">— Todos —</option>
                {(warehousesQ.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </SelectInput>
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

          {receiptsQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!receiptsQ.isLoading && (receiptsQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin recepciones.</p>
          )}
          {(receiptsQ.data ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Nº</th>
                    <th className="py-2 pr-4 font-medium">Fecha</th>
                    <th className="py-2 pr-4 font-medium">Almacén</th>
                    <th className="py-2 pr-4 font-medium">OC</th>
                    <th className="py-2 pr-4 font-medium text-right">Líneas</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {receiptsQ.data!.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs">{r.receiptNumber}</td>
                      <td className="py-2 pr-4 text-xs">{r.receiptDate}</td>
                      <td className="py-2 pr-4">{r.warehouseCode}</td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {r.purchaseOrderNumber ?? (
                          <span className="text-muted-foreground">Manual</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">{r.lines.length}</td>
                      <td className="py-2 pr-4 text-right">
                        <Button size="sm" variant="ghost" onClick={() => openView(r)}>
                          Ver
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

      {creating && (
        <ReceiptDialog
          warehouses={warehousesQ.data ?? []}
          products={(productsQ.data ?? []).filter((p) => p.isInventoried)}
          approvedPOs={approvedPOsQ.data ?? []}
          onClose={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['goods-receipts'] });
          }}
        />
      )}
      {viewing && <ReceiptViewDialog receipt={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

interface ReceiptDialogProps {
  warehouses: Warehouse[];
  products: Product[];
  approvedPOs: PurchaseOrder[];
  onClose(): void;
}

function ReceiptDialog(props: ReceiptDialogProps): JSX.Element {
  const [mode, setMode] = React.useState<Mode>('po');
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      mode: 'po',
      purchaseOrderId: '',
      warehouseId: '',
      receiptNumber: '',
      receiptDate: '',
      lines: [{ productId: '', quantity: '0', unitCost: '' }],
    },
  });
  const { register, handleSubmit, control, watch, setValue, formState, reset } = form;
  const { errors, isSubmitting } = formState;
  const { fields, replace } = useFieldArray({ control, name: 'lines' });

  const selectedPoId = watch('purchaseOrderId');
  const selectedPo = props.approvedPOs.find((po) => po.id === selectedPoId);

  // Al seleccionar una OC, precarga líneas pendientes.
  React.useEffect(() => {
    if (mode !== 'po' || !selectedPo) return;
    const pending = selectedPo.lines
      .filter((l) => parseFloat(l.quantity) - parseFloat(l.receivedQty) > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: (parseFloat(l.quantity) - parseFloat(l.receivedQty)).toString(),
        unitCost: l.unitCost,
      }));
    if (pending.length > 0) replace(pending);
  }, [selectedPo, mode, replace]);

  function switchMode(next: Mode) {
    setMode(next);
    setValue('mode', next);
    if (next === 'direct') {
      setValue('purchaseOrderId', '');
      reset({
        mode: 'direct',
        purchaseOrderId: '',
        warehouseId: watch('warehouseId'),
        receiptNumber: watch('receiptNumber'),
        receiptDate: watch('receiptDate'),
        lines: [{ productId: '', quantity: '1', unitCost: '0' }],
      });
    } else {
      reset({
        mode: 'po',
        purchaseOrderId: '',
        warehouseId: watch('warehouseId'),
        receiptNumber: watch('receiptNumber'),
        receiptDate: watch('receiptDate'),
        lines: [{ productId: '', quantity: '0', unitCost: '' }],
      });
    }
  }

  const mutation = useMutation({
    mutationFn: async (v: ReceiptFormValues) => {
      const payload = {
        purchaseOrderId: v.mode === 'po' ? v.purchaseOrderId : undefined,
        warehouseId: v.warehouseId,
        receiptNumber: v.receiptNumber,
        receiptDate: v.receiptDate || undefined,
        lines: v.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: v.mode === 'direct' ? l.unitCost : l.unitCost || undefined,
        })),
      };
      return (await api.post('/goods-receipts', payload)).data;
    },
    onSuccess: () => props.onClose(),
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
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Nueva recepción</CardTitle>
          <div className="mt-4 flex gap-2 border-b">
            <ModeBtn active={mode === 'po'} onClick={() => switchMode('po')}>
              Contra orden de compra
            </ModeBtn>
            <ModeBtn active={mode === 'direct'} onClick={() => switchMode('direct')}>
              Recepción directa
            </ModeBtn>
          </div>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            noValidate
            className="flex flex-col gap-4"
          >
            <input type="hidden" {...register('mode')} value={mode} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {mode === 'po' && (
                <Field
                  label="Orden de compra"
                  htmlFor="r-po"
                  error={errors.purchaseOrderId?.message}
                  fullWidth
                >
                  <SelectInput id="r-po" {...register('purchaseOrderId')}>
                    <option value="">— Seleccionar —</option>
                    {props.approvedPOs.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.orderNumber} — {po.supplierName}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              )}
              <Field label="Almacén" htmlFor="r-wh" error={errors.warehouseId?.message}>
                <SelectInput id="r-wh" {...register('warehouseId')}>
                  <option value="">— Seleccionar —</option>
                  {props.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Nº recepción" htmlFor="r-num" error={errors.receiptNumber?.message}>
                <Input id="r-num" {...register('receiptNumber')} />
              </Field>
              <Field label="Fecha" htmlFor="r-date" error={errors.receiptDate?.message}>
                <Input id="r-date" type="date" {...register('receiptDate')} />
              </Field>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Líneas</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-2 font-medium">Producto</th>
                      <th className="py-2 pr-2 font-medium text-right">Cantidad</th>
                      <th className="py-2 pr-2 font-medium text-right">
                        Costo unitario {mode === 'po' && '(opc.)'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, idx) => (
                      <tr key={field.id} className="border-b last:border-b-0">
                        <td className="py-1 pr-2">
                          {mode === 'po' ? (
                            <Input
                              readOnly
                              aria-label={`Producto línea ${idx + 1}`}
                              value={
                                props.products.find((p) => p.id === watch(`lines.${idx}.productId`))
                                  ?.sku ?? ''
                              }
                            />
                          ) : (
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
                          )}
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
                          {errors.lines?.[idx]?.quantity && (
                            <span className="text-xs text-destructive">
                              {errors.lines[idx]?.quantity?.message}
                            </span>
                          )}
                        </td>
                        <td className="py-1 pr-2">
                          <Input
                            inputMode="decimal"
                            aria-label={`Costo línea ${idx + 1}`}
                            {...register(`lines.${idx}.unitCost`)}
                          />
                          {errors.lines?.[idx]?.unitCost && (
                            <span className="text-xs text-destructive">
                              {errors.lines[idx]?.unitCost?.message}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mode === 'po' && selectedPo && fields.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Esta orden no tiene líneas pendientes por recibir.
                </p>
              )}
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
                {mutation.isPending ? 'Guardando…' : 'Confirmar recepción'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ReceiptViewDialog({
  receipt,
  onClose,
}: {
  receipt: GoodsReceipt;
  onClose(): void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recepción {receipt.receiptNumber}</CardTitle>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <div className="flex flex-col">
              <span className="text-xs uppercase text-muted-foreground">Fecha</span>
              <span>{receipt.receiptDate}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs uppercase text-muted-foreground">Almacén</span>
              <span>{receipt.warehouseCode}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs uppercase text-muted-foreground">OC</span>
              <span className="font-mono">{receipt.purchaseOrderNumber ?? 'Manual'}</span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-2 font-medium">SKU</th>
                <th className="py-2 pr-2 font-medium text-right">Cantidad</th>
                <th className="py-2 pr-2 font-medium text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 font-mono text-xs">{l.productSku}</td>
                  <td className="py-2 pr-2 text-right">{l.quantity}</td>
                  <td className="py-2 pr-2 text-right">{l.unitCost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function ModeBtn(props: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        'px-3 py-2 text-sm font-medium transition-colors',
        props.active
          ? 'border-b-2 border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
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
    <div className={`flex flex-col gap-1 ${props.fullWidth ? 'md:col-span-3' : ''}`}>
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
    className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className ?? ''}`}
    {...props}
  />
));
SelectInput.displayName = 'SelectInput';
