import { ResourceList } from '@/components/resource-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ParamRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

function renderValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export function SettingsPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Parámetros generales</CardTitle>
          <CardDescription>
            Configuración key/value de la empresa. Editar y crear nuevos parámetros entra en un
            sprint posterior; por ahora la pantalla los lista.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResourceList<ParamRow>
            title=""
            endpoint="/params"
            rowKey={(p) => p.key}
            columns={[
              { header: 'Clave', render: (p) => <code className="text-xs">{p.key}</code> },
              {
                header: 'Valor',
                render: (p) => <code className="text-xs">{renderValue(p.value)}</code>,
              },
              {
                header: 'Actualizado',
                render: (p) => new Date(p.updatedAt).toLocaleString(),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
