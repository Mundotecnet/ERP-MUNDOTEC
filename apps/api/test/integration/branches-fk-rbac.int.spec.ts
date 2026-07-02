/**
 * PR Sprint 12 — CRUD de Sucursales:
 *   - DELETE bloqueado por FKs adicionales (purchase_orders, user_branch,
 *     app_user.default_branch_id) además de la FK con warehouse que ya cubría
 *     `branches-warehouses.int.spec.ts`.
 *   - RBAC: sin `branch.create/update/delete` recibe 403.
 *   - Toggle isActive vía PATCH (retirar sin borrar).
 *
 * Los casos "básicos" (POST/GET/PATCH/DELETE simple, tenant, code duplicado,
 * FK warehouse) ya están cubiertos en `branches-warehouses.int.spec.ts`.
 */
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

const STRONG = 'BrCrud-1!aA';

interface Fixtures {
  companyAId: bigint;
  supplierId: bigint;
  /** Admin con todos los permisos de branch.* + partner para las FKs. */
  tokenAdmin: string;
  /** Lector: solo branch.read + auth.login (para probar 403). */
  tokenReader: string;
}

async function seedFixtures(tc: AppTestContext): Promise<Fixtures> {
  await tc.raw.currency.createMany({
    data: [{ code: 'CRC', name: 'Colón', symbol: '₡' }],
    skipDuplicates: true,
  });
  const a = await tc.raw.company.create({
    data: { legalName: 'Br FK', taxId: '3-101-303030', currencyCode: 'CRC' },
  });
  const supplier = await tc.raw.partner.create({
    data: {
      companyId: a.id,
      partnerType: 'SUPPLIER',
      code: 'PROV-1',
      legalName: 'Proveedor Test',
      taxId: '3-101-4040',
    },
  });

  const permCodes = [
    'auth.login',
    'branch.read',
    'branch.create',
    'branch.update',
    'branch.delete',
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
    username: string,
    permFilter: (code: string) => boolean,
  ): Promise<string> {
    const role = await tc.raw.role.create({
      data: { companyId: a.id, name: `role-${username}`, description: username },
    });
    await tc.raw.rolePermission.createMany({
      data: perms
        .filter((p) => permFilter(p.code))
        .map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    const user = await tc.raw.appUser.create({
      data: {
        companyId: a.id,
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
      throw new Error(`login(${username}) falló: ${login.status}`);
    }
    return login.body.accessToken as string;
  }

  return {
    companyAId: a.id,
    supplierId: supplier.id,
    tokenAdmin: await makeUser('br-admin', () => true),
    tokenReader: await makeUser('br-reader', (c) => c === 'auth.login' || c === 'branch.read'),
  };
}

describe('Branches — FKs adicionales + RBAC (PR Sprint 12)', () => {
  let tc: AppTestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    tc = await createAppTestContext();
    fx = await seedFixtures(tc);
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('DELETE 409 por FKs no cubiertas por el spec base', () => {
    it('bloqueado por asignación en user_branch', async () => {
      const branch = await tc.raw.branch.create({
        data: { companyId: fx.companyAId, code: 'UB-1', name: 'Sucursal user-branch' },
      });
      const target = await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: `t-ub-${Date.now()}`,
          email: `t-ub-${Date.now()}@demo.local`,
          passwordHash: await bcrypt.hash(STRONG, 4),
          fullName: 'Target UB',
        },
      });
      await tc.raw.userBranch.create({
        data: { userId: target.id, branchId: branch.id },
      });

      const res = await request(tc.app.getHttpServer())
        .delete(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${fx.tokenAdmin}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/asignaci(ó|o)n\(es\) a usuarios/i);
    });

    it('bloqueado si es defaultBranchId de algún usuario', async () => {
      const branch = await tc.raw.branch.create({
        data: { companyId: fx.companyAId, code: 'DF-1', name: 'Sucursal default' },
      });
      await tc.raw.appUser.create({
        data: {
          companyId: fx.companyAId,
          username: `t-df-${Date.now()}`,
          email: `t-df-${Date.now()}@demo.local`,
          passwordHash: await bcrypt.hash(STRONG, 4),
          fullName: 'Target Default',
          defaultBranchId: branch.id,
        },
      });

      const res = await request(tc.app.getHttpServer())
        .delete(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${fx.tokenAdmin}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/por defecto/i);
    });

    it('bloqueado por orden de compra que la referencia', async () => {
      const branch = await tc.raw.branch.create({
        data: { companyId: fx.companyAId, code: 'PO-1', name: 'Sucursal PO' },
      });
      await tc.raw.purchaseOrder.create({
        data: {
          companyId: fx.companyAId,
          branchId: branch.id,
          supplierId: fx.supplierId,
          orderNumber: `PO-${Date.now()}`,
        },
      });

      const res = await request(tc.app.getHttpServer())
        .delete(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${fx.tokenAdmin}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/orden\(es\) de compra/i);
    });

    it('acumula múltiples referentes en el mismo mensaje', async () => {
      // Una sucursal con warehouse Y purchase_order: el mensaje enumera ambos.
      const branch = await tc.raw.branch.create({
        data: { companyId: fx.companyAId, code: 'MX-1', name: 'Múltiple' },
      });
      await tc.raw.warehouse.create({
        data: { companyId: fx.companyAId, branchId: branch.id, code: 'W-MX-1', name: 'WH' },
      });
      await tc.raw.purchaseOrder.create({
        data: {
          companyId: fx.companyAId,
          branchId: branch.id,
          supplierId: fx.supplierId,
          orderNumber: `PO-MX-${Date.now()}`,
        },
      });

      const res = await request(tc.app.getHttpServer())
        .delete(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${fx.tokenAdmin}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/almac(é|e)n/i);
      expect(res.body.message).toMatch(/orden\(es\) de compra/i);
    });
  });

  describe('Toggle Activo/Inactivo vía PATCH', () => {
    it('PATCH isActive=false desactiva sin borrar', async () => {
      const branch = await tc.raw.branch.create({
        data: { companyId: fx.companyAId, code: 'TOG-1', name: 'Toggle' },
      });
      const off = await request(tc.app.getHttpServer())
        .patch(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${fx.tokenAdmin}`)
        .send({ isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);

      // La sucursal sigue existiendo (inactiva).
      const get = await request(tc.app.getHttpServer())
        .get(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${fx.tokenAdmin}`);
      expect(get.status).toBe(200);
      expect(get.body.isActive).toBe(false);
    });
  });

  describe('RBAC: lector sin branch.create/update/delete → 403', () => {
    it('POST sin permiso branch.create → 403', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${fx.tokenReader}`)
        .send({ code: 'RB-1', name: 'no debería crear' });
      expect(res.status).toBe(403);
    });

    it('PATCH sin permiso branch.update → 403', async () => {
      const branch = await tc.raw.branch.create({
        data: { companyId: fx.companyAId, code: 'RB-2', name: 'para PATCH' },
      });
      const res = await request(tc.app.getHttpServer())
        .patch(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${fx.tokenReader}`)
        .send({ name: 'nuevo nombre' });
      expect(res.status).toBe(403);
    });

    it('DELETE sin permiso branch.delete → 403', async () => {
      const branch = await tc.raw.branch.create({
        data: { companyId: fx.companyAId, code: 'RB-3', name: 'para DELETE' },
      });
      const res = await request(tc.app.getHttpServer())
        .delete(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${fx.tokenReader}`);
      expect(res.status).toBe(403);
    });

    it('GET con solo branch.read funciona (control positivo)', async () => {
      const res = await request(tc.app.getHttpServer())
        .get('/branches')
        .set('Authorization', `Bearer ${fx.tokenReader}`);
      expect(res.status).toBe(200);
    });
  });
});
