import { execSync } from 'node:child_process';
import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../../src/app.module';

const API_ROOT = join(__dirname, '..', '..');

export interface AppTestContext {
  app: INestApplication;
  raw: PrismaClient;
  cleanup(): Promise<void>;
}

/**
 * Levanta un Postgres efímero, aplica migraciones Prisma, setea las env vars
 * necesarias (DATABASE_URL, JWT_*, etc.) y arranca el AppModule completo. El
 * objeto resultante expone:
 *
 *   - `app`: NestApplication listo para usar con supertest.
 *   - `raw`: PrismaClient sin extensiones para preparar fixtures.
 *   - `cleanup()`: detiene la app y el contenedor.
 */
export async function createAppTestContext(): Promise<AppTestContext> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:15')
    .withDatabase('test_erp')
    .withUsername('test_user')
    .withPassword('test_pass')
    .start();

  const url = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  // Sobrescribir env ANTES de instanciar el AppModule: ConfigService cachea.
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = 'test-access-secret-do-not-use-in-prod';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
  process.env.JWT_ACCESS_EXPIRES_IN = '5m';
  process.env.JWT_REFRESH_EXPIRES_IN = '1h';
  process.env.AUTH_MAX_FAILED_ATTEMPTS = '3';
  process.env.AUTH_LOCK_DURATION_MIN = '1';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();

  const raw = new PrismaClient({ datasourceUrl: url });
  await raw.$connect();

  return {
    app,
    raw,
    cleanup: async () => {
      await app.close();
      await raw.$disconnect();
      await container.stop();
    },
  };
}
