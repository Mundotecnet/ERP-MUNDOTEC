import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Catalogs-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenA: string;
  tokenB: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Cat A', taxId: '3-101-100100', currencyCode: 'CRC' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Cat B', taxId: '3-101-200200', currencyCode: 'CRC' },
  });

  // Catalogo global de monedas que el suite va a usar.
  await tc.raw.currency.createMany({
    data: [
      { code: 'CRC', name: 'Colón costarricense', symbol: '₡' },
      { code: 'USD', name: 'Dólar', symbol: '$' },
    ],
    skipDuplicates: true,
  });

  const codes = [
    'auth.login',
    'catalogs.currency.read',
    'catalogs.currency.manage',
    'catalogs.exchange-rate.read',
    'catalogs.exchange-rate.manage',
    'catalogs.tax.read',
    'catalogs.tax.manage',
    'catalogs.uom.read',
    'catalogs.uom.manage',
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
    tokenA: await makeAdmin(a.id, 'cat-admin-a'),
    tokenB: await makeAdmin(b.id, 'cat-admin-b'),
  };
}

describe('Catálogos base (HU-5.1, 5.2, 5.3)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('Currencies (global)', () => {
    it('GET lista las monedas creadas en el seed del test', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/currencies')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      const codes = (res.body as { code: string }[]).map((c) => c.code).sort();
      expect(codes).toEqual(expect.arrayContaining(['CRC', 'USD']));
    });

    it('POST crea, GET :code, PATCH name, DELETE OK', async () => {
      const create = await request(tc.app.getHttpServer())
        .post('/currencies')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'EUR', name: 'Euro', symbol: '€' });
      expect(create.status).toBe(201);

      const get = await request(tc.app.getHttpServer())
        .get('/currencies/eur') // lowercase: el controller normaliza
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(get.status).toBe(200);
      expect(get.body.code).toBe('EUR');

      const patch = await request(tc.app.getHttpServer())
        .patch('/currencies/EUR')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Euro europeo' });
      expect(patch.status).toBe(200);
      expect(patch.body.name).toBe('Euro europeo');

      const del = await request(tc.app.getHttpServer())
        .delete('/currencies/EUR')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);
    });

    it('POST duplicado 409, código inválido 400', async () => {
      const dup = await request(tc.app.getHttpServer())
        .post('/currencies')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'USD', name: 'duplicada' });
      expect(dup.status).toBe(409);

      const bad = await request(tc.app.getHttpServer())
        .post('/currencies')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'xx', name: 'mala' });
      expect(bad.status).toBe(400);
    });

    it('DELETE bloqueado si moneda está en uso (company.currencyCode)', async () => {
      const res = await request(tc.app.getHttpServer())
        .delete('/currencies/CRC')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/en uso/i);
    });
  });

  describe('ExchangeRates (global) + helper /convert', () => {
    let firstRateId: string;

    it('POST crea, list filtra por currencyCode, PATCH actualiza', async () => {
      const c1 = await request(tc.app.getHttpServer())
        .post('/exchange-rates')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ currencyCode: 'USD', rateDate: '2026-01-01', rate: 1 });
      expect(c1.status).toBe(201);
      firstRateId = c1.body.id as string;

      const c2 = await request(tc.app.getHttpServer())
        .post('/exchange-rates')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ currencyCode: 'CRC', rateDate: '2026-01-01', rate: 500 });
      expect(c2.status).toBe(201);

      const list = await request(tc.app.getHttpServer())
        .get('/exchange-rates?currencyCode=USD')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(list.status).toBe(200);
      const codes = (list.body as { currencyCode: string }[]).map((r) => r.currencyCode);
      expect(new Set(codes)).toEqual(new Set(['USD']));

      const patch = await request(tc.app.getHttpServer())
        .patch(`/exchange-rates/${firstRateId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ rate: 1.05 });
      expect(patch.status).toBe(200);
      expect(Number(patch.body.rate)).toBeCloseTo(1.05, 4);
    });

    it('POST duplicado (mismo currency+date) → 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/exchange-rates')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ currencyCode: 'USD', rateDate: '2026-01-01', rate: 1.1 });
      expect(res.status).toBe(409);
    });

    it('POST con currencyCode inexistente → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/exchange-rates')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ currencyCode: 'XYZ', rateDate: '2026-01-01', rate: 1 });
      expect(res.status).toBe(400);
    });

    it('GET /convert from == to devuelve el mismo monto y rate=1', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/exchange-rates/convert?amount=100&from=USD&to=USD&date=2026-01-01')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.amount).toBe('100');
      expect(res.body.rateUsed).toBe('1');
    });

    it('GET /convert calcula con tasas vigentes', async () => {
      // USD@2026-01-01 = 1.05, CRC@2026-01-01 = 500. 100 USD → 100 * (1.05/500) = 0.21 CRC.
      const res = await request(tc.app.getHttpServer())
        .get('/exchange-rates/convert?amount=100&from=USD&to=CRC&date=2026-02-01')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(Number(res.body.amount)).toBeCloseTo(0.21, 2);
    });

    it('GET /convert sin tasa aplicable → 404', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/exchange-rates/convert?amount=100&from=USD&to=CRC&date=2025-01-01')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(404);
    });

    it('GET /convert params faltantes → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/exchange-rates/convert')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Taxes (per-tenant)', () => {
    let taxAId: string;

    it('POST crea con companyId del JWT y aisla entre empresas', async () => {
      const cA = await request(tc.app.getHttpServer())
        .post('/taxes')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'IVA A 13%', rate: 0.13 });
      expect(cA.status).toBe(201);
      taxAId = cA.body.id as string;

      await request(tc.app.getHttpServer())
        .post('/taxes')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ name: 'Sales tax B', rate: 0.08 });

      const listA = await request(tc.app.getHttpServer())
        .get('/taxes')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const namesA = (listA.body as { name: string }[]).map((t) => t.name);
      expect(namesA).toEqual(['IVA A 13%']);

      const listB = await request(tc.app.getHttpServer())
        .get('/taxes')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      const namesB = (listB.body as { name: string }[]).map((t) => t.name);
      expect(namesB).toEqual(['Sales tax B']);
    });

    it('PATCH y DELETE propios; uno ajeno devuelve 404', async () => {
      const patch = await request(tc.app.getHttpServer())
        .patch(`/taxes/${taxAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ rate: 0.15 });
      expect(patch.status).toBe(200);

      const foreign = await request(tc.app.getHttpServer())
        .patch(`/taxes/${taxAId}`)
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ rate: 0.99 });
      expect(foreign.status).toBe(404);

      const del = await request(tc.app.getHttpServer())
        .delete(`/taxes/${taxAId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);
    });

    it('rate fuera de [0,1] → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/taxes')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'mal', rate: 2 });
      expect(res.status).toBe(400);
    });
  });

  describe('UnitsOfMeasure (global)', () => {
    let kgId: string;

    it('POST crea, list muestra, código se normaliza a mayúscula', async () => {
      const create = await request(tc.app.getHttpServer())
        .post('/units-of-measure')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'kg', name: 'Kilogramo' });
      expect(create.status).toBe(201);
      expect(create.body.code).toBe('KG');
      kgId = create.body.id as string;

      const list = await request(tc.app.getHttpServer())
        .get('/units-of-measure')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const codes = (list.body as { code: string }[]).map((u) => u.code);
      expect(codes).toContain('KG');
    });

    it('POST duplicado → 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/units-of-measure')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'KG', name: 'Kilogramo duplicado' });
      expect(res.status).toBe(409);
    });

    it('PATCH y DELETE OK', async () => {
      const patch = await request(tc.app.getHttpServer())
        .patch(`/units-of-measure/${kgId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Kilogramo masa' });
      expect(patch.status).toBe(200);
      expect(patch.body.name).toBe('Kilogramo masa');

      const del = await request(tc.app.getHttpServer())
        .delete(`/units-of-measure/${kgId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);
    });

    it('code inválido (caracteres no permitidos) → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/units-of-measure')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ code: 'kg.m', name: 'malo' });
      expect(res.status).toBe(400);
    });
  });
});
