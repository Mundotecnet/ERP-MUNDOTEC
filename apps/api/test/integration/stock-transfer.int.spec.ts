import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Trsf-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenA: string;
  tokenB: string;
  tokenReadOnly: string;
  productAId: string;
  productServiceId: string;
  warehouseA1Id: string;
  warehouseA2Id: string;
  warehouseBId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Transfer A', taxId: '3-101-313131', currencyCode: 'USD' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Transfer B', taxId: '3-101-414141', currencyCode: 'USD' },
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
        fullName: username,
      },
    });
    await tc.raw.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const login = await request(tc.app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: STRONG });
    return login.body.accessToken as string;
  }

  const tokenA = await makeUser(a.id, 'trsf-a', perms);
  const tokenB = await makeUser(b.id, 'trsf-b', perms);
  const tokenReadOnly = await makeUser(a.id, 'trsf-readonly', [loginPerm, readPerm]);

  const productA = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'T-A-1', name: 'Adaptador USB', uomId: uom.id },
  });
  const productService = await tc.raw.product.create({
    data: {
      companyId: a.id,
      sku: 'T-SRV',
      name: 'Servicio técnico',
      uomId: uom.id,
      isInventoried: false,
    },
  });
  const warehouseA1 = await tc.raw.warehouse.create({
    data: { companyId: a.id, code: 'WH-A1', name: 'Central A' },
  });
  const warehouseA2 = await tc.raw.warehouse.create({
    data: { companyId: a.id, code: 'WH-A2', name: 'Sucursal A' },
  });
  const warehouseB = await tc.raw.warehouse.create({
    data: { companyId: b.id, code: 'WH-B', name: 'Central B' },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenA,
    tokenB,
    tokenReadOnly,
    productAId: productA.id.toString(),
    productServiceId: productService.id.toString(),
    warehouseA1Id: warehouseA1.id.toString(),
    warehouseA2Id: warehouseA2.id.toString(),
    warehouseBId: warehouseB.id.toString(),
  };
}

