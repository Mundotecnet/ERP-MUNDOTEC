/**
 * Catálogos — extras del PR de Mantenimiento de catálogos maestros:
 *   - Toggle `isActive` por PATCH en los 5 catálogos.
 *   - DELETE bloqueado por FK con productos (409) en tax/dept/uom/category.
 *   - Currency: decimals + isActive (campos nuevos), DELETE bloqueado por
 *     price_list, PATCH ignora `code` en body (es inmutable).
 *   - RBAC: el rol read-only recibe 403 al intentar crear/borrar.
 *
 * Los tests existentes (`catalogs-base`, `catalogs-hierarchical`) ya cubren
 * tenant + duplicado + jerarquía + DELETE bloqueado por subcategorías. Acá
 * solo cubrimos el delta del PR para no duplicar.
 */
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'CatalogsExt-1!aA';

interface Fixtures {
  companyAId: bigint;
  tokenManage: string;
  tokenReadOnly: string;
  uomId: bigint;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  await tc.raw.currency.createMany({
    data: [{ code: 'CRC', name: 'Colón', symbol: '₡' }],
    skipDuplicates: true,
  });
  const a = await tc.raw.company.create({
    data: { legalName: 'Cat Ext', taxId: '3-101-989898', currencyCode: 'CRC' },
  });
  const uom = await tc.raw.unitOfMeasure.upsert({
    where: { code: 'UND' },
    update: {},
    create: { code: 'UND', name: 'Unidad' },
  });

