import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { RequestContextService } from '../request-context/request-context.service';
import { buildAuditExtension } from './extensions/audit.extension';
import { buildSoftDeleteExtension } from './extensions/soft-delete.extension';
import { buildTenantExtension } from './extensions/tenant.extension';

/**
 * Devuelve la DATABASE_URL recibida con `connection_limit=N` añadido si no
 * estaba presente. Si ya tiene un connection_limit propio (operador subió la
 * env explícitamente) lo respetamos. Si la env no viene, devolvemos undefined
 * y Prisma usa su default de variables de entorno habitual.
 */
function appendConnectionLimit(url: string | undefined, limit: number): string | undefined {
  if (!url) return undefined;
  if (url.includes('connection_limit=')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}connection_limit=${limit}`;
}

/**
 * Cliente Prisma con las extensiones aplicadas. Las extensiones no añaden
 * métodos a los delegates (solo cambian el comportamiento de los existentes),
 * así que tiparlo como `PrismaClient` es seguro y mantiene la DX habitual en
 * los consumidores.
 */
export type ExtendedPrismaClient = PrismaClient;

/**
 * Wrapper de PrismaClient que expone dos accesos:
 *
 * - `client` — cliente con las extensiones audit / tenant / softDelete aplicadas.
 *   Es el que deberían usar controladores y servicios de negocio.
 * - `raw` — cliente sin extensiones, para tareas internas (seed, migraciones,
 *   las propias extensiones cuando necesitan saltarse la cadena de hooks).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly rawClient: PrismaClient;
  private extendedClient: ExtendedPrismaClient | null = null;

  constructor(private readonly ctx: RequestContextService) {
    // Bumpeamos el connection_limit del pool a 20 (default Prisma ≈ 9).
    // Razón: la extensión `audit` escribe en `audit_log` desde una conexión
    // SEPARADA (vía rawClient), porque la API de query extensions de Prisma
    // 5.x no expone el tx interactivo a los callbacks (getExtensionContext
    // es función identidad; $parent solo es type-hint en compile time).
    // Como cada operación auditada dentro de una tx interactiva consume 2
    // conexiones simultáneas (1 retenida por la tx + 1 para el audit), el
    // default se agotaba con ~5 tx concurrentes (timeout P2024). Lo dejamos
    // en 20 como margen razonable hasta que se rework la auditoría con
    // AsyncLocalStorage para que el insert al audit_log corra dentro de la
    // misma conexión de la tx (refactor mayor, fuera de scope acá).
    this.rawClient = new PrismaClient({
      datasourceUrl: appendConnectionLimit(process.env.DATABASE_URL, 20),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.rawClient.$connect();
    this.extendedClient = this.buildExtended();
  }

  async onModuleDestroy(): Promise<void> {
    await this.rawClient.$disconnect();
  }

  /** Cliente Prisma con audit + tenant + softDelete aplicados. */
  get client(): ExtendedPrismaClient {
    if (!this.extendedClient) {
      throw new Error('PrismaService no está inicializado todavía');
    }
    return this.extendedClient;
  }

  /** Cliente Prisma sin extensiones. Usar con cuidado. */
  get raw(): PrismaClient {
    return this.rawClient;
  }

  private buildExtended(): ExtendedPrismaClient {
    return this.rawClient
      .$extends(buildTenantExtension({ ctx: this.ctx }))
      .$extends(buildSoftDeleteExtension({ ctx: this.ctx, rawClient: this.rawClient }))
      .$extends(
        buildAuditExtension({ ctx: this.ctx, rawClient: this.rawClient }),
      ) as ExtendedPrismaClient;
  }
}
