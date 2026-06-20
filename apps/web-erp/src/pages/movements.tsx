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
import { cn } from '@/lib/cn';

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
interface Movement {
  id: string;
  productId: string;
  productSku: string;
  warehouseId: string;
  warehouseCode: string;
  movementType: string;
  quantity: string;
  unitCost: string;
  balanceQty: string;
  movementDate: string;
  sourceDoc: string | null;
  notes: string | null;
}

const MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUST'] as const;
type Tab = 'movement' | 'transfer' | 'kardex';

const movementSchema = z.object({
  productId: z.string().min(1, 'Requerido'),
  warehouseId: z.string().min(1, 'Requerido'),
  movementType: z.enum(MOVEMENT_TYPES),
  quantity: z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Decimal con hasta 4 decimales'),
  unitCost: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal positivo con hasta 4 decimales')
    .optional(),
  notes: z.string().max(250).optional(),
});
type MovementFormValues = z.infer<typeof movementSchema>;

const transferSchema = z
  .object({
    productId: z.string().min(1, 'Requerido'),
    fromWarehouseId: z.string().min(1, 'Requerido'),
    toWarehouseId: z.string().min(1, 'Requerido'),
    quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Decimal positivo con hasta 4 decimales'),
    notes: z.string().max(250).optional(),
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    message: 'El almacén origen y destino deben ser distintos',
    path: ['toWarehouseId'],
  });
type TransferFormValues = z.infer<typeof transferSchema>;

export function MovementsPage(): JSX.Element {
  const [tab, setTab] = React.useState<Tab>('movement');

  const productsQ = useQuery<Product[]>({
    queryKey: ['products', 'inventoried'],
    queryFn: async () => (await api.get('/products')).data,
  });
  const warehousesQ = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });

  const inventoriedProducts = (productsQ.data ?? []).filter((p) => p.isInventoried);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Movimientos de inventario</CardTitle>
        <div className="mt-4 flex gap-2 border-b">
          <TabButton active={tab === 'movement'} onClick={() => setTab('movement')}>
            Nuevo movimiento
          </TabButton>
          <TabButton active={tab === 'transfer'} onClick={() => setTab('transfer')}>
            Transferencia
          </TabButton>
          <TabButton active={tab === 'kardex'} onClick={() => setTab('kardex')}>
            Kardex
          </TabButton>
        </div>
      </CardHeader>
      <CardContent>
        {tab === 'movement' && (
          <MovementForm products={inventoriedProducts} warehouses={warehousesQ.data ?? []} />
        )}
        {tab === 'transfer' && (
          <TransferForm products={inventoriedProducts} warehouses={warehousesQ.data ?? []} />
        )}
        {tab === 'kardex' && (
          <KardexTable products={productsQ.data ?? []} warehouses={warehousesQ.data ?? []} />
        )}
      </CardContent>
    </Card>
  );
}

