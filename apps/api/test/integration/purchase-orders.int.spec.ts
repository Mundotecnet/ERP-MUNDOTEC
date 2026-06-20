import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'PO-1!aA';

interface Fixtures {
  companyAId: bigint;
  tokenA: string;
  tokenB: string;
  tokenReadOnly: string;
  supplierAId: string;
  customerAId: string;
  bothAId: string;
  supplierBId: string;
  branchAId: string;
  branchBId: string;
  productAId: string;
  product2AId: string;
  productServiceId: string;
  productBId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  // Empresa A en CRC (moneda base), empresa B en USD.
  const a = await tc.raw.company.create({
    data: { legalName: 'PO A', taxId: '3-101-111121', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'PO B', taxId: '3-101-222232', currencyCode: 'USD' },
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

  const codes = ['auth.login', 'purchases.po.read', 'purchases.po.manage'];
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
  const readPerm = perms.find((p) => p.code === 'purchases.po.read')!;

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

  const tokenA = await makeUser(a.id, 'po-a', perms);
  const tokenB = await makeUser(b.id, 'po-b', perms);
  const tokenReadOnly = await makeUser(a.id, 'po-readonly', [loginPerm, readPerm]);

  const supplierA = await tc.raw.partner.create({
    data: { companyId: a.id, partnerType: 'SUPPLIER', legalName: 'Proveedor A', code: 'SUP-A' },
  });
  const customerA = await tc.raw.partner.create({
    data: { companyId: a.id, partnerType: 'CUSTOMER', legalName: 'Cliente A', code: 'CUS-A' },
  });
  const bothA = await tc.raw.partner.create({
    data: { companyId: a.id, partnerType: 'BOTH', legalName: 'Ambos A', code: 'BTH-A' },
  });
  const supplierB = await tc.raw.partner.create({
    data: { companyId: b.id, partnerType: 'SUPPLIER', legalName: 'Proveedor B', code: 'SUP-B' },
  });

  const branchA = await tc.raw.branch.create({
    data: { companyId: a.id, code: 'BR-A', name: 'Central A' },
  });
  const branchB = await tc.raw.branch.create({
    data: { companyId: b.id, code: 'BR-B', name: 'Central B' },
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
      name: 'Servicio (no inv)',
      uomId: uom.id,
      isInventoried: false,
    },
  });
  const productB = await tc.raw.product.create({
    data: { companyId: b.id, sku: 'P-B-1', name: 'Producto B', uomId: uom.id },
  });

  return {
    companyAId: a.id,
    tokenA,
    tokenB,
    tokenReadOnly,
    supplierAId: supplierA.id.toString(),
    customerAId: customerA.id.toString(),
    bothAId: bothA.id.toString(),
    supplierBId: supplierB.id.toString(),
    branchAId: branchA.id.toString(),
    branchBId: branchB.id.toString(),
    productAId: productA.id.toString(),
    product2AId: product2A.id.toString(),
    productServiceId: productService.id.toString(),
    productBId: productB.id.toString(),
  };
}

describe('Purchase Orders (HU-9.2)', () => {
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
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function approve(token: string, id: string) {
    return request(tc.app.getHttpServer())
      .post(`/purchase-orders/${id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  function cancel(token: string, id: string) {
    return request(tc.app.getHttpServer())
      .post(`/purchase-orders/${id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  describe('Creación y totales', () => {
    it('crea una OC en moneda local con dos líneas y totales correctos', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        branchId: fx.branchAId,
        orderNumber: 'OC-001',
        currencyCode: 'CRC',
        lines: [
          { productId: fx.productAId, quantity: '10', unitCost: '100', taxRate: '0.13' },
          { productId: fx.product2AId, quantity: '5', unitCost: '50', taxRate: '0' },
        ],
        notes: 'Compra inicial',
      });
      expect(res.status).toBe(201);
      // Línea 1: 10*100=1000 sub, *0.13=130 tax, total=1130
      // Línea 2: 5*50=250 sub, 0 tax, total=250
      // Subtotal: 1250 ; tax: 130 ; total: 1380 ; base_total: 1380 (1:1 en moneda local)
      expect(res.body).toMatchObject({
        status: 'DRAFT',
        currencyCode: 'CRC',
        exchangeRate: '1',
        subtotal: '1250',
        taxAmount: '130',
        total: '1380',
        baseTotal: '1380',
      });
      expect(res.body.lines).toHaveLength(2);
      expect(res.body.lines[0]).toMatchObject({ lineTotal: '1130' });
      expect(res.body.lines[1]).toMatchObject({ lineTotal: '250' });
    });

    it('acepta a un partner BOTH como supplier', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.bothAId,
        orderNumber: 'OC-BOTH',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(201);
    });

    it('moneda distinta + exchangeRate → calcula base_total', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-USD',
        currencyCode: 'USD',
        exchangeRate: '500.123456',
        lines: [{ productId: fx.productAId, quantity: '2', unitCost: '100' }],
      });
      expect(res.status).toBe(201);
      // total = 200 USD. base_total = 200 * 500.123456 = 100024.6912
      expect(res.body.total).toBe('200');
      expect(res.body.baseTotal).toBe('100024.6912');
    });

    it('moneda distinta sin exchangeRate → 400', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-USD-NO-ER',
        currencyCode: 'USD',
        lines: [{ productId: fx.productAId, quantity: '2', unitCost: '100' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/exchangeRate/);
    });

