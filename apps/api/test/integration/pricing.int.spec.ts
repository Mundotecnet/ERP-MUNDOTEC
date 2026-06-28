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
  p1AId: string;
  p2AId: string;
  p3AId: string;
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

  // Seed las 3 listas P1/P2/P3 para ambas empresas (la migración solo cubre
  // empresas existentes al momento del deploy; las que crea el test deben
  // tenerlas también).
  for (const co of [a, b]) {
    for (const name of ['Precio 1', 'Precio 2', 'Precio 3']) {
      await tc.raw.priceList.upsert({
        where: { companyId_name: { companyId: co.id, name } },
        update: {},
        create: { companyId: co.id, name, currencyCode: co.currencyCode, listType: 'SALE' },
      });
    }
  }

  const codes = [
    'auth.login',
    'pricing.read',
    'pricing.item.manage',
    'catalogs.product.read',
    'catalogs.product.manage',
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

  const listsA = await tc.raw.priceList.findMany({
    where: { companyId: a.id, name: { in: ['Precio 1', 'Precio 2', 'Precio 3'] } },
    orderBy: { name: 'asc' },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenAdminA,
    tokenAdminB,
    tokenReadOnly,
    productAId: productA.id.toString(),
    productBId: productB.id.toString(),
    p1AId: listsA[0].id.toString(),
    p2AId: listsA[1].id.toString(),
    p3AId: listsA[2].id.toString(),
  };
}

describe('Pricing 3 niveles (HU-11.2, PR-34)', () => {
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
    it('devuelve costo + minMargin + 3 niveles (auto-seedeados si faltan)', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        productId: fx.productAId,
        costPrice: '100',
        minMarginPct: '0',
        outOfMargin: false,
      });
      expect(res.body.levels).toHaveLength(3);
      const names = res.body.levels.map((l: { name: string }) => l.name);
      expect(names).toEqual(['Precio 1', 'Precio 2', 'Precio 3']);
      // Cada nivel tiene id de lista, precio y margen.
      for (const lvl of res.body.levels) {
        expect(lvl).toMatchObject({ salePrice: '0', marginPct: '0', outOfMargin: false });
        expect(lvl.priceListId).toMatch(/^\d+$/);
      }
    });

    it('404 si el producto pertenece a otra empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminB}`);
      expect(res.status).toBe(404);
    });

    it('401 sin token', async () => {
      const res = await request(tc.app.getHttpServer()).get(`/products/${fx.productAId}/pricing`);
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /products/:id/pricing', () => {
    it('actualiza P1 con marginPct → precio recalculado y P1 sincroniza product.sale_price', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ levels: [{ priceListId: fx.p1AId, marginPct: '0.3' }] });
      expect(res.status).toBe(200);
      const p1 = res.body.levels.find((l: { name: string }) => l.name === 'Precio 1');
      // cost=100, margin=0.3 → price=142.8571
      expect(p1).toMatchObject({ marginPct: '0.3', salePrice: '142.8571', outOfMargin: false });

      const product = await tc.raw.product.findUnique({
        where: { id: BigInt(fx.productAId) },
        select: { salePrice: true, marginPct: true },
      });
      expect(product!.salePrice.toString()).toBe('142.8571');
      expect(product!.marginPct.toString()).toBe('0.3');
    });

    it('actualiza los 3 niveles a la vez con salePrice', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({
          levels: [
            { priceListId: fx.p1AId, salePrice: '150' },
            { priceListId: fx.p2AId, salePrice: '180' },
            { priceListId: fx.p3AId, salePrice: '210' },
          ],
        });
      expect(res.status).toBe(200);
      const byName = new Map<string, { salePrice: string; marginPct: string }>(
        res.body.levels.map((l: { name: string; salePrice: string; marginPct: string }) => [
          l.name,
          l,
        ]),
      );
      // cost=100 → margins: P1=0.3333, P2=0.4444, P3=0.5238
      expect(byName.get('Precio 1')!.salePrice).toBe('150');
      expect(byName.get('Precio 1')!.marginPct).toBe('0.3333');
      expect(byName.get('Precio 2')!.salePrice).toBe('180');
      expect(byName.get('Precio 2')!.marginPct).toBe('0.4444');
      expect(byName.get('Precio 3')!.salePrice).toBe('210');
      expect(byName.get('Precio 3')!.marginPct).toBe('0.5238');
    });

    it('actualizar solo costPrice recalcula precio de cada nivel manteniendo margen', async () => {
      // Estado actual (del test anterior): cost=100, margenes 0.3333/0.4444/0.5238.
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ costPrice: '120' });
      expect(res.status).toBe(200);
      expect(res.body.costPrice).toBe('120');
      const byName = new Map<string, { salePrice: string; marginPct: string }>(
        res.body.levels.map((l: { name: string; salePrice: string; marginPct: string }) => [
          l.name,
          l,
        ]),
      );
      // Margenes se mantienen, precio = 120 / (1 - margin).
      expect(byName.get('Precio 1')!.marginPct).toBe('0.3333');
      expect(byName.get('Precio 1')!.salePrice).toBe('179.991'); // 120/(1-0.3333)
      expect(byName.get('Precio 2')!.marginPct).toBe('0.4444');
      expect(byName.get('Precio 3')!.marginPct).toBe('0.5238');
    });

    it('minMarginPct alto → product.outOfMargin true y P3 outOfMargin true (P1 abajo del piso)', async () => {
      // Estado actual: P1.margin=0.3333. Si minMargin=0.4, P1 cae fuera.
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ minMarginPct: '0.4' });
      expect(res.status).toBe(200);
      expect(res.body.minMarginPct).toBe('0.4');
      // P1 (0.3333) cae fuera, P2 (0.4444) no, P3 (0.5238) no.
      const p1 = res.body.levels.find((l: { name: string }) => l.name === 'Precio 1');
      const p2 = res.body.levels.find((l: { name: string }) => l.name === 'Precio 2');
      expect(p1.outOfMargin).toBe(true);
      expect(p2.outOfMargin).toBe(false);
      // El agregado del producto es true porque al menos un nivel está fuera.
      expect(res.body.outOfMargin).toBe(true);
    });

    it('salePrice + marginPct inconsistentes en un nivel → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({
          levels: [{ priceListId: fx.p1AId, salePrice: '500', marginPct: '0.1' }],
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/consistentes/);
    });

    it('priceListId inválido (no pertenece al producto/empresa) → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ levels: [{ priceListId: '999999', marginPct: '0.3' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no pertenece/);
    });

    it('body vacío → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('marginPct >= 1 → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({ levels: [{ priceListId: fx.p1AId, marginPct: '1' }] });
      expect(res.status).toBe(400);
    });

    it('user sin pricing.item.manage → 403', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`)
        .send({ levels: [{ priceListId: fx.p1AId, salePrice: '999' }] });
      expect(res.status).toBe(403);
    });

    it('producto de otra empresa → 404', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${fx.productAId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminB}`)
        .send({ costPrice: '50' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /products/:id/pricing/history', () => {
    it('devuelve historial con priceListName y priceListId por nivel', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/products/${fx.productAId}/pricing/history`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      // Hay filas de tipo SALE con priceListId seteado y al menos un COST
      // con priceListId nulo (del cambio de costo).
      const sales = res.body.filter(
        (r: { changeType: string; priceListId: string | null }) =>
          r.changeType === 'SALE' && r.priceListId !== null,
      );
      const costs = res.body.filter(
        (r: { changeType: string; priceListId: string | null }) =>
          r.changeType === 'COST' && r.priceListId === null,
      );
      expect(sales.length).toBeGreaterThanOrEqual(1);
      expect(costs.length).toBeGreaterThanOrEqual(1);
      for (const s of sales) {
        expect(['Precio 1', 'Precio 2', 'Precio 3']).toContain(s.priceListName);
      }
    });
  });

  describe('Creación de producto', () => {
    it('al crear un producto via POST /products auto-seedea sus 3 niveles', async () => {
      const create = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenAdminA}`)
        .send({
          sku: 'NEW-AUTO',
          name: 'Producto autoseedeado',
          uomId: (
            await tc.raw.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UND' } })
          ).id.toString(),
          priceCurrency: 'CRC',
        });
      expect(create.status).toBe(201);
      const newId = create.body.id;

      const get = await request(tc.app.getHttpServer())
        .get(`/products/${newId}/pricing`)
        .set('Authorization', `Bearer ${fx.tokenAdminA}`);
      expect(get.status).toBe(200);
      expect(get.body.levels).toHaveLength(3);
      for (const lvl of get.body.levels) {
        expect(lvl).toMatchObject({ salePrice: '0', marginPct: '0' });
      }
    });
  });
});
