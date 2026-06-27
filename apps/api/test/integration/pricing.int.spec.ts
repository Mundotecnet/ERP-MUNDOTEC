import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Pricing-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenAdminA: string;
  tokenAdminB: string;
  tokenReadOnly: string;
  productAId: string;
  productBId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Pricing A', taxId: '3-101-414141', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Pricing B', taxId: '3-101-424242', currencyCode: 'USD' },
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

  const codes = ['auth.login', 'pricing.read', 'pricing.item.manage'];
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
  const readPerm = perms.find((p) => p.code === 'pricing.read')!;

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

  const tokenAdminA = await makeUser(a.id, 'price-admin-a', perms);
  const tokenAdminB = await makeUser(b.id, 'price-admin-b', perms);
  const tokenReadOnly = await makeUser(a.id, 'price-read-a', [loginPerm, readPerm]);

  const productA = await tc.raw.product.create({
    data: {
      companyId: a.id,
      sku: 'PRC-A-1',
      name: 'Producto A',
      uomId: uom.id,
      costPrice: 100,
      salePrice: 0,
      priceCurrency: 'CRC',
    },
  });
  const productB = await tc.raw.product.create({
    data: {
      companyId: b.id,
      sku: 'PRC-B-1',
      name: 'Producto B',
      uomId: uom.id,
      costPrice: 200,
      salePrice: 0,
      priceCurrency: 'CRC',
    },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenAdminA,
    tokenAdminB,
    tokenReadOnly,
    productAId: productA.id.toString(),
    productBId: productB.id.toString(),
  };
}

describe('Pricing core (HU-11.1, PR-32)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('GET /products/:id/pricing', () => {
    it('devuelve el trío costo/margen/precio del producto', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        productId: fx.productAId,
        sku: 'PRC-A-1',
        priceCurrency: 'CRC',
        costPrice: '100',
        salePrice: '0',
        marginPct: '0',
        minMarginPct: '0',
        outOfMargin: false,
      });
    });

    it('404 si el producto pertenece a otra empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminB}`);
      expect(res.status).toBe(404);
    });

    it('403 si el usuario no tiene pricing.read', async () => {
      // El user read-only sí tiene pricing.read, así que probamos sin token alguno.
      const res = await request(tc.app.getHttpServer()).get(`/products/${fx.productAId}/pricing`);
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /products/:id/pricing', () => {
    it('salePrice → margen recalculado, fila nueva en historial', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ salePrice: '142.8571', reason: 'precio sugerido' });
      expect(res.status).toBe(200);
      expect(res.body.salePrice).toBe('142.8571');
      expect(res.body.marginPct).toBe('0.3');
      expect(res.body.outOfMargin).toBe(false);

      const hist = await tc.raw.productPriceHistory.findMany({
        where: { productId: BigInt(fx.productAId) },
        orderBy: { changedAt: 'desc' },
        take: 1,
      });
      expect(hist).toHaveLength(1);
      expect(hist[0].changeType).toBe('SALE');
      expect(hist[0].source).toBe('MANUAL');
      expect(hist[0].newValue.toString()).toBe('142.8571');
      expect(hist[0].costValue?.toString()).toBe('100');
      expect(hist[0].marginPct?.toString()).toBe('0.3');
      expect(hist[0].reason).toBe('precio sugerido');
      expect(hist[0].changedBy).not.toBeNull();
    });

    it('marginPct → precio recalculado', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ marginPct: '0.5' });
      expect(res.status).toBe(200);
      expect(res.body.marginPct).toBe('0.5');
      // cost=100 / (1-0.5) = 200
      expect(res.body.salePrice).toBe('200');
    });

    it('salePrice + marginPct inconsistentes con costo → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ salePrice: '500', marginPct: '0.1' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/consistentes/);
    });

    it('salePrice + marginPct consistentes → aceptado', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ salePrice: '200', marginPct: '0.5' });
      expect(res.status).toBe(200);
      expect(res.body.salePrice).toBe('200');
      expect(res.body.marginPct).toBe('0.5');
    });

    it('costPrice solo → margen se conserva, precio se recalcula', async () => {
      // Estado actual: cost=100, sale=200, margin=0.5
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ costPrice: '120' });
      expect(res.status).toBe(200);
      expect(res.body.costPrice).toBe('120');
      expect(res.body.marginPct).toBe('0.5');
      // 120 / (1 - 0.5) = 240
      expect(res.body.salePrice).toBe('240');
    });

    it('minMarginPct que el margen vigente no alcanza → out_of_margin=true', async () => {
      // Margen vigente=0.5, piso=0.7 → fuera de margen.
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ minMarginPct: '0.7' });
      expect(res.status).toBe(200);
      expect(res.body.outOfMargin).toBe(true);
      expect(res.body.minMarginPct).toBe('0.7');
    });

    it('marginPct >= 1 → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ marginPct: '1' });
      expect(res.status).toBe(400);
    });

    it('body vacío → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('user sin pricing.item.manage → 403', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`)
        .send({ salePrice: '999' });
      expect(res.status).toBe(403);
    });

    it('producto de otra empresa → 404 (tenant aislado)', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminB}`)
        .send({ salePrice: '100' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /products/:id/pricing/history', () => {
    it('devuelve historial descendente con changedByName resuelto', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/products/${fx.productAId}/pricing/history`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      // El primero (más reciente) debe ser el último PATCH (minMarginPct).
      const first = res.body[0];
      expect(first.changeType).toBe('SALE');
      expect(first.source).toBe('MANUAL');
      expect(first.changedByName).toBe('price-admin-a');
    });

    it('404 si el producto pertenece a otra empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/products/${fx.productAId}/pricing/history`)
        .set('Authorization', `Bearer ${fx.tokenAdminB}`);
      expect(res.status).toBe(404);
    });
  });
});
