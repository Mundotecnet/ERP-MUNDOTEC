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

const PARTNER_TYPES = ['CUSTOMER', 'SUPPLIER', 'BOTH'] as const;
type PartnerType = (typeof PARTNER_TYPES)[number];
type TypeFilter = '' | PartnerType;

interface Partner {
  id: string;
  partnerType: PartnerType;
  code: string | null;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currencyCode: string;
  creditLimit: string;
  creditDays: number;
  isActive: boolean;
  customerCategoryId: string | null;
  contacts?: PartnerContact[];
}

interface PartnerContact {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
}

interface CustomerCategory {
  id: string;
  code: string;
  name: string;
}

const partnerSchema = z.object({
  partnerType: z.enum(PARTNER_TYPES),
  legalName: z.string().min(1, 'Requerido').max(200),
  code: z.string().max(30).optional(),
  tradeName: z.string().max(200).optional(),
  taxId: z.string().max(50).optional(),
  email: z.string().max(150).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Código ISO de 3 letras')
    .optional(),
  creditLimit: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Decimal positivo')
    .optional(),
  creditDays: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  customerCategoryId: z.string().optional(),
});
type PartnerFormValues = z.infer<typeof partnerSchema>;

const TYPE_LABELS: Record<PartnerType, string> = {
  CUSTOMER: 'Cliente',
  SUPPLIER: 'Proveedor',
  BOTH: 'Mixto',
};

