import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Inv-1!aA';

interface Fixtures {
  companyAId: bigint;
  tokenA: string;
  tokenB: string;
  tokenReadOnly: string;
  customerAId: string;
  customerBothAId: string;
  supplierOnlyAId: string;
  customerBId: string;
  branchAId: string;
  warehouseAId: string;
  warehouseBId: string;
  productAId: string;
  product2AId: string;
  productServiceId: string;
  productBId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Inv A', taxId: '3-101-353535', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Inv B', taxId: '3-101-363636', currencyCode: 'USD' },
  });
  await tc.raw.currency.upsert({
    where: { code: 'USD' },
    update: {},
    create: { code: 'USD', name: 'Dólar', symbol: '$' },
  });
  await tc.raw.currency.upsert({
    where: { code: 'CRC' },
    update: {},
    create: { code: 'CRC', name: 'Colón', symbol: '₡' },
  });
  const uom = await tc.raw.unitOfMeasure.upsert({
    where: { code: 'UND' },
    update: {},
    create: { code: 'UND', name: 'Unidad' },
  });

  const codes = [
    'auth.login',
    'sales.order.read',
    'sales.order.manage',
    'sales.invoice.read',
    'sales.invoice.manage',
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
  const readPerm = perms.find((p) => p.code === 'sales.invoice.read')!;

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

  const tokenA = await makeUser(a.id, 'inv-a', perms);
  const tokenB = await makeUser(b.id, 'inv-b', perms);
  const tokenReadOnly = await makeUser(a.id, 'inv-readonly', [loginPerm, readPerm]);

  const customerA = await tc.raw.partner.create({
    data: { companyId: a.id, partnerType: 'CUSTOMER', legalName: 'Cliente A', code: 'CUS' },
  });
  const customerBoth = await tc.raw.partner.create({
    data: { companyId: a.id, partnerType: 'BOTH', legalName: 'Ambos A', code: 'BTH' },
  });
  const supplierOnly = await tc.raw.partner.create({
    data: { companyId: a.id, partnerType: 'SUPPLIER', legalName: 'Solo Proveedor', code: 'SUP' },
  });
  const customerB = await tc.raw.partner.create({
    data: { companyId: b.id, partnerType: 'CUSTOMER', legalName: 'Cliente B', code: 'CUS' },
  });
  const branchA = await tc.raw.branch.create({
    data: { companyId: a.id, code: 'BR-A', name: 'Central A' },
  });
  const warehouseA = await tc.raw.warehouse.create({
    data: { companyId: a.id, branchId: branchA.id, code: 'WH-A', name: 'Bodega A' },
  });
  const warehouseB = await tc.raw.warehouse.create({
    data: { companyId: b.id, code: 'WH-B', name: 'Bodega B' },
  });
  const productA = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'INV-A-1', name: 'Producto INV', uomId: uom.id },
  });
  const product2A = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'INV-A-2', name: 'Producto INV 2', uomId: uom.id },
  });
  const productService = await tc.raw.product.create({
    data: {
      companyId: a.id,
      sku: 'INV-SRV',
      name: 'Servicio',
      uomId: uom.id,
      isInventoried: false,
    },
  });
  const productB = await tc.raw.product.create({
    data: { companyId: b.id, sku: 'INV-B-1', name: 'Producto INV B', uomId: uom.id },
  });

  return {
    companyAId: a.id,
    tokenA,
    tokenB,
    tokenReadOnly,
    customerAId: customerA.id.toString(),
    customerBothAId: customerBoth.id.toString(),
    supplierOnlyAId: supplierOnly.id.toString(),
    customerBId: customerB.id.toString(),
    branchAId: branchA.id.toString(),
    warehouseAId: warehouseA.id.toString(),
    warehouseBId: warehouseB.id.toString(),
    productAId: productA.id.toString(),
    product2AId: product2A.id.toString(),
    productServiceId: productService.id.toString(),
    productBId: productB.id.toString(),
  };
}

/** Cargar stock inicial sin pasar por el endpoint para no acoplar tests. */
async function seedStock(
  tc: AppTestContext,
  productId: string,
  warehouseId: string,
  quantity: string,
  unitCost = '10',
) {
  await tc.raw.stock.upsert({
    where: {
      productId_warehouseId: {
        productId: BigInt(productId),
        warehouseId: BigInt(warehouseId),
      },
    },
    update: { quantity, avgCost: unitCost },
    create: {
      productId: BigInt(productId),
      warehouseId: BigInt(warehouseId),
      quantity,
      avgCost: unitCost,
    },
  });
}

