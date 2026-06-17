import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  adminAccessTokenA: string;
  adminAccessTokenB: string;
  testUserId: bigint;
}

const STRONG = 'RolesAdmin-1!aA';

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Roles A', taxId: '3-101-555555', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Roles B', taxId: '3-101-666666', currencyCode: 'USD' },
  });

  // Permisos del catálogo del sistema. Algunos los necesitan los admins de
  // prueba (auth.login + roles.* + permissions.read); los otros existen para
  // asignárselos a roles dentro de los tests.
  const codes = [
    'auth.login',
    'roles.read',
    'roles.create',
    'roles.update',
    'roles.delete',
    'permissions.read',
    'company.read',
    'company.update',
    'users.read',
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

  const adminAccessTokenA = await makeAdmin(a.id, 'admin-a');
  const adminAccessTokenB = await makeAdmin(b.id, 'admin-b');

  // Usuario auxiliar en A (sin roles) para probar el bloqueo de DELETE con
  // userRoles asignados.
  const testUser = await tc.raw.appUser.create({
    data: {
      companyId: a.id,
      username: 'helper',
      email: 'helper@demo.local',
      passwordHash: await bcrypt.hash(STRONG, 4),
      fullName: 'Helper',
    },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    adminAccessTokenA,
    adminAccessTokenB,
    testUserId: testUser.id,
  };
}

describe('Roles + Permissions (HU-4.2, e2e)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('POST /roles', () => {
    it('crea un rol con name + description (201)', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/roles')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ name: 'vendedor', description: 'Acceso a CRM y ventas' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('vendedor');
      expect(res.body.description).toBe('Acceso a CRM y ventas');
      expect(res.body.permissions).toEqual([]);
    });

    it('rechaza duplicado de name por empresa (409)', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/roles')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ name: 'vendedor' });
      expect(res.status).toBe(409);
    });

    it('permite mismo name en otra empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/roles')
        .set('Authorization', `Bearer ${fx.adminAccessTokenB}`)
        .send({ name: 'vendedor' });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /roles', () => {
    it('lista paginada filtra por empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/roles?page=1&pageSize=10')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(res.status).toBe(200);
      const names = (res.body.data as { name: string }[]).map((r) => r.name).sort();
      expect(names).toEqual(['admin', 'vendedor']);
    });

    it('admin de B sólo ve sus roles', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/roles?page=1&pageSize=10')
        .set('Authorization', `Bearer ${fx.adminAccessTokenB}`);
      const names = (res.body.data as { name: string }[]).map((r) => r.name).sort();
      expect(names).toEqual(['admin', 'vendedor']);
      // Asegurar que B no ve el id del rol vendedor de A.
      const listA = await request(tc.app.getHttpServer())
        .get('/roles?page=1&pageSize=10')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      const idVendA = (listA.body.data as { id: string; name: string }[]).find(
        (r) => r.name === 'vendedor',
      )!.id;
      const idVendB = (res.body.data as { id: string; name: string }[]).find(
        (r) => r.name === 'vendedor',
      )!.id;
      expect(idVendA).not.toBe(idVendB);
    });
  });

  describe('PUT /roles/:id/permissions', () => {
    let vendedorRoleId: string;

    beforeAll(async () => {
      const list = await request(tc.app.getHttpServer())
        .get('/roles?page=1&pageSize=50')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      const found = (list.body.data as { id: string; name: string }[]).find(
        (r) => r.name === 'vendedor',
      );
      if (!found) throw new Error('rol vendedor no encontrado en setup');
      vendedorRoleId = found.id;
    });

    it('asigna un set de permisos al rol', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/roles/${vendedorRoleId}/permissions`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ permissionCodes: ['company.read', 'users.read'] });
      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual(['company.read', 'users.read']);
    });

    it('reemplaza el set completo (no acumula)', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/roles/${vendedorRoleId}/permissions`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ permissionCodes: ['permissions.read'] });
      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual(['permissions.read']);
    });

    it('vacía el set si se pasa []', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/roles/${vendedorRoleId}/permissions`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ permissionCodes: [] });
      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual([]);
    });

    it('rechaza códigos inexistentes con 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/roles/${vendedorRoleId}/permissions`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ permissionCodes: ['no.existe', 'company.read'] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/inexistentes/i);
    });

    it('rechaza body inválido (no es array)', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/roles/${vendedorRoleId}/permissions`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ permissionCodes: 'company.read' });
      expect(res.status).toBe(400);
    });

    it('no permite modificar permisos de un rol de otra empresa (404)', async () => {
      const res = await request(tc.app.getHttpServer())
        .put(`/roles/${vendedorRoleId}/permissions`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenB}`)
        .send({ permissionCodes: ['company.read'] });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /roles/:id', () => {
    let role: { id: string };

    beforeAll(async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/roles')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ name: 'editable', description: 'antes' });
      role = res.body as { id: string };
    });

    it('actualiza name + description y queda en audit_log', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/roles/${role.id}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ name: 'editado', description: 'después' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('editado');
      expect(res.body.description).toBe('después');

      const log = await tc.raw.auditLog.findFirst({
        where: { entity: 'Role', entityId: BigInt(role.id), action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).not.toBeNull();
    });

    it('body vacío devuelve 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/roles/${role.id}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /roles/:id', () => {
    it('elimina un rol sin usuarios asignados', async () => {
      const create = await request(tc.app.getHttpServer())
        .post('/roles')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ name: 'efímero' });
      const id = create.body.id as string;

      const del = await request(tc.app.getHttpServer())
        .delete(`/roles/${id}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(del.status).toBe(204);

      const after = await request(tc.app.getHttpServer())
        .get(`/roles/${id}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(after.status).toBe(404);
    });

    it('bloquea con 409 si el rol tiene usuarios asignados', async () => {
      const create = await request(tc.app.getHttpServer())
        .post('/roles')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ name: 'asignado' });
      const id = create.body.id as string;

      // Asignar al helper directamente vía DB (HU-4.3 traerá el endpoint).
      await tc.raw.userRole.create({
        data: { userId: fx.testUserId, roleId: BigInt(id) },
      });

      const del = await request(tc.app.getHttpServer())
        .delete(`/roles/${id}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(del.status).toBe(409);
    });
  });

  describe('GET /permissions', () => {
    it('lista todos los permisos del catálogo', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/permissions')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(res.status).toBe(200);
      const codes = (res.body as { code: string }[]).map((p) => p.code);
      expect(codes).toEqual(expect.arrayContaining(['auth.login', 'roles.read', 'company.update']));
    });

    it('sin Bearer → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/permissions');
      expect(res.status).toBe(401);
    });
  });
});
