import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Move-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenA: string;
  tokenB: string;
  tokenReadOnly: string;
  productAId: string;
  productServiceId: string;
  productBId: string;
  warehouseAId: string;
  warehouseBId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Move A', taxId: '3-101-919191', currencyCode: 'USD' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Move B', taxId: '3-101-020202', currencyCode: 'USD' },
  });

  const uom = await tc.raw.unitOfMeasure.upsert({
    where: { code: 'UND' },
    update: {},
    create: { code: 'UND', name: 'Unidad' },
  });

  const codes = ['auth.login', 'inventory.movement.read', 'inventory.movement.manage'];
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
  const readPerm = perms.find((p) => p.code === 'inventory.movement.read')!;

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

  const tokenA = await makeUser(a.id, 'move-a', perms);
  const tokenB = await makeUser(b.id, 'move-b', perms);
  const tokenReadOnly = await makeUser(a.id, 'move-readonly', [loginPerm, readPerm]);

  const productA = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'M-A-1', name: 'Cable HDMI', uomId: uom.id },
  });
  const productService = await tc.raw.product.create({
    data: {
      companyId: a.id,
      sku: 'M-SRV',
      name: 'Soporte técnico',
      uomId: uom.id,
      isInventoried: false,
    },
  });
  const productB = await tc.raw.product.create({
    data: { companyId: b.id, sku: 'M-B-1', name: 'Adaptador VGA', uomId: uom.id },
  });

  const warehouseA = await tc.raw.warehouse.create({
    data: { companyId: a.id, code: 'WHA', name: 'Central A' },
  });
  const warehouseB = await tc.raw.warehouse.create({
    data: { companyId: b.id, code: 'WHB', name: 'Central B' },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenA,
    tokenB,
    tokenReadOnly,
    productAId: productA.id.toString(),
    productServiceId: productService.id.toString(),
    productBId: productB.id.toString(),
    warehouseAId: warehouseA.id.toString(),
    warehouseBId: warehouseB.id.toString(),
  };
}

