import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Products-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenA: string;
  tokenB: string;
  tokenReadOnly: string;
  uomGlobalId: string;
  categoryAId: string;
  categoryBId: string;
  taxAId: string;
  departmentAId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Prod A', taxId: '3-101-515151', currencyCode: 'USD' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Prod B', taxId: '3-101-616161', currencyCode: 'USD' },
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

  const codes = ['auth.login', 'catalogs.product.read', 'catalogs.product.manage'];
  const perms = await Promise.all(
    codes.map((code) =>
      tc.raw.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: code.split('.')[0], description: code },
      }),
    ),
  );
  const readOnlyPerm = perms.find((p) => p.code === 'catalogs.product.read')!;
  const loginPerm = perms.find((p) => p.code === 'auth.login')!;

  async function makeAdmin(companyId: bigint, username: string): Promise<string> {
    const role = await tc.raw.role.create({
      data: { companyId, name: 'admin', description: 'Tenant admin' },
    });
    await tc.raw.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    const user = await tc.raw.appUser.create({
      data: {
        companyId,
        username,
        email: `${username}@demo.local`,
        passwordHash: await bcrypt.hash(STRONG, 4),
        fullName: `${username} admin`,
      },
    });
    await tc.raw.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const login = await request(tc.app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: STRONG });
    if (login.status !== 200) {
      throw new Error(`login(${username}) falló: ${login.status} ${JSON.stringify(login.body)}`);
    }
    return login.body.accessToken as string;
  }

  async function makeReadOnly(companyId: bigint, username: string): Promise<string> {
    const role = await tc.raw.role.create({
      data: { companyId, name: 'readonly', description: 'Solo lectura' },
    });
    await tc.raw.rolePermission.createMany({
      data: [
        { roleId: role.id, permissionId: readOnlyPerm.id },
        { roleId: role.id, permissionId: loginPerm.id },
      ],
      skipDuplicates: true,
    });
    const user = await tc.raw.appUser.create({
      data: {
        companyId,
        username,
        email: `${username}@demo.local`,
        passwordHash: await bcrypt.hash(STRONG, 4),
        fullName: `${username} readonly`,
      },
    });
    await tc.raw.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const login = await request(tc.app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: STRONG });
    return login.body.accessToken as string;
  }

  const tokenA = await makeAdmin(a.id, 'prod-admin-a');
  const tokenB = await makeAdmin(b.id, 'prod-admin-b');
  const tokenReadOnly = await makeReadOnly(a.id, 'prod-readonly-a');

  const categoryA = await tc.raw.productCategory.create({
    data: { companyId: a.id, name: 'Hardware' },
  });
  const categoryB = await tc.raw.productCategory.create({
    data: { companyId: b.id, name: 'Software' },
  });
  const taxA = await tc.raw.tax.create({
    data: { companyId: a.id, name: 'IVA 13%', rate: '0.1300' },
  });
  const departmentA = await tc.raw.department.create({
    data: { companyId: a.id, name: 'Bodega' },
  });

  // PR-34+: en producción las 3 listas P1/P2/P3 se autoseedean por empresa.
  // En tests las precreamos para que el primer POST /products no tenga que
  // upsertarlas en concurrencia (race en `priceList.upsert` durante alta
  // concurrencia, ver test SKU automático PR-39).
  for (const co of [a, b]) {
    for (const name of ['Precio 1', 'Precio 2', 'Precio 3']) {
      await tc.raw.priceList.upsert({
        where: { companyId_name: { companyId: co.id, name } },
        update: {},
        create: { companyId: co.id, name, currencyCode: co.currencyCode, listType: 'SALE' },
      });
    }
  }

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenA,
    tokenB,
    tokenReadOnly,
    uomGlobalId: uom.id.toString(),
    categoryAId: categoryA.id.toString(),
    categoryBId: categoryB.id.toString(),
    taxAId: taxA.id.toString(),
    departmentAId: departmentA.id.toString(),
  };
}