    it('moneda local fuerza exchangeRate=1 aun si lo mandan distinto', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-LOCAL-ER',
        currencyCode: 'CRC',
        exchangeRate: '500',
        lines: [{ productId: fx.productAId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.exchangeRate).toBe('1');
      expect(res.body.baseTotal).toBe('10');
    });
  });

  describe('Validaciones', () => {
    it('orderNumber duplicado por empresa → 409', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-001',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(409);
    });

    it('mismo orderNumber permitido en otra empresa', async () => {
      const res = await post(fx.tokenB, {
        supplierId: fx.supplierBId,
        orderNumber: 'OC-001',
        currencyCode: 'USD',
        lines: [{ productId: fx.productBId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(201);
    });

    it('supplier de tipo CUSTOMER → 400', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.customerAId,
        orderNumber: 'OC-BAD-SUP',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/proveedor/i);
    });

    it('supplier de otra empresa → 400', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierBId,
        orderNumber: 'OC-CROSS-SUP',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(400);
    });

    it('branch de otra empresa → 400', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        branchId: fx.branchBId,
        orderNumber: 'OC-CROSS-BR',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(400);
    });

    it('producto no inventariado → 400', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-SRV',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productServiceId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/inventariado/i);
    });

    it('producto de otra empresa → 400', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-CROSS-PROD',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productBId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(400);
    });

    it('lines vacío → 400', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-EMPTY',
        currencyCode: 'CRC',
        lines: [],
      });
      expect(res.status).toBe(400);
    });

    it('quantity 0 → 400', async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-Q0',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '0', unitCost: '10' }],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Transiciones de estado', () => {
    let id: string;

    beforeAll(async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-FLOW',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '5', unitCost: '20' }],
      });
      id = res.body.id;
    });

    it('approve mueve DRAFT → APPROVED', async () => {
      const res = await approve(fx.tokenA, id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('no se puede aprobar dos veces', async () => {
      const res = await approve(fx.tokenA, id);
      expect(res.status).toBe(409);
    });

    it('no se puede editar una OC APPROVED', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/purchase-orders/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ notes: 'cambio tardío' });
      expect(res.status).toBe(409);
    });

    it('no se puede eliminar una OC APPROVED (debe cancelarse)', async () => {
      const res = await request(tc.app.getHttpServer())
        .delete(`/purchase-orders/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(409);
    });

    it('cancel funciona desde APPROVED', async () => {
      const res = await cancel(fx.tokenA, id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('no se puede aprobar una OC CANCELLED', async () => {
      const res = await approve(fx.tokenA, id);
      expect(res.status).toBe(409);
    });
  });

  describe('Update + replace-all de líneas', () => {
    let id: string;

    beforeAll(async () => {
      const res = await post(fx.tokenA, {
        supplierId: fx.supplierAId,
        orderNumber: 'OC-UPD',
        currencyCode: 'CRC',
        lines: [
          { productId: fx.productAId, quantity: '10', unitCost: '100' },
          { productId: fx.product2AId, quantity: '5', unitCost: '50' },
        ],
      });
      id = res.body.id;
    });

    it('PATCH con lines reemplaza el set completo y recalcula totales', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/purchase-orders/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          lines: [{ productId: fx.productAId, quantity: '4', unitCost: '25', taxRate: '0.1' }],
        });
      expect(res.status).toBe(200);
      expect(res.body.lines).toHaveLength(1);
      // 4*25=100, *0.1=10 → total 110 ; subtotal 100 ; tax 10
      expect(res.body).toMatchObject({
        subtotal: '100',
        taxAmount: '10',
        total: '110',
      });
    });

    it('PATCH solo header (notes) no toca líneas', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/purchase-orders/${id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ notes: 'observación' });
      expect(res.status).toBe(200);
      expect(res.body.notes).toBe('observación');
      expect(res.body.lines).toHaveLength(1);
    });
  });

  describe('Aislamiento por empresa', () => {
    it('GET /:id de otra empresa → 404', async () => {
      const created = await post(fx.tokenB, {
        supplierId: fx.supplierBId,
        orderNumber: 'B-ONLY',
        currencyCode: 'USD',
        lines: [{ productId: fx.productBId, quantity: '1', unitCost: '5' }],
      });
      const res = await request(tc.app.getHttpServer())
        .get(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(404);
    });

    it('GET con filtro de status lista solo de la empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/purchase-orders?status=DRAFT')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.every((po: { status: string }) => po.status === 'DRAFT')).toBe(true);
    });
  });

  describe('RBAC', () => {
    it('POST con rol read-only → 403', async () => {
      const res = await post(fx.tokenReadOnly, {
        supplierId: fx.supplierAId,
        orderNumber: 'NO-PERM',
        currencyCode: 'CRC',
        lines: [{ productId: fx.productAId, quantity: '1', unitCost: '10' }],
      });
      expect(res.status).toBe(403);
    });

    it('GET con rol read-only → 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/purchase-orders')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });

    it('approve con rol read-only → 403', async () => {
      // Tomar uno existente en DRAFT
      const list = await request(tc.app.getHttpServer())
        .get('/purchase-orders?status=DRAFT')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const draft = list.body.find((po: { status: string }) => po.status === 'DRAFT');
      expect(draft).toBeDefined();
      const res = await approve(fx.tokenReadOnly, draft.id);
      expect(res.status).toBe(403);
    });

    it('sin token → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/purchase-orders');
      expect(res.status).toBe(401);
    });
  });
});
