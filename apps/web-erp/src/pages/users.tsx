import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isActive: boolean;
  isSalesperson: boolean;
  commissionPct: string;
  defaultBranchId: string | null;
  lastLoginAt: string | null;
}

interface Branch {
  id: string;
  code: string;
  name: string;
}

interface UserBranches {
  branchIds: string[];
  assignedBranchIds: string[];
  defaultBranchId: string | null;
  accessAll: boolean;
}

interface PaginatedUsers {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
}

function extractApiError(err: unknown, fallback = 'No se pudo completar la operación.'): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    if (data?.message) return Array.isArray(data.message) ? data.message.join(' · ') : data.message;
  }
  return fallback;
}

export function UsersPage(): JSX.Element {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<User | null>(null);
  const [creating, setCreating] = React.useState(false);

  const usersQ = useQuery<PaginatedUsers>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users?page=1&pageSize=100')).data,
  });
  const branchesQ = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) => alert(extractApiError(err)),
  });

  const users = usersQ.data?.data ?? [];
  const branches = branchesQ.data ?? [];
  const branchLabel = React.useCallback(
    (id: string | null) => {
      if (!id) return '—';
      const b = branches.find((x) => x.id === id);
      return b ? `${b.code} — ${b.name}` : `#${id}`;
    },
    [branches],
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Usuarios</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nuevo usuario
          </Button>
        </CardHeader>
        <CardContent>
          {usersQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {usersQ.error && <p className="text-sm text-destructive">No se pudo cargar la lista.</p>}
          {!usersQ.isLoading && users.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin usuarios.</p>
          )}
          {users.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Usuario</th>
                    <th className="py-2 pr-4 font-medium">Correo</th>
                    <th className="py-2 pr-4 font-medium">Nombre</th>
                    <th className="py-2 pr-4 font-medium">Sucursal default</th>
                    <th className="py-2 pr-4 font-medium">Vendedor</th>
                    <th className="py-2 pr-4 font-medium">Estado</th>
                    <th className="py-2 pr-4 font-medium" aria-label="acciones" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4">{u.username}</td>
                      <td className="py-2 pr-4">{u.email}</td>
                      <td className="py-2 pr-4">{u.fullName}</td>
                      <td className="py-2 pr-4">{branchLabel(u.defaultBranchId)}</td>
                      <td className="py-2 pr-4">
                        {u.isSalesperson ? `${(Number(u.commissionPct) * 100).toFixed(2)} %` : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            u.isActive
                              ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-800'
                              : 'rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                          }
                        >
                          {u.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`¿Eliminar "${u.username}"?`)) deleteMut.mutate(u.id);
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
        <UserDialog
          mode={creating ? 'create' : 'edit'}
          user={editing}
          branches={branches}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

interface UserDialogProps {
  mode: 'create' | 'edit';
  user: User | null;
  branches: Branch[];
  onClose: () => void;
}

interface FormState {
  username: string;
  email: string;
  password: string;
  fullName: string;
  isActive: boolean;
  isSalesperson: boolean;
  commissionPct: string;
  branchIds: string[];
  defaultBranchId: string;
}

function initialForm(user: User | null): FormState {
  return {
    username: user?.username ?? '',
    email: user?.email ?? '',
    password: '',
    fullName: user?.fullName ?? '',
    isActive: user?.isActive ?? true,
    isSalesperson: user?.isSalesperson ?? false,
    commissionPct: user ? (Number(user.commissionPct) * 100).toString() : '0',
    branchIds: [],
    defaultBranchId: user?.defaultBranchId ?? '',
  };
}

function UserDialog(props: UserDialogProps): JSX.Element {
  const qc = useQueryClient();
  const [form, setForm] = React.useState<FormState>(() => initialForm(props.user));
  const [serverError, setServerError] = React.useState<string | null>(null);
  const isEdit = props.mode === 'edit' && props.user !== null;

  // En edit, precargamos las branches asignadas + accessAll flag.
  const branchesQ = useQuery<UserBranches>({
    queryKey: ['user-branches', props.user?.id ?? ''],
    queryFn: async () => (await api.get(`/users/${props.user!.id}/branches`)).data,
    enabled: isEdit,
  });

  React.useEffect(() => {
    if (isEdit && branchesQ.data) {
      setForm((f) => ({
        ...f,
        branchIds: branchesQ.data!.assignedBranchIds,
        defaultBranchId: branchesQ.data!.defaultBranchId ?? '',
      }));
    }
  }, [isEdit, branchesQ.data]);

  const accessAll = branchesQ.data?.accessAll ?? false;

  const mutation = useMutation({
    mutationFn: async () => {
      // Validaciones locales.
      if (!form.username.trim()) throw new Error('El nombre de usuario es requerido.');
      if (!form.email.trim()) throw new Error('El correo es requerido.');
      if (!form.fullName.trim()) throw new Error('El nombre completo es requerido.');
      if (props.mode === 'create' && !form.password.trim()) {
        throw new Error('La contraseña es requerida al crear.');
      }
      const pct = Number(form.commissionPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error('La comisión debe estar entre 0 y 100 %.');
      }
      // Si NO tiene access_all, el default debe estar entre las asignadas
      // (o vacío). Con access_all podemos setear cualquiera de la empresa.
      if (form.defaultBranchId && !accessAll && !form.branchIds.includes(form.defaultBranchId)) {
        throw new Error('La sucursal por defecto debe estar entre las sucursales permitidas.');
      }

      const userPayload: Record<string, unknown> = {
        username: form.username.trim(),
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        isActive: form.isActive,
        isSalesperson: form.isSalesperson,
        commissionPct: pct / 100,
      };
      if (form.password.trim()) userPayload.password = form.password;
      // En create pasamos el default para que el usuario nazca con él (si aplica).
      if (props.mode === 'create' && form.defaultBranchId) {
        // Con access_all podemos setearlo en el POST directamente; sin él
        // debemos crear primero el user, asignar branches, y recién luego
        // el default (el POST valida contra el set actual que aún es vacío).
        if (accessAll) userPayload.defaultBranchId = form.defaultBranchId;
      }

      let userId: string;
      if (props.mode === 'create') {
        const created = (await api.post('/users', userPayload)).data as User;
        userId = created.id;
      } else {
        await api.patch(`/users/${props.user!.id}`, userPayload);
        userId = props.user!.id;
      }

      // Reemplazo del set de branches + default. En edit, el service maneja
      // el auto-null; en create con default fuera del set, va acá también.
      await api.put(`/users/${userId}/branches`, {
        branchIds: form.branchIds,
        defaultBranchId: form.defaultBranchId ? form.defaultBranchId : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user-branches'] });
      props.onClose();
    },
    onError: (err) => {
      setServerError(err instanceof Error ? err.message : extractApiError(err));
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{isEdit ? 'Editar usuario' : 'Nuevo usuario'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setServerError(null);
              mutation.mutate();
            }}
            noValidate
          >
            <Field label="Usuario" htmlFor="u-username">
              <Input
                id="u-username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                autoFocus
              />
            </Field>
            <Field label="Correo" htmlFor="u-email">
              <Input
                id="u-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>
            <Field
              label={isEdit ? 'Contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
              htmlFor="u-password"
            >
              <Input
                id="u-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </Field>
            <Field label="Nombre completo" htmlFor="u-fullname">
              <Input
                id="u-fullname"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              />
            </Field>

            <Field label="Sucursal por defecto" htmlFor="u-default-branch">
              <select
                id="u-default-branch"
                value={form.defaultBranchId}
                onChange={(e) => setForm((f) => ({ ...f, defaultBranchId: e.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— Sin default —</option>
                {props.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Sucursales permitidas"
              htmlFor="u-branches"
              hint={
                accessAll
                  ? 'El usuario tiene el permiso branch.access_all: opera TODAS las sucursales de la empresa (la selección de abajo es opcional).'
                  : 'Multiselección: mantené Ctrl/Cmd para elegir varias. El default debe estar entre estas.'
              }
            >
              <select
                id="u-branches"
                multiple
                size={Math.min(6, Math.max(3, props.branches.length))}
                value={form.branchIds}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setForm((f) => ({ ...f, branchIds: selected }));
                }}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {props.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Comisión %" htmlFor="u-commission" hint="0 a 100">
              <Input
                id="u-commission"
                inputMode="decimal"
                value={form.commissionPct}
                onChange={(e) => setForm((f) => ({ ...f, commissionPct: e.target.value }))}
              />
            </Field>

            <div className="md:col-span-2 flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Activo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isSalesperson}
                  onChange={(e) => setForm((f) => ({ ...f, isSalesperson: e.target.checked }))}
                />
                Vendedor
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
              <Button type="submit" disabled={mutation.isPending}>
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
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={props.htmlFor}>{props.label}</Label>
      {props.children}
      {props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
    </div>
  );
}
