import { Prisma, PrismaClient } from '@prisma/client';

import type { RequestContextService } from '../../request-context/request-context.service';
import { SOFT_DELETE_MODELS } from './registry';
import { modelDelegateName, readEntityId, serializeForAudit } from './serialize';

interface SoftDeleteExtensionOptions {
  ctx: RequestContextService;
  /** Cliente sin extensiones — se usa para hacer el update y escribir audit_log
   *  sin que la extensión audit duplique la operación. */
  rawClient: PrismaClient;
}

type WhereInput = Record<string, unknown> | undefined;
type PrismaDelegate = {
  findFirst(args: { where?: WhereInput }): Promise<unknown>;
  update(args: { where: WhereInput; data: Record<string, unknown> }): Promise<unknown>;
};

function injectNotDeleted(args: { where?: WhereInput }): { where: WhereInput } {
  return {
    ...args,
    where: { ...(args.where ?? {}), deletedAt: null },
  };
}

function getDelegate(client: PrismaClient, model: string): PrismaDelegate {
  const name = modelDelegateName(model);
  return (client as unknown as Record<string, PrismaDelegate>)[name];
}

/**
 * Extensión Prisma `softDelete`. Para los modelos en {@link SOFT_DELETE_MODELS}:
 *
 * - `delete(where)` → busca el registro vivo y lo marca con `deletedAt = now()`.
 *   Escribe directamente en `audit_log` con action='DELETE' usando el rawClient,
 *   para que aparezca como baja real aunque físicamente sea un update.
 * - `findMany / findFirst / count`: inyecta `deletedAt: null` en el `where`.
 * - `findUnique`: ejecuta el query original; si el row resulta con `deletedAt`
 *   distinto de null, devuelve `null` (Prisma no permite where compuesto en
 *   findUnique).
 */
export function buildSoftDeleteExtension(opts: SoftDeleteExtensionOptions) {
  return Prisma.defineExtension({
    name: 'softDelete',
    query: {
      $allModels: {
        async delete({ model, args, query }) {
          if (!SOFT_DELETE_MODELS.has(model)) return query(args);
          const delegate = getDelegate(opts.rawClient, model);
          const oldRow = await delegate.findFirst({
            where: { ...(args.where ?? {}), deletedAt: null },
          });
          if (!oldRow) {
            // Nada vivo para borrar suavemente; respetamos la semántica devolviendo
            // lo que devolvería un delete sobre un row ya soft-deleteado: error de
            // Prisma. En vez de eso, hacemos el update plano para no esconder bugs.
            return delegate.update({
              where: args.where,
              data: { deletedAt: new Date() },
            });
          }
          const newRow = await delegate.update({
            where: { id: (oldRow as { id: bigint }).id },
            data: { deletedAt: new Date() },
          });
          await opts.rawClient.auditLog.create({
            data: {
              userId: opts.ctx.getUserId(),
              entity: model,
              entityId: readEntityId(oldRow),
              action: 'DELETE',
              oldValues: serializeForAudit(oldRow) as
                | Prisma.InputJsonValue
                | typeof Prisma.JsonNull,
              newValues: serializeForAudit(newRow) as
                | Prisma.InputJsonValue
                | typeof Prisma.JsonNull,
            },
          });
          return newRow;
        },
        async findMany({ model, args, query }) {
          if (!SOFT_DELETE_MODELS.has(model)) return query(args);
          return query(injectNotDeleted(args));
        },
        async findFirst({ model, args, query }) {
          if (!SOFT_DELETE_MODELS.has(model)) return query(args);
          return query(injectNotDeleted(args));
        },
        async count({ model, args, query }) {
          if (!SOFT_DELETE_MODELS.has(model)) return query(args);
          return query(injectNotDeleted(args));
        },
        async findUnique({ model, args, query }) {
          if (!SOFT_DELETE_MODELS.has(model)) return query(args);
          const result = await query(args);
          if (result && (result as { deletedAt: Date | null }).deletedAt !== null) {
            return null;
          }
          return result;
        },
      },
    },
  });
}
