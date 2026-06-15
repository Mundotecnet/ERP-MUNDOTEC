import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { RequestContextService } from '../request-context/request-context.service';
import { buildAuditExtension } from './extensions/audit.extension';
import { buildSoftDeleteExtension } from './extensions/soft-delete.extension';
import { buildTenantExtension } from './extensions/tenant.extension';

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
    this.rawClient = new PrismaClient();
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