describe('Productos (HU-7.1)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('CRUD', () => {
    let productId: string;

    it('POST /products crea con SKU 100000 auto-asignado (PR-39)', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          // PR-39: NO se envía SKU desde el cliente.
          barcode: '7501234567890',
          name: 'Switch 24 puertos',
          description: 'Gigabit administrable',
          categoryId: fx.categoryAId,
          uomId: fx.uomGlobalId,
          taxId: fx.taxAId,
          costPrice: '120.5000',
          salePrice: '199.99',
          priceCurrency: 'USD',
          trackingType: 'SERIAL',
          warrantyMonths: 12,
          departmentId: fx.departmentAId,
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        sku: '100000',
        name: 'Switch 24 puertos',
        trackingType: 'SERIAL',
        warrantyMonths: 12,
        priceCurrency: 'USD',
        isActive: true,
        isInventoried: true,
      });
      expect(res.body.id).toBeDefined();
      productId = res.body.id;
    });

    it('POST /products siguiente correlativo = 100001 + ignora SKU enviado por el cliente', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          // El cliente intenta forzar un SKU; el server lo ignora.
          sku: 'CLIENT-FORCED-SKU',
          name: 'Producto con defaults',
          uomId: fx.uomGlobalId,
        });
      expect(res.status).toBe(201);
      expect(res.body.sku).toBe('100001');
      expect(res.body).toMatchObject({
        trackingType: 'NONE',
        priceCurrency: 'USD',
        costPrice: '0',
        salePrice: '0',
        isInventoried: true,
        isActive: true,
        categoryId: null,
        taxId: null,
        barcode: null,
      });
    });

    it('POST /products en empresa distinta arranca su propia secuencia en 100000', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ name: 'Otra empresa primer producto', uomId: fx.uomGlobalId });
      expect(res.status).toBe(201);
      expect(res.body.sku).toBe('100000');
    });

    it('GET /products lista solo los de la empresa del usuario (con SKUs autoasignados)', async () => {
      const resA = await request(tc.app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.map((p: { sku: string }) => p.sku).sort()).toEqual(
        ['100000', '100001'].sort(),
      );

      const resB = await request(tc.app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.map((p: { sku: string }) => p.sku)).toEqual(['100000']);
    });

    it('GET /products/:id devuelve 404 si el id es de otra empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/products/${productId}`)
        .set('Authorization', `Bearer ${fx.tokenB}`);
      expect(res.status).toBe(404);
    });

    it('PATCH /products actualiza un subset', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Switch 24p — gestionado', salePrice: '210.00' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Switch 24p — gestionado',
        salePrice: '210',
        trackingType: 'SERIAL',
      });
    });

    it('DELETE /products hace soft-delete', async () => {
      const del = await request(tc.app.getHttpServer())
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);

      const list = await request(tc.app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(list.body.map((p: { id: string }) => p.id)).not.toContain(productId);

      const row = await tc.raw.product.findUnique({ where: { id: BigInt(productId) } });
      expect(row?.deletedAt).not.toBeNull();
    });
  });

  describe('Validación de referencias y formato', () => {
    it('rechaza categoryId de otra empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          // PR-39: sku enviado se ignora; el server asigna automático.
          name: 'Cross tenant',
          uomId: fx.uomGlobalId,
          categoryId: fx.categoryBId,
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/categoría/i);
    });

    it('rechaza uomId inexistente', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          // PR-39: sku enviado se ignora.
          name: 'Sin UoM',
          uomId: '999999',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/unidad/i);
    });

    it('rechaza trackingType inválido', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          // PR-39: sku enviado se ignora.
          name: 'Tracking malo',
          uomId: fx.uomGlobalId,
          trackingType: 'BATCH',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/trackingType/);
    });

    it('rechaza priceCurrency inexistente', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          // PR-39: sku enviado se ignora.
          name: 'Moneda mala',
          uomId: fx.uomGlobalId,
          priceCurrency: 'XYZ',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/moneda/i);
    });

    it('rechaza decimales con más de 4 posiciones', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          // PR-39: sku enviado se ignora.
          name: 'Demasiados decimales',
          uomId: fx.uomGlobalId,
          costPrice: '10.123456',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/costPrice/);
    });
  });

  describe('RBAC', () => {
    it('GET sin token responde 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/products');
      expect(res.status).toBe(401);
    });

    it('POST con rol read-only responde 403', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`)
        .send({
          // PR-39: sku enviado se ignora.
          name: 'Sin permiso',
          uomId: fx.uomGlobalId,
        });
      expect(res.status).toBe(403);
    });

    it('GET con rol read-only responde 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });
  });

  describe('SKU automático — concurrencia (PR-39)', () => {
    it('15 create concurrentes en la misma empresa producen 15 SKUs únicos sin gaps', async () => {
      // Tras el follow-up del PR-39 (reserveProductSku en autocommit, fuera
      // de la tx interactiva), 15 creates concurrentes ya no saturan el pool.
      // Antes esto fallaba con P2024 (timeout fetching connection) porque
      // cada tx retenía 2 conexiones simultáneas (la tx + el audit_log
      // write desde rawClient). Llamamos al service directo para que las
      // excepciones se vean en el test, no escondidas tras un 500 de Nest.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ProductsService } = require('../../src/products/products.service');
      const svc = tc.app.get(ProductsService) as InstanceType<typeof ProductsService>;
      const uomId = BigInt(fx.uomGlobalId);
      const N = 15;
      const results = await Promise.allSettled(
        Array.from({ length: N }, (_, i) =>
          svc.create(fx.companyAId, {
            barcode: null,
            name: `Concurrent ${i}`,
            description: null,
            categoryId: null,
            uomId,
            taxId: null,
            costPrice: '0',
            salePrice: '0',
            priceCurrency: 'USD',
            isInventoried: true,
            trackingType: 'NONE' as const,
            warrantyMonths: 0,
            minStock: '0',
            maxStock: '0',
            isActive: true,
            departmentId: null,
          }),
        ),
      );
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toEqual([]);

      const skus = (results as PromiseFulfilledResult<{ sku: string }>[]).map((r) => r.value.sku);
      const unique = new Set(skus);
      expect(unique.size).toBe(N);
      const sorted = skus.map((s) => Number(s)).sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).toBe(sorted[i - 1] + 1);
      }
    });
  });
});