describe('Transferencias entre almacenes (HU-8.3)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  function postMovement(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/stock-movements')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function postTransfer(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/stock-movements/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  describe('Feliz', () => {
    it('genera OUT+IN atómicos, source_id cruzado, y recalcula CPP en destino', async () => {
      // Cargar origen: 10 @ $4 (avg=4) y destino: 5 @ $10 (avg=10).
      await postMovement(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseA1Id,
        movementType: 'IN',
        quantity: '10',
        unitCost: '4',
      });
      await postMovement(fx.tokenA, {
        productId: fx.productAId,
        warehouseId: fx.warehouseA2Id,
        movementType: 'IN',
        quantity: '5',
        unitCost: '10',
      });

      // Transfer 6 unidades de A1 → A2.
      const res = await postTransfer(fx.tokenA, {
        productId: fx.productAId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA2Id,
        quantity: '6',
        notes: 'reabastece sucursal',
      });
      expect(res.status).toBe(201);
      expect(res.body.out).toMatchObject({
        movementType: 'OUT',
        warehouseId: fx.warehouseA1Id,
        quantity: '-6',
        unitCost: '4', // costo del origen al momento
        balanceQty: '4',
        sourceDoc: 'TRANSFER',
      });
      expect(res.body.in).toMatchObject({
        movementType: 'IN',
        warehouseId: fx.warehouseA2Id,
        quantity: '6',
        unitCost: '4',
        balanceQty: '11',
        sourceDoc: 'TRANSFER',
      });

      // source_id cruzado.
      expect(res.body.out.sourceId).toBe(res.body.in.id);
      expect(res.body.in.sourceId).toBe(res.body.out.id);

      // CPP del destino: (5*10 + 6*4) / 11 = (50 + 24) / 11 = 74/11 ≈ 6.7272…
      const destStock = await tc.raw.stock.findFirst({
        where: { productId: BigInt(fx.productAId), warehouseId: BigInt(fx.warehouseA2Id) },
      });
      expect(destStock?.quantity.toString()).toBe('11');
      // Comparar con tolerancia: el motor trunca a 4 decimales.
      const expectedAvg = 74 / 11;
      expect(Math.abs(Number(destStock?.avgCost) - expectedAvg)).toBeLessThan(0.0002);

      // CPP del origen no cambia (sigue 4).
      const originStock = await tc.raw.stock.findFirst({
        where: { productId: BigInt(fx.productAId), warehouseId: BigInt(fx.warehouseA1Id) },
      });
      expect(originStock?.quantity.toString()).toBe('4');
      expect(originStock?.avgCost.toString()).toBe('4');
    });
  });

  describe('Validaciones', () => {
    it('from == to → 400 y no persiste', async () => {
      const before = await tc.raw.stockMovement.count({
        where: { companyId: fx.companyAId, sourceDoc: 'TRANSFER' },
      });
      const res = await postTransfer(fx.tokenA, {
        productId: fx.productAId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA1Id,
        quantity: '1',
      });
      expect(res.status).toBe(400);
      const after = await tc.raw.stockMovement.count({
        where: { companyId: fx.companyAId, sourceDoc: 'TRANSFER' },
      });
      expect(after).toBe(before);
    });

    it('cantidad 0 o negativa → 400', async () => {
      const zero = await postTransfer(fx.tokenA, {
        productId: fx.productAId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA2Id,
        quantity: '0',
      });
      expect(zero.status).toBe(400);
      const neg = await postTransfer(fx.tokenA, {
        productId: fx.productAId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA2Id,
        quantity: '-3',
      });
      expect(neg.status).toBe(400);
    });

    it('saldo insuficiente en origen → 409 y NO persiste ningún movimiento', async () => {
      const before = await tc.raw.stockMovement.count({
        where: { companyId: fx.companyAId, sourceDoc: 'TRANSFER' },
      });
      const res = await postTransfer(fx.tokenA, {
        productId: fx.productAId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA2Id,
        quantity: '9999',
      });
      expect(res.status).toBe(409);
      const after = await tc.raw.stockMovement.count({
        where: { companyId: fx.companyAId, sourceDoc: 'TRANSFER' },
      });
      expect(after).toBe(before);
    });

    it('producto no inventariado (servicio) → 400', async () => {
      const res = await postTransfer(fx.tokenA, {
        productId: fx.productServiceId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA2Id,
        quantity: '1',
      });
      expect(res.status).toBe(400);
    });

    it('producto inexistente → 404', async () => {
      const res = await postTransfer(fx.tokenA, {
        productId: '999999',
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA2Id,
        quantity: '1',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Aislamiento por empresa', () => {
    it('almacén destino de otra empresa → 404', async () => {
      const res = await postTransfer(fx.tokenA, {
        productId: fx.productAId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseBId,
        quantity: '1',
      });
      expect(res.status).toBe(404);
    });

    it('usuario de B no ve producto de A → 404', async () => {
      const res = await postTransfer(fx.tokenB, {
        productId: fx.productAId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA2Id,
        quantity: '1',
      });
      expect(res.status).toBe(404);
    });

    it('GET /stock-movements filtra TRANSFER por empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/stock-movements')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const transfers = res.body.filter(
        (m: { sourceDoc: string | null }) => m.sourceDoc === 'TRANSFER',
      );
      // Debe haber al menos 2 (OUT + IN) del caso feliz.
      expect(transfers.length).toBeGreaterThanOrEqual(2);
      expect(
        transfers.every((m: { warehouseCode: string }) => m.warehouseCode.startsWith('WH-A')),
      ).toBe(true);
    });
  });

  describe('RBAC', () => {
    it('read-only no puede transferir → 403', async () => {
      const res = await postTransfer(fx.tokenReadOnly, {
        productId: fx.productAId,
        fromWarehouseId: fx.warehouseA1Id,
        toWarehouseId: fx.warehouseA2Id,
        quantity: '1',
      });
      expect(res.status).toBe(403);
    });

    it('sin token → 401', async () => {
      const res = await request(tc.app.getHttpServer()).post('/stock-movements/transfer').send({});
      expect(res.status).toBe(401);
    });
  });
});
