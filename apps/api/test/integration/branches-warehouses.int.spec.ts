import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'BranchAdmin-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenA: string;
  tokenB: string;
  /** Branch precreado en empresa B para probar el rechazo cross-tenant. */
  branchBForeignId: bigint;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'BW A', taxId: '3-101-101010', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'BW B', taxId: '3-101-202020', currencyCode: 'USD' },
  });

  const codes = [
    'auth.login',
    'branch.read',
    'branch.create',
    'branch.update',
    'branch.delete',
    'warehouses.read',
    'warehouses.create',
    'warehouses.update',
    'warehouses.delete',
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

  const tokenA = await makeAdmin(a.id, 'admin-bwa');
  const tokenB = await makeAdmin(b.id, 'admin-bwb');

  const foreignBranch = await tc.raw.branch.create({
    data: { companyId: b.id, code: 'BF', name: 'Branch en B' },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenA,
    tokenB,
    branchBForeignId: foreignBranch.id,
  };
}

describe('Branches + Warehouses CRUD (HU-3.2)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('Branches CRUD', () => {
    let branchAId: string;

    it('POST crea (201) y respeta aislamiento por empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'A1', name: 'A Central', address: 'San José' });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe('A1');
      branchAId = res.body.id as string;

      // B no ve la de A.
      const list = await request(tc.app.getHttpServer())
        .get('/branches')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      const codes = (list.body as { code: string }[]).map((b) => b.code);
      expect(codes).toEqual(['BF']);
    });

    it('POST duplicado de code en la empresa → 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'A1', name: 'Otra Central' });
      expect(res.status).toBe(409);
    });

    it('GET /:id propia 200, ajena 404', async () => {
      const ok = await request(tc.app.getHttpServer())
        .get(`/branches/${branchAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(ok.status).toBe(200);

      const foreign = await request(tc.app.getHttpServer())
        .get(`/branches/${fx.branchBForeignId.toString()}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(foreign.status).toBe(404);
    });

    it('PATCH actualiza y queda en audit_log', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/branches/${branchAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'A Central renombrada' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('A Central renombrada');

      const log = await tc.raw.auditLog.findFirst({
        where: { entity: 'Branch', entityId: BigInt(branchAId), action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).not.toBeNull();
    });

    it('DELETE bloquea con 409 si tiene almacenes asociados', async () => {
      // Crear warehouse vinculada y luego intentar borrar.
      const w = await request(tc.app.getHttpServer())
        .post('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'A1-W1', name: 'Almacén A1', branchId: branchAId });
      expect(w.status).toBe(201);

      const del = await request(tc.app.getHttpServer())
        .delete(`/branches/${branchAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(409);
    });

    it('DELETE 204 cuando no tiene almacenes', async () => {
      const create = await request(tc.app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'TBD', name: 'Por borrar' });
      const del = await request(tc.app.getHttpServer())
        .delete(`/branches/${create.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);
    });
  });

  describe('Warehouses CRUD', () => {
    let warehouseAId: string;
    let branchAId: string;

    beforeAll(async () => {
      // Crear branch fresca en A para asociar warehouses.
      const res = await request(tc.app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'A2', name: 'A Sucursal Norte' });
      branchAId = res.body.id as string;
    });

    it('POST crea sin branch (201)', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'CENTRAL', name: 'Central' });
      expect(res.status).toBe(201);
      expect(res.body.branchId).toBeNull();
      warehouseAId = res.body.id as string;
    });

    it('POST con branchId de la misma empresa lo guarda', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'A2-W1', name: 'Almacén en A2', branchId: branchAId });
      expect(res.status).toBe(201);
      expect(res.body.branchId).toBe(branchAId);
    });

    it('POST con branchId de otra empresa → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'OUTSIDE', name: 'Foráneo', branchId: fx.branchBForeignId.toString() });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no existe|no pertenece/i);
    });

    it('POST duplicado de code → 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'CENTRAL', name: 'Otra' });
      expect(res.status).toBe(409);
    });

    it('GET / lista sólo los de la empresa', async () => {
      const a = await request(tc.app.getHttpServer())
        .get('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const codesA = (a.body as { code: string }[]).map((w) => w.code).sort();
      expect(codesA).toEqual(expect.arrayContaining(['CENTRAL', 'A2-W1']));

      const b = await request(tc.app.getHttpServer())
        .get('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      expect((b.body as unknown[]).length).toBe(0);
    });

    it('PATCH branchId=null desasocia el almacén', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/warehouses/${warehouseAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ branchId: branchAId });
      expect(res.status).toBe(200);
      expect(res.body.branchId).toBe(branchAId);

      const unset = await request(tc.app.getHttpServer())
        .patch(`/warehouses/${warehouseAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ branchId: null });
      expect(unset.status).toBe(200);
      expect(unset.body.branchId).toBeNull();
    });

    it('PATCH a warehouse de otra empresa → 404', async () => {
      const foreign = await tc.raw.warehouse.create({
        data: { companyId: fx.companyBId, code: 'BW1', name: 'B Central' },
      });
      const res = await request(tc.app.getHttpServer())
        .patch(`/warehouses/${foreign.id.toString()}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Hacker' });
      expect(res.status).toBe(404);
    });

    it('DELETE 204', async () => {
      const create = await request(tc.app.getHttpServer())
        .post('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'WTBD', name: 'Por borrar' });
      const del = await request(tc.app.getHttpServer())
        .delete(`/warehouses/${create.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);
    });
  });

  describe('Body inválidos', () => {
    it('POST /branches sin code → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Sin code' });
      expect(res.status).toBe(400);
    });

    it('POST /warehouses sin code → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/warehouses')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Sin code' });
      expect(res.status).toBe(400);
    });

    it('PATCH /branches body vacío → 400', async () => {
      // Crear una rápida para el patch.
      const create = await request(tc.app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'EMPTYP', name: 'Vacío' });
      const res = await request(tc.app.getHttpServer())
        .patch(`/branches/${create.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
