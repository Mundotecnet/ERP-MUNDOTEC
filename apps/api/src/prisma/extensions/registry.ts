/**
 * Registro de modelos por hook de Prisma. Mantener en un solo lugar para que
 * los reviewers vean rápido qué entidades están bajo qué política.
 *
 * NOTA: los nombres son los del modelo Prisma (PascalCase), no del @@map.
 */

/** Modelos cuyas mutaciones (create/update/upsert/delete) registran fila en `audit_log`. */
export const AUDITED_MODELS = new Set<string>([
  'Company',
  'Branch',
  'AppUser',
  'Role',
  'RolePermission',
  'UserRole',
  'Tax',
  'Department',
  'ProductCategory',
  'CustomerCategory',
  'Product',
  'StockMovement',
  'Partner',
  'PurchaseOrder',
  'GoodsReceipt',
]);

/**
 * Modelos a los que se les inyecta `where: { companyId: ctx.companyId }`
 * automáticamente en find/update/delete. Excluye Company (que filtra por `id`)
 * y catálogos globales (currency, exchange_rate, unit_of_measure, permission).
 */
export const TENANT_MODELS = new Set<string>([
  'Branch',
  'AppUser',
  'Role',
  'Tax',
  'Department',
  'ProductCategory',
  'CustomerCategory',
  'Product',
  'StockMovement',
  'Partner',
  'PurchaseOrder',
  'GoodsReceipt',
]);

/**
 * Modelos donde `delete` se transforma en `update({ deletedAt: now() })` y las
 * lecturas filtran `deletedAt: null`. Sólo los modelos con columna `deleted_at`
 * en `erp_schema.sql` pertenecen a este set.
 */
export const SOFT_DELETE_MODELS = new Set<string>(['AppUser', 'Product', 'Partner']);
