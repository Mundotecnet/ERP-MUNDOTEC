import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  adminAccessTokenA: string;
  adminAccessTokenB: string;
}

const STRONG_PASSWORD = 'StrongUserPwd-9!';

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Users CRUD A', taxId: '3-101-333333', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Users CRUD B', taxId: '3-101-444444', currencyCode: 'USD' },
  });

  const perms = await Promise.all(
    ['auth.login', 'users.read', 'users.create', 'users.update', 'users.delete'].map((code) =>
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
        passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
        fullName: `${username} admin`,
      },
    });
    await tc.raw.userRole.create({ data: { userId: user.id, roleId: role.id } });

    const login = await request(tc.app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: STRONG_PASSWORD });
    if (login.status !== 200) {
      throw new Error(`login(${username}) falló: ${login.status}`);
    }
    return login.body.accessToken as string;
  }

  return {
    companyAId: a.id,
    companyBId: b.id,
    adminAccessTokenA: await makeAdmin(a.id, 'admin-a'),
    adminAccessTokenB: await makeAdmin(b.id, 'admin-b'),
  };
}

describe('Users CRUD (HU-4.1, e2e)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('POST /users', () => {
    it('crea un usuario con password válida y devuelve la vista (201)', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({
          username: 'ana',
          email: 'ana@demo.local',
          password: STRONG_PASSWORD,
          fullName: 'Ana User',
          isSalesperson: true,
          commissionPct: 0.05,
        });
      expect(res.status).toBe(201);
      expect(res.body.username).toBe('ana');
      expect(res.body.email).toBe('ana@demo.local');
      expect(res.body.isSalesperson).toBe(true);
      expect(res.body.commissionPct).toBe('0.05');
    });

    it('rechaza con 400 si la password no cumple la policy y devuelve detalles', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({
          username: 'corta',
          email: 'corta@demo.local',
          password: 'corta',
          fullName: 'Pass Corta',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no cumple la pol/i);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });

    it('rechaza duplicado de username con 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({
          username: 'ana',
          email: 'ana2@demo.local',
          password: STRONG_PASSWORD,
          fullName: 'Ana Duplicada',
        });
      expect(res.status).toBe(409);
    });

    it('rechaza commissionPct fuera de [0, 1]', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({
          username: 'maxc',
          email: 'maxc@demo.local',
          password: STRONG_PASSWORD,
          fullName: 'Comision Mala',
          commissionPct: 2,
        });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /users', () => {
    it('lista paginada de usuarios de la empresa activa', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/users?page=1&pageSize=10')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(10);
      const usernames = (res.body.data as { username: string }[]).map((u) => u.username);
      expect(usernames).toEqual(expect.arrayContaining(['admin-a', 'ana']));
      // No incluye usuarios de la otra empresa.
      expect(usernames).not.toContain('admin-b');
    });

    it('admin de B no ve a admin-a (HU-3.3 reforzada)', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/users?page=1&pageSize=50')
        .set('Authorization', `Bearer ${fx.adminAccessTokenB}`);
      expect(res.status).toBe(200);
      const usernames = (res.body.data as { username: string }[]).map((u) => u.username);
      expect(usernames).toEqual(['admin-b']);
    });

    it('?isSalesperson=true filtra solo vendedores (HU-10.4 — selector vendedor)', async () => {
      await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'vend-only',
          email: 'vend-only@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Vendedor Activo',
          isSalesperson: true,
        },
      });
      await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'no-vend',
          email: 'no-vend@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'No Vendedor',
          isSalesperson: false,
        },
      });
      const res = await request(tc.app.getHttpServer())
        .get('/users?isSalesperson=true&pageSize=50')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(res.status).toBe(200);
      const rows = res.body.data as { username: string; isSalesperson: boolean }[];
      expect(rows.every((r) => r.isSalesperson === true)).toBe(true);
      expect(rows.map((r) => r.username)).toEqual(expect.arrayContaining(['vend-only']));
      expect(rows.map((r) => r.username)).not.toContain('no-vend');
    });

    it('?isSalesperson=invalid devuelve 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/users?isSalesperson=yes')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /users/:id', () => {
    it('lee un usuario propio por id', async () => {
      const created = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'beto',
          email: 'beto@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Beto User',
        },
      });
      const res = await request(tc.app.getHttpServer())
        .get(`/users/${created.id.toString()}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('beto');
    });

    it('intento de leer usuario de otra empresa devuelve 404 (no filtra)', async () => {
      const foreign = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyBId,
          username: 'foreignB',
          email: 'foreignB@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Foreign B',
        },
      });
      const res = await request(tc.app.getHttpServer())
        .get(`/users/${foreign.id.toString()}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /users/:id', () => {
    it('actualiza fullName + isSalesperson y refleja en audit_log', async () => {
      const user = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'carla-edit',
          email: 'carla-edit@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Carla Inicial',
        },
      });
      const res = await request(tc.app.getHttpServer())
        .patch(`/users/${user.id.toString()}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ fullName: 'Carla Editada', isSalesperson: true, commissionPct: 0.1 });
      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe('Carla Editada');
      expect(res.body.isSalesperson).toBe(true);
      expect(res.body.commissionPct).toBe('0.1');

      const log = await tc.raw.auditLog.findFirst({
        where: { entity: 'AppUser', entityId: user.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).not.toBeNull();
    });

    it('cuando el admin cambia la password, revoca refresh activos y permite login con la nueva', async () => {
      const userRow = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'dora',
          email: 'dora@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Dora User',
        },
      });
      // dora logueada antes del cambio.
      const oldLogin = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'dora', password: STRONG_PASSWORD });
      expect(oldLogin.status).toBe(200);
      const oldRefresh = oldLogin.body.refreshToken as string;

      const newPassword = 'NewDoraPwd-1A!';
      const change = await request(tc.app.getHttpServer())
        .patch(`/users/${userRow.id.toString()}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ password: newPassword });
      expect(change.status).toBe(200);

      // Refresh anterior revocado.
      const reuse = await request(tc.app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: oldRefresh });
      expect(reuse.status).toBe(401);

      // Login con la nueva.
      const fresh = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'dora', password: newPassword });
      expect(fresh.status).toBe(200);
      // Login con la vieja ya no.
      const stale = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'dora', password: STRONG_PASSWORD });
      expect(stale.status).toBe(401);
    });

    it('no permite editar un user de otra empresa (404)', async () => {
      const foreign = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyBId,
          username: 'foreignB-edit',
          email: 'foreignB-edit@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Foreign B Edit',
        },
      });
      const res = await request(tc.app.getHttpServer())
        .patch(`/users/${foreign.id.toString()}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({ fullName: 'Hacker' });
      expect(res.status).toBe(404);
    });

    it('body vacío devuelve 400', async () => {
      const user = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'emi',
          email: 'emi@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Emi User',
        },
      });
      const res = await request(tc.app.getHttpServer())
        .patch(`/users/${user.id.toString()}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /users/:id', () => {
    it('soft-delete: deletedAt seteado, lista no lo muestra, login del user falla', async () => {
      const user = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'fido',
          email: 'fido@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Fido User',
        },
      });

      const del = await request(tc.app.getHttpServer())
        .delete(`/users/${user.id.toString()}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(del.status).toBe(204);

      const dbRow = await tc.raw.appUser.findUnique({ where: { id: user.id } });
      expect(dbRow).not.toBeNull();
      expect(dbRow!.deletedAt).not.toBeNull();

      const list = await request(tc.app.getHttpServer())
        .get('/users?page=1&pageSize=50')
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      const usernames = (list.body.data as { username: string }[]).map((u) => u.username);
      expect(usernames).not.toContain('fido');

      const login = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'fido', password: STRONG_PASSWORD });
      expect(login.status).toBe(401);
    });

    it('borrar user de otra empresa devuelve 404', async () => {
      const foreign = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyBId,
          username: 'foreignB-delete',
          email: 'foreignB-delete@demo.local',
          passwordHash: await bcrypt.hash(STRONG_PASSWORD, 4),
          fullName: 'Foreign B Del',
        },
      });
      const res = await request(tc.app.getHttpServer())
        .delete(`/users/${foreign.id.toString()}`)
        .set('Authorization', `Bearer ${fx.adminAccessTokenA}`);
      expect(res.status).toBe(404);
    });
  });
});
