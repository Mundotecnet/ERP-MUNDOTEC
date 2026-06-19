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

    it('POST /products crea con todos los campos requeridos', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          sku: 'SKU-001',
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
        sku: 'SKU-001',
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

    it('POST /products usa defaults cuando faltan opcionales', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          sku: 'SKU-DEFAULTS',
          name: 'Producto con defaults',
          uomId: fx.uomGlobalId,
        });
      expect(res.status).toBe(201);
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

    it('POST /products devuelve 409 con SKU duplicado en la misma empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ sku: 'SKU-001', name: 'Duplicado', uomId: fx.uomGlobalId });
      expect(res.status).toBe(409);
    });

    it('POST /products permite el mismo SKU en empresa distinta', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ sku: 'SKU-001', name: 'Otra empresa mismo SKU', uomId: fx.uomGlobalId });
      expect(res.status).toBe(201);
    });

    it('GET /products lista solo los de la empresa del usuario', async () => {
      const resA = await request(tc.app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.map((p: { sku: string }) => p.sku).sort()).toEqual(
        ['SKU-001', 'SKU-DEFAULTS'].sort(),
      );

      const resB = await request(tc.app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.map((p: { sku: string }) => p.sku)).toEqual(['SKU-001']);
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
          sku: 'SKU-BAD-CAT',
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
        .send({ sku: 'SKU-BAD-UOM', name: 'Sin UoM', uomId: '999999' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/unidad/i);
    });

    it('rechaza trackingType inválido', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          sku: 'SKU-BAD-TT',
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
          sku: 'SKU-BAD-CUR',
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
          sku: 'SKU-BAD-DEC',
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
        .send({ sku: 'SKU-NO-PERM', name: 'Sin permiso', uomId: fx.uomGlobalId });
      expect(res.status).toBe(403);
    });

    it('GET con rol read-only responde 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });
  });
});
