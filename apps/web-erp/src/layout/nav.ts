import {
  ArrowLeftRight,
  Box,
  Building2,
  ClipboardCheck,
  Coins,
  Contact2,
  FileBadge,
  FileText,
  FolderTree,
  Home,
  Layers,
  Library,
  PackageCheck,
  Receipt,
  Ruler,
  Settings,
  ShoppingCart,
  Tags,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  kind: 'item';
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  /** Permiso requerido para mostrar el ítem. */
  permission?: string;
}

export interface NavGroup {
  kind: 'group';
  label: string;
  /** Clave única; se usa para persistir abierto/cerrado en localStorage. */
  id: string;
  icon: ComponentType<{ className?: string }>;
  children: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

/**
 * Catálogo de rutas del shell. El menú real las filtra por los permisos del
 * usuario activo en {@link Shell}. Mantener este array como única fuente de
 * verdad para añadir/quitar entradas.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { kind: 'item', label: 'Dashboard', to: '/', icon: Home },
  {
    kind: 'item',
    label: 'Productos',
    to: '/products',
    icon: Box,
    permission: 'catalogs.product.read',
  },
  {
    kind: 'item',
    label: 'Existencias',
    to: '/stock',
    icon: Layers,
    permission: 'inventory.stock.read',
  },
  {
    kind: 'item',
    label: 'Movimientos',
    to: '/movements',
    icon: ArrowLeftRight,
    permission: 'inventory.movement.read',
  },
  { kind: 'item', label: 'Terceros', to: '/partners', icon: Contact2, permission: 'partners.read' },
  {
    kind: 'item',
    label: 'Órdenes de compra',
    to: '/purchase-orders',
    icon: ShoppingCart,
    permission: 'purchases.po.read',
  },
  {
    kind: 'item',
    label: 'Recepciones',
    to: '/receipts',
    icon: PackageCheck,
    permission: 'purchases.receipt.read',
  },
  {
    kind: 'item',
    label: 'Cotizaciones',
    to: '/quotations',
    icon: FileText,
    permission: 'sales.quote.read',
  },
  {
    kind: 'item',
    label: 'Órdenes de venta',
    to: '/sales-orders',
    icon: ClipboardCheck,
    permission: 'sales.order.read',
  },
  {
    kind: 'item',
    label: 'Facturas',
    to: '/invoices',
    icon: Receipt,
    permission: 'sales.invoice.read',
  },
  {
    kind: 'item',
    label: 'Sucursales',
    to: '/branches',
    icon: Building2,
    permission: 'branch.read',
  },
  { kind: 'item', label: 'Usuarios', to: '/users', icon: Users, permission: 'users.read' },
  { kind: 'item', label: 'Roles', to: '/roles', icon: FileBadge, permission: 'roles.read' },
  {
    kind: 'group',
    label: 'Catálogos',
    id: 'catalogos',
    icon: Library,
    children: [
      {
        kind: 'item',
        label: 'Categorías',
        to: '/product-categories',
        icon: FolderTree,
        permission: 'catalogs.product-category.read',
      },
      {
        kind: 'item',
        label: 'Departamentos',
        to: '/departments',
        icon: Building2,
        permission: 'catalogs.department.read',
      },
      {
        kind: 'item',
        label: 'Unidades',
        to: '/units-of-measure',
        icon: Ruler,
        permission: 'catalogs.uom.read',
      },
      {
        kind: 'item',
        label: 'Impuestos',
        to: '/taxes',
        icon: Tags,
        permission: 'catalogs.tax.read',
      },
      {
        kind: 'item',
        label: 'Monedas',
        to: '/currencies',
        icon: Coins,
        permission: 'catalogs.currency.read',
      },
    ],
  },
  {
    kind: 'item',
    label: 'Configuración',
    to: '/settings',
    icon: Settings,
    permission: 'params.read',
  },
];

/** Filtra el menú por permisos: oculta items sin permiso y grupos vacíos. */
export function filterNav(
  entries: NavEntry[],
  hasPermission: (code: string) => boolean,
): NavEntry[] {
  const isVisibleItem = (i: NavItem) => !i.permission || hasPermission(i.permission);
  return entries.flatMap<NavEntry>((entry) => {
    if (entry.kind === 'item') return isVisibleItem(entry) ? [entry] : [];
    const visibleChildren = entry.children.filter(isVisibleItem);
    if (visibleChildren.length === 0) return [];
    return [{ ...entry, children: visibleChildren }];
  });
}
