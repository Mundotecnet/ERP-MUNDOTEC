import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Stock-1!aA';

interface Fixtures {
  tokenA: string;
  tokenB: string;
  tokenNoPerm: string;
  productAId: string;
  productAOtherId: string;
  productBId: string;
  warehouseAMainId: string;
  warehouseASecondaryId: string;
  warehouseBId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Stock A', taxId: '3-101-717171', currencyCode: 'USD' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Stock B', taxId: '3-101-818181', currencyCode: 'USD' },
  });

  const uom = await tc.raw.unitOfMeasure.upsert({
    where: { code: 'UND' },
    update: {},
    create: { code: 'UND', name: 'Unidad' },
  });

  const codes = ['auth.login', 'inventory.stock.read'];
  const perms = await Promise.all(
    codes.map((code) =>
      tc.raw.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: code.split('.')[0], description: code },
      }),
    ),
  );
  const loginPerm = perms.find((p) => p.code === 'auth.login')!;

  async function makeUser(
    companyId: bigint,
    username: string,
    permsForRole: typeof perms,
  ): Promise<string> {
    const role = await tc.raw.role.create({
      data: { companyId, name: `role-${username}`, description: 'test' },
    });
    await tc.raw.rolePermission.createMany({
      data: permsForRole.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    const user = await tc.raw.appUser.create({
      data: {
        companyId,
        username,
        email: `${username}@demo.local`,
        passwordHash: await bcrypt.hash(STRONG, 4),
        fullName: `${username}`,
      },
    });
    await tc.raw.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const login = await request(tc.app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: STRONG });
    return login.body.accessToken as string;
  }

  const tokenA = await makeUser(a.id, 'stock-a', perms);
  const tokenB = await makeUser(b.id, 'stock-b', perms);
  const tokenNoPerm = await makeUser(a.id, 'stock-noperm', [loginPerm]);

  // Productos y almacenes
  const productA = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'A-001', name: 'Cable HDMI', uomId: uom.id },
  });
  const productAOther = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'A-002', name: 'Cable USB-C', uomId: uom.id },
  });
  const productB = await tc.raw.product.create({
    data: { companyId: b.id, sku: 'B-001', name: 'Adaptador VGA', uomId: uom.id },
  });
  const productASoftDeleted = await tc.raw.product.create({
    data: {
      companyId: a.id,
      sku: 'A-DEL',
      name: 'Producto borrado',
      uomId: uom.id,
      deletedAt: new Date(),
    },
  });

  const warehouseAMain = await tc.raw.warehouse.create({
    data: { companyId: a.id, code: 'WH-A-1', name: 'Central A' },
  });
  const warehouseASecondary = await tc.raw.warehouse.create({
    data: { companyId: a.id, code: 'WH-A-2', name: 'Sucursal A' },
  });
  const warehouseB = await tc.raw.warehouse.create({
    data: { companyId: b.id, code: 'WH-B-1', name: 'Central B' },
  });

  // Stock seed
  await tc.raw.stock.createMany({
    data: [
      {
        productId: productA.id,
        warehouseId: warehouseAMain.id,
        quantity: '25.0000',
        avgCost: '4.5000',
      },
      {
        productId: productA.id,
        warehouseId: warehouseASecondary.id,
        quantity: '10.0000',
        avgCost: '4.5000',
      },
      {
        productId: productAOther.id,
        warehouseId: warehouseAMain.id,
        quantity: '60.0000',
        avgCost: '2.1000',
      },
      {
        productId: productB.id,
        warehouseId: warehouseB.id,
        quantity: '100.0000',
        avgCost: '1.0000',
      },
      // Producto soft-deleted: NO debe aparecer en el listado de A.
      {
        productId: productASoftDeleted.id,
        warehouseId: warehouseAMain.id,
        quantity: '7.0000',
        avgCost: '0.0000',
      },
    ],
  });

  return {
    tokenA,
    tokenB,
    tokenNoPerm,
    productAId: productA.id.toString(),
    productAOtherId: productAOther.id.toString(),
    productBId: productB.id.toString(),
    warehouseAMainId: warehouseAMain.id.toString(),
    warehouseASecondaryId: warehouseASecondary.id.toString(),
    warehouseBId: warehouseB.id.toString(),
  };
}

describe('Stock snapshot (HU-7.2)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  it('GET /stock devuelve sólo las filas de la empresa del usuario y omite productos soft-deleted', async () => {
    const res = await request(tc.app.getHttpServer())
      .get('/stock')
      .set('Authorization', `Bearer ${fx.tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const skus = res.body.map((r: { productSku: string }) => r.productSku).sort();
    expect(skus).toEqual(['A-001', 'A-001', 'A-002']);
    expect(res.body.every((r: { productSku: string }) => r.productSku !== 'A-DEL')).toBe(true);
  });

  it('filtra por productId', async () => {
    const res = await request(tc.app.getHttpServer())
      .get(`/stock?productId=${fx.productAId}`)
      .set('Authorization', `Bearer ${fx.tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((r: { productId: string }) => r.productId === fx.productAId)).toBe(true);
  });

  it('filtra por warehouseId', async () => {
    const res = await request(tc.app.getHttpServer())
      .get(`/stock?warehouseId=${fx.warehouseAMainId}`)
      .set('Authorization', `Bearer ${fx.tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(
      res.body.every((r: { warehouseId: string }) => r.warehouseId === fx.warehouseAMainId),
    ).toBe(true);
  });

  it('filtra por ambos parámetros combinados', async () => {
    const res = await request(tc.app.getHttpServer())
      .get(`/stock?productId=${fx.productAId}&warehouseId=${fx.warehouseAMainId}`)
      .set('Authorization', `Bearer ${fx.tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      productSku: 'A-001',
      warehouseCode: 'WH-A-1',
      quantity: '25',
      avgCost: '4.5',
    });
  });

  it('un usuario de la empresa B no ve stock de la empresa A', async () => {
    const res = await request(tc.app.getHttpServer())
      .get(`/stock?productId=${fx.productAId}`)
      .set('Authorization', `Bearer ${fx.tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('rechaza productId no numérico', async () => {
    const res = await request(tc.app.getHttpServer())
      .get('/stock?productId=abc')
      .set('Authorization', `Bearer ${fx.tokenA}`);
    expect(res.status).toBe(400);
  });

  it('sin token responde 401', async () => {
    const res = await request(tc.app.getHttpServer()).get('/stock');
    expect(res.status).toBe(401);
  });

  it('sin permiso inventory.stock.read responde 403', async () => {
    const res = await request(tc.app.getHttpServer())
      .get('/stock')
      .set('Authorization', `Bearer ${fx.tokenNoPerm}`);
    expect(res.status).toBe(403);
  });
});
