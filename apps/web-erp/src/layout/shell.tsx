import { ChevronDown, ChevronRight, LogOut } from 'lucide-react';
import * as React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { filterNav, NAV_ENTRIES, type NavGroup, type NavItem } from './nav';

const GROUP_STORAGE_KEY = 'erp.nav.openGroups';

function readOpenGroups(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(GROUP_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeOpenGroups(state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage no disponible: silencioso, el estado igual queda en memoria.
  }
}

export function Shell(): JSX.Element {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(readOpenGroups);

  const visibleEntries = React.useMemo(
    () => filterNav(NAV_ENTRIES, hasPermission),
    [hasPermission],
  );

  // Si la ruta activa pertenece a un grupo, abrirlo automáticamente.
  React.useEffect(() => {
    for (const entry of visibleEntries) {
      if (entry.kind !== 'group') continue;
      const hit = entry.children.some((c) => location.pathname.startsWith(c.to));
      if (hit && !openGroups[entry.id]) {
        setOpenGroups((prev) => {
          const next = { ...prev, [entry.id]: true };
          writeOpenGroups(next);
          return next;
        });
      }
    }
  }, [location.pathname, visibleEntries, openGroups]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeOpenGroups(next);
      return next;
    });
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="grid h-screen grid-cols-[16rem_1fr] grid-rows-[3.5rem_1fr]">
      <aside className="row-span-2 border-r bg-card text-card-foreground">
        <div className="flex h-14 items-center border-b px-6 font-semibold">MundoTec ERP</div>
        <nav className="flex flex-col gap-1 p-3">
          {visibleEntries.map((entry) =>
            entry.kind === 'item' ? (
              <NavItemLink key={entry.to} item={entry} />
            ) : (
              <NavGroupSection
                key={entry.id}
                group={entry}
                open={openGroups[entry.id] ?? false}
                onToggle={() => toggleGroup(entry.id)}
              />
            ),
          )}
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

function NavItemLink({ item, nested }: { item: NavItem; nested?: boolean }): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          nested && 'pl-9',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )
      }
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </NavLink>
  );
}

function NavGroupSection({
  group,
  open,
  onToggle,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <group.icon className="h-4 w-4" />
        <span className="flex-1 text-left">{group.label}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div className="flex flex-col gap-1 pt-1">
          {group.children.map((child) => (
            <NavItemLink key={child.to} item={child} nested />
          ))}
        </div>
      )}
    </div>
  );
}
