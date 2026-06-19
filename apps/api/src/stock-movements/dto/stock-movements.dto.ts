import { BadRequestException } from '@nestjs/common';

export const MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUST'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface CreateMovementBody {
  productId?: unknown;
  warehouseId?: unknown;
  movementType?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
  sourceDoc?: unknown;
  sourceId?: unknown;
  movementDate?: unknown;
  notes?: unknown;
}

export interface ParsedCreateMovement {
  productId: bigint;
  warehouseId: bigint;
  movementType: MovementType;
  /** Signed: + entrada, − salida. Para ADJUST puede ser + o −. */
  quantity: string;
  unitCost: string;
  sourceDoc: string | null;
  sourceId: bigint | null;
  movementDate: Date | null;
  notes: string | null;
}

function requireBigInt(value: unknown, name: string): bigint {
  if (value === null || value === undefined) {
    throw new BadRequestException(`Campo "${name}" es requerido.`);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`Campo "${name}" debe ser string o number.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Campo "${name}" no es un número válido.`);
  }
}

function nullableBigInt(value: unknown, name: string): bigint | null {
  if (value === null || value === undefined) return null;
  return requireBigInt(value, name);
}

function asMovementType(value: unknown): MovementType {
  if (typeof value !== 'string' || !MOVEMENT_TYPES.includes(value as MovementType)) {
    throw new BadRequestException(
      `Campo "movementType" debe ser uno de: ${MOVEMENT_TYPES.join(', ')}.`,
    );
  }
  return value as MovementType;
}

/**
 * Decimal con signo, hasta 4 decimales. Acepta string ("10.5", "-3.0000") o
 * number. Convierte a string canónico (mantiene precisión).
 */
function signedDecimalString(value: unknown, name: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BadRequestException(`Campo "${name}" debe ser un número finito.`);
    }
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d{1,4})?$/.test(trimmed)) {
      throw new BadRequestException(
        `Campo "${name}" debe ser un decimal con hasta 4 decimales (acepta negativo).`,
      );
    }
    return trimmed;
  }
  throw new BadRequestException(`Campo "${name}" debe ser número o string decimal.`);
}

function nonNegativeDecimalString(value: unknown, name: string): string {
  const s = signedDecimalString(value, name);
  if (s.startsWith('-')) {
    throw new BadRequestException(`Campo "${name}" no puede ser negativo.`);
  }
  return s;
}

function optionalString(value: unknown, name: string, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Campo "${name}" debe ser un texto no vacío.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new BadRequestException(`Campo "${name}" excede ${max} caracteres.`);
  }
  return trimmed;
}

function optionalDate(value: unknown, name: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`Campo "${name}" debe ser un ISO date string.`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Campo "${name}" no es una fecha válida.`);
  }
  return d;
}

export function parseCreateMovementBody(body: CreateMovementBody): ParsedCreateMovement {
  const movementType = asMovementType(body.movementType);
  const quantity = signedDecimalString(body.quantity, 'quantity');

  // Validación de signo según tipo.
  if (movementType === 'IN' && !quantity.match(/^\d/) /* no positivo */) {
    throw new BadRequestException(`Un movimiento IN requiere cantidad positiva.`);
  }
  if (movementType === 'OUT' && !quantity.startsWith('-')) {
    throw new BadRequestException(`Un movimiento OUT requiere cantidad negativa.`);
  }
  if (
    movementType === 'ADJUST' &&
    (quantity === '0' || quantity === '0.0' || /^-?0(\.0+)?$/.test(quantity))
  ) {
    throw new BadRequestException(`Un movimiento ADJUST no puede tener cantidad 0.`);
  }
  if (movementType === 'IN' && /^0(\.0+)?$/.test(quantity)) {
    throw new BadRequestException(`Un movimiento IN requiere cantidad positiva.`);
  }

  return {
    productId: requireBigInt(body.productId, 'productId'),
    warehouseId: requireBigInt(body.warehouseId, 'warehouseId'),
    movementType,
    quantity,
    unitCost:
      body.unitCost === undefined ? '0' : nonNegativeDecimalString(body.unitCost, 'unitCost'),
    sourceDoc: optionalString(body.sourceDoc, 'sourceDoc', 30),
    sourceId: nullableBigInt(body.sourceId, 'sourceId'),
    movementDate: optionalDate(body.movementDate, 'movementDate'),
    notes: optionalString(body.notes, 'notes', 250),
  };
}

export interface MovementListQuery {
  productId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
}

export interface ParsedMovementListQuery {
  productId: bigint | null;
  warehouseId: bigint | null;
  from: Date | null;
  to: Date | null;
}

export function parseMovementListQuery(q: MovementListQuery): ParsedMovementListQuery {
  return {
    productId: q.productId ? requireBigInt(q.productId, 'productId') : null,
    warehouseId: q.warehouseId ? requireBigInt(q.warehouseId, 'warehouseId') : null,
    from: optionalDate(q.from, 'from'),
    to: optionalDate(q.to, 'to'),
  };
}
