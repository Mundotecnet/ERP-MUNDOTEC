import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AppTestContext, createAppTestContext } from './app-test-context';

describe('Auth flow (e2e contra Postgres real)', () => {
  let tc: AppTestContext;
  let companyId: bigint;
  let companyIdStr: string;

  beforeAll(async () => {
    tc = await createAppTestContext();

    const company = await tc.raw.company.create({
      data: { legalName: 'Auth Demo S.A.', taxId: 'AUTH-DEMO', currencyCode: 'USD' },
    });
    companyId = company.id;
    companyIdStr = company.id.toString();

    await tc.raw.appUser.create({
      data: {
        companyId,
        username: 'alice',
        email: 'alice@demo.local',
        passwordHash: await bcrypt.hash('Secret123!', 4),
        fullName: 'Alice Admin',
      },
    });
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('POST /auth/login', () => {
    it('emite tokens válidos con credenciales correctas', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'alice', password: 'Secret123!' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.body.user).toEqual({
        id: expect.any(String),
        email: 'alice@demo.local',
        fullName: 'Alice Admin',
        companyId: companyIdStr,
      });
    });

    it('acepta login por email', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'alice@demo.local', password: 'Secret123!' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('rechaza password incorrecta con 401', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'alice', password: 'wrong' });
      expect(res.status).toBe(401);
    });

    it('bloquea la cuenta tras AUTH_MAX_FAILED_ATTEMPTS=3 intentos fallidos (423)', async () => {
      const userBefore = await tc.raw.appUser.create({
        data: {
          companyId,
          username: 'bob',
          email: 'bob@demo.local',
          passwordHash: await bcrypt.hash('Secret123!', 4),
          fullName: 'Bob Locked',
        },
      });
      // 3 intentos fallidos.
      for (let i = 0; i < 3; i++) {
        await request(tc.app.getHttpServer())
          .post('/auth/login')
          .send({ username: 'bob', password: 'wrong' });
      }
      const locked = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'bob', password: 'Secret123!' });
      expect(locked.status).toBe(423);
      const dbRow = await tc.raw.appUser.findUniqueOrThrow({ where: { id: userBefore.id } });
      expect(dbRow.failedLoginAttempts).toBeGreaterThanOrEqual(3);
      expect(dbRow.lockedUntil).not.toBeNull();
    });
  });

  describe('JwtAuthGuard global', () => {
    it('GET /health pasa sin Bearer (es @Public)', async () => {
      const res = await request(tc.app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET / pasa sin Bearer', async () => {
      const res = await request(tc.app.getHttpServer()).get('/');
      expect(res.status).toBe(200);
    });

    it('endpoint protegido rechaza sin Bearer con 401', async () => {
      const res = await request(tc.app.getHttpServer()).post('/admin/companies').send({});
      expect(res.status).toBe(401);
    });

    it('endpoint protegido pasa el guard con Bearer válido (luego falla en RBAC, esperado)', async () => {
      const login = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'alice', password: 'Secret123!' });
      expect(login.status).toBe(200);

      const res = await request(tc.app.getHttpServer())
        .post('/admin/companies')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .send({ legalName: 'X', taxId: 'X' });
      // Alice existe pero no tiene roles asignados → PermissionsGuard responde 403.
      // Lo importante es que YA NO sea 401 (autenticación) sino 403 (autorización).
      expect(res.status).toBe(403);
    });
  });

  describe('POST /auth/refresh', () => {
    it('emite un nuevo accessToken con un refresh válido', async () => {
      const login = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'alice', password: 'Secret123!' });
      expect(login.status).toBe(200);

      const refresh = await request(tc.app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: login.body.refreshToken });
      expect(refresh.status).toBe(200);
      expect(refresh.body.accessToken).toEqual(expect.any(String));
      // El nuevo token decodificado debe tener sub correcto. No comparamos
      // igualdad contra el original: si la emisión cae en el mismo segundo,
      // iat coincide y el JWT firmado es idéntico — falso positivo.
      const parts = (refresh.body.accessToken as string).split('.');
      expect(parts).toHaveLength(3);
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.type).toBe('access');
      expect(payload.sub).toEqual(expect.any(String));
    });

    it('rechaza refresh con firma inválida (401)', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not-a-real-jwt' });
      expect(res.status).toBe(401);
    });

    it('rechaza el access token como si fuera refresh (401)', async () => {
      const login = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'alice', password: 'Secret123!' });
      const res = await request(tc.app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: login.body.accessToken });
      expect(res.status).toBe(401);
    });
  });
});
