import { BadRequestException } from '@nestjs/common';

export interface PutParamBody {
  value?: unknown;
}

export interface ParsedPutParam {
  /** Cualquier JSON serializable: string, number, boolean, null, array, object. */
  value: unknown;
}

const KEY_RE = /^[a-z][a-z0-9._-]{0,79}$/;

/**
 * Valida una clave de parámetro:
 *   - empieza con minúscula
 *   - solo minúsculas, dígitos, puntos, guiones y guiones bajos
 *   - máximo 80 caracteres
 *
 * Ejemplos válidos: `documents.invoice.prefix`, `format.date`, `feature.crm-enabled`.
 */
export function parseParamKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new BadRequestException('El parámetro "key" es requerido.');
  }
  if (!KEY_RE.test(trimmed)) {
    throw new BadRequestException(
      'La clave debe empezar con minúscula y usar sólo a-z, 0-9, ".", "-" o "_" (máx. 80 chars).',
    );
  }
  return trimmed;
}

export function parsePutParamBody(body: PutParamBody): ParsedPutParam {
  if (!('value' in body)) {
    throw new BadRequestException('Campo "value" requerido (puede ser null).');
  }
  // Verificamos que sea serializable a JSON (Prisma Json rechaza valores con
  // ciclos o referencias no-serializables).
  try {
    JSON.stringify(body.value);
  } catch (err) {
    throw new BadRequestException(
      `Campo "value" no es JSON-serializable: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
  return { value: body.value };
}
