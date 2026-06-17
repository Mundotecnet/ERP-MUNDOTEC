import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'AssignRoles-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  adminTokenA: string; // empresa A, todos los permisos
  adminTokenB: string; // empresa B, todos los permisos
  /** Usuario común en A, sin roles asignados al inicio del bloque que lo use. */
  carolId: bigint;
  /** Role en A con company.read. */
  readerRoleAId: bigint;
  /** Role en A con users.read. */
  managerRoleAId: bigint;
  /** Role en B (no debería poder asignarse a usuarios de A). */
  readerRoleBId: bigint;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Assign A', taxId: '3-101-777777', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Assign B', taxId: '3-101-888888', currencyCode: 'USD' },
  });

  const codes = [
    'auth.login',
    'company.read',
    'company.update',
    'users.read',
    'users.create',
    'users.update',
    'users.delete',
    'users.assign-roles',
    'roles.read',
    'roles.create',
    'roles.update',
    'roles.delete',
    'permissions.read',
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

  function permId(code: string): bigint {
    const found = perms.find((p) => p.code === code);
    if (!found) throw new Error(`perm ${code} no fue creada`);
    return found.id;
  }

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

  const adminTokenA = await makeAdmin(a.id, 'admin-a');
  const adminTokenB = await makeAdmin(b.id, 'admin-b');

  // Roles "reader" en A y B, "manager" en A.
  const readerA = await tc.raw.role.create({
    data: { companyId: a.id, name: 'reader', description: 'Sólo lectura empresa' },
  });
  await tc.raw.rolePermission.create({
    data: { roleId: readerA.id, permissionId: permId('company.read') },
  });

  const managerA = await tc.raw.role.create({
    data: { companyId: a.id, name: 'manager', description: 'Gestión de usuarios' },
  });
  await tc.raw.rolePermission.create({
    data: { roleId: managerA.id, permissionId: permId('users.read') },
  });

  const readerB = await tc.raw.role.create({
    data: { companyId: b.id, name: 'reader', description: 'Sólo lectura empresa' },
  });
  await tc.raw.rolePermission.create({
    data: { roleId: readerB.id, permissionId: permId('company.read') },
  });

  // Usuario sin roles en A.
  const carol = await tc.raw.appUser.create({
    data: {
      companyId: a.id,
      username: 'carol',
      email: 'carol@demo.local',
      passwordHash: await bcrypt.hash(STRONG, 4),
      fullName: 'Carol User',
    },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    adminTokenA,
    adminTokenB,
    carolId: carol.id,
    readerRoleAId: readerA.id,
    managerRoleAId: managerA.id,
    readerRoleBId: readerB.id,
  };
}

async function loginAs(tc: AppTestContext, username: string, password = STRONG): Promise<string> {
  const res = await request(tc.app.getHttpServer())
    .post('/auth/login')
    .send({ username, password });
  if (res.status !== 200) {
    throw new Error(`login(${username}) falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

describe('Asignación de roles (HU-4.3) + cobertura RBAC (HU-4.4)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('PUT /users/:id/roles', () => {
    it('asigna roles y los devuelve en getOne', async () => {
      const put = await request(tc.app.getHttpServer())
        .put(`/users/${fx.carolId.toString()}/roles`)
        .set('Authorization', `Bearer ${fx.adminTokenA}`)
        .send({ roleIds: [fx.readerRoleAId.toString()] });
      expect(put.status).toBe(200);

      const links = await tc.raw.userRole.findMany({
        where: { userId: fx.carolId },
        select: { roleId: true },
      });
      expect(links.map((l) => l.roleId)).toEqual([fx.readerRoleAId]);
    });

    it('reemplaza el set completo (no acumula)', async () => {
      const put = await request(tc.app.getHttpServer())
        .put(`/users/${fx.carolId.toString()}/roles`)
        .set('Authorization', `Bearer ${fx.adminTokenA}`)
        .send({ roleIds: [fx.managerRoleAId.toString()] });
      expect(put.status).toBe(200);

      const links = await tc.raw.userRole.findMany({
        where: { userId: fx.carolId },
        select: { roleId: true },
      });
      expect(links.map((l) => l.roleId)).toEqual([fx.managerRoleAId]);
    });

    it('quita todos los roles con []', async () => {
      const put = await request(tc.app.getHttpServer())
        .put(`/users/${fx.carolId.toString()}/roles`)
        .set('Authorization', `Bearer ${fx.adminTokenA}`)
        .send({ roleIds: [] });
      expect(put.status).toBe(200);

      const count = await tc.raw.userRole.count({ where: { userId: fx.carolId } });
      expect(count).toBe(0);
    });

    it('rechaza asignar un rol de otra empresa (400)', async () => {
      const put = await request(tc.app.getHttpServer())
        .put(`/users/${fx.carolId.toString()}/roles`)
        .set('Authorization', `Bearer ${fx.adminTokenA}`)
        .send({ roleIds: [fx.readerRoleBId.toString()] });
      expect(put.status).toBe(400);
      expect(put.body.message).toMatch(/otra empresa|inexistentes/i);
    });

    it('rechaza body inválido (no array)', async () => {
      const put = await request(tc.app.getHttpServer())
        .put(`/users/${fx.carolId.toString()}/roles`)
        .set('Authorization', `Bearer ${fx.adminTokenA}`)
        .send({ roleIds: fx.readerRoleAId.toString() });
      expect(put.status).toBe(400);
    });

    it('asignar roles a un user de otra empresa devuelve 404', async () => {
      const foreign = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyBId,
          username: 'foreignAssign',
          email: 'foreignAssign@demo.local',
          passwordHash: await bcrypt.hash(STRONG, 4),
          fullName: 'Foreign Assign',
        },
      });
      const put = await request(tc.app.getHttpServer())
        .put(`/users/${foreign.id.toString()}/roles`)
        .set('Authorization', `Bearer ${fx.adminTokenA}`)
        .send({ roleIds: [fx.readerRoleAId.toString()] });
      expect(put.status).toBe(404);
    });
  });

  describe('Efecto inmediato de la asignación (HU-4.3, criterio)', () => {
    let dianaId: bigint;

    beforeAll(async () => {
      const d = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'diana',
          email: 'diana@demo.local',
          passwordHash: await bcrypt.hash(STRONG, 4),
          fullName: 'Diana User',
        },
      });
      dianaId = d.id;
    });

    it('sin roles asignados, diana recibe 403 al pedir company.read', async () => {
      const dianaToken = await loginAs(tc, 'diana');
      const res = await request(tc.app.getHttpServer())
        .get('/companies/current')
        .set('Authorization', `Bearer ${dianaToken}`);
      expect(res.status).toBe(403);
    });

    it('tras asignar reader (company.read), diana entra 200 con el MISMO access token (efecto inmediato)', async () => {
      const dianaToken = await loginAs(tc, 'diana');

      const before = await request(tc.app.getHttpServer())
        .get('/companies/current')
        .set('Authorization', `Bearer ${dianaToken}`);
      expect(before.status).toBe(403);

      const put = await request(tc.app.getHttpServer())
        .put(`/users/${dianaId.toString()}/roles`)
        .set('Authorization', `Bearer ${fx.adminTokenA}`)
        .send({ roleIds: [fx.readerRoleAId.toString()] });
      expect(put.status).toBe(200);

      const after = await request(tc.app.getHttpServer())
        .get('/companies/current')
        .set('Authorization', `Bearer ${dianaToken}`);
      expect(after.status).toBe(200);
    });

    it('tras quitar el rol, diana vuelve a 403 con el MISMO access token', async () => {
      const dianaToken = await loginAs(tc, 'diana');

      const put = await request(tc.app.getHttpServer())
        .put(`/users/${dianaId.toString()}/roles`)
        .set('Authorization', `Bearer ${fx.adminTokenA}`)
        .send({ roleIds: [] });
      expect(put.status).toBe(200);

      const after = await request(tc.app.getHttpServer())
        .get('/companies/current')
        .set('Authorization', `Bearer ${dianaToken}`);
      expect(after.status).toBe(403);
    });
  });

  describe('Cobertura RBAC (HU-4.4): users.assign-roles', () => {
    it('un admin con users.update pero SIN users.assign-roles recibe 403 en PUT /:id/roles', async () => {
      // Crear un rol "users-manager" en A con users.update (pero NO assign-roles).
      const r = await tc.raw.role.create({
        data: { companyId: fx.companyAId, name: 'users-manager', description: 'Edita usuarios' },
      });
      const updatePerm = await tc.raw.permission.findUniqueOrThrow({
        where: { code: 'users.update' },
      });
      const loginPerm = await tc.raw.permission.findUniqueOrThrow({
        where: { code: 'auth.login' },
      });
      await tc.raw.rolePermission.createMany({
        data: [
          { roleId: r.id, permissionId: updatePerm.id },
          { roleId: r.id, permissionId: loginPerm.id },
        ],
      });

      // Crear user "ed" con ese rol.
      const ed = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'ed',
          email: 'ed@demo.local',
          passwordHash: await bcrypt.hash(STRONG, 4),
          fullName: 'Ed Manager',
        },
      });
      await tc.raw.userRole.create({ data: { userId: ed.id, roleId: r.id } });

      const edToken = await loginAs(tc, 'ed');

      // Puede editar (users.update) — verifica que ese permiso sí funciona.
      const patch = await request(tc.app.getHttpServer())
        .patch(`/users/${fx.carolId.toString()}`)
        .set('Authorization', `Bearer ${edToken}`)
        .send({ fullName: 'Carol Renombrada' });
      expect(patch.status).toBe(200);

      // Pero NO puede asignar roles.
      const put = await request(tc.app.getHttpServer())
        .put(`/users/${fx.carolId.toString()}/roles`)
        .set('Authorization', `Bearer ${edToken}`)
        .send({ roleIds: [fx.readerRoleAId.toString()] });
      expect(put.status).toBe(403);
    });
  });
});
