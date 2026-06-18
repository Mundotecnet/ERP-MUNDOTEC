import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export interface Column<T> {
  header: string;
  render(row: T): React.ReactNode;
}

interface ResourceListProps<T> {
  title: string;
  /** Endpoint relativo a `/api`. */
  endpoint: string;
  columns: Column<T>[];
  /** Función para extraer los items cuando el backend devuelve `{ data: [] }`. */
  selector?: (raw: unknown) => T[];
  rowKey(row: T): string;
}

function defaultSelector<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (
    raw &&
    typeof raw === 'object' &&
    'data' in raw &&
    Array.isArray((raw as { data: unknown }).data)
  ) {
    return (raw as { data: T[] }).data;
  }
  return [];
}

export function ResourceList<T>({
  title,
  endpoint,
  columns,
  selector,
  rowKey,
}: ResourceListProps<T>): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['resource', endpoint],
    queryFn: async () => {
      const res = await api.get(endpoint);
      return (selector ?? defaultSelector<T>)(res.data);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && (
          <p className="text-sm text-destructive">
            {(error as { message?: string }).message ?? 'Error al cargar.'}
          </p>
        )}
        {!isLoading && !error && data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin resultados.</p>
        )}
        {!isLoading && !error && data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  {columns.map((c) => (
                    <th key={c.header} className="py-2 pr-4 font-medium">
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={rowKey(row)} className="border-b last:border-b-0">
                    {columns.map((c) => (
                      <td key={c.header} className="py-2 pr-4 align-top">
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
