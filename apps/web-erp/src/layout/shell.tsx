import { LogOut } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { NAV_ENTRIES } from './nav';

export function Shell(): JSX.Element {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  const visibleEntries = NAV_ENTRIES.filter(
    (entry) => !entry.permission || hasPermission(entry.permission),
  );

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="grid h-screen grid-cols-[16rem_1fr] grid-rows-[3.5rem_1fr]">
      <aside className="row-span-2 border-r bg-card text-card-foreground">
        <div className="flex h-14 items-center border-b px-6 font-semibold">MundoTec ERP</div>
        <nav className="flex flex-col gap-1 p-3">
          {visibleEntries.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              end={entry.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <entry.icon className="h-4 w-4" />
              {entry.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <header className="flex items-center justify-between border-b px-6">
        <div className="text-sm text-muted-foreground">
          Empresa <span className="font-mono">{user?.companyId}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm font-medium leading-none">{user?.fullName}</div>
            <div className="text-xs text-muted-foreground">{user?.email}</div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} aria-label="Cerrar sesión">
            <LogOut className="h-4 w-4" />
            Salir
          </Button>
        </div>
      </header>

      <main className="overflow-y-auto bg-muted/30 p-6">
        <Outlet />
      </main>
    </div>
  );
}
