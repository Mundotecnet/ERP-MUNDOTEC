/**
 * Seed inicial del ERP (Sprint 1 / HU-1.3).
 *
 * Idempotente — se puede correr varias veces sin duplicar.
 *
 * Variables de entorno requeridas:
 *   - DATABASE_URL          → conexión a la DB destino.
 *   - SEED_ADMIN_EMAIL      → correo del usuario admin demo (default: admin@demo.local).
 *   - SEED_ADMIN_PASSWORD   → contraseña en claro del admin demo (obligatorio).
 *
 * Uso:
 *   pnpm --filter @mundotec/api db:seed
 *   o, equivalente vía Prisma:
 *   pnpm --filter @mundotec/api exec prisma db seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 10;

interface PermissionSpec {
  code: string;
  module: string;
  description: string;
}

const PERMISSIONS: PermissionSpec[] = [
  // --- Autenticación ---
  { code: 'auth.login', module: 'auth', description: 'Iniciar sesión en el ERP' },

  // --- Empresa ---
  { code: 'company.read', module: 'company', description: 'Ver datos de la empresa' },
  { code: 'company.update', module: 'company', description: 'Editar datos de la empresa' },

  // --- Sucursales ---
  { code: 'branch.read', module: 'branch', description: 'Listar y ver sucursales' },
  { code: 'branch.create', module: 'branch', description: 'Crear sucursales' },
  { code: 'branch.update', module: 'branch', description: 'Editar sucursales' },
  { code: 'branch.delete', module: 'branch', description: 'Desactivar/borrar sucursales' },

  // --- Almacenes ---
  { code: 'warehouses.read', module: 'warehouses', description: 'Listar y ver almacenes' },
  { code: 'warehouses.create', module: 'warehouses', description: 'Crear almacenes' },
  { code: 'warehouses.update', module: 'warehouses', description: 'Editar almacenes' },
  { code: 'warehouses.delete', module: 'warehouses', description: 'Eliminar almacenes' },

  // --- Usuarios ---
  { code: 'users.read', module: 'users', description: 'Listar y ver usuarios' },
  { code: 'users.create', module: 'users', description: 'Crear usuarios' },
  { code: 'users.update', module: 'users', description: 'Editar usuarios' },
  { code: 'users.delete', module: 'users', description: 'Eliminar/desactivar usuarios' },
  {
    code: 'users.assign-roles',
    module: 'users',
    description: 'Asignar/quitar roles a usuarios',
  },

  // --- Roles ---
  { code: 'roles.read', module: 'roles', description: 'Listar y ver roles' },
  { code: 'roles.create', module: 'roles', description: 'Crear roles' },
  { code: 'roles.update', module: 'roles', description: 'Editar roles y asignar permisos' },
  { code: 'roles.delete', module: 'roles', description: 'Eliminar roles' },

  // --- Permisos (sólo lectura — son catálogo de sistema) ---
  { code: 'permissions.read', module: 'permissions', description: 'Listar permisos disponibles' },

  // --- Auditoría ---
  { code: 'audit.read', module: 'audit', description: 'Consultar el log de auditoría' },

  // --- Parámetros generales (HU-6.3) ---
  { code: 'params.read', module: 'params', description: 'Leer parámetros generales de la empresa' },
  {
    code: 'params.manage',
    module: 'params',
    description: 'Crear/editar/eliminar parámetros generales',
  },

  // --- Catálogos base: lectura + gestión (create/update/delete) ---
  { code: 'catalogs.currency.read', module: 'catalogs', description: 'Ver monedas' },
  {
    code: 'catalogs.currency.manage',
    module: 'catalogs',
    description: 'Crear/editar/eliminar monedas',
  },
  { code: 'catalogs.exchange-rate.read', module: 'catalogs', description: 'Ver tipos de cambio' },
  {
    code: 'catalogs.exchange-rate.manage',
    module: 'catalogs',
    description: 'Crear/editar/eliminar tipos de cambio',
  },
  { code: 'catalogs.tax.read', module: 'catalogs', description: 'Ver impuestos' },
  {
    code: 'catalogs.tax.manage',
    module: 'catalogs',
    description: 'Crear/editar/eliminar impuestos',
  },
  { code: 'catalogs.uom.read', module: 'catalogs', description: 'Ver unidades de medida' },
  {
    code: 'catalogs.uom.manage',
    module: 'catalogs',
    description: 'Crear/editar/eliminar unidades de medida',
  },
  { code: 'catalogs.department.read', module: 'catalogs', description: 'Ver departamentos' },
  {
    code: 'catalogs.department.manage',
    module: 'catalogs',
    description: 'Crear/editar/eliminar departamentos',
  },
  {
    code: 'catalogs.product-category.read',
    module: 'catalogs',
    description: 'Ver categorías de producto',
  },
  {
    code: 'catalogs.product-category.manage',
    module: 'catalogs',
    description: 'Crear/editar/eliminar categorías de producto',
  },
  {
    code: 'catalogs.customer-category.read',
    module: 'catalogs',
    description: 'Ver categorías de cliente',
  },
  {
    code: 'catalogs.customer-category.manage',
    module: 'catalogs',
    description: 'Crear/editar/eliminar categorías de cliente',
  },

  // --- Productos (HU-7.1) ---
  { code: 'catalogs.product.read', module: 'catalogs', description: 'Ver productos' },
  {
    code: 'catalogs.product.manage',
    module: 'catalogs',
    description: 'Crear/editar/eliminar productos',
  },

  // --- Inventario (HU-7.2) ---
  {
    code: 'inventory.stock.read',
    module: 'inventory',
    description: 'Ver existencias por almacén',
  },

  // --- Kardex / movimientos (HU-8.1) ---
  {
    code: 'inventory.movement.read',
    module: 'inventory',
    description: 'Ver el kardex de movimientos de inventario',
  },
  {
    code: 'inventory.movement.manage',
    module: 'inventory',
    description: 'Registrar movimientos de inventario (entradas, salidas, ajustes)',
  },

  // --- Terceros / partners (HU-9.1) ---
  {
    code: 'partners.read',
    module: 'partners',
    description: 'Listar y ver clientes/proveedores',
  },
  {
    code: 'partners.manage',
    module: 'partners',
    description: 'Crear/editar/eliminar clientes y proveedores y sus contactos',
  },

  // --- Compras / órdenes (HU-9.2) ---
  {
    code: 'purchases.po.read',
    module: 'purchases',
    description: 'Ver órdenes de compra',
  },
  {
    code: 'purchases.po.manage',
    module: 'purchases',
    description: 'Crear/editar/eliminar órdenes de compra y aprobarlas o cancelarlas',
  },

  // --- Compras / recepciones (HU-9.3) ---
  {
    code: 'purchases.receipt.read',
    module: 'purchases',
    description: 'Ver recepciones de mercancía',
  },
  {
    code: 'purchases.receipt.manage',
    module: 'purchases',
    description: 'Registrar recepciones de mercancía (alimentan el kardex)',
  },

  // --- Ventas / cotizaciones (HU-10.1) ---
  {
    code: 'sales.quote.read',
    module: 'sales',
    description: 'Ver cotizaciones de venta',
  },
  {
    code: 'sales.quote.manage',
    module: 'sales',
    description: 'Crear/editar/eliminar cotizaciones y transitarlas (enviar, aceptar, rechazar)',
  },

  // --- Ventas / órdenes (HU-10.2) ---
  {
    code: 'sales.order.read',
    module: 'sales',
    description: 'Ver órdenes de venta',
  },
  {
    code: 'sales.order.manage',
    module: 'sales',
    description: 'Crear/editar/eliminar órdenes de venta y transitarlas (confirmar, cancelar)',
  },

  // --- Ventas / facturas (HU-10.3) ---
  {
    code: 'sales.invoice.read',
    module: 'sales',
    description: 'Ver facturas de venta',
  },
  {
    code: 'sales.invoice.manage',
    module: 'sales',
    description: 'Emitir facturas de venta (alimentan el kardex con OUT) y cancelarlas',
  },
];

async function seedCurrencies(): Promise<void> {
  const currencies = [
    { code: 'CRC', name: 'Colón costarricense', symbol: '₡' },
    { code: 'USD', name: 'Dólar estadounidense', symbol: '$' },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: { name: c.name, symbol: c.symbol },
      create: c,
    });
  }
  console.log(`  ✓ ${currencies.length} monedas`);
}

async function seedUnitsOfMeasure(): Promise<void> {
  const units = [
    { code: 'UND', name: 'Unidad' },
    { code: 'KG', name: 'Kilogramo' },
    { code: 'LT', name: 'Litro' },
  ];
  for (const u of units) {
    await prisma.unitOfMeasure.upsert({
      where: { code: u.code },
      update: { name: u.name },
      create: u,
    });
  }
  console.log(`  ✓ ${units.length} unidades de medida`);
}

async function seedPermissions(): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, description: p.description },
      create: p,
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permisos`);
}

async function seedDemoCompany(): Promise<bigint> {
  const company = await prisma.company.upsert({
    where: { taxId: '3-101-DEMO' },
    update: {
      legalName: 'MundoTec Demo S.A.',
      tradeName: 'MundoTec Demo',
      currencyCode: 'CRC',
    },
    create: {
      legalName: 'MundoTec Demo S.A.',
      tradeName: 'MundoTec Demo',
      taxId: '3-101-DEMO',
      currencyCode: 'CRC',
      email: 'demo@mundoteconline.com',
    },
  });
  console.log(`  ✓ empresa demo (id ${company.id})`);
  return company.id;
}

async function seedDemoTax(companyId: bigint): Promise<void> {
  const existing = await prisma.tax.findFirst({
    where: { companyId, name: 'IVA 13%' },
  });
  if (existing) {
    await prisma.tax.update({
      where: { id: existing.id },
      data: { rate: '0.1300', isActive: true },
    });
  } else {
    await prisma.tax.create({
      data: { companyId, name: 'IVA 13%', rate: '0.1300', isActive: true },
    });
  }
  console.log('  ✓ impuesto IVA 13%');
}

async function seedAdminRole(companyId: bigint): Promise<bigint> {
  const role = await prisma.role.upsert({
    where: { companyId_name: { companyId, name: 'admin' } },
    update: { description: 'Administrador con todos los permisos' },
    create: {
      companyId,
      name: 'admin',
      description: 'Administrador con todos los permisos',
    },
  });

  const allPermissions = await prisma.permission.findMany({ select: { id: true } });
  await prisma.rolePermission.createMany({
    data: allPermissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  console.log(`  ✓ rol admin (id ${role.id}) con ${allPermissions.length} permisos`);
  return role.id;
}

async function seedAdminUser(companyId: bigint, adminRoleId: bigint): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      'SEED_ADMIN_PASSWORD no está definido. Configúralo en .env antes de correr el seed.',
    );
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.appUser.upsert({
    where: { companyId_email: { companyId, email } },
    update: {
      passwordHash,
      fullName: 'Administrador Demo',
      isActive: true,
    },
    create: {
      companyId,
      username: 'admin',
      email,
      passwordHash,
      fullName: 'Administrador Demo',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRoleId } },
    update: {},
    create: { userId: user.id, roleId: adminRoleId },
  });

  console.log(`  ✓ usuario admin ${email} (id ${user.id})`);
}

async function main(): Promise<void> {
  console.log('▸ Seed núcleo MundoTec ERP');
  await seedCurrencies();
  await seedUnitsOfMeasure();
  await seedPermissions();
  const companyId = await seedDemoCompany();
  await seedDemoTax(companyId);
  const adminRoleId = await seedAdminRole(companyId);
  await seedAdminUser(companyId, adminRoleId);
  console.log('▸ Seed completo');
}

main()
  .catch((err) => {
    console.error('Seed falló:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
