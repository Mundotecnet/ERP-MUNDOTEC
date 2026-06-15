import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

import { buildAuditExtension } from '../../src/prisma/extensions/audit.extension';
import { buildSoftDeleteExtension } from '../../src/prisma/extensions/soft-delete.extension';
import { buildTenantExtension } from '../../src/prisma/extensions/tenant.extension';
import { RequestContextService } from '../../src/request-context/request-context.service';

const API_ROOT = join(__dirname, '..', '..');

export interface TestContext {
  raw: PrismaClient;
  client: ReturnType<typeof buildExtended>;
  ctx: RequestContextService;
  url: string;
  cleanup(): Promise<void>;
}

function buildExtended(raw: PrismaClient, ctx: RequestContextService): PrismaClient {
  return raw
    .$extends(buildTenantExtension({ ctx }))
    .$extends(buildSoftDeleteExtension({ ctx, rawClient: raw }))
    .$extends(buildAuditExtension({ ctx, rawClient: raw })) as unknown as PrismaClient;
}

/**
 * Levanta un contenedor PostgreSQL efímero, aplica las migraciones Prisma,
 * crea un RequestContextService nuevo y devuelve un PrismaClient extendido
 * con audit + tenant + softDelete.
 *
 * Llamar `cleanup()` en `afterAll` para detener el contenedor.
 */
export async function createTestContext(): Promise<TestContext> {
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

  const raw = new PrismaClient({ datasourceUrl: url });
  await raw.$connect();

  const ctx = new RequestContextService();
  const client = buildExtended(raw, ctx);

  return {
    raw,
    client,
    ctx,
    url,
    cleanup: async () => {
      await raw.$disconnect();
      await container.stop();
    },
  };
}
