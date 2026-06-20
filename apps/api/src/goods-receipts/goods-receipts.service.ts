import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { ParsedCreateGoodsReceipt, ParsedListGoodsReceiptsQuery } from './dto/goods-receipts.dto';

export interface GoodsReceiptLineView {
  id: string;
  productId: string;
  productSku: string;
  quantity: string;
  unitCost: string;
}

export interface GoodsReceiptView {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  warehouseId: string;
  warehouseCode: string;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  createdBy: string | null;
  createdAt: string;
  lines: GoodsReceiptLineView[];
}

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: StockMovementsService,
  ) {}

  async list(companyId: bigint, filter: ParsedListGoodsReceiptsQuery): Promise<GoodsReceiptView[]> {
    const where: Prisma.GoodsReceiptWhereInput = { companyId };
    if (filter.purchaseOrderId !== null) where.purchaseOrderId = filter.purchaseOrderId;
    if (filter.warehouseId !== null) where.warehouseId = filter.warehouseId;
    if (filter.from !== null || filter.to !== null) {
      where.receiptDate = {};
      if (filter.from !== null) where.receiptDate.gte = filter.from;
      if (filter.to !== null) where.receiptDate.lte = filter.to;
    }
    const rows = await this.prisma.raw.goodsReceipt.findMany({
      where,
      include: {
        warehouse: { select: { code: true } },
        purchaseOrder: { select: { orderNumber: true } },
        lines: {
          include: { product: { select: { sku: true } } },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ receiptDate: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<GoodsReceiptView> {
    const row = await this.prisma.raw.goodsReceipt.findFirst({
      where: { id, companyId },
      include: {
        warehouse: { select: { code: true } },
        purchaseOrder: { select: { orderNumber: true } },
        lines: {
          include: { product: { select: { sku: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Recepción no encontrada.');
    return this.toView(row);
  }

  /**
   * Crea una recepción de mercancía y aplica todos los efectos colaterales
   * en una sola transacción Prisma:
   *  1. Valida warehouse de la empresa.
   *  2. Si hay `purchaseOrderId`, valida que la OC esté APPROVED y resuelve
   *     el FIFO de líneas por producto para distribuir las cantidades y
   *     heredar los costos.
   *  3. Si no hay OC, exige `unitCost` por línea.
   *  4. Inserta header + líneas.
   *  5. Por cada línea, llama `StockMovementsService.applyMovementInTx` con
   *     un IN positivo (`sourceDoc='RECEIPT'`, `sourceId=goodsReceipt.id`).
   *  6. Avanza `received_qty` de las líneas de OC que tocó.
   *  7. Si todas las líneas de la OC quedaron completas, la OC pasa a
   *     RECEIVED.
   */
  async create(
    companyId: bigint,
    userId: bigint,
    data: ParsedCreateGoodsReceipt,
  ): Promise<GoodsReceiptView> {
    return this.prisma.client.$transaction(async (tx) => {
      // 1. Almacén.
      const warehouse = await tx.warehouse.findFirst({
        where: { id: data.warehouseId, companyId },
        select: { id: true, code: true },
      });
      if (!warehouse) {
        throw new BadRequestException(
          `El almacén ${data.warehouseId.toString()} no existe o no pertenece a esta empresa.`,
        );
      }

      // 2/3. Resolver líneas con costo + matching FIFO a líneas de OC.
      const resolution = await this.resolveLines(tx, companyId, data);

      // 4. Insertar header + líneas.
      let receipt;
      try {
        receipt = await tx.goodsReceipt.create({
          data: {
            companyId,
            purchaseOrderId: data.purchaseOrderId,
            warehouseId: warehouse.id,
            receiptNumber: data.receiptNumber,
            receiptDate: data.receiptDate ?? new Date(),
            createdBy: userId,
            lines: {
              create: resolution.linesToInsert.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                unitCost: l.unitCost,
              })),
            },
          },
          include: {
            warehouse: { select: { code: true } },
            purchaseOrder: { select: { orderNumber: true } },
            lines: {
              include: { product: { select: { sku: true } } },
              orderBy: { id: 'asc' },
            },
          },
        });
      } catch (err) {
        this.translatePrismaError(err);
      }

      // 5. Alimentar el kardex (IN por cada línea).
      for (const l of resolution.linesToInsert) {
        await this.movements.applyMovementInTx(tx, {
          companyId,
          userId,
          productId: l.productId,
          warehouseId: warehouse.id,
          movementType: 'IN',
          quantity: l.quantity,
          unitCost: l.unitCost,
          sourceDoc: 'RECEIPT',
          sourceId: receipt.id,
          movementDate: data.receiptDate ?? null,
          notes: null,
        });
      }

      // 6. Avance de received_qty + (7) transición OC → RECEIVED si completa.
      if (data.purchaseOrderId !== null) {
        for (const upd of resolution.poLineUpdates) {
          await tx.purchaseOrderLine.update({
            where: { id: upd.poLineId },
            data: { receivedQty: upd.newReceivedQty },
          });
        }
        const remaining = await tx.purchaseOrderLine.findFirst({
          where: {
            purchaseOrderId: data.purchaseOrderId,
            quantity: { gt: tx.purchaseOrderLine.fields.receivedQty },
          },
        });
        if (!remaining) {
          await tx.purchaseOrder.update({
            where: { id: data.purchaseOrderId },
            data: { status: 'RECEIVED' },
          });
        }
      }

      return this.toView(receipt);
    });
  }

  /**
   * Distribuye las líneas recibidas contra las líneas de la OC (FIFO por
   * producto) cuando hay OC; devuelve además los costos resueltos. Cuando no
   * hay OC sólo valida que cada línea traiga `unitCost`.
   */
  private async resolveLines(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    data: ParsedCreateGoodsReceipt,
  ): Promise<{
    linesToInsert: { productId: bigint; quantity: string; unitCost: string }[];
    poLineUpdates: { poLineId: bigint; newReceivedQty: string }[];
  }> {
    const linesToInsert: { productId: bigint; quantity: string; unitCost: string }[] = [];
    const poLineUpdates: { poLineId: bigint; newReceivedQty: string }[] = [];

    if (data.purchaseOrderId === null) {
      // Recepción sin OC: validar productos del tenant + costo obligatorio.
      for (const [idx, line] of data.lines.entries()) {
        if (line.unitCost === null) {
          throw new BadRequestException(
            `Línea #${idx + 1}: "unitCost" es obligatorio cuando no hay OC asociada.`,
          );
        }
        const product = await tx.product.findFirst({
          where: { id: line.productId, companyId, deletedAt: null },
          select: { id: true, isInventoried: true, sku: true },
        });
        if (!product) {
          throw new BadRequestException(
            `Línea #${idx + 1}: el producto ${line.productId.toString()} no existe o no pertenece a esta empresa.`,
          );
        }
        if (!product.isInventoried) {
          throw new BadRequestException(
            `Línea #${idx + 1}: el producto ${product.sku} no es inventariado y no puede recibirse.`,
          );
        }
        linesToInsert.push({
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost,
        });
      }
      return { linesToInsert, poLineUpdates };
    }

    // Recepción contra una OC.
    const po = await tx.purchaseOrder.findFirst({
      where: { id: data.purchaseOrderId, companyId },
      include: {
        lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
      },
    });
    if (!po) {
      throw new BadRequestException(
        `La orden de compra ${data.purchaseOrderId.toString()} no existe o no pertenece a esta empresa.`,
      );
    }
    if (po.status !== 'APPROVED') {
      throw new BadRequestException(
        `La orden de compra está en estado ${po.status}; solo se pueden recibir OC APPROVED.`,
      );
    }

    // Estado mutable de las líneas de OC: pendientes por línea (FIFO por id).
    const remainingByLine = new Map<string, Prisma.Decimal>();
    for (const l of po.lines) {
      remainingByLine.set(
        l.id.toString(),
        new Prisma.Decimal(l.quantity.toString()).sub(new Prisma.Decimal(l.receivedQty.toString())),
      );
    }
    // Agrupar líneas de OC por producto manteniendo orden de id.
    const poLinesByProduct = new Map<string, typeof po.lines>();
    for (const l of po.lines) {
      const key = l.productId.toString();
      const arr = poLinesByProduct.get(key) ?? [];
      arr.push(l);
      poLinesByProduct.set(key, arr);
    }

    for (const [idx, recLine] of data.lines.entries()) {
      let qtyToDistribute = new Prisma.Decimal(recLine.quantity);
      const poLines = poLinesByProduct.get(recLine.productId.toString()) ?? [];
      if (poLines.length === 0) {
        throw new BadRequestException(
          `Línea #${idx + 1}: el producto ${recLine.productId.toString()} no está en la OC.`,
        );
      }
      // Acumular cuánto cabe en las líneas de OC con saldo pendiente.
      let consumed = new Prisma.Decimal(0);
      const costAccum: { qty: Prisma.Decimal; cost: Prisma.Decimal }[] = [];
      for (const poLine of poLines) {
        if (qtyToDistribute.isZero()) break;
        const remaining = remainingByLine.get(poLine.id.toString())!;
        if (remaining.lessThanOrEqualTo(0)) continue;
        const take = Prisma.Decimal.min(remaining, qtyToDistribute);
        if (take.isZero()) continue;
        const newRemaining = remaining.sub(take);
        remainingByLine.set(poLine.id.toString(), newRemaining);
        const poLineDecimalQty = new Prisma.Decimal(poLine.quantity.toString());
        const newReceived = poLineDecimalQty.sub(newRemaining);
        poLineUpdates.push({ poLineId: poLine.id, newReceivedQty: newReceived.toFixed(4) });
        costAccum.push({ qty: take, cost: new Prisma.Decimal(poLine.unitCost.toString()) });
        qtyToDistribute = qtyToDistribute.sub(take);
        consumed = consumed.add(take);
      }
      if (!qtyToDistribute.isZero()) {
        const product = poLines[0].product;
        throw new ConflictException(
          `Línea #${idx + 1}: la cantidad excede el pendiente por recibir del producto ${product.sku}.`,
        );
      }

      // Costo de la línea de recepción:
      //  - si vino en el body, se respeta tal cual;
      //  - si no, promedio ponderado de los costos de OC consumidos (que en la
      //    inmensa mayoría de casos es un solo cost porque FIFO consumió 1 línea).
      let unitCost: string;
      if (recLine.unitCost !== null) {
        unitCost = recLine.unitCost;
      } else {
        let num = new Prisma.Decimal(0);
        for (const c of costAccum) num = num.add(c.qty.mul(c.cost));
        unitCost = num.div(consumed).toFixed(4);
      }

      linesToInsert.push({
        productId: recLine.productId,
        quantity: recLine.quantity,
        unitCost,
      });
    }

    return { linesToInsert, poLineUpdates: this.coalesce(poLineUpdates) };
  }

  /** Si la misma línea de OC aparece varias veces, se queda con el último valor. */
  private coalesce(
    updates: { poLineId: bigint; newReceivedQty: string }[],
  ): { poLineId: bigint; newReceivedQty: string }[] {
    const last = new Map<string, { poLineId: bigint; newReceivedQty: string }>();
    for (const u of updates) last.set(u.poLineId.toString(), u);
    return Array.from(last.values());
  }

  private translatePrismaError(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe una recepción con ese número en esta empresa.');
    }
    throw err as Error;
  }

  private toView(row: {
    id: bigint;
    receiptNumber: string;
    receiptDate: Date;
    warehouseId: bigint;
    purchaseOrderId: bigint | null;
    createdBy: bigint | null;
    createdAt: Date;
    warehouse: { code: string };
    purchaseOrder: { orderNumber: string } | null;
    lines: Array<{
      id: bigint;
      productId: bigint;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      product: { sku: string };
    }>;
  }): GoodsReceiptView {
    return {
      id: row.id.toString(),
      receiptNumber: row.receiptNumber,
      receiptDate: row.receiptDate.toISOString().slice(0, 10),
      warehouseId: row.warehouseId.toString(),
      warehouseCode: row.warehouse.code,
      purchaseOrderId: row.purchaseOrderId === null ? null : row.purchaseOrderId.toString(),
      purchaseOrderNumber: row.purchaseOrder?.orderNumber ?? null,
      createdBy: row.createdBy === null ? null : row.createdBy.toString(),
      createdAt: row.createdAt.toISOString(),
      lines: row.lines.map((l) => ({
        id: l.id.toString(),
        productId: l.productId.toString(),
        productSku: l.product.sku,
        quantity: l.quantity.toString(),
        unitCost: l.unitCost.toString(),
      })),
    };
  }
}
