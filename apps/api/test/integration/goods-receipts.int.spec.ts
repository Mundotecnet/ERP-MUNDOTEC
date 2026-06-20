import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'GR-1!aA';

interface Fixtures {
  companyAId: bigint;
  tokenA: string;
  tokenB: string;
  tokenReadOnly: string;
  supplierAId: string;
  supplierBId: string;
  warehouseAId: string;
  warehouseBId: string;
  productAId: string;
  product2AId: string;
  productServiceId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'GR A', taxId: '3-101-141414', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'GR B', taxId: '3-101-151515', currencyCode: 'USD' },
  });
  await tc.raw.currency.upsert({
    where: { code: 'CRC' },
    update: {},
    create: { code: 'CRC', name: 'Colón', symbol: '₡' },
  });
  await tc.raw.currency.upsert({
    where: { code: 'USD' },
    update: {},
    create: { code: 'USD', name: 'Dólar', symbol: '$' },
  });
  const uom = await tc.raw.unitOfMeasure.upsert({
    where: { code: 'UND' },
    update: {},
    create: { code: 'UND', name: 'Unidad' },
  });

  const codes = [
    'auth.login',
    'purchases.po.read',
    'purchases.po.manage',
    'purchases.receipt.read',
    'purchases.receipt.manage',
  ];
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
  const readPerm = perms.find((p) => p.code === 'purchases.receipt.read')!;

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

  const tokenA = await makeUser(a.id, 'gr-a', perms);
  const tokenB = await makeUser(b.id, 'gr-b', perms);
  const tokenReadOnly = await makeUser(a.id, 'gr-readonly', [loginPerm, readPerm]);

  const supplierA = await tc.raw.partner.create({
    data: { companyId: a.id, partnerType: 'SUPPLIER', legalName: 'Proveedor A', code: 'SUP' },
  });
  const supplierB = await tc.raw.partner.create({
    data: { companyId: b.id, partnerType: 'SUPPLIER', legalName: 'Proveedor B', code: 'SUP' },
  });
  const warehouseA = await tc.raw.warehouse.create({
    data: { companyId: a.id, code: 'WH-A', name: 'Central A' },
  });
  const warehouseB = await tc.raw.warehouse.create({
    data: { companyId: b.id, code: 'WH-B', name: 'Central B' },
  });
  const productA = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'P-A-1', name: 'Producto A', uomId: uom.id },
  });
  const product2A = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'P-A-2', name: 'Producto A2', uomId: uom.id },
  });
  const productService = await tc.raw.product.create({
    data: {
      companyId: a.id,
      sku: 'P-SRV',
      name: 'Servicio',
      uomId: uom.id,
      isInventoried: false,
    },
  });

  return {
    companyAId: a.id,
    tokenA,
    tokenB,
    tokenReadOnly,
    supplierAId: supplierA.id.toString(),
    supplierBId: supplierB.id.toString(),
    warehouseAId: warehouseA.id.toString(),
    warehouseBId: warehouseB.id.toString(),
    productAId: productA.id.toString(),
    product2AId: product2A.id.toString(),
    productServiceId: productService.id.toString(),
  };
}

