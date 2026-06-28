import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'SO-1!aA';

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
  productAId: string;
  product2AId: string;
  productServiceId: string;
  productBId: string;
  // PR-38 — niveles seeded por empresa.
  p1AId: string;
  p2AId: string;
  p1BId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'SO A', taxId: '3-101-323232', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'SO B', taxId: '3-101-343434', currencyCode: 'USD' },
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
    'sales.quote.read',
    'sales.quote.manage',
    'sales.order.read',
    'sales.order.manage',
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
  const readPerm = perms.find((p) => p.code === 'sales.order.read')!;

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

  const tokenA = await makeUser(a.id, 'so-a', perms);
  const tokenB = await makeUser(b.id, 'so-b', perms);
  const tokenReadOnly = await makeUser(a.id, 'so-readonly', [loginPerm, readPerm]);

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
  const productA = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'SO-A-1', name: 'Producto SO', uomId: uom.id },
  });
  const product2A = await tc.raw.product.create({
    data: { companyId: a.id, sku: 'SO-A-2', name: 'Producto SO 2', uomId: uom.id },
  });
  const productService = await tc.raw.product.create({
    data: {
      companyId: a.id,
      sku: 'SO-SRV',
      name: 'Servicio',
      uomId: uom.id,
      isInventoried: false,
    },
  });
  const productB = await tc.raw.product.create({
    data: { companyId: b.id, sku: 'SO-B-1', name: 'Producto SO B', uomId: uom.id },
  });

  for (const co of [a, b]) {
    for (const name of ['Precio 1', 'Precio 2', 'Precio 3']) {
      await tc.raw.priceList.upsert({
        where: { companyId_name: { companyId: co.id, name } },
        update: {},
        create: { companyId: co.id, name, currencyCode: co.currencyCode, listType: 'SALE' },
      });
    }
  }
  const listsA = await tc.raw.priceList.findMany({
    where: { companyId: a.id, name: { in: ['Precio 1', 'Precio 2'] } },
    orderBy: { name: 'asc' },
  });
  const listsB = await tc.raw.priceList.findMany({
    where: { companyId: b.id, name: 'Precio 1' },
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
    productAId: productA.id.toString(),
    product2AId: product2A.id.toString(),
    productServiceId: productService.id.toString(),
    productBId: productB.id.toString(),
    p1AId: listsA[0].id.toString(),
    p2AId: listsA[1].id.toString(),
    p1BId: listsB[0].id.toString(),
  };
}

