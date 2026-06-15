import * as bcrypt from 'bcrypt';
import { createTestContext, TestContext } from './test-context';

describe('Extensiones Prisma (integración con Postgres real)', () => {
  let tc: TestContext;
  let companyId: bigint;
  let otherCompanyId: bigint;
  let actingUserId: bigint;

  beforeAll(async () => {
    tc = await createTestContext();

    // Seed mínimo: dos companies y un usuario que actúa.
    const c1 = await tc.raw.company.create({
      data: { legalName: 'Demo A', taxId: 'TAX-A', currencyCode: 'USD' },
    });
    const c2 = await tc.raw.company.create({
      data: { legalName: 'Demo B', taxId: 'TAX-B', currencyCode: 'USD' },
    });
    companyId = c1.id;
    otherCompanyId = c2.id;

    const user = await tc.raw.appUser.create({
      data: {
        companyId,
        username: 'acting',
        email: 'acting@demo.local',
        passwordHash: await bcrypt.hash('x', 4),
        fullName: 'Acting User',
      },
    });
    actingUserId = user.id;
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('audit', () => {
    it('INSERT registra new_values con user_id del contexto', async () => {
      const created = await tc.ctx.run({ userId: actingUserId, companyId }, () =>
        tc.client.tax.create({ data: { companyId, name: 'IVA test', rate: '0.13' } }),
      );
      const log = await tc.raw.auditLog.findFirstOrThrow({
        where: { entity: 'Tax', entityId: created.id, action: 'INSERT' },
      });
      expect(log.userId).toBe(actingUserId);
      expect(log.oldValues).toBeNull();
      const newValues = log.newValues as Record<string, unknown>;
      expect(newValues.name).toBe('IVA test');
      expect(newValues.rate).toBe('0.13');
    });

    it('UPDATE registra old y new', async () => {
      const dept = await tc.ctx.run({ userId: actingUserId, companyId }, () =>
        tc.client.department.create({
          data: { companyId, name: 'Ventas' },
        }),
      );
      await tc.ctx.run({ userId: actingUserId, companyId }, () =>
        tc.client.department.update({ where: { id: dept.id }, data: { name: 'Comercial' } }),
      );
      const log = await tc.raw.auditLog.findFirstOrThrow({
        where: { entity: 'Department', entityId: dept.id, action: 'UPDATE' },
      });
      expect((log.oldValues as Record<string, unknown>).name).toBe('Ventas');
      expect((log.newValues as Record<string, unknown>).name).toBe('Comercial');
    });

    it('DELETE físico registra old', async () => {
      const cat = await tc.ctx.run({ userId: actingUserId, companyId }, () =>
        tc.client.productCategory.create({ data: { companyId, name: 'PorBorrar' } }),
      );
      await tc.ctx.run({ userId: actingUserId, companyId }, () =>
        tc.client.productCategory.delete({ where: { id: cat.id } }),
      );
      const log = await tc.raw.auditLog.findFirstOrThrow({
        where: { entity: 'ProductCategory', entityId: cat.id, action: 'DELETE' },
      });
      expect((log.oldValues as Record<string, unknown>).name).toBe('PorBorrar');
      expect(log.newValues).toBeNull();
    });
  });

  describe('soft-delete (AppUser)', () => {
    it('delete marca deletedAt, mantiene el row físicamente y oculta de findMany', async () => {
      const user = await tc.raw.appUser.create({
        data: {
          companyId,
          username: 'soft',
          email: 'soft@demo.local',
          passwordHash: 'x',
          fullName: 'Soft User',
        },
      });
      await tc.ctx.run({ userId: actingUserId, companyId }, () =>
        tc.client.appUser.delete({ where: { id: user.id } }),
      );

      // físicamente sigue
      const rawRow = await tc.raw.appUser.findUnique({ where: { id: user.id } });
      expect(rawRow).not.toBeNull();
      expect(rawRow?.deletedAt).not.toBeNull();

      // a través del cliente extendido NO aparece
      const visible = await tc.ctx.run({ companyId, userId: actingUserId }, () =>
        tc.client.appUser.findFirst({ where: { id: user.id } }),
      );
      expect(visible).toBeNull();

      // audit registró DELETE
      const log = await tc.raw.auditLog.findFirstOrThrow({
        where: { entity: 'AppUser', entityId: user.id, action: 'DELETE' },
      });
      expect((log.oldValues as Record<string, unknown>).username).toBe('soft');
    });
  });

  describe('tenant scoping', () => {
    it('findMany sobre Branch filtra por companyId del contexto', async () => {
      const sucA = await tc.raw.branch.create({
        data: { companyId, code: 'A1', name: 'Sucursal A1' },
      });
      const sucB = await tc.raw.branch.create({
        data: { companyId: otherCompanyId, code: 'B1', name: 'Sucursal B1' },
      });

      const seenAsA = await tc.ctx.run({ companyId, userId: actingUserId }, () =>
        tc.client.branch.findMany({ where: { id: { in: [sucA.id, sucB.id] } } }),
      );
      expect(seenAsA.map((b) => b.id)).toEqual([sucA.id]);

      const seenAsB = await tc.ctx.run({ companyId: otherCompanyId, userId: actingUserId }, () =>
        tc.client.branch.findMany({ where: { id: { in: [sucA.id, sucB.id] } } }),
      );
      expect(seenAsB.map((b) => b.id)).toEqual([sucB.id]);
    });

    it('sin companyId en contexto, no filtra', async () => {
      const all = await tc.client.branch.findMany();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });
  });
});
