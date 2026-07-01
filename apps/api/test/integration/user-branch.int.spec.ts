/**
 * PR Sprint 11 — Base Usuario↔Sucursal (multi-sucursal por usuario).
 *
 * Cubre:
 *  - PUT /users/:id/branches (asignación + default validado ∈ permitidas).
 *  - GET /users/:id/branches y GET /users/me/branches.
 *  - Permiso `branch.access_all`: ve todas las sucursales de la empresa sin
 *    asignación explícita (assignedBranchIds puede quedar vacío).
 *  - Tenant: no puede asignar branches de otra empresa (400) ni ver usuarios
 *    de otra empresa (404).
 *  - RBAC: sin `users.update` → 403 al PUT.
 *  - Auto-null del defaultBranchId al recortar el set: si el default queda
 *    fuera de las nuevas branches (sin access_all) y el body no lo actualiza,
 *    el service lo pone en NULL.
 *  - PATCH /users/:id { defaultBranchId }: valida que esté entre las
 *    permitidas del usuario (o que tenga access_all).
 */
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'UserBranch-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  branchA1Id: bigint;
  branchA2Id: bigint;
  branchA3Id: bigint;
  branchB1Id: bigint;
  /** Admin con todos los permisos (incluye branch.access_all + users.update). */
  tokenAdminA: string;
  /** Editor de A: users.read/update pero SIN branch.access_all. */
  tokenEditorA: string;
  /** Read-only en A: solo lectura, para probar 403 en PUT. */
  tokenReadOnlyA: string;
  /** Admin en B para probar aislamiento tenant. */
  tokenAdminB: string;
  /** IDs de usuarios de A creados en el seed para asignarles branches. */
  userAliceId: bigint;
  userBobId: bigint;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  await tc.raw.currency.createMany({
    data: [{ code: 'CRC', name: 'Colón', symbol: '₡' }],
    skipDuplicates: true,
  });
  const a = await tc.raw.company.create({
    data: { legalName: 'UB A', taxId: '3-101-111111', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'UB B', taxId: '3-101-222222', currencyCode: 'CRC' },
  });

  const [ba1, ba2, ba3, bb1] = await Promise.all([
    tc.raw.branch.create({ data: { companyId: a.id, code: 'A1', name: 'Central A' } }),
    tc.raw.branch.create({ data: { companyId: a.id, code: 'A2', name: 'Sucursal A2' } }),
    tc.raw.branch.create({ data: { companyId: a.id, code: 'A3', name: 'Sucursal A3' } }),
    tc.raw.branch.create({ data: { companyId: b.id, code: 'B1', name: 'Central B' } }),
  ]);

  const permCodes = [
    'auth.login',
    'users.read',
    'users.create',
    'users.update',
    'users.delete',
    'branch.read',
    'branch.access_all',
  ];
  const perms = await Promise.all(
    permCodes.map((code) =>
      tc.raw.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: code.split('.')[0], description: code },
      }),
    ),
  );

  async function makeUser(
    companyId: bigint,
    username: string,
    permFilter: (code: string) => boolean,
  ): Promise<{ userId: bigint; token: string }> {
    const role = await tc.raw.role.create({
      data: { companyId, name: `role-${username}`, description: username },
    });
    await tc.raw.rolePermission.createMany({
      data: perms
        .filter((p) => permFilter(p.code))
        .map((p) => ({ roleId: role.id, permissionId: p.id })),
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
    if (login.status !== 200) {
      throw new Error(`login(${username}) falló: ${login.status} ${JSON.stringify(login.body)}`);
    }
    return { userId: user.id, token: login.body.accessToken as string };
  }

  const adminA = await makeUser(a.id, 'ub-admin-a', () => true);
  const editorA = await makeUser(
    a.id,
    'ub-editor-a',
    (c) => c !== 'branch.access_all' && c !== 'users.delete',
  );
  const readOnlyA = await makeUser(
    a.id,
    'ub-readonly-a',
    (c) => c === 'auth.login' || c === 'users.read' || c === 'branch.read',
  );
  const adminB = await makeUser(b.id, 'ub-admin-b', () => true);

  // Usuarios "target" a los que les asignaremos branches. No necesitan login.
  const alice = await tc.raw.appUser.create({
    data: {
      companyId: a.id,
      username: 'alice',
      email: 'alice@demo.local',
      passwordHash: await bcrypt.hash(STRONG, 4),
      fullName: 'Alice',
    },
  });
  const bob = await tc.raw.appUser.create({
    data: {
      companyId: a.id,
      username: 'bob',
      email: 'bob@demo.local',
      passwordHash: await bcrypt.hash(STRONG, 4),
      fullName: 'Bob',
    },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    branchA1Id: ba1.id,
    branchA2Id: ba2.id,
    branchA3Id: ba3.id,
    branchB1Id: bb1.id,
    tokenAdminA: adminA.token,
    tokenEditorA: editorA.token,
    tokenReadOnlyA: readOnlyA.token,
    tokenAdminB: adminB.token,
    userAliceId: alice.id,
    userBobId: bob.id,
  };
}

describe('Usuarios ↔ Sucursales (PR Sprint 11)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('PUT /users/:id/branches — asignación básica + default', () => {
    it('asigna 2 branches y setea la default entre ellas', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/users/${fx.userAliceId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({
          branchIds: [fx.branchA1Id.toString(), fx.branchA2Id.toString()],
          defaultBranchId: fx.branchA1Id.toString(),
        });
      expect(res.status).toBe(200);
      expect(res.body.accessAll).toBe(false);
      expect(res.body.assignedBranchIds.sort()).toEqual(
        [fx.branchA1Id.toString(), fx.branchA2Id.toString()].sort(),
      );
      expect(res.body.branchIds.sort()).toEqual(res.body.assignedBranchIds.sort());
      expect(res.body.defaultBranchId).toBe(fx.branchA1Id.toString());
    });

    it('rechaza defaultBranchId que NO está entre las branchIds nuevas (sin access_all)', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/users/${fx.userAliceId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({
          branchIds: [fx.branchA1Id.toString()],
          defaultBranchId: fx.branchA2Id.toString(),
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/entre las sucursales asignadas/i);
    });

    it('rechaza branchIds de otra empresa (400)', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/users/${fx.userAliceId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({
          branchIds: [fx.branchA1Id.toString(), fx.branchB1Id.toString()],
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no pertenece|inexistente/i);
    });

    it('auto-null del defaultBranchId al recortar branches sin refresh explícito', async () => {
      // Estado previo: alice tiene A1 + A2, default = A1 (del primer test).
      // Recortamos a solo A2, sin mandar defaultBranchId en el body.
      // Como el default (A1) ya no está en el set y alice no tiene access_all,
      // el service debe ponerlo en NULL.
      const res = await request(tc.app.getHttpServer())
        .put(`/users/${fx.userAliceId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({ branchIds: [fx.branchA2Id.toString()] });
      expect(res.status).toBe(200);
      expect(res.body.assignedBranchIds).toEqual([fx.branchA2Id.toString()]);
      expect(res.body.defaultBranchId).toBe(null);
    });

    it('vaciar el set (branchIds=[]) también borra la asignación', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/users/${fx.userBobId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({ branchIds: [fx.branchA1Id.toString()], defaultBranchId: fx.branchA1Id.toString() });
      expect(res.status).toBe(200);

      const clear = await request(tc.app.getHttpServer())
        .put(`/users/${fx.userBobId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({ branchIds: [] });
      expect(clear.status).toBe(200);
      expect(clear.body.assignedBranchIds).toEqual([]);
      expect(clear.body.branchIds).toEqual([]);
      expect(clear.body.defaultBranchId).toBe(null);
    });
  });

  describe('branch.access_all → ve todas las sucursales sin asignación', () => {
    it('GET /users/me/branches del admin: accessAll=true, branchIds contiene TODAS las de la empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/users/me/branches')
        .set('Authorization', `Bearer ${fx.tokenAdminA}`);
      expect(res.status).toBe(200);
      expect(res.body.accessAll).toBe(true);
      // Admin no tiene filas propias en user_branch, pero ve las 3 de A.
      const branchIds = (res.body.branchIds as string[]).sort();
      const expected = [
        fx.branchA1Id.toString(),
        fx.branchA2Id.toString(),
        fx.branchA3Id.toString(),
      ].sort();
      expect(branchIds).toEqual(expected);
      expect(res.body.assignedBranchIds).toEqual([]);
    });

    it('GET /users/me/branches del editor (sin access_all): ve solo las asignadas', async () => {
      // El editor de A no tiene user_branch asignadas.
      const res = await request(tc.app.getHttpServer())
        .get('/users/me/branches')
        .set('Authorization', `Bearer ${fx.tokenEditorA}`);
      expect(res.status).toBe(200);
      expect(res.body.accessAll).toBe(false);
      expect(res.body.branchIds).toEqual([]);
      expect(res.body.assignedBranchIds).toEqual([]);
    });
  });

  describe('Tenant isolation', () => {
    it('admin B no puede ver/modificar branches de un usuario de A (404)', async () => {
      const get = await request(tc.app.getHttpServer())
        .get(`/users/${fx.userAliceId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenAdminB}`);
      expect(get.status).toBe(404);

      const put = await request(tc.app.getHttpServer())
        .put(`/users/${fx.userAliceId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenAdminB}`)
        .send({ branchIds: [fx.branchB1Id.toString()] });
      expect(put.status).toBe(404);
    });
  });

  describe('RBAC', () => {
    it('read-only recibe 403 al intentar PUT /users/:id/branches', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/users/${fx.userAliceId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenReadOnlyA}`)
        .send({ branchIds: [fx.branchA1Id.toString()] });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /users/:id { defaultBranchId } — validación', () => {
    beforeAll(async () => {
      // Asegurar que bob tiene A1 asignada como única sucursal.
      await request(tc.app.getHttpServer())
        .put(`/users/${fx.userBobId}/branches`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({ branchIds: [fx.branchA1Id.toString()] });
    });

    it('PATCH con defaultBranchId ∈ permitidas → 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/users/${fx.userBobId}`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({ defaultBranchId: fx.branchA1Id.toString() });
      expect(res.status).toBe(200);
      expect(res.body.defaultBranchId).toBe(fx.branchA1Id.toString());
    });

    it('PATCH con defaultBranchId ∉ permitidas → 400 (bob no tiene A2 asignada)', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/users/${fx.userBobId}`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({ defaultBranchId: fx.branchA2Id.toString() });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/permitidas|asignadas/i);
    });

    it('PATCH con defaultBranchId=null limpia el default', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/users/${fx.userBobId}`)
        .set('Authorization', `Bearer ${fx.tokenEditorA}`)
        .send({ defaultBranchId: null });
      expect(res.status).toBe(200);
      expect(res.body.defaultBranchId).toBe(null);
    });
  });
});
