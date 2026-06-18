import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from './auth-context';

/**
 * Bloquea rutas hijas si no hay sesión activa. Si la sesión todavía está
 * cargando (`/auth/me` en curso), no redirige.
 */
export function ProtectedRoute({ permission }: { permission?: string }): JSX.Element {
  const { user, loading, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando sesión…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (permission && !hasPermission(permission)) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="text-center">
          <h2 className="text-lg font-semibold">Sin permiso</h2>
          <p className="text-sm text-muted-foreground">
            Tu rol no tiene <code>{permission}</code>.
          </p>
        </div>
      </div>
    );
  }
  return <Outlet />;
}
