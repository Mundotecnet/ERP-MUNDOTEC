import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Quote-1!aA';

interface Fixtures {
  companyAId: bigint;
  tokenA: string;
  tokenB: string;
  tokenReadOnly: string;
  customerAId: string;
  customerSupplierAId: string;
  supplierOnlyAId: string;
  customerBId: string;
  branchAId: string;
  productAId: string;
  productBId: string;
  salespersonAId: string;
  salespersonBId: string;
  // PR-37 — ids de las 3 listas P1/P2/P3 de la empresa A + una de B para
  // probar aislamiento.
  p1AId: string;
  p2AId: string;
  p1BId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Quote A', taxId: '3-101-232323', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Quote B', taxId: '3-101-242424', currencyCode: 'USD' },
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

  const codes = ['auth.login', 'sales.quote.read', 'sales.quote.manage'];
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
  const readPerm = perms.find((p) => p.code === 'sales.quote.read')!;

  async function makeUser(
    companyId: bigint,
    username: string,
    permsForRole: typeof perms,
  ): Promise<{ token: string; id: bigint }> {
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
    return { token: login.body.accessToken as string, id: user.id };
  }

  const adminA = await makeUser(a.id, 'q-admin-a', perms);
  const adminB = await makeUser(b.id, 'q-admin-b', perms);
  const readOnly = await makeUser(a.id, 'q-readonly', [loginPerm, readPerm]);
  const salespersonA = await makeUser(a.id, 'q-seller-a', perms);
  const salespersonB = await makeUser(b.id, 'q-seller-b', perms);

  const customerA = await tc.raw.partner.create({
    data: { companyId: a.id, partnerType: 'CUSTOMER', legalName: 'Cliente A', code: 'CUS' },
  });
  const both = await tc.raw.partner.create({
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
    data: { companyId: a.id, sku: 'Q-A-1', name: 'Producto Q', uomId: uom.id },
  });
  const productB = await tc.raw.product.create({
    data: { companyId: b.id, sku: 'Q-B-1', name: 'Producto Q B', uomId: uom.id },
  });

  // PR-37 — seed P1/P2/P3 SALE para ambas empresas (en runtime se
  // auto-seedean; en tests deben crearse explícito).
  for (const co of [a, b]) {
    for (const name of ['Precio 1', 'Precio 2', 'Precio 3']) {
      await tc.raw.priceList.upsert({
        where: { companyId_name: { companyId: co.id, name } },
        update: {},
        create: { companyId: co.id, name, currencyCode: co.currencyCode, listType: 'SALE' },
      });
    }
  }
  // Y una lista PURCHASE en A para verificar que el server la rechaza como
  // priceListId de línea de cotización.
  await tc.raw.priceList.upsert({
    where: { companyId_name: { companyId: a.id, name: 'Costo proveedor' } },
    update: {},
    create: {
      companyId: a.id,
      name: 'Costo proveedor',
      currencyCode: a.currencyCode,
      listType: 'PURCHASE',
    },
  });
  const listsA = await tc.raw.priceList.findMany({
    where: { companyId: a.id, name: { in: ['Precio 1', 'Precio 2'] } },
    orderBy: { name: 'asc' },
  });
  const listsB = await tc.raw.priceList.findMany({
    where: { companyId: b.id, name: 'Precio 1' },
  });

  return {
    companyAId: a.id,
    tokenA: adminA.token,
    tokenB: adminB.token,
    tokenReadOnly: readOnly.token,
    customerAId: customerA.id.toString(),
    customerSupplierAId: both.id.toString(),
    supplierOnlyAId: supplierOnly.id.toString(),
    customerBId: customerB.id.toString(),
    branchAId: branchA.id.toString(),
    productAId: productA.id.toString(),
    productBId: productB.id.toString(),
    salespersonAId: salespersonA.id.toString(),
    salespersonBId: salespersonB.id.toString(),
    p1AId: listsA[0].id.toString(),
    p2AId: listsA[1].id.toString(),
    p1BId: listsB[0].id.toString(),
  };
}

