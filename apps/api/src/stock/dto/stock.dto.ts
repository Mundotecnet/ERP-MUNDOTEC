import { BadRequestException } from '@nestjs/common';

export interface StockListQuery {
  productId?: string;
  warehouseId?: string;
}

export interface ParsedStockListQuery {
  productId: bigint | null;
  warehouseId: bigint | null;
}

function optionalBigInt(value: unknown, name: string): bigint | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

export function parseStockListQuery(q: StockListQuery): ParsedStockListQuery {
  return {
    productId: optionalBigInt(q.productId, 'productId'),
    warehouseId: optionalBigInt(q.warehouseId, 'warehouseId'),
  };
}
