import { Prisma, PrismaClient } from '@prisma/client';

import type { RequestContextService } from '../../request-context/request-context.service';
import { AUDITED_MODELS } from './registry';
import { modelDelegateName, readEntityId, serializeForAudit } from './serialize';

type DelegateName = string;
type PrismaDelegate = {
  findUnique(args: { where: unknown }): Promise<unknown>;
};

interface AuditExtensionOptions {
  ctx: RequestContextService;
  /** Cliente sin extensiones — para escribir en `audit_log` y leer estado previo. */
  rawClient: PrismaClient;
}

async function writeAuditLog(
  opts: AuditExtensionOptions,
  model: string,
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  oldRow: unknown,
  newRow: unknown,
): Promise<void> {
  const entityId = readEntityId(action === 'DELETE' ? oldRow : newRow);
  await opts.rawClient.auditLog.create({
    data: {
      userId: opts.ctx.getUserId(),
      entity: model,
      entityId,
      action,
      oldValues: serializeForAudit(oldRow) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      newValues: serializeForAudit(newRow) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
    },
  });
}

function getDelegate(client: PrismaClient, model: string): PrismaDelegate {
  const name: DelegateName = modelDelegateName(model);
  const delegate = (client as unknown as Record<string, PrismaDelegate>)[name];
  if (!delegate) throw new Error(`PrismaClient no expone delegate para modelo ${model}`);
  return delegate;
}

/**
 * Extensión Prisma `audit`: registra en `audit_log` cada create/update/upsert/
 * delete sobre los modelos en {@link AUDITED_MODELS}.
 *
 * Notas:
 * - `deleteMany` / `updateMany` no se auditan en este sprint: Prisma no
 *   devuelve los rows individuales y un audit por batch no preserva el
 *   `old_values` por entidad. Se documenta arriba del registro.
 * - Para `delete` de un modelo con soft-delete (AppUser), la extensión de
 *   soft-delete intercepta primero y escribe el audit como DELETE con sus
 *   propios old/new; esta extensión nunca llega a ver ese `delete`.
 */
export function buildAuditExtension(opts: AuditExtensionOptions) {
  return Prisma.defineExtension({
    name: 'audit',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          if (AUDITED_MODELS.has(model)) {
            await writeAuditLog(opts, model, 'INSERT', null, result);
          }
          return result;
        },
        async update({ model, args, query }) {
          if (!AUDITED_MODELS.has(model)) return query(args);
          const delegate = getDelegate(opts.rawClient, model);
          const oldRow = await delegate.findUnique({ where: args.where });
          const result = await query(args);
          await writeAuditLog(opts, model, 'UPDATE', oldRow, result);
          return result;
        },
        async upsert({ model, args, query }) {
          if (!AUDITED_MODELS.has(model)) return query(args);
          const delegate = getDelegate(opts.rawClient, model);
          const oldRow = await delegate.findUnique({ where: args.where });
          const result = await query(args);
          const action: 'INSERT' | 'UPDATE' = oldRow ? 'UPDATE' : 'INSERT';
          await writeAuditLog(opts, model, action, oldRow, result);
          return result;
        },
        async delete({ model, args, query }) {
          if (!AUDITED_MODELS.has(model)) return query(args);
          const delegate = getDelegate(opts.rawClient, model);
          const oldRow = await delegate.findUnique({ where: args.where });
          const result = await query(args);
          await writeAuditLog(opts, model, 'DELETE', oldRow, null);
          return result;
        },
      },
    },
  });
}
