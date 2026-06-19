import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateMovement, ParsedMovementListQuery } from './dto/stock-movements.dto';

export interface MovementView {
  id: string;
  productId: string;
  productSku: string;
  warehouseId: string;
  warehouseCode: string;
  movementType: string;
  quantity: string;
  unitCost: string;
  balanceQty: string;
  movementDate: string;
  sourceDoc: string | null;
  sourceId: string | null;
  notes: string | null;
  createdBy: string | null;
}

interface MovementRow {
  id: bigint;
  productId: bigint;
  warehouseId: bigint;
  movementType: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  balanceQty: Prisma.Decimal;
  movementDate: Date;
  sourceDoc: string | null;
  sourceId: bigint | null;
  notes: string | null;
  createdBy: bigint | null;
  product: { sku: string };
  warehouse: { code: string };
}

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un movimiento de inventario y recalcula `stock` con costo
   * promedio ponderado en una transacción.
   */
  async create(
    companyId: bigint,
    userId: bigint,
    data: ParsedCreateMovement,
  ): Promise<MovementView> {
    return this.prisma.client.$transaction(async (tx) => {
      // 1. Producto válido (mismo tenant, inventariado, no soft-deleted).
      const product = await tx.product.findFirst({
        where: { id: data.productId, companyId, deletedAt: null },
        select: { id: true, isInventoried: true, sku: true },
      });
      if (!product) {
        throw new NotFoundException(`Producto ${data.productId.toString()} no encontrado.`);
      }
      if (!product.isInventoried) {
        throw new BadRequestException(
          'No se pueden registrar movimientos de stock sobre un producto no inventariado (servicio).',
        );
      }

      // 2. Almacén válido (mismo tenant).
      const warehouse = await tx.warehouse.findFirst({
        where: { id: data.warehouseId, companyId },
        select: { id: true, code: true },
      });
      if (!warehouse) {
        throw new NotFoundException(`Almacén ${data.warehouseId.toString()} no encontrado.`);
      }

      // 3. Snapshot actual (o cero si nunca tuvo stock).
      const snapshot = await tx.stock.findUnique({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      });
      const qtyOld = snapshot
        ? new Prisma.Decimal(snapshot.quantity.toString())
        : new Prisma.Decimal(0);
      const costOld = snapshot
        ? new Prisma.Decimal(snapshot.avgCost.toString())
        : new Prisma.Decimal(0);

      const movementQty = new Prisma.Decimal(data.quantity);
      const movementCost = new Prisma.Decimal(data.unitCost);
      const qtyNew = qtyOld.add(movementQty);

      // 4. Sin saldo negativo.
      if (qtyNew.lessThan(0)) {
        throw new ConflictException(
          `El movimiento dejaría saldo negativo (${qtyNew.toString()}). Saldo actual: ${qtyOld.toString()}.`,
        );
      }

      // 5. Costo promedio ponderado.
      //    - Entrada (movementQty > 0): se recalcula.
      //    - Salida (movementQty < 0): se mantiene el costo.
      //    - Si el saldo llega a 0 exacto, el costo queda en 0 (mejor empezar de cero la próxima entrada).
      let costNew: Prisma.Decimal;
      if (qtyNew.isZero()) {
        costNew = new Prisma.Decimal(0);
      } else if (movementQty.greaterThan(0)) {
        const num = qtyOld.mul(costOld).add(movementQty.mul(movementCost));
        costNew = num.div(qtyNew);
      } else {
        costNew = costOld;
      }

      // 6. Inserta el movimiento con su saldo resultante.
      const movement = await tx.stockMovement.create({
        data: {
          companyId,
          productId: product.id,
          warehouseId: warehouse.id,
          movementType: data.movementType,
          sourceDoc: data.sourceDoc,
          sourceId: data.sourceId,
          quantity: data.quantity,
          unitCost: data.unitCost,
          balanceQty: qtyNew.toFixed(4),
          movementDate: data.movementDate ?? new Date(),
          createdBy: userId,
          notes: data.notes,
        },
        include: {
          product: { select: { sku: true } },
          warehouse: { select: { code: true } },
        },
      });

      // 7. Sincroniza el snapshot `stock`.
      await tx.stock.upsert({
        where: {
          productId_warehouseId: { productId: product.id, warehouseId: warehouse.id },
        },
        update: {
          quantity: qtyNew.toFixed(4),
          avgCost: costNew.toFixed(4),
          updatedAt: new Date(),
        },
        create: {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: qtyNew.toFixed(4),
          avgCost: costNew.toFixed(4),
        },
      });

      return this.toView(movement);
    });
  }

  async list(companyId: bigint, filter: ParsedMovementListQuery): Promise<MovementView[]> {
    const where: Prisma.StockMovementWhereInput = { companyId };
    if (filter.productId !== null) where.productId = filter.productId;
    if (filter.warehouseId !== null) where.warehouseId = filter.warehouseId;
    if (filter.from !== null || filter.to !== null) {
      where.movementDate = {};
      if (filter.from !== null) where.movementDate.gte = filter.from;
      if (filter.to !== null) where.movementDate.lte = filter.to;
    }
    const rows = await this.prisma.raw.stockMovement.findMany({
      where,
      include: {
        product: { select: { sku: true } },
        warehouse: { select: { code: true } },
      },
      orderBy: [{ movementDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  private toView(row: MovementRow): MovementView {
    return {
      id: row.id.toString(),
      productId: row.productId.toString(),
      productSku: row.product.sku,
      warehouseId: row.warehouseId.toString(),
      warehouseCode: row.warehouse.code,
      movementType: row.movementType,
      quantity: row.quantity.toString(),
      unitCost: row.unitCost.toString(),
      balanceQty: row.balanceQty.toString(),
      movementDate: row.movementDate.toISOString(),
      sourceDoc: row.sourceDoc,
      sourceId: row.sourceId === null ? null : row.sourceId.toString(),
      notes: row.notes,
      createdBy: row.createdBy === null ? null : row.createdBy.toString(),
    };
  }
}