describe('Stock movements / kardex (HU-8.1, HU-8.2)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  function post(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/stock-movements')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  describe('Costo promedio ponderado', () => {
    it('calcula CPP correcto sobre 3 entradas con costos distintos y una salida', async () => {
      // Entrada 1: 10 unidades @ $5 → stock = 10 @ $5
      const r1 = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'IN',
        quantity: '10',
        unitCost: '5.0000',
      });
      expect(r1.status).toBe(201);
      expect(r1.body.balanceQty).toBe('10');

      // Entrada 2: 20 unidades @ $8 → stock = 30, avg = (10*5 + 20*8)/30 = 210/30 = 7
      const r2 = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'IN',
        quantity: '20',
        unitCost: '8.0000',
      });
      expect(r2.status).toBe(201);
      expect(r2.body.balanceQty).toBe('30');

      // Salida: 5 unidades → stock = 25, avg sigue siendo 7
      const r3 = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'OUT',
        quantity: '-5',
        notes: 'venta sin documento',
      });
      expect(r3.status).toBe(201);
      expect(r3.body.balanceQty).toBe('25');

      // Verificar snapshot
      const stockRow = await tc.raw.stock.findFirst({
        where: { productId: BigInt(fx.productAId), warehouseId: BigInt(fx.warehouseAId) },
      });
      expect(stockRow?.quantity.toString()).toBe('25');
      expect(stockRow?.avgCost.toString()).toBe('7');

      // Entrada 3: 5 unidades @ $10 → stock = 30, avg = (25*7 + 5*10)/30 = 225/30 = 7.5
      const r4 = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'IN',
        quantity: '5',
        unitCost: '10.0000',
      });
      expect(r4.status).toBe(201);
      expect(r4.body.balanceQty).toBe('30');
      const stock2 = await tc.raw.stock.findFirst({
        where: { productId: BigInt(fx.productAId), warehouseId: BigInt(fx.warehouseAId) },
      });
      expect(stock2?.avgCost.toString()).toBe('7.5');
    });
  });

  describe('Validaciones', () => {
    it('IN con cantidad negativa → 400', async () => {
      const res = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'IN',
        quantity: '-3',
      });
      expect(res.status).toBe(400);
    });

    it('OUT con cantidad positiva → 400', async () => {
      const res = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'OUT',
        quantity: '3',
      });
      expect(res.status).toBe(400);
    });

    it('ADJUST con cantidad 0 → 400', async () => {
      const res = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'ADJUST',
        quantity: '0',
      });
      expect(res.status).toBe(400);
    });

    it('producto no inventariado (servicio) → 400', async () => {
      const res = await post(fx.tokenA, {
        productId: fx.productServiceId,
        warehouseId: fx.warehouseAId,
        movementType: 'IN',
        quantity: '1',
        unitCost: '0',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/inventariado|servicio/i);
    });

    it('saldo negativo → 409 y no persiste', async () => {
      const before = await tc.raw.stockMovement.count({
        where: { companyId: fx.companyAId, productId: BigInt(fx.productAId) },
      });
      const res = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'OUT',
        quantity: '-9999',
      });
      expect(res.status).toBe(409);
      const after = await tc.raw.stockMovement.count({
        where: { companyId: fx.companyAId, productId: BigInt(fx.productAId) },
      });
      expect(after).toBe(before);
    });

    it('producto inexistente → 404', async () => {
      const res = await post(fx.tokenA, {
        productId: '999999',
        warehouseId: fx.warehouseAId,
        movementType: 'IN',
        quantity: '1',
        unitCost: '1',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Aislamiento por empresa', () => {
    it('un usuario de B no puede mover stock de un producto de A', async () => {
      const res = await post(fx.tokenB, {
        productId: fx.productAId,
        warehouseId: fx.warehouseBId,
        movementType: 'IN',
        quantity: '1',
        unitCost: '1',
      });
      expect(res.status).toBe(404);
    });

    it('un usuario de A no puede mover stock en almacén de B', async () => {
      const res = await post(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseBId,
        movementType: 'IN',
        quantity: '1',
        unitCost: '1',
      });
      expect(res.status).toBe(404);
    });

    it('GET /stock-movements lista sólo movimientos de la empresa del usuario', async () => {
      // Crear movimiento en B para asegurar aislamiento.
      await post(fx.tokenB, {
        productId: fx.productBId,
        warehouseId: fx.warehouseBId,
        movementType: 'IN',
        quantity: '5',
        unitCost: '2',
      });
      const resA = await request(tc.app.getHttpServer())
        .get('/stock-movements')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.every((m: { productSku: string }) => m.productSku.startsWith('M-A'))).toBe(
        true,
      );
      const resB = await request(tc.app.getHttpServer())
        .get('/stock-movements')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.every((m: { productSku: string }) => m.productSku === 'M-B-1')).toBe(true);
    });
  });

  describe('RBAC', () => {
    it('POST con rol read-only → 403', async () => {
      const res = await post(fx.tokenReadOnly, {
        productId: fx.productAId,
        warehouseId: fx.warehouseAId,
        movementType: 'IN',
        quantity: '1',
        unitCost: '1',
      });
      expect(res.status).toBe(403);
    });

    it('GET con rol read-only → 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/stock-movements')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });

    it('sin token → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/stock-movements');
      expect(res.status).toBe(401);
    });
  });

  describe('Filtros del kardex', () => {
    it('GET con productId filtra por producto', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/stock-movements?productId=${fx.productAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.every((m: { productId: string }) => m.productId === fx.productAId)).toBe(
        true,
      );
      // El último movimiento debe tener balance_qty 30 (CPP).
      const last = res.body[res.body.length - 1];
      expect(last.balanceQty).toBe('30');
    });

    it('GET con from en el futuro devuelve []', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/stock-movements?from=2099-01-01T00:00:00Z')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
