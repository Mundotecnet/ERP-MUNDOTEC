import {
  ArrowLeftRight,
  Box,
  Building2,
  Coins,
  FileBadge,
  Home,
  Layers,
  Settings,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavEntry {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  /** Permiso requerido para mostrar el ítem. */
  permission?: string;
}

/**
 * Catálogo de rutas del shell. El menú real las filtra por los permisos del
 * usuario activo en {@link Shell}. Mantener este array como única fuente de
 * verdad para añadir/quitar entradas.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { label: 'Dashboard', to: '/', icon: Home },
  { label: 'Productos', to: '/products', icon: Box, permission: 'catalogs.product.read' },
  { label: 'Existencias', to: '/stock', icon: Layers, permission: 'inventory.stock.read' },
  {
    label: 'Movimientos',
    to: '/movements',
    icon: ArrowLeftRight,
    permission: 'inventory.movement.read',
  },
  { label: 'Sucursales', to: '/branches', icon: Building2, permission: 'branch.read' },
  { label: 'Usuarios', to: '/users', icon: Users, permission: 'users.read' },
  { label: 'Roles', to: '/roles', icon: FileBadge, permission: 'roles.read' },
  { label: 'Monedas', to: '/currencies', icon: Coins, permission: 'catalogs.currency.read' },
  { label: 'Configuración', to: '/settings', icon: Settings, permission: 'params.read' },
];