describe('Quotations (HU-10.1)', () => {
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
      .post('/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function action(token: string, id: string, name: string) {
    return request(tc.app.getHttpServer())
      .post(`/quotations/${id}/${name}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  describe('Cálculo de totales', () => {
    it('calcula subtotal/descuento/impuesto/total correcto sobre 2 líneas mixtas', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        branchId: fx.branchAId,
        salespersonId: fx.salespersonAId,
        quoteNumber: 'Q-001',
        currencyCode: 'CRC',
        lines: [
          {
            productId: fx.productAId,
            quantity: '10',
            unitPrice: '100',
            discountRate: '0.1',
            taxRate: '0.13',
          },
          { description: 'Servicio extra', quantity: '1', unitPrice: '500' },
        ],
      });
      expect(res.status).toBe(201);
      // L1: gross=1000, disc=100, subtotal=900, tax=117, total=1017
      // L2: gross=500, disc=0, subtotal=500, tax=0, total=500
      // Σ subtotal=1500, discount=100, tax=117, total=1500-100+117=1517
      expect(res.body).toMatchObject({
        status: 'DRAFT',
        currencyCode: 'CRC',
        exchangeRate: '1',
        subtotal: '1500',
        discountAmount: '100',
        taxAmount: '117',
        total: '1517',
        baseTotal: '1517',
      });
      expect(res.body.lines).toHaveLength(2);
      expect(res.body.lines[0].lineTotal).toBe('1017');
      expect(res.body.lines[1].lineTotal).toBe('500');
    });

    it('acepta cliente BOTH como customer', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerSupplierAId,
        quoteNumber: 'Q-BOTH',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '10' }],
      });
      expect(res.status).toBe(201);
    });

    it('acepta cotización sin cliente (prospecto)', async () => {
      const res = await post(fx.tokenA, {
        quoteNumber: 'Q-PROSPECT',
        currencyCode: 'CRC',
        lines: [{ description: 'Cotización en frío', quantity: '1', unitPrice: '50' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.customerId).toBeNull();
    });

    it('multimoneda con exchange_rate calcula base_total', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-USD',
        currencyCode: 'USD',
        exchangeRate: '500',
        lines: [{ productId: fx.productAId, quantity: '2', unitPrice: '50' }],
      });
      expect(res.status).toBe(201);
      // total=100 USD, base_total=100*500=50000
      expect(res.body.total).toBe('100');
      expect(res.body.baseTotal).toBe('50000');
    });

    it('moneda local fuerza exchange_rate=1 aunque se mande otro', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-LOCAL',
        currencyCode: 'CRC',
        exchangeRate: '500',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '10' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.exchangeRate).toBe('1');
    });
  });

  describe('Validaciones', () => {
    it('número duplicado por empresa → 409', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-001',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(409);
    });

    it('mismo número permitido en otra empresa', async () => {
      const res = await post(fx.tokenB, {
        customerId: fx.customerBId,
        quoteNumber: 'Q-001',
        currencyCode: 'USD',
        lines: [{ productId: fx.productBId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(201);
    });

    it('cliente SUPPLIER puro → 400', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.supplierOnlyAId,
        quoteNumber: 'Q-BAD-CUST',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cliente/i);
    });

    it('cliente de otra empresa → 400', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerBId,
        quoteNumber: 'Q-X-CUST',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('producto de otra empresa → 400', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-X-PROD',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productBId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('vendedor de otra empresa → 400', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        salespersonId: fx.salespersonBId,
        quoteNumber: 'Q-X-SELL',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('línea sin producto y sin descripción → 400', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-LINE-EMPTY',
        currencyCode: 'CRC',
        lines: [{ quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/productId.*description/i);
    });

    it('descuento >= 1 → 400', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-BAD-DISC',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '10', discountRate: '1' }],
      });
      expect(res.status).toBe(400);
    });

    it('lines vacío → 400', async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-EMPTY',
        currencyCode: 'CRC',
        lines: [],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Transiciones', () => {
    let id: string;

    beforeAll(async () => {
      const res = await post(fx.tokenA, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-FLOW',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '100' }],
      });
      id = res.body.id;
    });

    it('send: DRAFT → SENT y setea sent_at', async () => {
      const res = await action(fx.tokenA, id, 'send');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SENT');
      const row = await tc.raw.quotation.findUnique({ where: { id: BigInt(id) } });
      expect(row?.sentAt).not.toBeNull();
    });

    it('no se puede editar una SENT en estados terminales pero sí en SENT', async () => {
      // SENT permite editar (regla EDITABLE_STATUSES)
      const ok = await request(tc.app.getHttpServer())
        .patch(`/quotations/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ notes: 'actualizado en SENT' });
      expect(ok.status).toBe(200);
      expect(ok.body.notes).toBe('actualizado en SENT');
    });

    it('accept: SENT → ACCEPTED', async () => {
      const res = await action(fx.tokenA, id, 'accept');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACCEPTED');
    });

    it('no se puede editar una ACCEPTED', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/quotations/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ notes: 'tarde' });
      expect(res.status).toBe(409);
    });

    it('reject: ACCEPTED → REJECTED', async () => {
      const res = await action(fx.tokenA, id, 'reject');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJECTED');
    });

    it('no se puede send una REJECTED', async () => {
      const res = await action(fx.tokenA, id, 'send');
      expect(res.status).toBe(409);
    });

    it('no se puede eliminar una cotización en REJECTED', async () => {
      const res = await request(tc.app.getHttpServer())
        .delete(`/quotations/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(409);
    });
  });

  describe('Aislamiento + RBAC', () => {
    it('GET /:id de otra empresa → 404', async () => {
      const created = await post(fx.tokenB, {
        customerId: fx.customerBId,
        quoteNumber: 'B-ONLY-Q',
        currencyCode: 'USD',
        lines: [{ productId: fx.productBId, quantity: '1', unitPrice: '5' }],
      });
      const res = await request(tc.app.getHttpServer())
        .get(`/quotations/${created.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(404);
    });

    it('GET con filtro status lista solo de la empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/quotations?status=DRAFT')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.every((q: { status: string }) => q.status === 'DRAFT')).toBe(true);
    });

    it('POST con rol read-only → 403', async () => {
      const res = await post(fx.tokenReadOnly, {
        customerId: fx.customerAId,
        quoteNumber: 'Q-NO-PERM',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '1' }],
      });
      expect(res.status).toBe(403);
    });

    it('GET con rol read-only → 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/quotations')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });

    it('sin token → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/quotations');
      expect(res.status).toBe(401);
    });
  });

  describe('Nivel de precio por línea (PR-37)', () => {
    it('persiste priceListId y devuelve priceListName en la vista', async () => {
      const created = await request(tc.app.getHttpServer())
        .post('/quotations')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          quoteNumber: 'Q-PR37-1',
          quoteDate: '2026-06-27',
          currencyCode: 'CRC',
          lines: [
            { productId: fx.productAId, quantity: '1', unitPrice: '100', priceListId: fx.p1AId },
            { productId: fx.productAId, quantity: '2', unitPrice: '200', priceListId: fx.p2AId },
          ],
        });
      expect(created.status).toBe(201);
      expect(created.body.lines).toHaveLength(2);
      expect(created.body.lines[0]).toMatchObject({
        priceListId: fx.p1AId,
        priceListName: 'Precio 1',
      });
      expect(created.body.lines[1]).toMatchObject({
        priceListId: fx.p2AId,
        priceListName: 'Precio 2',
      });

      // GET /quotations/:id también lo devuelve.
      const got = await request(tc.app.getHttpServer())
        .get(`/quotations/${created.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(got.status).toBe(200);
      expect(got.body.lines[0].priceListName).toBe('Precio 1');
      expect(got.body.lines[1].priceListName).toBe('Precio 2');
    });

    it('priceListId opcional: línea sin nivel queda con priceListId=null', async () => {
      const created = await request(tc.app.getHttpServer())
        .post('/quotations')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          quoteNumber: 'Q-PR37-2',
          quoteDate: '2026-06-27',
          currencyCode: 'CRC',
          lines: [{ productId: fx.productAId, quantity: '1', unitPrice: '50' }],
        });
      expect(created.status).toBe(201);
      expect(created.body.lines[0].priceListId).toBeNull();
      expect(created.body.lines[0].priceListName).toBeNull();
    });

    it('priceListId de otra empresa → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/quotations')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          quoteNumber: 'Q-PR37-3',
          quoteDate: '2026-06-27',
          currencyCode: 'CRC',
          lines: [
            { productId: fx.productAId, quantity: '1', unitPrice: '10', priceListId: fx.p1BId },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/lista de precios/i);
    });

    it('priceListId apuntando a lista PURCHASE → 400', async () => {
      const purchase = await tc.raw.priceList.findFirstOrThrow({
        where: { companyId: fx.companyAId, name: 'Costo proveedor' },
      });
      const res = await request(tc.app.getHttpServer())
        .post('/quotations')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          quoteNumber: 'Q-PR37-4',
          quoteDate: '2026-06-27',
          currencyCode: 'CRC',
          lines: [
            {
              productId: fx.productAId,
              quantity: '1',
              unitPrice: '10',
              priceListId: purchase.id.toString(),
            },
          ],
        });
      expect(res.status).toBe(400);
    });

    it('priceListId inexistente → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/quotations')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          quoteNumber: 'Q-PR37-5',
          quoteDate: '2026-06-27',
          currencyCode: 'CRC',
          lines: [
            {
              productId: fx.productAId,
              quantity: '1',
              unitPrice: '10',
              priceListId: '999999',
            },
          ],
        });
      expect(res.status).toBe(400);
    });

    it('PATCH /quotations/:id puede actualizar el priceListId de una línea', async () => {
      const created = await request(tc.app.getHttpServer())
        .post('/quotations')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          customerId: fx.customerAId,
          quoteNumber: 'Q-PR37-6',
          quoteDate: '2026-06-27',
          currencyCode: 'CRC',
          lines: [
            { productId: fx.productAId, quantity: '1', unitPrice: '100', priceListId: fx.p1AId },
          ],
        });
      expect(created.status).toBe(201);

      const patched = await request(tc.app.getHttpServer())
        .patch(`/quotations/${created.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          lines: [
            { productId: fx.productAId, quantity: '1', unitPrice: '180', priceListId: fx.p2AId },
          ],
        });
      expect(patched.status).toBe(200);
      expect(patched.body.lines[0].priceListId).toBe(fx.p2AId);
      expect(patched.body.lines[0].priceListName).toBe('Precio 2');
    });
  });
});
