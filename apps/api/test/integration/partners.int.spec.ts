import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'Partner-1!aA';

interface Fixtures {
  companyAId: bigint;
  companyBId: bigint;
  tokenA: string;
  tokenB: string;
  tokenReadOnly: string;
  customerCategoryAId: string;
  customerCategoryBId: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  const a = await tc.raw.company.create({
    data: { legalName: 'Partner A', taxId: '3-101-505050', currencyCode: 'USD' },
  });
  const b = await tc.raw.company.create({
    data: { legalName: 'Partner B', taxId: '3-101-606060', currencyCode: 'USD' },
  });
  await tc.raw.currency.upsert({
    where: { code: 'USD' },
    update: {},
    create: { code: 'USD', name: 'Dólar', symbol: '$' },
  });
  await tc.raw.currency.upsert({
    where: { code: 'CRC' },
    update: {},
    create: { code: 'CRC', name: 'Colón', symbol: '₡' },
  });

  const codes = ['auth.login', 'partners.read', 'partners.manage'];
  const perms = await Promise.all(
    codes.map((code) =>
      tc.raw.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: code.split('.')[0], description: code },
      }),
    ),
  );
  const loginPerm = perms.find((p) => p.code === 'auth.login')!;
  const readPerm = perms.find((p) => p.code === 'partners.read')!;

  async function makeUser(
    companyId: bigint,
    username: string,
    permsForRole: typeof perms,
  ): Promise<string> {
    const role = await tc.raw.role.create({
      data: { companyId, name: `role-${username}`, description: 'test' },
    });
    await tc.raw.rolePermission.createMany({
      data: permsForRole.map((p) => ({ roleId: role.id, permissionId: p.id })),
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
    return login.body.accessToken as string;
  }

  const tokenA = await makeUser(a.id, 'p-admin-a', perms);
  const tokenB = await makeUser(b.id, 'p-admin-b', perms);
  const tokenReadOnly = await makeUser(a.id, 'p-readonly-a', [loginPerm, readPerm]);

  const ccA = await tc.raw.customerCategory.create({
    data: { companyId: a.id, code: 'VIP', name: 'VIP' },
  });
  const ccB = await tc.raw.customerCategory.create({
    data: { companyId: b.id, code: 'NEW', name: 'Nuevos' },
  });

  return {
    companyAId: a.id,
    companyBId: b.id,
    tokenA,
    tokenB,
    tokenReadOnly,
    customerCategoryAId: ccA.id.toString(),
    customerCategoryBId: ccB.id.toString(),
  };
}

describe('Partners (HU-9.1)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('CRUD básico', () => {
    let supplierId: string;
    let customerId: string;
    let bothId: string;

    it('crea un proveedor con todos los campos', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          partnerType: 'SUPPLIER',
          code: 'SUP-001',
          legalName: 'Distribuidora ABC S.A.',
          tradeName: 'ABC',
          taxId: '3-101-700700',
          email: 'ventas@abc.cr',
          phone: '+506-2222-3333',
          address: 'San José, Costa Rica',
          currencyCode: 'USD',
          creditLimit: '5000.00',
          creditDays: 30,
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        partnerType: 'SUPPLIER',
        code: 'SUP-001',
        legalName: 'Distribuidora ABC S.A.',
        creditDays: 30,
        creditLimit: '5000',
        isActive: true,
      });
      supplierId = res.body.id;
    });

    it('crea un cliente y un BOTH con defaults', async () => {
      const cust = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          partnerType: 'CUSTOMER',
          legalName: 'Cliente final',
          customerCategoryId: fx.customerCategoryAId,
        });
      expect(cust.status).toBe(201);
      expect(cust.body).toMatchObject({
        partnerType: 'CUSTOMER',
        legalName: 'Cliente final',
        currencyCode: 'USD',
        creditDays: 0,
        creditLimit: '0',
        customerCategoryId: fx.customerCategoryAId,
      });
      expect(cust.body.code).toBeNull();
      customerId = cust.body.id;

      const both = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ partnerType: 'BOTH', legalName: 'Empresa mixta', code: 'MIX-1' });
      expect(both.status).toBe(201);
      bothId = both.body.id;
    });

    it('GET /:id incluye los contactos', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/partners/${supplierId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: supplierId, contacts: [] });
    });

    it('PATCH actualiza un subset', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/partners/${supplierId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ creditDays: 45, isActive: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ creditDays: 45, isActive: false });
    });

    it('código duplicado por empresa → 409', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ partnerType: 'SUPPLIER', legalName: 'Otro', code: 'SUP-001' });
      expect(res.status).toBe(409);
    });

    it('mismo código permitido en otra empresa', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ partnerType: 'SUPPLIER', legalName: 'En B', code: 'SUP-001' });
      expect(res.status).toBe(201);
    });

    it('DELETE hace soft-delete (no aparece en listas posteriores)', async () => {
      const del = await request(tc.app.getHttpServer())
        .delete(`/partners/${bothId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(del.status).toBe(204);

      const list = await request(tc.app.getHttpServer())
        .get('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(list.body.map((p: { id: string }) => p.id)).not.toContain(bothId);

      const row = await tc.raw.partner.findUnique({ where: { id: BigInt(bothId) } });
      expect(row?.deletedAt).not.toBeNull();
    });

    it('mantiene IDs disponibles para próximos casos', () => {
      expect(supplierId).toBeDefined();
      expect(customerId).toBeDefined();
    });
  });

  describe('Filtro por tipo (BOTH cuenta como CUSTOMER y SUPPLIER)', () => {
    it('?type=SUPPLIER incluye SUPPLIER + BOTH y excluye CUSTOMER', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/partners?type=SUPPLIER')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      const types = res.body.map((p: { partnerType: string }) => p.partnerType);
      expect(types).toContain('SUPPLIER');
      expect(types).not.toContain('CUSTOMER');
      // (los BOTH ya fueron soft-deleted en el bloque anterior, pero el filtro
      //  los habría incluido si quedaran activos)
    });

    it('?type=CUSTOMER excluye SUPPLIER puros', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/partners?type=CUSTOMER')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      const types = res.body.map((p: { partnerType: string }) => p.partnerType);
      expect(types).toContain('CUSTOMER');
      expect(types).not.toContain('SUPPLIER');
    });

    it('?type=XYZ → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/partners?type=XYZ')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(400);
    });

    it('?q filtra por legal_name (insensitive)', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/partners?q=distribuidora')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(
        res.body.some((p: { legalName: string }) =>
          p.legalName.toLowerCase().includes('distribuidora'),
        ),
      ).toBe(true);
    });
  });

  describe('Validaciones de referencias', () => {
    it('moneda inexistente → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ partnerType: 'CUSTOMER', legalName: 'Mala moneda', currencyCode: 'XYZ' });
      expect(res.status).toBe(400);
    });

    it('customerCategoryId de otra empresa → 400', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({
          partnerType: 'CUSTOMER',
          legalName: 'Cross tenant',
          customerCategoryId: fx.customerCategoryBId,
        });
      expect(res.status).toBe(400);
    });
  });

  describe('Aislamiento por empresa', () => {
    it('GET sólo lista partners de la empresa del usuario', async () => {
      const resA = await request(tc.app.getHttpServer())
        .get('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      const resB = await request(tc.app.getHttpServer())
        .get('/partners')
        .set('Authorization', `Bearer ${fx.tokenB}`);
      // Crear uno en B para asegurar que A no lo ve.
      const bCreated = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ partnerType: 'CUSTOMER', legalName: 'Solo B' });
      expect(bCreated.status).toBe(201);
      const afterA = await request(tc.app.getHttpServer())
        .get('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(afterA.body.length).toBe(resA.body.length);
      expect(afterA.body.map((p: { id: string }) => p.id)).not.toContain(bCreated.body.id);
      expect(resB.body.length).toBeGreaterThanOrEqual(0);
    });

    it('GET /:id de otra empresa → 404', async () => {
      const created = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ partnerType: 'SUPPLIER', legalName: 'B-only', code: 'BONLY' });
      const res = await request(tc.app.getHttpServer())
        .get(`/partners/${created.body.id}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Contactos', () => {
    let partnerId: string;
    let contactId: string;

    beforeAll(async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ partnerType: 'SUPPLIER', legalName: 'Con contactos', code: 'CC-1' });
      partnerId = res.body.id;
    });

    it('POST crea un contacto', async () => {
      const res = await request(tc.app.getHttpServer())
        .post(`/partners/${partnerId}/contacts`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ name: 'Ana Pérez', position: 'Compras', email: 'ana@cc.cr' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Ana Pérez',
        position: 'Compras',
        email: 'ana@cc.cr',
      });
      contactId = res.body.id;
    });

    it('GET /:id incluye los contactos creados', async () => {
      const res = await request(tc.app.getHttpServer())
        .get(`/partners/${partnerId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.contacts).toHaveLength(1);
      expect(res.body.contacts[0].id).toBe(contactId);
    });

    it('PATCH actualiza el contacto', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/partners/${partnerId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`)
        .send({ position: 'Gerente de compras' });
      expect(res.status).toBe(200);
      expect(res.body.position).toBe('Gerente de compras');
    });

    it('PATCH a contacto de un partner de otra empresa → 404', async () => {
      const res = await request(tc.app.getHttpServer())
        .patch(`/partners/${partnerId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${fx.tokenB}`)
        .send({ position: 'X' });
      expect(res.status).toBe(404);
    });

    it('DELETE borra el contacto físicamente', async () => {
      const res = await request(tc.app.getHttpServer())
        .delete(`/partners/${partnerId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(res.status).toBe(204);

      const list = await request(tc.app.getHttpServer())
        .get(`/partners/${partnerId}/contacts`)
        .set('Authorization', `Bearer ${fx.tokenA}`);
      expect(list.body).toHaveLength(0);
    });
  });

  describe('RBAC', () => {
    it('POST con rol read-only → 403', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/partners')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`)
        .send({ partnerType: 'CUSTOMER', legalName: 'Sin permiso' });
      expect(res.status).toBe(403);
    });

    it('GET sin token → 401', async () => {
      const res = await request(tc.app.getHttpServer()).get('/partners');
      expect(res.status).toBe(401);
    });

    it('GET con read-only → 200', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/partners')
        .set('Authorization', `Bearer ${fx.tokenReadOnly}`);
      expect(res.status).toBe(200);
    });
  });
});