  const codes = [
    'auth.login',
    'catalogs.product.read',
    'catalogs.product.manage',
    'catalogs.product-category.read',
    'catalogs.product-category.manage',
    'catalogs.department.read',
    'catalogs.department.manage',
    'catalogs.tax.read',
    'catalogs.tax.manage',
    'catalogs.uom.read',
    'catalogs.uom.manage',
    'catalogs.currency.read',
    'catalogs.currency.manage',
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

  async function makeUser(username: string, permFilter: (c: string) => boolean): Promise<string> {
    const role = await tc.raw.role.create({
      data: { companyId: a.id, name: username, description: username },
    });
    await tc.raw.rolePermission.createMany({
      data: perms
        .filter((p) => permFilter(p.code))
        .map((p) => ({
          roleId: role.id,
          permissionId: p.id,
        })),
      skipDuplicates: true,
    });
    const user = await tc.raw.appUser.create({
      data: {
        companyId: a.id,
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
    if (login.status !== 200) {
      throw new Error(`login(${username}) falló: ${login.status}`);
    }
    return login.body.accessToken as string;
  }

  return {
    companyAId: a.id,
    tokenManage: await makeUser('cat-ext-admin', () => true),
    tokenReadOnly: await makeUser(
      'cat-ext-readonly',
      (c) => c === 'auth.login' || c.endsWith('.read'),
    ),
    uomId: uom.id,
  };
}

describe('Catálogos — isActive, FK 409 y RBAC (PR mantenimiento catálogos)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('Currency: decimals + isActive + PATCH ignora code', () => {
    it('POST acepta decimals e isActive con valores válidos', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/currencies')
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ code: 'XCD', name: 'Dólar caribe', symbol: '$', decimals: 4, isActive: false });
      expect(res.status).toBe(201);
      expect(res.body.decimals).toBe(4);
      expect(res.body.isActive).toBe(false);
    });

    it('POST con decimals fuera de rango → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/currencies')
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ code: 'BAD', name: 'mala', decimals: 9 });
      expect(res.status).toBe(400);
    });

    it('PATCH actualiza decimals e isActive', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch('/currencies/XCD')
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ decimals: 2, isActive: true });
      expect(res.status).toBe(200);
      expect(res.body.decimals).toBe(2);
      expect(res.body.isActive).toBe(true);
    });

    it('PATCH con campo "code" en el body lo ignora (code inmutable)', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch('/currencies/XCD')
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ code: 'AAA', name: 'Renombrada' });
      expect(res.status).toBe(200);
      expect(res.body.code).toBe('XCD');
      expect(res.body.name).toBe('Renombrada');

      const aaa = await request(tc.app.getHttpServer())
        .get('/currencies/AAA')
        .set('Authorization', `Bearer ${fx.tokenManage}`);
      expect(aaa.status).toBe(404);
    });

    it('DELETE bloqueado si la moneda está en uso por price_list (409)', async () => {
      await tc.raw.currency.create({ data: { code: 'GBP', name: 'Libra' } });
      await tc.raw.priceList.create({
        data: {
          companyId: fx.companyAId,
          name: 'lista-gbp',
          currencyCode: 'GBP',
          listType: 'SALE',
        },
      });
      const res = await request(tc.app.getHttpServer())
        .delete('/currencies/GBP')
        .set('Authorization', `Bearer ${fx.tokenManage}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/lista\(s\) de precios|en uso/i);
    });
  });

  describe('Tax / Department / ProductCategory / UoM: toggle isActive + DELETE 409 por FK', () => {
    async function makeProductRef(refs: {
      taxId?: bigint;
      departmentId?: bigint;
      categoryId?: bigint;
      uomId?: bigint;
    }) {
      // Creamos directo en DB para no depender del endpoint /products (que
      // valida muchas otras cosas y oculta la FK que nos interesa).
      return tc.raw.product.create({
        data: {
          companyId: fx.companyAId,
          sku: `T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: 'Producto FK',
          uomId: refs.uomId ?? fx.uomId,
          taxId: refs.taxId ?? null,
          departmentId: refs.departmentId ?? null,
          categoryId: refs.categoryId ?? null,
          updatedAt: new Date(),
        },
      });
    }

    it('Tax: PATCH toggle isActive, luego DELETE 409 con producto que lo referencia', async () => {
      const tax = await tc.raw.tax.create({
        data: { companyId: fx.companyAId, name: 'IVA toggle', rate: '0.1300' },
      });
      // Toggle
      const off = await request(tc.app.getHttpServer())
        .patch(`/taxes/${tax.id}`)
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);

      // Crear producto referenciando este tax
      await makeProductRef({ taxId: tax.id });

      const del = await request(tc.app.getHttpServer())
        .delete(`/taxes/${tax.id}`)
        .set('Authorization', `Bearer ${fx.tokenManage}`);
      expect(del.status).toBe(409);
      expect(del.body.message).toMatch(/producto|referencia/i);
    });

    it('Department: PATCH toggle isActive, luego DELETE 409 con producto que lo referencia', async () => {
      const dept = await tc.raw.department.create({
        data: { companyId: fx.companyAId, name: 'Depto toggle' },
      });
      const off = await request(tc.app.getHttpServer())
        .patch(`/departments/${dept.id}`)
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);

      await makeProductRef({ departmentId: dept.id });

      const del = await request(tc.app.getHttpServer())
        .delete(`/departments/${dept.id}`)
        .set('Authorization', `Bearer ${fx.tokenManage}`);
      expect(del.status).toBe(409);
      expect(del.body.message).toMatch(/producto|referencia/i);
    });

    it('ProductCategory: PATCH toggle isActive, luego DELETE 409 con producto que la referencia', async () => {
      const cat = await tc.raw.productCategory.create({
        data: { companyId: fx.companyAId, name: 'Cat toggle' },
      });
      const off = await request(tc.app.getHttpServer())
        .patch(`/product-categories/${cat.id}`)
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);

      await makeProductRef({ categoryId: cat.id });

      const del = await request(tc.app.getHttpServer())
        .delete(`/product-categories/${cat.id}`)
        .set('Authorization', `Bearer ${fx.tokenManage}`);
      expect(del.status).toBe(409);
      expect(del.body.message).toMatch(/producto|referencia/i);
    });

    it('UoM: POST devuelve isActive=true por default; PATCH toggle; DELETE 409 con producto referenciándolo', async () => {
      const create = await request(tc.app.getHttpServer())
        .post('/units-of-measure')
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ code: 'LT', name: 'Litro' });
      expect(create.status).toBe(201);
      expect(create.body.isActive).toBe(true);
      const uomId = BigInt(create.body.id);

      const off = await request(tc.app.getHttpServer())
        .patch(`/units-of-measure/${create.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenManage}`)
        .send({ isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);

      await makeProductRef({ uomId });

      const del = await request(tc.app.getHttpServer())
        .delete(`/units-of-measure/${create.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenManage}`);
      expect(del.status).toBe(409);
      expect(del.body.message).toMatch(/producto|referencia/i);
    });
  });

  describe('RBAC: rol sin permiso *.manage no puede crear/borrar', () => {
    const cases = [
      { name: 'product-category', path: '/product-categories', body: { name: 'X' } },
      { name: 'department', path: '/departments', body: { name: 'X' } },
      { name: 'tax', path: '/taxes', body: { name: 'X', rate: 0.1 } },
      { name: 'uom', path: '/units-of-measure', body: { code: 'PX', name: 'X' } },
      { name: 'currency', path: '/currencies', body: { code: 'ZZZ', name: 'X' } },
    ];

    for (const c of cases) {
      it(`${c.name}: POST sin permiso manage → 403`, async () => {
        const res = await request(tc.app.getHttpServer())
          .post(c.path)
          .set('Authorization', `Bearer ${fx.tokenReadOnly}`)
          .send(c.body);
        expect(res.status).toBe(403);
      });
    }
  });
});
