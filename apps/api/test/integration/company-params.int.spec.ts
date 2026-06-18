import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Params-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenA: string;
  tokenB: string;
  /** Token con sólo params.read en A. */
  tokenReadOnlyA: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Params A', taxId: '3-101-515151', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Params B', taxId: '3-101-616161', currencyCode: 'USD' },
  });

  const codes = ['auth.login', 'params.read', 'params.manage'];
  const perms = await Promise.all(
    codes.map((code) =>
      tc.raw.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: code.split('.')[0], description: code },
      }),
    ),
  );
  const readPermId = perms.find((p) => p.code === 'params.read')!.id;
  const loginPermId = perms.find((p) => p.code === 'auth.login')!.id;

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
      throw new Error(`login(${username}) falló: ${login.status}`);
    }
    return login.body.accessToken as string;
  }

  // Usuario read-only en A para probar 403 en mutaciones.
  async function makeReadOnly(companyId: bigint, username: string): Promise<string> {
    const role = await tc.raw.role.create({
      data: { companyId, name: 'readonly', description: 'Solo lectura params' },
    });
    await tc.raw.rolePermission.createMany({
      data: [
        { roleId: role.id, permissionId: loginPermId },
        { roleId: role.id, permissionId: readPermId },
      ],
    });
    const user = await tc.raw.appUser.create({
      data: {
        companyId,
        username,
        email: `${username}@demo.local`,
        passwordHash: await bcrypt.hash(STRONG, 4),
        fullName: `${username} read`,
      },
    });
    await tc.raw.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const login = await request(tc.app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: STRONG });
    return login.body.accessToken as string;
  }

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenA: await makeAdmin(a.id, 'p-admin-a'),
    tokenB: await makeAdmin(b.id, 'p-admin-b'),
    tokenReadOnlyA: await makeReadOnly(a.id, 'p-read-a'),
  };
}

describe('Parámetros generales (HU-6.3)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('PUT /params/:key (upsert)', () => {
    it('crea un parámetro con valor string', async () => {
      const res = await request(tc.app.getHttpServer())
        .put('/params/format.date')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ value: 'DD/MM/YYYY' });
      expect(res.status).toBe(200);
      expect(res.body.key).toBe('format.date');
      expect(res.body.value).toBe('DD/MM/YYYY');
    });

    it('actualiza el mismo key (mismo PUT es upsert)', async () => {
      const res = await request(tc.app.getHttpServer())
        .put('/params/format.date')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ value: 'YYYY-MM-DD' });
      expect(res.status).toBe(200);
      expect(res.body.value).toBe('YYYY-MM-DD');
    });

    it('acepta value JSON arbitrario (object, array, boolean, null, number)', async () => {
      const samples: { key: string; value: unknown }[] = [
        { key: 'documents.invoice.prefix', value: 'FE' },
        { key: 'documents.invoice.next-number', value: 1001 },
        { key: 'feature.crm.enabled', value: true },
        { key: 'feature.disabled', value: null },
        {
          key: 'branding.colors',
          value: { primary: '#003B82', secondary: '#FF6F00', extras: ['#fff', '#000'] },
        },
      ];
      for (const sample of samples) {
        const res = await request(tc.app.getHttpServer())
          .put(`/params/${sample.key}`)
          .set('Authorization', `Bearer ${fx.tokenA}`)
          .send({ value: sample.value });
        expect(res.status).toBe(200);
        expect(res.body.value).toEqual(sample.value);
      }
    });

    it('rechaza key inválida (mayúscula) → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .put('/params/Format.Date')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ value: 'x' });
      expect(res.status).toBe(400);
    });

    it('rechaza body sin campo "value" → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .put('/params/whatever')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('un user sólo con params.read recibe 403 al PUT', async () => {
      const res = await request(tc.app.getHttpServer())
        .put('/params/format.date')
        .set('Authorization', `Bearer ${fx.tokenReadOnlyA}`)
        .send({ value: 'no' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /params', () => {
    it('lista los parámetros de la empresa, ordenados por key', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/params')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      const keys = (res.body as { key: string }[]).map((p) => p.key);
      expect(keys).toEqual([...keys].sort());
      expect(keys).toEqual(
        expect.arrayContaining([
          'branding.colors',
          'documents.invoice.next-number',
          'documents.invoice.prefix',
          'feature.crm.enabled',
          'feature.disabled',
          'format.date',
        ]),
      );
    });

    it('aísla entre empresas', async () => {
      await request(tc.app.getHttpServer())
        .put('/params/feature.b-only')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ value: 'foo' });

      const a = await request(tc.app.getHttpServer())
        .get('/params')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect((a.body as { key: string }[]).map((p) => p.key)).not.toContain('feature.b-only');

      const b = await request(tc.app.getHttpServer())
        .get('/params')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      expect((b.body as { key: string }[]).map((p) => p.key)).toEqual(['feature.b-only']);
    });

    it('GET por key inexistente → 404', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/params/no.existe')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /params/:key', () => {
    it('borra y vuelve a 404', async () => {
      await request(tc.app.getHttpServer())
        .put('/params/temporal')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ value: 'temp' });

      const del = await request(tc.app.getHttpServer())
        .delete('/params/temporal')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);

      const get = await request(tc.app.getHttpServer())
        .get('/params/temporal')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(get.status).toBe(404);
    });

    it('DELETE de key inexistente → 404', async () => {
      const res = await request(tc.app.getHttpServer())
        .delete('/params/no.existe')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(404);
    });

    it('user con sólo params.read recibe 403 al DELETE', async () => {
      const res = await request(tc.app.getHttpServer())
        .delete('/params/format.date')
        .set('Authorization', `Bearer ${fx.tokenReadOnlyA}`);
      expect(res.status).toBe(403);
    });
  });
});