describe('Sales Orders (HU-10.2)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  function postSO(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/sales-orders')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function action(token: string, id: string, name: string) {
    return request(tc.app.getHttpServer())
      .post(`/sales-orders/${id}/${name}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }
  function postQuote(token: string, body: object) {
    return request(tc.app.getHttpServer())
      .post('/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function quoteAction(token: string, id: string, name: string) {
    return request(tc.app.getHttpServer())
      .post(`/quotations/${id}/${name}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  describe('CRUD y totales', () => {
    it('crea SO con dos líneas y totales correctos', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        branchId: fx.branchAId,
        orderNumber: 'SO-001',
        currencyCode: 'CRC',
        lines: [
          {
            productId: fx.productAId,
            quantity: '10',
            unitPrice: '100',
            discountRate: '0.1',
            taxRate: '0.13',
          },
          { productId: fx.product2AId, quantity: '5', unitPrice: '50' },
        ],
      });
      expect(res.status).toBe(201);
      // L1: gross=1000, disc=100, sub=900, tax=117, total=1017
      // L2: gross=250, disc=0, sub=250, tax=0, total=250
      // Σ subtotal=1250, discount=100, tax=117, total=1250-100+117=1267
      expect(res.body).toMatchObject({
        status: 'DRAFT',
        currencyCode: 'CRC',
        exchangeRate: '1',
        subtotal: '1250',
        discountAmount: '100',
        taxAmount: '117',
        total: '1267',
        baseTotal: '1267',
        channel: 'POS',
      });
    });

    it('cliente BOTH aceptado', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerBothAId,
        orderNumber: 'SO-BOTH',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '10' }],
      });
      expect(res.status).toBe(201);
    });

    it('multimoneda con base_total', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-USD',
        currencyCode: 'USD',
        exchangeRate: '500',
        lines: [{ productId: fx.productAId, quantity: '2', unitPrice: '50' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.total).toBe('100');
      expect(res.body.baseTotal).toBe('50000');
    });
  });

  describe('Validaciones', () => {
    it('sin cliente → 400', async () => {
      const res = await postSO(fx.tokenA, {
        orderNumber: 'SO-NO-CUST',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('cliente SUPPLIER puro → 400', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.supplierOnlyAId,
        orderNumber: 'SO-BAD-CUST',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('cliente de otra empresa → 400', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerBId,
        orderNumber: 'SO-X-CUST',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('producto no inventariado (servicio) → 400', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-SRV',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productServiceId, quantity: '1', unitPrice: '50' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/inventariado/);
    });

    it('producto cross-tenant → 400', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-X-PROD',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productBId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('número duplicado por empresa → 409', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-001',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(409);
    });

    it('descuento >= 1 → 400', async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-BAD-DISC',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '10', discountRate: '1' }],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Transiciones', () => {
    let id: string;
    beforeAll(async () => {
      const res = await postSO(fx.tokenA, {
        customerId: fx.customerAId,
        orderNumber: 'SO-FLOW',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '5', unitPrice: '20' }],
      });
      id = res.body.id;
    });

    it('confirm DRAFT → CONFIRMED', async () => {
      const res = await action(fx.tokenA, id, 'confirm');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CONFIRMED');
    });

    it('no se puede editar una CONFIRMED', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/sales-orders/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ notes: 'tarde' });
      expect(res.status).toBe(409);
    });

    it('no se puede eliminar una CONFIRMED', async () => {
      const res = await request(tc.app.getHttpServer())
        .delete(`/sales-orders/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(409);
    });

    it('cancel CONFIRMED → CANCELLED', async () => {
      const res = await action(fx.tokenA, id, 'cancel');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('no se puede confirmar CANCELLED', async () => {
      const res = await action(fx.tokenA, id, 'confirm');
      expect(res.status).toBe(409);
    });
  });

  describe('Conversión desde cotización', () => {
    it('caso feliz: cotización ACCEPTED → SO DRAFT, quote CONVERTED, FK cruzada', async () => {
      const created = await postQuote(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-CONV-1',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '3', unitPrice: '100' }],
      });
      const quoteId = created.body.id;
      await quoteAction(fx.tokenA, quoteId, 'send');
      await quoteAction(fx.tokenA, quoteId, 'accept');

      const res = await request(tc.app.getHttpServer())
        .post(`/quotations/${quoteId}/convert`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ orderNumber: 'SO-FROM-Q' });
      expect(res.status).toBe(201);
      expect(res.body.salesOrder).toMatchObject({
        status: 'DRAFT',
        orderNumber: 'SO-FROM-Q',
        quotationNumber: 'Q-CONV-1',
      });
      expect(res.body.quotation).toMatchObject({ status: 'CONVERTED' });
      expect(res.body.quotation.convertedSalesOrderId).toBe(res.body.salesOrder.id);
    });

    it('rechaza convertir si la cotización no está ACCEPTED', async () => {
      const created = await postQuote(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-CONV-DRAFT',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '10' }],
      });
      const res = await request(tc.app.getHttpServer())
        .post(`/quotations/${created.body.id}/convert`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ orderNumber: 'SO-NEVER' });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/ACCEPTED/);
    });

    it('rechaza convertir una cotización ya convertida (idempotencia)', async () => {
      const created = await postQuote(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-CONV-DUP',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '10' }],
      });
      const qid = created.body.id;
      await quoteAction(fx.tokenA, qid, 'send');
      await quoteAction(fx.tokenA, qid, 'accept');
      const first = await request(tc.app.getHttpServer())
        .post(`/quotations/${qid}/convert`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ orderNumber: 'SO-DUP-1' });
      expect(first.status).toBe(201);
      const second = await request(tc.app.getHttpServer())
        .post(`/quotations/${qid}/convert`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ orderNumber: 'SO-DUP-2' });
      // El primer convert dejó la quote en CONVERTED, así que el segundo
      // intento se rechaza por la guarda de "no es ACCEPTED" (que se evalúa
      // antes que la de convertedSalesOrderId).
      expect(second.status).toBe(409);
      expect(second.body.message).toMatch(/ACCEPTED|CONVERTED/);
    });

    it('rechaza convertir cotización sin cliente (prospecto)', async () => {
      const created = await postQuote(fx.tokenA, {
        quoteNumber: 'Q-CONV-PROS',
        currencyCode: 'CRC',
        lines: [{ description: 'cotización libre', quantity: '1', unitPrice: '10' }],
      });
      const qid = created.body.id;
      await quoteAction(fx.tokenA, qid, 'send');
      await quoteAction(fx.tokenA, qid, 'accept');
      const res = await request(tc.app.getHttpServer())
        .post(`/quotations/${qid}/convert`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ orderNumber: 'SO-NO-CUST' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cliente/i);
    });

    it('rechaza convertir cotización con sólo líneas libres (sin product_id)', async () => {
      const created = await postQuote(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-CONV-FREE',
        currencyCode: 'CRC',
        lines: [{ description: 'consultoría', quantity: '2', unitPrice: '100' }],
      });
      const qid = created.body.id;
      await quoteAction(fx.tokenA, qid, 'send');
      await quoteAction(fx.tokenA, qid, 'accept');
      const res = await request(tc.app.getHttpServer())
        .post(`/quotations/${qid}/convert`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ orderNumber: 'SO-NO-PROD' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/líneas libres/i);
    });

    it('omite líneas libres y convierte sólo las que tienen producto', async () => {
      const created = await postQuote(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-CONV-MIXED',
        currencyCode: 'CRC',
        lines: [
          { productId: fx.productAId, quantity: '5', unitPrice: '100' },
          { description: 'cargo extra', quantity: '1', unitPrice: '50' },
        ],
      });
      const qid = created.body.id;
      await quoteAction(fx.tokenA, qid, 'send');
      await quoteAction(fx.tokenA, qid, 'accept');
      const res = await request(tc.app.getHttpServer())
        .post(`/quotations/${qid}/convert`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ orderNumber: 'SO-MIXED' });
      expect(res.status).toBe(201);
      expect(res.body.salesOrder.lines).toHaveLength(1);
      expect(res.body.salesOrder.lines[0].productSku).toBe('SO-A-1');
    });
  });

  describe('Aislamiento + RBAC', () => {
    it('GET /:id de otra empresa → 404', async () => {
      const created = await postSO(fx.tokenB, {
        customerId: fx.customerBId,
        orderNumber: 'B-ONLY-SO',
        currencyCode: 'USD',
        lines: [{ productId: fx.productBId, quantity: '1', unitPrice: '5' }],
      });
      const res = await request(tc.app.getHttpServer())
        .get(`/sales-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(404);
    });

    it('GET con filtro status lista solo de la empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/sales-orders?status=DRAFT')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.every((so: { status: string }) => so.status === 'DRAFT')).toBe(true);
    });

    it('POST con rol read-only → 403', async () => {
      const res = await postSO(fx.tokenReadOnly, {
        customerId: fx.customerAId,
        orderNumber: 'SO-NO-PERM',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(403);
    });

    it('GET con rol read-only → 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/sales-orders')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });

    it('sin token → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/sales-orders');
      expect(res.status).toBe(401);
    });
  });

  describe('Nivel de precio por línea (PR-38)', () => {
    it('persiste priceListId/priceListName en línea de OV', async () => {
      const created = await request(tc.app.getHttpServer())
        .post('/sales-orders')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          orderNumber: 'SO-PR38-1',
          currencyCode: 'CRC',
          lines: [
            { productId: fx.productAId, quantity: '1', unitPrice: '100', priceListId: fx.p1AId },
            { productId: fx.product2AId, quantity: '2', unitPrice: '180', priceListId: fx.p2AId },
          ],
        });
      expect(created.status).toBe(201);
      expect(created.body.lines[0]).toMatchObject({
        priceListId: fx.p1AId,
        priceListName: 'Precio 1',
      });
      expect(created.body.lines[1]).toMatchObject({
        priceListId: fx.p2AId,
        priceListName: 'Precio 2',
      });
    });

    it('priceListId de otra empresa → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/sales-orders')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          orderNumber: 'SO-PR38-2',
          currencyCode: 'CRC',
          lines: [
            { productId: fx.productAId, quantity: '1', unitPrice: '50', priceListId: fx.p1BId },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/lista de precios/i);
    });

    it('priceListId opcional: línea sin nivel queda null', async () => {
      const created = await request(tc.app.getHttpServer())
        .post('/sales-orders')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          orderNumber: 'SO-PR38-3',
          currencyCode: 'CRC',
          lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '50' }],
        });
      expect(created.status).toBe(201);
      expect(created.body.lines[0].priceListId).toBeNull();
      expect(created.body.lines[0].priceListName).toBeNull();
    });

    it('Cotización ACCEPTED → convert: propaga priceListId al sales_order_line', async () => {
      // Crear cotización con priceListId en la línea.
      const quote = await request(tc.app.getHttpServer())
        .post('/quotations')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          quoteNumber: 'Q-PR38-PROP',
          currencyCode: 'CRC',
          lines: [
            {
              productId: fx.productAId,
              quantity: '4',
              unitPrice: '180',
              priceListId: fx.p2AId,
            },
          ],
        });
      expect(quote.status).toBe(201);
      // Pasar a ACCEPTED (DRAFT → SENT → ACCEPTED).
      await request(tc.app.getHttpServer())
        .post(`/quotations/${quote.body.id}/send`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      await request(tc.app.getHttpServer())
        .post(`/quotations/${quote.body.id}/accept`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      // Convertir.
      const conv = await request(tc.app.getHttpServer())
        .post(`/quotations/${quote.body.id}/convert`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ orderNumber: 'SO-FROM-Q-PR38' });
      expect(conv.status).toBe(201);
      expect(conv.body.salesOrder.lines[0]).toMatchObject({
        priceListId: fx.p2AId,
        priceListName: 'Precio 2',
      });
      // El precio acordado se respeta tal cual (no se recalcula).
      expect(conv.body.salesOrder.lines[0].unitPrice).toBe('180');
    });
  });
});
