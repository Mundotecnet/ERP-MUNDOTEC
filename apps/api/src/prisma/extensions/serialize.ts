/**
 * Convierte un row de Prisma a un valor serializable como JSONB.
 *
 * - `BigInt` → string (audit_log.old_values/new_values es JSONB y BigInt no es
 *   JSON-nativo).
 * - `Decimal` (Prisma.Decimal) → string (preserva precisión exacta).
 * - Resto: deja como está.
 *
 * Nunca lanza: si el row no es serializable, devuelve null y dejamos que la
 * fila de audit_log quede sin valores en vez de tumbar la operación principal.
 */
export function serializeForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v: unknown) => {
        if (typeof v === 'bigint') return v.toString();
        if (
          typeof v === 'object' &&
          v !== null &&
          (v as { constructor?: { name?: string } }).constructor?.name === 'Decimal'
        ) {
          return (v as { toString(): string }).toString();
        }
        return v;
      }),
    );
  } catch {
    return null;
  }
}

/**
 * Convierte el nombre del modelo Prisma (PascalCase) al nombre del delegate
 * (camelCase). Ejemplo: 'AppUser' → 'appUser', 'Company' → 'company'.
 */
export function modelDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Resuelve la PK de un row recién creado/actualizado para guardarla en
 * audit_log.entity_id. Asume PK simple `id` (BigInt). Las tablas con PK
 * compuesta (role_permission, user_role) o PK texto (currency) no pasan por la
 * extensión audit en este sprint.
 */
export function readEntityId(row: unknown): bigint | null {
  if (row && typeof row === 'object' && 'id' in row) {
    const id = (row as { id: unknown }).id;
    if (typeof id === 'bigint') return id;
    if (typeof id === 'number') return BigInt(id);
  }
  return null;
}
