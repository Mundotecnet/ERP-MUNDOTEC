import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  aliceAccessToken: string; // empresa A — permisos company.read, company.update, branch.read
  bobAccessToken: string; // empresa B — mismos permisos sobre su empresa
}

/**
 * Crea dos empresas + un usuario admin en cada una, todos con permisos
 * mínimos para ejercitar HU-3.1 (CRUD empresa) y HU-3.3 (aislamiento).
 */
async function seedTwoTenants(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Empresa A S.A.', taxId: '3-101-111111', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Empresa B S.A.', taxId: '3-101-222222', currencyCode: 'USD' },
  });

  const perms = await Promise.all(
    ['auth.login', 'company.read', 'company.update', 'branch.read'].map((code) =>
      tc.raw.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: code.split('.')[0], description: code },
      }),
    ),
  );

  async function makeAdmin(companyId: bigint, username: string) {
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
        passwordHash: await bcrypt.hash('TenantPass-1!', 4),
        fullName: `${username} admin`,
      },
    });
    await tc.raw.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return user;
  }

  await makeAdmin(a.id, 'alice');
  await makeAdmin(b.id, 'bob');

  // Branches: 2 en A, 1 en B.
  await tc.raw.branch.createMany({
    data: [
      { companyId: a.id, code: 'A1', name: 'A — Central' },
      { companyId: a.id, code: 'A2', name: 'A — Sucursal Norte' },
      { companyId: b.id, code: 'B1', name: 'B — Central' },
    ],
  });

  async function login(username: string): Promise<string> {
    const res = await request(tc.app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'TenantPass-1!' });
    if (res.status !== 200) {
      throw new Error(`login(${username}) falló: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.accessToken as string;
  }

  return {
    companyAId: a.id,
    companyBId: b.id,
    aliceAccessToken: await login('alice'),
    bobAccessToken: await login('bob'),
  };
}

describe('Aislamiento por empresa (HU-3.1 + HU-3.3)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedTwoTenants(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('GET /companies/current', () => {
    it('alice ve sólo su empresa A', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/companies/current')
        .set('Authorization', `Bearer ${fx.aliceAccessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fx.companyAId.toString());
      expect(res.body.legalName).toBe('Empresa A S.A.');
      expect(res.body.currencyCode).toBe('CRC');
    });

    it('bob ve sólo su empresa B', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/companies/current')
        .set('Authorization', `Bearer ${fx.bobAccessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fx.companyBId.toString());
      expect(res.body.legalName).toBe('Empresa B S.A.');
      expect(res.body.currencyCode).toBe('USD');
    });
  });

  describe('PATCH /companies/current (HU-3.1)', () => {
    it('alice actualiza su empresa y queda registrado en audit_log', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch('/companies/current')
        .set('Authorization', `Bearer ${fx.aliceAccessToken}`)
        .send({ tradeName: 'Empresa A', phone: '2222-3333' });
      expect(res.status).toBe(200);
      expect(res.body.tradeName).toBe('Empresa A');
      expect(res.body.phone).toBe('2222-3333');

      // El cambio NO afectó a B.
      const aliceCheck = await tc.raw.company.findUniqueOrThrow({ where: { id: fx.companyBId } });
      expect(aliceCheck.tradeName).toBeNull();

      // audit_log capturó la actualización con userId real (no null).
      const log = await tc.raw.auditLog.findFirst({
        where: { entity: 'Company', entityId: fx.companyAId, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).not.toBeNull();
      const newValues = log!.newValues as Record<string, unknown>;
      expect(newValues.tradeName).toBe('Empresa A');
    });

    it('valida cédula CR antes de aceptar el taxId', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch('/companies/current')
        .set('Authorization', `Bearer ${fx.aliceAccessToken}`)
        .send({ taxId: '3-A01-123456' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/dígitos|tributaria|formato/i);
    });

    it('rechaza body vacío', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch('/companies/current')
        .set('Authorization', `Bearer ${fx.aliceAccessToken}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /branches (HU-3.3)', () => {
    it('alice sólo ve las branches de A (2)', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/branches')
        .set('Authorization', `Bearer ${fx.aliceAccessToken}`);
      expect(res.status).toBe(200);
      const codes = (res.body as { code: string }[]).map((b) => b.code).sort();
      expect(codes).toEqual(['A1', 'A2']);
    });

    it('bob sólo ve la branch de B (1)', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/branches')
        .set('Authorization', `Bearer ${fx.bobAccessToken}`);
      expect(res.status).toBe(200);
      const codes = (res.body as { code: string }[]).map((b) => b.code);
      expect(codes).toEqual(['B1']);
    });
  });

  describe('Sin Bearer / sin permiso', () => {
    it('GET /companies/current sin Bearer → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/companies/current');
      expect(res.status).toBe(401);
    });

    it('usuario con Bearer pero sin permiso → 403', async () => {
      // Crear un usuario sin roles.
      const nobody = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: 'nobody',
          email: 'nobody@demo.local',
          passwordHash: await bcrypt.hash('NobodyPass-1!', 4),
          fullName: 'No Roles',
        },
      });
      const login = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'nobody', password: 'NobodyPass-1!' });
      expect(login.status).toBe(200);
      const res = await request(tc.app.getHttpServer())
        .get('/companies/current')
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(403);
      // Limpieza para no contaminar otros tests del suite.
      await tc.raw.appUser.delete({ where: { id: nobody.id } });
    });
  });
});