function TabButton(props: {
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

function MovementForm(props: { products: Product[]; warehouses: Warehouse[] }): JSX.Element {
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [okMessage, setOkMessage] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MovementFormValues>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      productId: '',
      warehouseId: '',
      movementType: 'IN',
      quantity: '',
      unitCost: '0',
      notes: '',
    },
  });

  const movementType = watch('movementType');

  const mutation = useMutation({
    mutationFn: async (values: MovementFormValues) => {
      const payload = {
        productId: values.productId,
        warehouseId: values.warehouseId,
        movementType: values.movementType,
        quantity: values.quantity,
        unitCost: values.unitCost ?? '0',
        notes: values.notes?.trim() ? values.notes.trim() : null,
      };
      return (await api.post('/stock-movements', payload)).data;
    },
    onSuccess: (data) => {
      setOkMessage(
        `Movimiento registrado. Saldo en ${data.warehouseCode}: ${data.balanceQty} (CPP ${data.unitCost}).`,
      );
      setServerError(null);
      reset();
      qc.invalidateQueries({ queryKey: ['kardex'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
            'No se pudo registrar.')
          : 'No se pudo registrar.';
      setServerError(msg);
      setOkMessage(null);
    },
  });

  return (
    <form
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      onSubmit={handleSubmit((v) => mutation.mutate(v))}
      noValidate
    >
      <Field label="Producto" htmlFor="m-productId" error={errors.productId?.message}>
        <SelectInput id="m-productId" {...register('productId')}>
          <option value="">— Seleccionar —</option>
          {props.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} — {p.name}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Almacén" htmlFor="m-warehouseId" error={errors.warehouseId?.message}>
        <SelectInput id="m-warehouseId" {...register('warehouseId')}>
          <option value="">— Seleccionar —</option>
          {props.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Tipo" htmlFor="m-movementType" error={errors.movementType?.message}>
        <SelectInput id="m-movementType" {...register('movementType')}>
          <option value="IN">IN — Entrada (cantidad positiva)</option>
          <option value="OUT">OUT — Salida (cantidad negativa)</option>
          <option value="ADJUST">ADJUST — Ajuste (positivo o negativo)</option>
        </SelectInput>
      </Field>
      <Field
        label={`Cantidad ${movementType === 'OUT' ? '(negativa)' : ''}`}
        htmlFor="m-quantity"
        error={errors.quantity?.message}
      >
        <Input id="m-quantity" inputMode="decimal" {...register('quantity')} />
      </Field>
      <Field label="Costo unitario" htmlFor="m-unitCost" error={errors.unitCost?.message}>
        <Input id="m-unitCost" inputMode="decimal" {...register('unitCost')} />
      </Field>
      <Field label="Notas" htmlFor="m-notes" error={errors.notes?.message} fullWidth>
        <Input id="m-notes" maxLength={250} {...register('notes')} />
      </Field>

      {serverError && (
        <div className="md:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {serverError}
        </div>
      )}
      {okMessage && (
        <div className="md:col-span-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          {okMessage}
        </div>
      )}

      <div className="md:col-span-2 flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting || mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : 'Registrar movimiento'}
        </Button>
      </div>
    </form>
  );
}

function TransferForm(props: { products: Product[]; warehouses: Warehouse[] }): JSX.Element {
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [okMessage, setOkMessage] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      productId: '',
      fromWarehouseId: '',
      toWarehouseId: '',
      quantity: '',
      notes: '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: TransferFormValues) => {
      const payload = {
        productId: values.productId,
        fromWarehouseId: values.fromWarehouseId,
        toWarehouseId: values.toWarehouseId,
        quantity: values.quantity,
        notes: values.notes?.trim() ? values.notes.trim() : null,
      };
      return (await api.post('/stock-movements/transfer', payload)).data;
    },
    onSuccess: (data) => {
      setOkMessage(
        `Transferencia OK. Saldo origen: ${data.out.balanceQty}, destino: ${data.in.balanceQty}.`,
      );
      setServerError(null);
      reset();
      qc.invalidateQueries({ queryKey: ['kardex'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
            'No se pudo transferir.')
          : 'No se pudo transferir.';
      setServerError(msg);
      setOkMessage(null);
    },
  });

  return (
    <form
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      onSubmit={handleSubmit((v) => mutation.mutate(v))}
      noValidate
    >
      <Field label="Producto" htmlFor="t-productId" error={errors.productId?.message} fullWidth>
        <SelectInput id="t-productId" {...register('productId')}>
          <option value="">— Seleccionar —</option>
          {props.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} — {p.name}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field
        label="Almacén origen"
        htmlFor="t-fromWarehouseId"
        error={errors.fromWarehouseId?.message}
      >
        <SelectInput id="t-fromWarehouseId" {...register('fromWarehouseId')}>
          <option value="">— Seleccionar —</option>
          {props.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field
        label="Almacén destino"
        htmlFor="t-toWarehouseId"
        error={errors.toWarehouseId?.message}
      >
        <SelectInput id="t-toWarehouseId" {...register('toWarehouseId')}>
          <option value="">— Seleccionar —</option>
          {props.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Cantidad" htmlFor="t-quantity" error={errors.quantity?.message}>
        <Input id="t-quantity" inputMode="decimal" {...register('quantity')} />
      </Field>
      <Field label="Notas" htmlFor="t-notes" error={errors.notes?.message}>
        <Input id="t-notes" maxLength={250} {...register('notes')} />
      </Field>

      {serverError && (
        <div className="md:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {serverError}
        </div>
      )}
      {okMessage && (
        <div className="md:col-span-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          {okMessage}
        </div>
      )}

      <div className="md:col-span-2 flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting || mutation.isPending}>
          {mutation.isPending ? 'Transfiriendo…' : 'Transferir'}
        </Button>
      </div>
    </form>
  );
}

function KardexTable(props: { products: Product[]; warehouses: Warehouse[] }): JSX.Element {
  const [productId, setProductId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  const params = new URLSearchParams();
  if (productId) params.set('productId', productId);
  if (warehouseId) params.set('warehouseId', warehouseId);
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(to).toISOString());
  const qs = params.toString();

  const movementsQ = useQuery<Movement[]>({
    queryKey: ['kardex', qs],
    queryFn: async () => (await api.get(`/stock-movements${qs ? `?${qs}` : ''}`)).data,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="k-product">Producto</Label>
          <SelectInput
            id="k-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">— Todos —</option>
            {props.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </SelectInput>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="k-warehouse">Almacén</Label>
          <SelectInput
            id="k-warehouse"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">— Todos —</option>
            {props.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </SelectInput>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="k-from">Desde</Label>
          <Input
            id="k-from"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="k-to">Hasta</Label>
          <Input
            id="k-to"
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {movementsQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {movementsQ.error && <p className="text-sm text-destructive">No se pudo cargar el kardex.</p>}
      {!movementsQ.isLoading && (movementsQ.data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">Sin movimientos.</p>
      )}
      {(movementsQ.data ?? []).length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Fecha</th>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 font-medium">Almacén</th>
                <th className="py-2 pr-4 font-medium">Tipo</th>
                <th className="py-2 pr-4 font-medium text-right">Cantidad</th>
                <th className="py-2 pr-4 font-medium text-right">Costo</th>
                <th className="py-2 pr-4 font-medium text-right">Saldo</th>
                <th className="py-2 pr-4 font-medium">Origen</th>
              </tr>
            </thead>
            <tbody>
              {movementsQ.data!.map((m) => (
                <tr key={m.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4 text-xs">
                    {new Date(m.movementDate).toLocaleString('es-CR')}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{m.productSku}</td>
                  <td className="py-2 pr-4">{m.warehouseCode}</td>
                  <td className="py-2 pr-4">
                    <MovementBadge type={m.movementType} />
                  </td>
                  <td className="py-2 pr-4 text-right">{m.quantity}</td>
                  <td className="py-2 pr-4 text-right">{m.unitCost}</td>
                  <td className="py-2 pr-4 text-right">{m.balanceQty}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">{m.sourceDoc ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MovementBadge({ type }: { type: string }): JSX.Element {
  const styles =
    type === 'IN'
      ? 'bg-green-100 text-green-800'
      : type === 'OUT'
        ? 'bg-orange-100 text-orange-800'
        : 'bg-blue-100 text-blue-800';
  return <span className={`rounded px-2 py-0.5 text-xs ${styles}`}>{type}</span>;
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
    className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className ?? ''}`}
    {...props}
  />
));
SelectInput.displayName = 'SelectInput';
