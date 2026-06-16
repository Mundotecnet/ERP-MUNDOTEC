import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

describe('Logout y change-password (e2e contra Postgres real)', () => {
  let tc: AppTestContext;
  let companyId: bigint;

  beforeAll(async () => {
    tc = await createAppTestContext();

    const company = await tc.raw.company.create({
      data: { legalName: 'Logout Demo S.A.', taxId: 'LOGOUT-DEMO', currencyCode: 'USD' },
    });
    companyId = company.id;

    await tc.raw.appUser.create({
      data: {
        companyId,
        username: 'carla',
        email: 'carla@demo.local',
        passwordHash: await bcrypt.hash('Initial-Password-1', 4),
        fullName: 'Carla User',
      },
    });
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  async function login(password = 'Initial-Password-1') {
    const res = await request(tc.app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'carla', password });
    if (res.status !== 200) {
      throw new Error(`login falló (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return res.body as { accessToken: string; refreshToken: string };
  }

  describe('POST /auth/logout', () => {
    it('revoca el refresh y bloquea futuros /auth/refresh con ese token', async () => {
      const { refreshToken } = await login();

      const logout = await request(tc.app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken });
      expect(logout.status).toBe(204);

      const reuse = await request(tc.app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });
      expect(reuse.status).toBe(401);
    });

    it('es idempotente: revocar dos veces sigue devolviendo 204', async () => {
      const { refreshToken } = await login();
      const first = await request(tc.app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken });
      const second = await request(tc.app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken });
      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
    });

    it('logout con un refresh inválido también devuelve 204 (no filtra estado)', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: 'garbage' });
      expect(res.status).toBe(204);
    });
  });

  describe('POST /auth/change-password', () => {
    it('rechaza sin Bearer con 401', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/auth/change-password')
        .send({ currentPassword: 'x', newPassword: 'y' });
      expect(res.status).toBe(401);
    });

    it('rechaza si current no coincide (401)', async () => {
      const { accessToken } = await login();
      const res = await request(tc.app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'wrong', newPassword: 'BrandNewPass-2' });
      expect(res.status).toBe(401);
    });

    it('rechaza nueva password que no cumple policy con 400 y detalles', async () => {
      const { accessToken } = await login();
      const res = await request(tc.app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'Initial-Password-1', newPassword: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no cumple la pol/i);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it('rechaza si la nueva password es igual a la actual', async () => {
      const { accessToken } = await login();
      const res = await request(tc.app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'Initial-Password-1',
          newPassword: 'Initial-Password-1',
        });
      expect(res.status).toBe(400);
    });

    it('cambia la password, revoca refresh tokens previos y permite login con la nueva', async () => {
      // Crear usuario aislado para no interferir con los demás tests.
      await tc.raw.appUser.create({
        data: {
          companyId,
          username: 'dani',
          email: 'dani@demo.local',
          passwordHash: await bcrypt.hash('Dani-Original-1', 4),
          fullName: 'Dani Test',
        },
      });

      const oldLogin = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'dani', password: 'Dani-Original-1' });
      expect(oldLogin.status).toBe(200);
      const oldRefresh = oldLogin.body.refreshToken as string;
      const oldAccess = oldLogin.body.accessToken as string;

      const change = await request(tc.app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${oldAccess}`)
        .send({
          currentPassword: 'Dani-Original-1',
          newPassword: 'Dani-NewPass-2',
        });
      expect(change.status).toBe(204);

      // Refresh anterior queda revocado.
      const reuse = await request(tc.app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: oldRefresh });
      expect(reuse.status).toBe(401);

      // Login con la nueva password funciona.
      const newLogin = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'dani', password: 'Dani-NewPass-2' });
      expect(newLogin.status).toBe(200);

      // Login con la vieja ya no.
      const stale = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'dani', password: 'Dani-Original-1' });
      expect(stale.status).toBe(401);
    });
  });
});