describe('Goods Receipts (HU-9.3)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  function postPO(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function approvePO(token: string, id: string) {
    return request(tc.app.getHttpServer())
      .post(`/purchase-orders/${id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  function postReceipt(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/goods-receipts')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function createApprovedPO(
    token: string,
    orderNumber: string,
    lines: object[],
  ): Promise<{ id: string; lines: Array<{ id: string; productId: string }> }> {
    const created = await postPO(token, {
      supplierId: fx.supplierAId,
      orderNumber,
      currencyCode: 'CRC',
      lines,
    });
    expect(created.status).toBe(201);
    const approved = await approvePO(token, created.body.id);
    expect(approved.status).toBe(200);
    return { id: created.body.id, lines: created.body.lines };
  }

  describe('Recepción con OC', () => {
    it('recepción completa hace que la OC pase a RECEIVED y alimenta kardex', async () => {
      const po = await createApprovedPO(fx.tokenA, 'OC-FULL', [
        { productId: fx.productAId, quantity: '10', unitCost: '5' },
      ]);
      const res = await postReceipt(fx.tokenA, {
        purchaseOrderId: po.id,
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-FULL',
        lines: [{ productId: fx.productAId, quantity: '10' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.lines).toHaveLength(1);
      // unit_cost de la OC fue 5; sin override en el body, debe heredarlo.
      expect(res.body.lines[0]).toMatchObject({ quantity: '10', unitCost: '5' });

      // OC ahora RECEIVED y línea con received_qty = 10.
      const poRow = await tc.raw.purchaseOrder.findUnique({
        where: { id: BigInt(po.id) },
        include: { lines: true },
      });
      expect(poRow?.status).toBe('RECEIVED');
      expect(poRow?.lines[0].receivedQty.toString()).toBe('10');

      // Kardex: un IN con quantity=10, balance_qty=10, sourceDoc=RECEIPT.
      const movements = await tc.raw.stockMovement.findMany({
        where: { companyId: fx.companyAId, sourceDoc: 'RECEIPT' },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ movementType: 'IN' });
      expect(movements[0].quantity.toString()).toBe('10');
      expect(movements[0].balanceQty.toString()).toBe('10');
      expect(movements[0].sourceId?.toString()).toBe(res.body.id);

      // Stock snapshot: avg_cost = 5.
      const stock = await tc.raw.stock.findFirst({
        where: { productId: BigInt(fx.productAId), warehouseId: BigInt(fx.warehouseAId) },
      });
      expect(stock?.quantity.toString()).toBe('10');
      expect(stock?.avgCost.toString()).toBe('5');
    });

    it('recepción parcial deja la OC en APPROVED y avanza received_qty', async () => {
      const po = await createApprovedPO(fx.tokenA, 'OC-PART', [
        { productId: fx.product2AId, quantity: '20', unitCost: '8' },
      ]);
      const res = await postReceipt(fx.tokenA, {
        purchaseOrderId: po.id,
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-PART-1',
        lines: [{ productId: fx.product2AId, quantity: '7' }],
      });
      expect(res.status).toBe(201);

      const poRow = await tc.raw.purchaseOrder.findUnique({
        where: { id: BigInt(po.id) },
        include: { lines: true },
      });
      expect(poRow?.status).toBe('APPROVED');
      expect(poRow?.lines[0].receivedQty.toString()).toBe('7');
    });

    it('sobre-recibir excede el pendiente → 409 atómico, nada persiste', async () => {
      const po = await createApprovedPO(fx.tokenA, 'OC-OVER', [
        { productId: fx.productAId, quantity: '5', unitCost: '2' },
      ]);
      const beforeMovs = await tc.raw.stockMovement.count({ where: { companyId: fx.companyAId } });
      const beforeRecs = await tc.raw.goodsReceipt.count({ where: { companyId: fx.companyAId } });
      const res = await postReceipt(fx.tokenA, {
        purchaseOrderId: po.id,
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-OVER',
        lines: [{ productId: fx.productAId, quantity: '99' }],
      });
      expect(res.status).toBe(409);
      const afterMovs = await tc.raw.stockMovement.count({ where: { companyId: fx.companyAId } });
      const afterRecs = await tc.raw.goodsReceipt.count({ where: { companyId: fx.companyAId } });
      expect(afterMovs).toBe(beforeMovs);
      expect(afterRecs).toBe(beforeRecs);

      // La línea de OC sigue con receivedQty=0 (no se tocó).
      const poRow = await tc.raw.purchaseOrder.findUnique({
        where: { id: BigInt(po.id) },
        include: { lines: true },
      });
      expect(poRow?.lines[0].receivedQty.toString()).toBe('0');
    });

    it('FIFO sobre 2 líneas iguales: 30 unidades se reparten 10+20', async () => {
      const po = await createApprovedPO(fx.tokenA, 'OC-FIFO', [
        { productId: fx.productAId, quantity: '10', unitCost: '4' },
        { productId: fx.productAId, quantity: '20', unitCost: '6' },
      ]);
      const res = await postReceipt(fx.tokenA, {
        purchaseOrderId: po.id,
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-FIFO',
        lines: [{ productId: fx.productAId, quantity: '30' }],
      });
      expect(res.status).toBe(201);
      // Sin unitCost en body, la única línea de recepción consume las dos líneas
      // FIFO y guarda costo promedio ponderado: (10*4 + 20*6)/30 = 160/30 ≈ 5.3333.
      expect(res.body.lines[0].unitCost).toBe('5.3333');

      const poRow = await tc.raw.purchaseOrder.findUnique({
        where: { id: BigInt(po.id) },
        include: { lines: { orderBy: { id: 'asc' } } },
      });
      expect(poRow?.status).toBe('RECEIVED');
      expect(poRow?.lines[0].receivedQty.toString()).toBe('10');
      expect(poRow?.lines[1].receivedQty.toString()).toBe('20');
    });

    it('OC DRAFT no puede recibirse → 400', async () => {
      const created = await postPO(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-DRAFT',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitCost: '1' }],
      });
      const res = await postReceipt(fx.tokenA, {
        purchaseOrderId: created.body.id,
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-DRAFT',
        lines: [{ productId: fx.productAId, quantity: '1' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/APPROVED/);
    });

    it('producto no presente en la OC → 400', async () => {
      const po = await createApprovedPO(fx.tokenA, 'OC-MISS', [
        { productId: fx.productAId, quantity: '1', unitCost: '1' },
      ]);
      const res = await postReceipt(fx.tokenA, {
        purchaseOrderId: po.id,
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-MISS',
        lines: [{ productId: fx.product2AId, quantity: '1' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no está en la OC/);
    });

    it('override de unitCost en el body prevalece sobre la OC', async () => {
      const po = await createApprovedPO(fx.tokenA, 'OC-OV-COST', [
        { productId: fx.productAId, quantity: '5', unitCost: '10' },
      ]);
      const res = await postReceipt(fx.tokenA, {
        purchaseOrderId: po.id,
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-OV-COST',
        lines: [{ productId: fx.productAId, quantity: '5', unitCost: '12.5' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.lines[0].unitCost).toBe('12.5');
    });
  });

  describe('Recepción sin OC', () => {
    it('crea recepción y mueve kardex IN cuando viene unitCost', async () => {
      const res = await postReceipt(fx.tokenA, {
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-NOPO',
        lines: [{ productId: fx.product2AId, quantity: '4', unitCost: '15' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.purchaseOrderId).toBeNull();
      const mov = await tc.raw.stockMovement.findFirst({
        where: { companyId: fx.companyAId, sourceDoc: 'RECEIPT', sourceId: BigInt(res.body.id) },
      });
      expect(mov?.quantity.toString()).toBe('4');
      expect(mov?.unitCost.toString()).toBe('15');
    });

    it('sin OC y sin unitCost → 400', async () => {
      const res = await postReceipt(fx.tokenA, {
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-NOPO-NOCOST',
        lines: [{ productId: fx.product2AId, quantity: '1' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/unitCost/);
    });

    it('servicio (no inventariado) → 400', async () => {
      const res = await postReceipt(fx.tokenA, {
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-SRV',
        lines: [{ productId: fx.productServiceId, quantity: '1', unitCost: '5' }],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Validaciones generales', () => {
    it('receipt_number duplicado por empresa → 409', async () => {
      // GR-FULL ya existe del primer test.
      const res = await postReceipt(fx.tokenA, {
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-FULL',
        lines: [{ productId: fx.product2AId, quantity: '1', unitCost: '1' }],
      });
      expect(res.status).toBe(409);
    });

    it('mismo receipt_number permitido en otra empresa', async () => {
      const companyB = (await tc.raw.company.findFirst({ where: { taxId: '3-101-151515' } }))!;
      const uom = (await tc.raw.unitOfMeasure.findFirst({ where: { code: 'UND' } }))!;
      const productB = await tc.raw.product.create({
        data: {
          companyId: companyB.id,
          sku: 'P-B-DUP',
          name: 'Producto B',
          uomId: uom.id,
        },
      });
      const res = await postReceipt(fx.tokenB, {
        warehouseId: fx.warehouseBId,
        receiptNumber: 'GR-FULL',
        lines: [{ productId: productB.id.toString(), quantity: '1', unitCost: '1' }],
      });
      expect(res.status).toBe(201);
    });

    it('almacén de otra empresa → 400', async () => {
      const res = await postReceipt(fx.tokenA, {
        warehouseId: fx.warehouseBId,
        receiptNumber: 'GR-CROSS-WH',
        lines: [{ productId: fx.product2AId, quantity: '1', unitCost: '1' }],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Listado y aislamiento', () => {
    it('GET /goods-receipts solo de la empresa del usuario', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/goods-receipts')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      const numbers = res.body.map((r: { receiptNumber: string }) => r.receiptNumber);
      expect(numbers).toContain('GR-FULL');
    });

    it('GET con purchaseOrderId filtra', async () => {
      const po = await createApprovedPO(fx.tokenA, 'OC-FILTER', [
        { productId: fx.productAId, quantity: '1', unitCost: '1' },
      ]);
      const created = await postReceipt(fx.tokenA, {
        purchaseOrderId: po.id,
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-FILTER',
        lines: [{ productId: fx.productAId, quantity: '1' }],
      });
      expect(created.status).toBe(201);
      const res = await request(tc.app.getHttpServer())
        .get(`/goods-receipts?purchaseOrderId=${po.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].receiptNumber).toBe('GR-FILTER');
    });
  });

  describe('RBAC', () => {
    it('POST con rol read-only → 403', async () => {
      const res = await postReceipt(fx.tokenReadOnly, {
        warehouseId: fx.warehouseAId,
        receiptNumber: 'GR-NO-PERM',
        lines: [{ productId: fx.product2AId, quantity: '1', unitCost: '1' }],
      });
      expect(res.status).toBe(403);
    });

    it('GET con rol read-only → 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/goods-receipts')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });

    it('sin token → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/goods-receipts');
      expect(res.status).toBe(401);
    });
  });
});
