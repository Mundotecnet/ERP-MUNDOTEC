import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ParsedCreateMovement,
  ParsedMovementListQuery,
  ParsedTransferMovement,
} from './dto/stock-movements.dto';

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

export interface TransferView {
  out: MovementView;
  in: MovementView;
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

/** Datos atómicos para `applyMovementInTx`. Cantidad es **signed** (string). */
export interface ApplyMovementInput {
  companyId: bigint;
  userId: bigint;
  productId: bigint;
  warehouseId: bigint;
  movementType: string;
  quantity: string;
  unitCost: string;
  sourceDoc: string | null;
  sourceId: bigint | null;
  movementDate: Date | null;
  notes: string | null;
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
      return this.applyMovementInTx(tx, {
        companyId,
        userId,
        productId: data.productId,
        warehouseId: data.warehouseId,
        movementType: data.movementType,
        quantity: data.quantity,
        unitCost: data.unitCost,
        sourceDoc: data.sourceDoc,
        sourceId: data.sourceId,
        movementDate: data.movementDate,
        notes: data.notes,
      });
    });
  }

  /**
   * Transferencia entre almacenes de la misma empresa: dos movimientos
   * (OUT en `from`, IN en `to`) ejecutados atómicamente. El `unit_cost`
   * del par es el `avg_cost` actual del almacén origen — así la
   * transferencia no altera el costo agregado de los productos, sólo
   * cambia su ubicación física, y el CPP del destino integra los costos
   * heredados con sus propios (HU-8.3).
   */
  async transfer(
    companyId: bigint,
    userId: bigint,
    data: ParsedTransferMovement,
  ): Promise<TransferView> {
    if (data.fromWarehouseId === data.toWarehouseId) {
      throw new BadRequestException(
        'El almacén origen y destino deben ser distintos para una transferencia.',
      );
    }
    return this.prisma.client.$transaction(async (tx) => {
      // 1. Costo de referencia: el `avg_cost` actual del origen. Si nunca tuvo
      //    stock no hay nada que transferir y el OUT fallará por saldo
      //    negativo (deseable).
      const originSnapshot = await tx.stock.findUnique({
        where: {
          productId_warehouseId: {
            productId: data.productId,
            warehouseId: data.fromWarehouseId,
          },
        },
      });
      const transferCost = originSnapshot
        ? new Prisma.Decimal(originSnapshot.avgCost.toString()).toFixed(4)
        : '0.0000';

      const outQty = new Prisma.Decimal(data.quantity).neg().toFixed(4);

      // 2. OUT en origen (sin source_id todavía; se cruzará al final).
      const outView = await this.applyMovementInTx(tx, {
        companyId,
        userId,
        productId: data.productId,
        warehouseId: data.fromWarehouseId,
        movementType: 'OUT',
        quantity: outQty,
        unitCost: transferCost,
        sourceDoc: 'TRANSFER',
        sourceId: null,
        movementDate: data.movementDate,
        notes: data.notes,
      });

      // 3. IN en destino, apuntando al OUT.
      const inView = await this.applyMovementInTx(tx, {
        companyId,
        userId,
        productId: data.productId,
        warehouseId: data.toWarehouseId,
        movementType: 'IN',
        quantity: data.quantity,
        unitCost: transferCost,
        sourceDoc: 'TRANSFER',
        sourceId: BigInt(outView.id),
        movementDate: data.movementDate,
        notes: data.notes,
      });

      // 4. Cierra el cruce: OUT.source_id = IN.id.
      const outUpdated = await tx.stockMovement.update({
        where: { id: BigInt(outView.id) },
        data: { sourceId: BigInt(inView.id) },
        include: {
          product: { select: { sku: true } },
          warehouse: { select: { code: true } },
        },
      });

      return { out: this.toView(outUpdated), in: inView };
    });
  }

  /**
   * Aplica un movimiento ya validado de signo (positivo/negativo) sobre la
   * tabla `stock`. Asume que se invoca dentro de un `$transaction`.
   *
   * Pasos:
   *  1. Valida producto y almacén (mismo tenant, producto inventariado y no
   *     soft-deleted).
   *  2. Lee snapshot de stock (o lo trata como 0 si no existe).
   *  3. Rechaza si `qty_new < 0` (409).
   *  4. Recalcula `avg_cost` con costo promedio ponderado:
   *     - entrada (qty > 0): `(qty_old·cost_old + qty_in·unit_cost) / qty_new`,
   *     - salida (qty < 0): mantiene el costo,
   *     - saldo cero: resetea el costo a 0.
   *  5. Inserta el movimiento con `balance_qty = qty_new`.
   *  6. `upsert` en `stock` con los nuevos valores.
   */
  /**
   * Público para que otros services (goods-receipts, futuro sales-invoices)
   * puedan invocarlo dentro de su propia `$transaction` sin reimplementar
   * la lógica de CPP. Asume que el caller ya validó los pre-requisitos
   * propios (estado del documento padre, etc.).
   */
  async applyMovementInTx(
    tx: Prisma.TransactionClient,
    input: ApplyMovementInput,
  ): Promise<MovementView> {
    // 1. Producto válido (mismo tenant, inventariado, no soft-deleted).
    const product = await tx.product.findFirst({
      where: { id: input.productId, companyId: input.companyId, deletedAt: null },
      select: { id: true, isInventoried: true, sku: true },
    });
    if (!product) {
      throw new NotFoundException(`Producto ${input.productId.toString()} no encontrado.`);
    }
    if (!product.isInventoried) {
      throw new BadRequestException(
        'No se pueden registrar movimientos de stock sobre un producto no inventariado (servicio).',
      );
    }

    // 2. Almacén válido (mismo tenant).
    const warehouse = await tx.warehouse.findFirst({
      where: { id: input.warehouseId, companyId: input.companyId },
      select: { id: true, code: true },
    });
    if (!warehouse) {
      throw new NotFoundException(`Almacén ${input.warehouseId.toString()} no encontrado.`);
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

    const movementQty = new Prisma.Decimal(input.quantity);
    const movementCost = new Prisma.Decimal(input.unitCost);
    const qtyNew = qtyOld.add(movementQty);

    // 4. Sin saldo negativo.
    if (qtyNew.lessThan(0)) {
      throw new ConflictException(
        `El movimiento dejaría saldo negativo (${qtyNew.toString()}) en el almacén ${warehouse.code}. Saldo actual: ${qtyOld.toString()}.`,
      );
    }

    // 5. Costo promedio ponderado.
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
        companyId: input.companyId,
        productId: product.id,
        warehouseId: warehouse.id,
        movementType: input.movementType,
        sourceDoc: input.sourceDoc,
        sourceId: input.sourceId,
        quantity: input.quantity,
        unitCost: input.unitCost,
        balanceQty: qtyNew.toFixed(4),
        movementDate: input.movementDate ?? new Date(),
        createdBy: input.userId,
        notes: input.notes,
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