describe('Invoices (HU-10.3)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  function postInv(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function postSO(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/sales-orders')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function soAction(token: string, id: string, name: string) {
    return request(tc.app.getHttpServer())
      .post(`/sales-orders/${id}/${name}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  describe('Emisión feliz', () => {
    it('emite factura sin OV: kardex OUT, stock baja, balance = total', async () => {
      await seedStock(tc, fx.productAId, fx.warehouseAId, '100', '10');
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-001',
        currencyCode: 'CRC',
        lines: [
          { productId: fx.productAId, quantity: '5', unitPrice: '50', taxRate: '0.13' },
          { description: 'Cargo por envío', quantity: '1', unitPrice: '100' },
        ],
      });
      expect(res.status).toBe(201);
      // L1: 5*50 = 250, tax = 32.5, total = 282.5
      // L2: 100, tax = 0, total = 100
      // Σ subtotal=350, tax=32.5, total=382.5
      expect(res.body).toMatchObject({
        status: 'ISSUED',
        currencyCode: 'CRC',
        subtotal: '350',
        taxAmount: '32.5',
        total: '382.5',
        baseTotal: '382.5',
        paidAmount: '0',
        balance: '382.5',
      });

      // Stock bajó de 100 a 95.
      const stock = await tc.raw.stock.findFirst({
        where: { productId: BigInt(fx.productAId), warehouseId: BigInt(fx.warehouseAId) },
      });
      expect(stock?.quantity.toString()).toBe('95');

      // Hay 1 movimiento OUT con sourceDoc=INVOICE (la línea de servicio no
      // movió stock).
      const movs = await tc.raw.stockMovement.findMany({
        where: {
          companyId: fx.companyAId,
          sourceDoc: 'INVOICE',
          sourceId: BigInt(res.body.id),
        },
      });
      expect(movs).toHaveLength(1);
      expect(movs[0].movementType).toBe('OUT');
      expect(movs[0].quantity.toString()).toBe('-5');
    });

    it('emite factura desde OV: la OV pasa a INVOICED en la misma tx', async () => {
      await seedStock(tc, fx.product2AId, fx.warehouseAId, '50', '20');
      const so = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-FOR-INV',
        currencyCode: 'CRC',
        lines: [{ productId: fx.product2AId, quantity: '3', unitPrice: '40' }],
      });
      await soAction(fx.tokenA, so.body.id, 'confirm');

      const inv = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        salesOrderId: so.body.id,
        invoiceNumber: 'INV-SO',
        currencyCode: 'CRC',
        lines: [{ productId: fx.product2AId, quantity: '3', unitPrice: '40' }],
      });
      expect(inv.status).toBe(201);
      expect(inv.body.salesOrderNumber).toBe('SO-FOR-INV');

      const soRow = await tc.raw.salesOrder.findUnique({
        where: { id: BigInt(so.body.id) },
      });
      expect(soRow?.status).toBe('INVOICED');
    });

    it('multimoneda calcula base_total con exchange_rate', async () => {
      await seedStock(tc, fx.productAId, fx.warehouseAId, '50', '10');
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-USD',
        currencyCode: 'USD',
        exchangeRate: '500',
        lines: [{ productId: fx.productAId, quantity: '2', unitPrice: '20' }],
      });
      expect(res.status).toBe(201);
      // total=40 USD, base_total=20000
      expect(res.body.total).toBe('40');
      expect(res.body.baseTotal).toBe('20000');
    });

    it('factura solo con líneas de servicio (sin producto) no mueve kardex', async () => {
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-SRV-ONLY',
        currencyCode: 'CRC',
        lines: [{ description: 'Consultoría', quantity: '1', unitPrice: '200' }],
      });
      expect(res.status).toBe(201);
      const movs = await tc.raw.stockMovement.findMany({
        where: { sourceDoc: 'INVOICE', sourceId: BigInt(res.body.id) },
      });
      expect(movs).toHaveLength(0);
    });
  });

  describe('Validaciones', () => {
    it('stock insuficiente en una línea → 409 atómico (nada persiste)', async () => {
      await seedStock(tc, fx.productAId, fx.warehouseAId, '2', '10');
      const beforeInvs = await tc.raw.invoice.count({ where: { companyId: fx.companyAId } });
      const beforeMovs = await tc.raw.stockMovement.count({
        where: { companyId: fx.companyAId, sourceDoc: 'INVOICE' },
      });

      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-OVERSELL',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '99', unitPrice: '10' }],
      });
      expect(res.status).toBe(409);

      const afterInvs = await tc.raw.invoice.count({ where: { companyId: fx.companyAId } });
      const afterMovs = await tc.raw.stockMovement.count({
        where: { companyId: fx.companyAId, sourceDoc: 'INVOICE' },
      });
      expect(afterInvs).toBe(beforeInvs);
      expect(afterMovs).toBe(beforeMovs);

      const stock = await tc.raw.stock.findFirst({
        where: { productId: BigInt(fx.productAId), warehouseId: BigInt(fx.warehouseAId) },
      });
      expect(stock?.quantity.toString()).toBe('2');
    });

    it('cliente requerido → 400', async () => {
      const res = await postInv(fx.tokenA, {
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-NO-CUST',
        currencyCode: 'CRC',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('cliente SUPPLIER puro → 400', async () => {
      const res = await postInv(fx.tokenA, {
        customerId: fx.supplierOnlyAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-BAD-CUST',
        currencyCode: 'CRC',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('cliente de otra empresa → 400', async () => {
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerBId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-X-CUST',
        currencyCode: 'CRC',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('almacén de otra empresa → 400', async () => {
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseBId,
        invoiceNumber: 'INV-X-WH',
        currencyCode: 'CRC',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('producto cross-tenant → 400', async () => {
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-X-PROD',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productBId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('línea con productId de servicio (isInventoried=false) → 400', async () => {
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-SRV-PROD',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productServiceId, quantity: '1', unitPrice: '50' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/inventariado/);
    });

    it('línea sin producto y sin descripción → 400', async () => {
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-EMPTY-LINE',
        currencyCode: 'CRC',
        lines: [{ quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('SO en DRAFT → 400 al referenciar', async () => {
      const so = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-DRAFT-FOR-INV',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        salesOrderId: so.body.id,
        invoiceNumber: 'INV-DRAFT-SO',
        currencyCode: 'CRC',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/CONFIRMED/);
    });

    it('SO con cliente distinto → 400', async () => {
      await seedStock(tc, fx.productAId, fx.warehouseAId, '50', '10');
      const so = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-OTHER-CUST',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      await soAction(fx.tokenA, so.body.id, 'confirm');
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerBothAId,
        warehouseId: fx.warehouseAId,
        salesOrderId: so.body.id,
        invoiceNumber: 'INV-MISMATCH',
        currencyCode: 'CRC',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cliente.*orden/i);
    });

    it('invoice_number duplicado por empresa → 409', async () => {
      const res = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-001',
        currencyCode: 'CRC',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(409);
    });

    it('mismo invoice_number permitido en otra empresa', async () => {
      const productB = await tc.raw.product.findFirst({ where: { sku: 'INV-B-1' } });
      const res = await postInv(fx.tokenB, {
        customerId: fx.customerBId,
        warehouseId: fx.warehouseBId,
        invoiceNumber: 'INV-001',
        currencyCode: 'USD',
        lines: [{ productId: productB!.id.toString(), quantity: '0.0001', unitPrice: '1' }],
      });
      // Como stock de B no existe → 409 al intentar OUT. Lo aceptamos como
      // prueba de aislamiento (no es el caso que estamos midiendo). Para
      // forzar éxito, usamos línea de servicio.
      if (res.status === 409) {
        const ok = await postInv(fx.tokenB, {
          customerId: fx.customerBId,
          warehouseId: fx.warehouseBId,
          invoiceNumber: 'INV-001',
          currencyCode: 'USD',
          lines: [{ description: 'Servicio', quantity: '1', unitPrice: '1' }],
        });
        expect(ok.status).toBe(201);
      } else {
        expect(res.status).toBe(201);
      }
    });
  });

  describe('Cancelación', () => {
    let invId: string;
    beforeAll(async () => {
      await seedStock(tc, fx.productAId, fx.warehouseAId, '100', '10');
      const r = await postInv(fx.tokenA, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-TO-CANCEL',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '5', unitPrice: '10' }],
      });
      invId = r.body.id;
    });

    it('cancel ISSUED → CANCELLED y NO revierte el kardex', async () => {
      const beforeStock = (
        await tc.raw.stock.findFirst({
          where: {
            productId: BigInt(fx.productAId),
            warehouseId: BigInt(fx.warehouseAId),
          },
        })
      )?.quantity.toString();
      const beforeMovs = await tc.raw.stockMovement.count({
        where: { sourceDoc: 'INVOICE', sourceId: BigInt(invId) },
      });

      const res = await request(tc.app.getHttpServer())
        .post(`/invoices/${invId}/cancel`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');

      const afterStock = (
        await tc.raw.stock.findFirst({
          where: {
            productId: BigInt(fx.productAId),
            warehouseId: BigInt(fx.warehouseAId),
          },
        })
      )?.quantity.toString();
      const afterMovs = await tc.raw.stockMovement.count({
        where: { sourceDoc: 'INVOICE', sourceId: BigInt(invId) },
      });

      expect(afterStock).toBe(beforeStock);
      expect(afterMovs).toBe(beforeMovs);
    });

    it('no se puede cancelar una factura CANCELLED → 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post(`/invoices/${invId}/cancel`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({});
      expect(res.status).toBe(409);
    });
  });

  describe('Aislamiento + RBAC', () => {
    it('GET /:id de otra empresa → 404', async () => {
      const inv = await postInv(fx.tokenB, {
        customerId: fx.customerBId,
        warehouseId: fx.warehouseBId,
        invoiceNumber: 'INV-B-ONLY',
        currencyCode: 'USD',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      const res = await request(tc.app.getHttpServer())
        .get(`/invoices/${inv.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(404);
    });

    it('GET con filtro status lista solo de la empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/invoices?status=ISSUED')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.every((i: { status: string }) => i.status === 'ISSUED')).toBe(true);
    });

    it('POST con rol read-only → 403', async () => {
      const res = await postInv(fx.tokenReadOnly, {
        customerId: fx.customerAId,
        warehouseId: fx.warehouseAId,
        invoiceNumber: 'INV-NO-PERM',
        currencyCode: 'CRC',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(403);
    });

    it('GET con rol read-only → 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });

    it('sin token → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/invoices');
      expect(res.status).toBe(401);
    });
  });
});
