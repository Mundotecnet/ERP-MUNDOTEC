import { Prisma } from '@prisma/client';

import type { RequestContextService } from '../../request-context/request-context.service';
import { TENANT_MODELS } from './registry';

interface TenantExtensionOptions {
  ctx: RequestContextService;
}

type WithWhere = { where?: Record<string, unknown> };

function injectCompanyId<T extends WithWhere>(args: T, companyId: bigint): T {
  return {
    ...args,
    where: { ...(args.where ?? {}), companyId },
  };
}

function injectCompanyIdAsId<T extends WithWhere>(args: T, companyId: bigint): T {
  // Para el modelo Company el filtro es por `id`, no por `companyId`.
  return {
    ...args,
    where: { ...(args.where ?? {}), id: companyId },
  };
}

/**
 * Extensión Prisma `tenant`: inyecta el filtro de empresa en find/update/delete
 * para los modelos en {@link TENANT_MODELS}, más el caso especial del modelo
 * `Company` que filtra por `id`.
 *
 * Si no hay `companyId` en el {@link RequestContextService} (p. ej. seed o
 * tareas de mantenimiento sin scope), NO se inyecta el filtro — es opt-in vía
 * middleware/contexto. Eso permite seed/migraciones desde la línea de comandos
 * sin romper.
 */
export function buildTenantExtension(opts: TenantExtensionOptions) {
  return Prisma.defineExtension({
    name: 'tenant',
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          const cid = opts.ctx.getCompanyId();
          if (cid === null) return query(args);
          if (model === 'Company') return query(injectCompanyIdAsId(args, cid));
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(injectCompanyId(args, cid));
        },
        async findFirst({ model, args, query }) {
          const cid = opts.ctx.getCompanyId();
          if (cid === null) return query(args);
          if (model === 'Company') return query(injectCompanyIdAsId(args, cid));
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(injectCompanyId(args, cid));
        },
        async count({ model, args, query }) {
          const cid = opts.ctx.getCompanyId();
          if (cid === null) return query(args);
          if (model === 'Company') return query(injectCompanyIdAsId(args, cid));
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(injectCompanyId(args, cid));
        },
        async updateMany({ model, args, query }) {
          const cid = opts.ctx.getCompanyId();
          if (cid === null) return query(args);
          if (model === 'Company') return query(injectCompanyIdAsId(args, cid));
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(injectCompanyId(args, cid));
        },
        async deleteMany({ model, args, query }) {
          const cid = opts.ctx.getCompanyId();
          if (cid === null) return query(args);
          if (model === 'Company') return query(injectCompanyIdAsId(args, cid));
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(injectCompanyId(args, cid));
        },
        // findUnique / update / delete sobre PK no aceptan filtros adicionales
        // dinámicos sin romper el tipo. Se podría hacer verificación post-query
        // pero introduce racing y costo. Para PR-4 documentamos esa limitación
        // y obligamos a usar findFirst/updateMany/deleteMany en código tenant-
        // aware (la guía irá en el módulo de ese sprint).
      },
    },
  });
}
