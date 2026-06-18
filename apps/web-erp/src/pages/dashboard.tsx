import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/auth-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

interface CompanyResponse {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  currencyCode: string;
}

export function DashboardPage(): JSX.Element {
  const { user, hasPermission } = useAuth();

  const company = useQuery({
    queryKey: ['company', 'current'],
    queryFn: async () => (await api.get<CompanyResponse>('/companies/current')).data,
    enabled: hasPermission('company.read'),
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Bienvenido, {user?.fullName}</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Sesión</CardTitle>
            <CardDescription>Datos del usuario y permisos efectivos.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Correo</dt>
              <dd>{user?.email}</dd>
              <dt className="text-muted-foreground">Usuario</dt>
              <dd>{user?.username}</dd>
              <dt className="text-muted-foreground">Permisos</dt>
              <dd>{user?.permissions.length ?? 0}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Empresa activa</CardTitle>
            <CardDescription>Aislada por el JWT.</CardDescription>
          </CardHeader>
          <CardContent>
            {company.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
            {company.error && (
              <p className="text-sm text-destructive">
                No se pudo cargar la empresa. ¿Falta <code>company.read</code>?
              </p>
            )}
            {company.data && (
              <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted-foreground">Razón</dt>
                <dd>{company.data.legalName}</dd>
                <dt className="text-muted-foreground">Comercial</dt>
                <dd>{company.data.tradeName ?? '—'}</dd>
                <dt className="text-muted-foreground">Cédula</dt>
                <dd>{company.data.taxId}</dd>
                <dt className="text-muted-foreground">Moneda</dt>
                <dd>{company.data.currencyCode}</dd>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