export function PartnersPage(): JSX.Element {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>('');
  const [editing, setEditing] = React.useState<Partner | null>(null);
  const [creating, setCreating] = React.useState(false);

  const params = new URLSearchParams();
  if (typeFilter) params.set('type', typeFilter);
  if (search.trim()) params.set('q', search.trim());
  const qs = params.toString();

  const partnersQ = useQuery<Partner[]>({
    queryKey: ['partners', qs],
    queryFn: async () => (await api.get(`/partners${qs ? `?${qs}` : ''}`)).data,
  });
  const categoriesQ = useQuery<CustomerCategory[]>({
    queryKey: ['customer-categories'],
    queryFn: async () => (await api.get('/customer-categories')).data,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/partners/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partners'] }),
  });

  function close() {
    setEditing(null);
    setCreating(false);
  }

  async function openEdit(p: Partner) {
    // Trae el detalle con contactos
    const detail = (await api.get(`/partners/${p.id}`)).data as Partner;
    setEditing(detail);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Terceros</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nuevo tercero
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
              <Label htmlFor="search">Buscar</Label>
              <Input
                id="search"
                placeholder="Código, nombre o nombre comercial"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <TypeChip active={typeFilter === ''} onClick={() => setTypeFilter('')}>
                Todos
              </TypeChip>
              <TypeChip
                active={typeFilter === 'CUSTOMER'}
                onClick={() => setTypeFilter('CUSTOMER')}
              >
                Clientes
              </TypeChip>
              <TypeChip
                active={typeFilter === 'SUPPLIER'}
                onClick={() => setTypeFilter('SUPPLIER')}
              >
                Proveedores
              </TypeChip>
              <TypeChip active={typeFilter === 'BOTH'} onClick={() => setTypeFilter('BOTH')}>
                Mixtos
              </TypeChip>
            </div>
          </div>

          {partnersQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {partnersQ.error && (
            <p className="text-sm text-destructive">No se pudieron cargar los terceros.</p>
          )}
          {!partnersQ.isLoading && (partnersQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin resultados.</p>
          )}
          {(partnersQ.data ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Código</th>
                    <th className="py-2 pr-4 font-medium">Nombre</th>
                    <th className="py-2 pr-4 font-medium">Tipo</th>
                    <th className="py-2 pr-4 font-medium">Moneda</th>
                    <th className="py-2 pr-4 font-medium text-right">Crédito</th>
                    <th className="py-2 pr-4 font-medium">Activo</th>
                    <th className="py-2 pr-4 font-medium" aria-label="acciones" />
                  </tr>
                </thead>
                <tbody>
                  {partnersQ.data!.map((p) => (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs">{p.code ?? '—'}</td>
                      <td className="py-2 pr-4">{p.legalName}</td>
                      <td className="py-2 pr-4">
                        <TypeBadge type={p.partnerType} />
                      </td>
                      <td className="py-2 pr-4 text-xs">{p.currencyCode}</td>
                      <td className="py-2 pr-4 text-right">
                        {p.creditLimit} ({p.creditDays}d)
                      </td>
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
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`¿Eliminar "${p.legalName}"?`)) deleteMut.mutate(p.id);
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
        <PartnerDialog
          mode={creating ? 'create' : 'edit'}
          partner={editing}
          categories={categoriesQ.data ?? []}
          onClose={close}
        />
      )}
    </>
  );
}

function TypeChip(props: {
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

function TypeBadge({ type }: { type: PartnerType }): JSX.Element {
  const styles =
    type === 'CUSTOMER'
      ? 'bg-blue-100 text-blue-800'
      : type === 'SUPPLIER'
        ? 'bg-purple-100 text-purple-800'
        : 'bg-amber-100 text-amber-800';
  return <span className={`rounded px-2 py-0.5 text-xs ${styles}`}>{TYPE_LABELS[type]}</span>;
}

function PartnerDialog(props: {
  mode: 'create' | 'edit';
  partner: Partner | null;
  categories: CustomerCategory[];
  onClose(): void;
}): JSX.Element {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<'data' | 'contacts'>('data');
  const [serverError, setServerError] = React.useState<string | null>(null);
  const initial = props.partner;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PartnerFormValues>({
    resolver: zodResolver(partnerSchema),
    defaultValues: {
      partnerType: initial?.partnerType ?? 'CUSTOMER',
      legalName: initial?.legalName ?? '',
      code: initial?.code ?? '',
      tradeName: initial?.tradeName ?? '',
      taxId: initial?.taxId ?? '',
      email: initial?.email ?? '',
      phone: initial?.phone ?? '',
      address: initial?.address ?? '',
      currencyCode: initial?.currencyCode ?? 'USD',
      creditLimit: initial?.creditLimit ?? '0',
      creditDays: initial?.creditDays ?? 0,
      isActive: initial?.isActive ?? true,
      customerCategoryId: initial?.customerCategoryId ?? '',
    },
  });

  const partnerType = watch('partnerType');
  const showCustomerCategory = partnerType === 'CUSTOMER' || partnerType === 'BOTH';

  const mutation = useMutation({
    mutationFn: async (v: PartnerFormValues) => {
      const payload = {
        partnerType: v.partnerType,
        legalName: v.legalName,
        code: v.code?.trim() ? v.code.trim() : null,
        tradeName: v.tradeName?.trim() ? v.tradeName.trim() : null,
        taxId: v.taxId?.trim() ? v.taxId.trim() : null,
        email: v.email?.trim() ? v.email.trim() : null,
        phone: v.phone?.trim() ? v.phone.trim() : null,
        address: v.address?.trim() ? v.address.trim() : null,
        currencyCode: v.currencyCode ?? 'USD',
        creditLimit: v.creditLimit ?? '0',
        creditDays: v.creditDays ?? 0,
        isActive: v.isActive ?? true,
        customerCategoryId:
          showCustomerCategory && v.customerCategoryId ? v.customerCategoryId : null,
      };
      if (props.mode === 'create') return (await api.post('/partners', payload)).data;
      return (await api.patch(`/partners/${props.partner!.id}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partners'] });
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
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>{props.mode === 'create' ? 'Nuevo tercero' : 'Editar tercero'}</CardTitle>
          {props.mode === 'edit' && (
            <div className="mt-4 flex gap-2 border-b">
              <TabBtn active={tab === 'data'} onClick={() => setTab('data')}>
                Datos
              </TabBtn>
              <TabBtn active={tab === 'contacts'} onClick={() => setTab('contacts')}>
                Contactos
              </TabBtn>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {tab === 'data' && (
            <form
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
              onSubmit={handleSubmit((v) => mutation.mutate(v))}
              noValidate
            >
              <Field label="Tipo" htmlFor="p-type" error={errors.partnerType?.message}>
                <SelectInput id="p-type" {...register('partnerType')}>
                  <option value="CUSTOMER">Cliente</option>
                  <option value="SUPPLIER">Proveedor</option>
                  <option value="BOTH">Mixto (cliente y proveedor)</option>
                </SelectInput>
              </Field>
              <Field label="Código" htmlFor="p-code" error={errors.code?.message}>
                <Input id="p-code" {...register('code')} />
              </Field>
              <Field
                label="Razón social"
                htmlFor="p-name"
                error={errors.legalName?.message}
                fullWidth
              >
                <Input id="p-name" {...register('legalName')} />
              </Field>
              <Field label="Nombre comercial" htmlFor="p-trade" error={errors.tradeName?.message}>
                <Input id="p-trade" {...register('tradeName')} />
              </Field>
              <Field label="Identificación" htmlFor="p-taxid" error={errors.taxId?.message}>
                <Input id="p-taxid" {...register('taxId')} />
              </Field>
              <Field label="Email" htmlFor="p-email" error={errors.email?.message}>
                <Input id="p-email" type="email" {...register('email')} />
              </Field>
              <Field label="Teléfono" htmlFor="p-phone" error={errors.phone?.message}>
                <Input id="p-phone" {...register('phone')} />
              </Field>
              <Field label="Dirección" htmlFor="p-addr" error={errors.address?.message} fullWidth>
                <Input id="p-addr" {...register('address')} />
              </Field>
              <Field label="Moneda" htmlFor="p-cur" error={errors.currencyCode?.message}>
                <Input
                  id="p-cur"
                  maxLength={3}
                  {...register('currencyCode', {
                    setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                  })}
                />
              </Field>
              <Field label="Límite de crédito" htmlFor="p-cl" error={errors.creditLimit?.message}>
                <Input id="p-cl" inputMode="decimal" {...register('creditLimit')} />
              </Field>
              <Field label="Días de crédito" htmlFor="p-cd" error={errors.creditDays?.message}>
                <Input
                  id="p-cd"
                  type="number"
                  min={0}
                  {...register('creditDays', { valueAsNumber: true })}
                />
              </Field>
              {showCustomerCategory && (
                <Field
                  label="Categoría de cliente"
                  htmlFor="p-cc"
                  error={errors.customerCategoryId?.message}
                >
                  <SelectInput id="p-cc" {...register('customerCategoryId')}>
                    <option value="">— Sin categoría —</option>
                    {props.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              )}
              <div className="md:col-span-2 flex items-center gap-2">
                <input id="p-active" type="checkbox" {...register('isActive')} />
                <Label htmlFor="p-active">Activo</Label>
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

          {tab === 'contacts' && props.partner && (
            <ContactsList
              partnerId={props.partner.id}
              initialContacts={props.partner.contacts ?? []}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ContactsList(props: {
  partnerId: string;
  initialContacts: PartnerContact[];
}): JSX.Element {
  const qc = useQueryClient();
  const [contacts, setContacts] = React.useState(props.initialContacts);
  const [draft, setDraft] = React.useState<{
    name: string;
    position: string;
    email: string;
    phone: string;
  }>({
    name: '',
    position: '',
    email: '',
    phone: '',
  });
  const [error, setError] = React.useState<string | null>(null);

  function refresh() {
    qc.invalidateQueries({ queryKey: ['partners'] });
  }

  async function add() {
    setError(null);
    if (!draft.name.trim()) {
      setError('Nombre requerido');
      return;
    }
    const payload = {
      name: draft.name.trim(),
      position: draft.position.trim() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
    };
    try {
      const created = (await api.post(`/partners/${props.partnerId}/contacts`, payload))
        .data as PartnerContact;
      setContacts((cs) => [...cs, created]);
      setDraft({ name: '', position: '', email: '', phone: '' });
      refresh();
    } catch (err) {
      setError(
        err instanceof AxiosError
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
              'No se pudo guardar.')
          : 'No se pudo guardar.',
      );
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar contacto?')) return;
    await api.delete(`/partners/${props.partnerId}/contacts/${id}`);
    setContacts((cs) => cs.filter((c) => c.id !== id));
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Nombre</th>
              <th className="py-2 pr-4 font-medium">Posición</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Teléfono</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-sm text-muted-foreground">
                  Sin contactos.
                </td>
              </tr>
            )}
            {contacts.map((c) => (
              <tr key={c.id} className="border-b last:border-b-0">
                <td className="py-2 pr-4">{c.name}</td>
                <td className="py-2 pr-4">{c.position ?? '—'}</td>
                <td className="py-2 pr-4 text-xs">{c.email ?? '—'}</td>
                <td className="py-2 pr-4 text-xs">{c.phone ?? '—'}</td>
                <td className="py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border p-3">
        <h4 className="mb-2 text-sm font-semibold">Nuevo contacto</h4>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Input
            placeholder="Nombre"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="Nombre del contacto"
          />
          <Input
            placeholder="Posición"
            value={draft.position}
            onChange={(e) => setDraft({ ...draft, position: e.target.value })}
            aria-label="Posición del contacto"
          />
          <Input
            placeholder="Email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            aria-label="Email del contacto"
          />
          <Input
            placeholder="Teléfono"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            aria-label="Teléfono del contacto"
          />
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={add}>
            Agregar contacto
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabBtn(props: {
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
