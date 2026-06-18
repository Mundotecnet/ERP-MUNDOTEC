import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Hierarchies-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenA: string;
  tokenB: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Hier A', taxId: '3-101-313131', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Hier B', taxId: '3-101-414141', currencyCode: 'CRC' },
  });

  const codes = [
    'auth.login',
    'catalogs.department.read',
    'catalogs.department.manage',
    'catalogs.product-category.read',
    'catalogs.product-category.manage',
    'catalogs.customer-category.read',
    'catalogs.customer-category.manage',
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

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenA: await makeAdmin(a.id, 'hier-admin-a'),
    tokenB: await makeAdmin(b.id, 'hier-admin-b'),
  };
}

describe('Catálogos jerárquicos / categoría cliente (HU-5.4, 5.5)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('Departments (per-tenant)', () => {
    let deptAId: string;

    it('POST/GET aísla por empresa', async () => {
      const cA = await request(tc.app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Ventas' });
      expect(cA.status).toBe(201);
      deptAId = cA.body.id as string;

      await request(tc.app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ name: 'Marketing' });

      const listA = await request(tc.app.getHttpServer())
        .get('/departments')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const namesA = (listA.body as { name: string }[]).map((d) => d.name);
      expect(namesA).toEqual(['Ventas']);

      const listB = await request(tc.app.getHttpServer())
        .get('/departments')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      const namesB = (listB.body as { name: string }[]).map((d) => d.name);
      expect(namesB).toEqual(['Marketing']);
    });

    it('POST duplicado de name en la misma empresa → 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Ventas' });
      expect(res.status).toBe(409);
    });

    it('PATCH ajena → 404; DELETE OK', async () => {
      const foreign = await request(tc.app.getHttpServer())
        .patch(`/departments/${deptAId}`)
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ name: 'Hackeado' });
      expect(foreign.status).toBe(404);

      const del = await request(tc.app.getHttpServer())
        .delete(`/departments/${deptAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);
    });
  });

  describe('ProductCategories jerárquicas (per-tenant)', () => {
    let raizId: string;
    let hijoId: string;

    it('POST raíz + POST hijo con parentId válido', async () => {
      const raiz = await request(tc.app.getHttpServer())
        .post('/product-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Electrónica' });
      expect(raiz.status).toBe(201);
      expect(raiz.body.parentId).toBeNull();
      raizId = raiz.body.id as string;

      const hijo = await request(tc.app.getHttpServer())
        .post('/product-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Teléfonos', parentId: raizId });
      expect(hijo.status).toBe(201);
      expect(hijo.body.parentId).toBe(raizId);
      hijoId = hijo.body.id as string;
    });

    it('POST con parentId de otra empresa → 400', async () => {
      const externo = await request(tc.app.getHttpServer())
        .post('/product-categories')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ name: 'Categoría B' });
      const externoId = externo.body.id as string;

      const res = await request(tc.app.getHttpServer())
        .post('/product-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Inválida', parentId: externoId });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no existe|no pertenece/i);
    });

    it('PATCH parentId = id (auto-referencia) → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/product-categories/${hijoId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ parentId: hijoId });
      expect(res.status).toBe(400);
    });

    it('PATCH que formaría un ciclo → 400 (raíz → hijo del propio hijo)', async () => {
      // Hacer raíz hija de su propio hijo crearía un ciclo raíz → hijo → raíz.
      const res = await request(tc.app.getHttpServer())
        .patch(`/product-categories/${raizId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ parentId: hijoId });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/ciclo/i);
    });

    it('PATCH parentId=null pasa la categoría a raíz', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/product-categories/${hijoId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ parentId: null });
      expect(res.status).toBe(200);
      expect(res.body.parentId).toBeNull();
    });

    it('DELETE bloquea con 409 si tiene subcategorías', async () => {
      // Crear nueva jerarquía aislada para no chocar con tests anteriores.
      const parent = await request(tc.app.getHttpServer())
        .post('/product-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'PadreConHijo' });
      const child = await request(tc.app.getHttpServer())
        .post('/product-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Hijo', parentId: parent.body.id });
      expect(child.status).toBe(201);

      const del = await request(tc.app.getHttpServer())
        .delete(`/product-categories/${parent.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(409);

      // Limpiar hijo y luego padre.
      await request(tc.app.getHttpServer())
        .delete(`/product-categories/${child.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const ok = await request(tc.app.getHttpServer())
        .delete(`/product-categories/${parent.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(ok.status).toBe(204);
    });

    it('PATCH ajena → 404', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/product-categories/${raizId}`)
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ name: 'Hackeada' });
      expect(res.status).toBe(404);
    });
  });

  describe('CustomerCategories (per-tenant)', () => {
    let catId: string;

    it('POST/GET aísla por empresa; code se normaliza a mayúscula', async () => {
      const cA = await request(tc.app.getHttpServer())
        .post('/customer-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'a', name: 'Clientes VIP' });
      expect(cA.status).toBe(201);
      expect(cA.body.code).toBe('A');
      catId = cA.body.id as string;

      await request(tc.app.getHttpServer())
        .post('/customer-categories')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ code: 'A', name: 'Clientes B-VIP' });

      const listA = await request(tc.app.getHttpServer())
        .get('/customer-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const namesA = (listA.body as { name: string }[]).map((c) => c.name);
      expect(namesA).toEqual(['Clientes VIP']);

      const listB = await request(tc.app.getHttpServer())
        .get('/customer-categories')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      const namesB = (listB.body as { name: string }[]).map((c) => c.name);
      expect(namesB).toEqual(['Clientes B-VIP']);
    });

    it('POST duplicado de code en la empresa → 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/customer-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'A', name: 'Duplicada' });
      expect(res.status).toBe(409);
    });

    it('code inválido (caracteres no permitidos) → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/customer-categories')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'a-b', name: 'mala' });
      expect(res.status).toBe(400);
    });

    it('PATCH y DELETE propios', async () => {
      const patch = await request(tc.app.getHttpServer())
        .patch(`/customer-categories/${catId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'VIP renombrada' });
      expect(patch.status).toBe(200);
      expect(patch.body.name).toBe('VIP renombrada');

      const del = await request(tc.app.getHttpServer())
        .delete(`/customer-categories/${catId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);
    });
  });
});
