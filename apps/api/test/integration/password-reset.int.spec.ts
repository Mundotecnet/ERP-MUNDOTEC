import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { MailerService } from '../../src/mailer/mailer.service';
import { AppTestContext, createAppTestContext } from './app-test-context';

interface CapturedMail {
  to: string;
  subject: string;
  text: string;
}

function lastMailFrom(mailer: MailerService): CapturedMail | null {
  const info = mailer.getLastJsonMessage();
  if (!info) return null;
  // jsonTransport guarda el mensaje serializado en info.message.
  const serialized = info.message;
  if (typeof serialized !== 'string') return null;
  const parsed = JSON.parse(serialized) as {
    to?: { address?: string }[];
    subject?: string;
    text?: string;
  };
  return {
    to: parsed.to?.[0]?.address ?? '',
    subject: parsed.subject ?? '',
    text: parsed.text ?? '',
  };
}

function extractTokenFromMail(mail: CapturedMail): string {
  const match = /\?token=([^\s]+)/.exec(mail.text);
  if (!match) throw new Error(`No se encontró token en el email:\n${mail.text}`);
  return decodeURIComponent(match[1]);
}

describe('Password reset (e2e contra Postgres real)', () => {
  let tc: AppTestContext;
  let mailer: MailerService;
  let companyId: bigint;

  beforeAll(async () => {
    tc = await createAppTestContext();
    mailer = tc.app.get(MailerService);

    const company = await tc.raw.company.create({
      data: { legalName: 'Reset Demo S.A.', taxId: 'RESET-DEMO', currencyCode: 'USD' },
    });
    companyId = company.id;

    await tc.raw.appUser.create({
      data: {
        companyId,
        username: 'erica',
        email: 'erica@demo.local',
        passwordHash: await bcrypt.hash('Initial-Password-1', 4),
        fullName: 'Erica User',
      },
    });
  });

  afterAll(async () => {
    if (tc) await tc.cleanup();
  });

  describe('POST /auth/forgot-password', () => {
    it('responde 204 incluso si el usuario no existe (no filtra)', async () => {
      const before = mailer.getLastJsonMessage();
      const res = await request(tc.app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ username: 'fantasma' });
      expect(res.status).toBe(204);
      // No se envió email nuevo.
      expect(mailer.getLastJsonMessage()).toBe(before);
    });

    it('responde 204 cuando el usuario existe y envía email con token', async () => {
      const res = await request(tc.app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'erica@demo.local' });
      expect(res.status).toBe(204);
      const mail = lastMailFrom(mailer);
      expect(mail).not.toBeNull();
      expect(mail!.to).toBe('erica@demo.local');
      expect(mail!.subject).toMatch(/Recuperaci/i);
      expect(mail!.text).toContain('token=');
    });

    it('exige username o email', async () => {
      const res = await request(tc.app.getHttpServer()).post('/auth/forgot-password').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/reset-password', () => {
    async function requestReset(): Promise<string> {
      const before = mailer.getLastJsonMessage();
      const res = await request(tc.app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'erica@demo.local' });
      expect(res.status).toBe(204);
      const after = mailer.getLastJsonMessage();
      // Asegurar que se emitió uno nuevo.
      expect(after).not.toBe(before);
      const mail = lastMailFrom(mailer);
      if (!mail) throw new Error('No se capturó email');
      return extractTokenFromMail(mail);
    }

    it('cambia la password con token válido y permite login con la nueva', async () => {
      const token = await requestReset();

      // Login con vieja antes del reset funciona.
      const oldLogin = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'erica', password: 'Initial-Password-1' });
      expect(oldLogin.status).toBe(200);
      const oldRefresh = oldLogin.body.refreshToken as string;

      const reset = await request(tc.app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'Reset-NewPass-2' });
      expect(reset.status).toBe(204);

      // Login con vieja ya no.
      const stale = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'erica', password: 'Initial-Password-1' });
      expect(stale.status).toBe(401);

      // Login con nueva sí.
      const fresh = await request(tc.app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'erica', password: 'Reset-NewPass-2' });
      expect(fresh.status).toBe(200);

      // Refresh anterior revocado.
      const reuse = await request(tc.app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: oldRefresh });
      expect(reuse.status).toBe(401);
    });

    it('rechaza un token ya usado (un solo uso)', async () => {
      // Restauramos la password con un primer reset y luego intentamos el mismo
      // token otra vez.
      const token = await requestReset();
      const first = await request(tc.app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'OnceUsed-1A' });
      expect(first.status).toBe(204);

      const second = await request(tc.app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'OnceUsed-2B' });
      expect(second.status).toBe(400);
    });

    it('rechaza token con secret manipulado', async () => {
      const token = await requestReset();
      const [jti] = token.split('.');
      const tampered = `${jti}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      const res = await request(tc.app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: tampered, newPassword: 'Tampered-1A' });
      expect(res.status).toBe(400);
    });

    it('rechaza nueva password que no cumple la policy y devuelve detalles', async () => {
      const token = await requestReset();
      const res = await request(tc.app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no cumple la pol/i);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it('rechaza body incompleto', async () => {
      const r1 = await request(tc.app.getHttpServer())
        .post('/auth/reset-password')
        .send({ newPassword: 'X' });
      expect(r1.status).toBe(400);
      const r2 = await request(tc.app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'x.y' });
      expect(r2.status).toBe(400);
    });
  });
});
