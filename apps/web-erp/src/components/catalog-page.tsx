import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export interface CatalogColumn<T> {
  header: string;
  render(row: T): React.ReactNode;
  className?: string;
}

export interface CatalogFormProps<F> {
  values: F;
  setValues: React.Dispatch<React.SetStateAction<F>>;
  mode: 'create' | 'edit';
  /** Mensaje de error del servidor (ej. 409 al guardar). */
  serverError: string | null;
}

interface CatalogPageProps<T, CF, UF> {
  /** Texto del título del card y singular para el botón "Nuevo X". */
  title: string;
  singular: string;
  /** Ej. "/product-categories". */
  endpoint: string;
  /** QueryKey base para invalidar tras mutaciones. */
  queryKey: QueryKey;
  /** Extrae la clave para `key=` y para construir las URLs PATCH/DELETE. */
  rowKey(row: T): string;
  /** Texto para usar en confirm() de delete (ej. row.name). */
  rowLabel(row: T): string;
  /** Filtra `T` localmente con el texto del search; si no se pasa no muestra search. */
  search?: { placeholder: string; matches(row: T, q: string): boolean };
  columns: CatalogColumn<T>[];
  emptyCreate(): CF;
  rowToUpdate(row: T): UF;
  renderCreateForm(props: CatalogFormProps<CF>): React.ReactNode;
  renderUpdateForm(props: CatalogFormProps<UF>): React.ReactNode;
  /** Devuelve el JSON a enviar al POST. Devolver null/string aborta y muestra el msg. */
  buildCreatePayload(form: CF): unknown | string;
  buildUpdatePayload(form: UF): unknown | string;
  /** Otras queryKeys a invalidar tras crear/editar/borrar (ej. selectores en products). */
  extraInvalidate?: QueryKey[];
}

function extractApiError(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    if (data?.message) return Array.isArray(data.message) ? data.message.join(' · ') : data.message;
  }
  return 'No se pudo completar la operación.';
}

export function CatalogPage<T, CF, UF>(props: CatalogPageProps<T, CF, UF>): JSX.Element {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<T | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const listQ = useQuery<T[]>({
    queryKey: props.queryKey,
    queryFn: async () => (await api.get(props.endpoint)).data,
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: props.queryKey });
    for (const k of props.extraInvalidate ?? []) qc.invalidateQueries({ queryKey: k });
  }

  const deleteMut = useMutation({
    mutationFn: async (key: string) => api.delete(`${props.endpoint}/${key}`),
    onSuccess: invalidateAll,
    onError: (err) => alert(extractApiError(err)),
  });

  const list = listQ.data ?? [];
  const filtered = React.useMemo(() => {
    if (!props.search || !search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((row) => props.search!.matches(row, q));
  }, [list, search, props.search]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>{props.title}</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            Nuevo {props.singular}
          </Button>
        </CardHeader>
        <CardContent>
          {props.search && (
            <div className="mb-4 flex flex-col gap-1">
              <Label htmlFor="catalog-search">Buscar</Label>
              <Input
                id="catalog-search"
                placeholder={props.search.placeholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}

          {listQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {listQ.error && (
            <p className="text-sm text-destructive">No se pudo cargar el catálogo.</p>
          )}
          {!listQ.isLoading && !listQ.error && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin resultados.</p>
          )}
          {filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    {props.columns.map((c) => (
                      <th key={c.header} className="py-2 pr-4 font-medium">
                        {c.header}
                      </th>
                    ))}
                    <th className="py-2 pr-4 font-medium" aria-label="acciones" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const key = props.rowKey(row);
                    return (
                      <tr key={key} className="border-b last:border-b-0">
                        {props.columns.map((c) => (
                          <td key={c.header} className={`py-2 pr-4 align-top ${c.className ?? ''}`}>
                            {c.render(row)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`¿Eliminar "${props.rowLabel(row)}"?`)) {
                                deleteMut.mutate(key);
                              }
                            }}
                          >
                            Eliminar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {creating && (
        <CreateDialog<CF>
          title={`Nuevo ${props.singular}`}
          endpoint={props.endpoint}
          initial={props.emptyCreate()}
          renderForm={props.renderCreateForm}
          buildPayload={props.buildCreatePayload}
          onClose={() => setCreating(false)}
          onSuccess={invalidateAll}
        />
      )}
      {editing && (
        <UpdateDialog<UF>
          title={`Editar ${props.singular}`}
          endpoint={props.endpoint}
          rowKey={props.rowKey(editing)}
          initial={props.rowToUpdate(editing)}
          renderForm={props.renderUpdateForm}
          buildPayload={props.buildUpdatePayload}
          onClose={() => setEditing(null)}
          onSuccess={invalidateAll}
        />
      )}
    </>
  );
}

function DialogShell(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
        </CardHeader>
        <CardContent>{props.children}</CardContent>
      </Card>
    </div>
  );
}

interface CreateDialogProps<F> {
  title: string;
  endpoint: string;
  initial: F;
  renderForm(p: CatalogFormProps<F>): React.ReactNode;
  buildPayload(form: F): unknown | string;
  onClose(): void;
  onSuccess(): void;
}

function CreateDialog<F>(props: CreateDialogProps<F>): JSX.Element {
  const [values, setValues] = React.useState<F>(props.initial);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const payload = props.buildPayload(values);
      if (typeof payload === 'string') throw new Error(payload);
      return api.post(props.endpoint, payload);
    },
    onSuccess: () => {
      props.onSuccess();
      props.onClose();
    },
    onError: (err) => setServerError(err instanceof Error ? err.message : extractApiError(err)),
  });

  return (
    <DialogShell title={props.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          mut.mutate();
        }}
        noValidate
      >
        {props.renderForm({ values, setValues, mode: 'create', serverError })}
        {serverError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {serverError}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mut.isPending}>
            {mut.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

interface UpdateDialogProps<F> {
  title: string;
  endpoint: string;
  rowKey: string;
  initial: F;
  renderForm(p: CatalogFormProps<F>): React.ReactNode;
  buildPayload(form: F): unknown | string;
  onClose(): void;
  onSuccess(): void;
}

function UpdateDialog<F>(props: UpdateDialogProps<F>): JSX.Element {
  const [values, setValues] = React.useState<F>(props.initial);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const payload = props.buildPayload(values);
      if (typeof payload === 'string') throw new Error(payload);
      return api.patch(`${props.endpoint}/${props.rowKey}`, payload);
    },
    onSuccess: () => {
      props.onSuccess();
      props.onClose();
    },
    onError: (err) => setServerError(err instanceof Error ? err.message : extractApiError(err)),
  });

  return (
    <DialogShell title={props.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          mut.mutate();
        }}
        noValidate
      >
        {props.renderForm({ values, setValues, mode: 'edit', serverError })}
        {serverError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {serverError}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mut.isPending}>
            {mut.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Helpers reutilizables por las pantallas concretas. */
export function ActiveBadge({ active }: { active: boolean }): JSX.Element {
  return active ? (
    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Activo</span>
  ) : (
    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">Inactivo</span>
  );
}

export function CatalogField(props: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={props.htmlFor}>{props.label}</Label>
      {props.children}
      {props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
    </div>
  );
}
