import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ParsedCreateLine,
  ParsedCreatePurchaseOrder,
  ParsedListPurchaseOrdersQuery,
  ParsedUpdatePurchaseOrder,
  PoStatus,
} from './dto/purchase-orders.dto';

export interface PurchaseOrderLineView {
  id: string;
  productId: string;
  productSku: string;
  quantity: string;
  receivedQty: string;
  unitCost: string;
  taxRate: string;
  lineTotal: string;
}

export interface PurchaseOrderView {
  id: string;
  orderNumber: string;
  status: string;
  supplierId: string;
  supplierName: string;
  branchId: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  baseTotal: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  lines: PurchaseOrderLineView[];
}

interface ComputedTotals {
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  baseTotal: Prisma.Decimal;
  lineTotals: Prisma.Decimal[];
}

const EDITABLE_STATUSES = new Set<PoStatus>(['DRAFT']);

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: bigint,
    filter: ParsedListPurchaseOrdersQuery,
  ): Promise<PurchaseOrderView[]> {
    const where: Prisma.PurchaseOrderWhereInput = { companyId };
    if (filter.status !== null) where.status = filter.status;
    if (filter.supplierId !== null) where.supplierId = filter.supplierId;
    if (filter.from !== null || filter.to !== null) {
      where.orderDate = {};
      if (filter.from !== null) where.orderDate.gte = filter.from;
      if (filter.to !== null) where.orderDate.lte = filter.to;
    }
    const rows = await this.prisma.raw.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { legalName: true } },
        lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
      },
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<PurchaseOrderView> {
    const row = await this.prisma.raw.purchaseOrder.findFirst({
      where: { id, companyId },
      include: {
        supplier: { select: { legalName: true } },
        lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Orden de compra no encontrada.');
    return this.toView(row);
  }

  async create(
    companyId: bigint,
    userId: bigint,
    data: ParsedCreatePurchaseOrder,
  ): Promise<PurchaseOrderView> {
    return this.prisma.client.$transaction(async (tx) => {
      const companyCurrency = await this.getCompanyCurrency(tx, companyId);
      const exchangeRate = this.resolveExchangeRate(
        data.currencyCode,
        companyCurrency,
        data.exchangeRate,
      );
      await this.assertSupplier(tx, companyId, data.supplierId);
      if (data.branchId !== null) {
        await this.assertBranch(tx, companyId, data.branchId);
      }
      await this.assertCurrency(tx, data.currencyCode);
      await this.assertProducts(tx, companyId, data.lines);

      const totals = this.computeTotals(data.lines, exchangeRate);
      try {
        const order = await tx.purchaseOrder.create({
          data: {
            companyId,
            supplierId: data.supplierId,
            branchId: data.branchId,
            orderNumber: data.orderNumber,
            orderDate: data.orderDate ?? new Date(),
            expectedDate: data.expectedDate,
            status: 'DRAFT',
            currencyCode: data.currencyCode,
            exchangeRate,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            total: totals.total,
            baseTotal: totals.baseTotal,
            notes: data.notes,
            createdBy: userId,
            lines: {
              create: data.lines.map((line, idx) => ({
                productId: line.productId,
                quantity: line.quantity,
                unitCost: line.unitCost,
                taxRate: line.taxRate,
                lineTotal: totals.lineTotals[idx],
              })),
            },
          },
          include: {
            supplier: { select: { legalName: true } },
            lines: {
              include: { product: { select: { sku: true } } },
              orderBy: { id: 'asc' },
            },
          },
        });
        return this.toView(order);
      } catch (err) {
        this.translatePrismaError(err);
      }
    });
  }

  async update(
    companyId: bigint,
    id: bigint,
    data: ParsedUpdatePurchaseOrder,
  ): Promise<PurchaseOrderView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        include: { lines: true },
      });
      if (!existing) throw new NotFoundException('Orden de compra no encontrada.');
      if (!EDITABLE_STATUSES.has(existing.status as PoStatus)) {
        throw new ConflictException(
          `No se puede editar una orden de compra en estado ${existing.status}. Solo DRAFT es editable.`,
        );
      }

      const companyCurrency = await this.getCompanyCurrency(tx, companyId);
      const supplierId = data.supplierId ?? existing.supplierId;
      const branchId = data.branchId === undefined ? existing.branchId : data.branchId;
      const currencyCode = data.currencyCode ?? existing.currencyCode;
      const exchangeRate = this.resolveExchangeRate(
        currencyCode,
        companyCurrency,
        data.exchangeRate ?? null,
        existing.exchangeRate.toString(),
      );

      if (data.supplierId !== undefined) {
        await this.assertSupplier(tx, companyId, supplierId);
      }
      if (data.branchId !== undefined && branchId !== null) {
        await this.assertBranch(tx, companyId, branchId);
      }
      if (data.currencyCode !== undefined) {
        await this.assertCurrency(tx, currencyCode);
      }

      const linesParsed: ParsedCreateLine[] =
        data.lines ??
        existing.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity.toString(),
          unitCost: l.unitCost.toString(),
          taxRate: l.taxRate.toString(),
        }));
      if (data.lines !== undefined) {
        await this.assertProducts(tx, companyId, linesParsed);
      }

      const totals = this.computeTotals(linesParsed, exchangeRate);

      // Replace-all del set de líneas cuando se proveen: borrar y recrear en
      // la misma tx mantiene el contrato sin tener que diffear ids.
      if (data.lines !== undefined) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      }

      try {
        const updated = await tx.purchaseOrder.update({
          where: { id },
          data: {
            supplierId,
            branchId,
            orderNumber: data.orderNumber ?? existing.orderNumber,
            orderDate: data.orderDate ?? existing.orderDate,
            expectedDate:
              data.expectedDate === undefined ? existing.expectedDate : data.expectedDate,
            currencyCode,
            exchangeRate,
            notes: data.notes === undefined ? existing.notes : data.notes,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            total: totals.total,
            baseTotal: totals.baseTotal,
            ...(data.lines !== undefined
              ? {
                  lines: {
                    create: linesParsed.map((line, idx) => ({
                      productId: line.productId,
                      quantity: line.quantity,
                      unitCost: line.unitCost,
                      taxRate: line.taxRate,
                      lineTotal: totals.lineTotals[idx],
                    })),
                  },
                }
              : {}),
          },
          include: {
            supplier: { select: { legalName: true } },
            lines: {
              include: { product: { select: { sku: true } } },
              orderBy: { id: 'asc' },
            },
          },
        });
        return this.toView(updated);
      } catch (err) {
        this.translatePrismaError(err);
      }
    });
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.purchaseOrder.findFirst({
      where: { id, companyId },
    });
    if (!existing) throw new NotFoundException('Orden de compra no encontrada.');
    if (!EDITABLE_STATUSES.has(existing.status as PoStatus)) {
      throw new ConflictException(
        `No se puede eliminar una orden de compra en estado ${existing.status}. Solo DRAFT puede borrarse; las demás deben cancelarse.`,
      );
    }
    // Las líneas caen por cascade.
    await this.prisma.client.purchaseOrder.delete({ where: { id } });
  }

  async approve(companyId: bigint, id: bigint): Promise<PurchaseOrderView> {
    return this.transition(companyId, id, ['DRAFT'], 'APPROVED');
  }

  async cancel(companyId: bigint, id: bigint): Promise<PurchaseOrderView> {
    return this.transition(companyId, id, ['DRAFT', 'APPROVED'], 'CANCELLED');
  }

  private async transition(
    companyId: bigint,
    id: bigint,
    allowedFrom: PoStatus[],
    to: PoStatus,
  ): Promise<PurchaseOrderView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        include: { _count: { select: { lines: true } } },
      });
      if (!existing) throw new NotFoundException('Orden de compra no encontrada.');
      if (!allowedFrom.includes(existing.status as PoStatus)) {
        throw new ConflictException(
          `Transición no permitida: no se puede pasar de ${existing.status} a ${to}.`,
        );
      }
      if (to === 'APPROVED' && existing._count.lines === 0) {
        throw new BadRequestException('No se puede aprobar una OC sin líneas.');
      }
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: to },
        include: {
          supplier: { select: { legalName: true } },
          lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
        },
      });
      return this.toView(updated);
    });
  }

  private computeTotals(lines: ParsedCreateLine[], exchangeRate: string): ComputedTotals {
    const er = new Prisma.Decimal(exchangeRate);
    let subtotal = new Prisma.Decimal(0);
    let taxAmount = new Prisma.Decimal(0);
    const lineTotals: Prisma.Decimal[] = [];
    for (const line of lines) {
      const qty = new Prisma.Decimal(line.quantity);
      const cost = new Prisma.Decimal(line.unitCost);
      const rate = new Prisma.Decimal(line.taxRate);
      const lineSubtotal = qty.mul(cost);
      const lineTax = lineSubtotal.mul(rate);
      const lineTotal = lineSubtotal.add(lineTax);
      subtotal = subtotal.add(lineSubtotal);
      taxAmount = taxAmount.add(lineTax);
      lineTotals.push(lineTotal);
    }
    const total = subtotal.add(taxAmount);
    const baseTotal = total.mul(er);
    return { subtotal, taxAmount, total, baseTotal, lineTotals };
  }

  private resolveExchangeRate(
    currencyCode: string,
    companyCurrency: string,
    provided: string | null,
    fallback?: string,
  ): string {
    if (currencyCode === companyCurrency) {
      // Moneda local: siempre 1 (ignora overrides porque sería incoherente).
      return '1';
    }
    if (provided !== null) return provided;
    if (fallback !== undefined) return fallback;
    throw new BadRequestException(
      `Se requiere "exchangeRate" cuando la moneda del documento (${currencyCode}) difiere de la moneda de la empresa (${companyCurrency}).`,
    );
  }

  private async getCompanyCurrency(
    tx: Prisma.TransactionClient,
    companyId: bigint,
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { currencyCode: true },
    });
    if (!company) {
      // No debería pasar nunca (el JWT garantiza company válida).
      throw new BadRequestException('Empresa del usuario no encontrada.');
    }
    return company.currencyCode;
  }

  private async assertSupplier(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    supplierId: bigint,
  ): Promise<void> {
    const supplier = await tx.partner.findFirst({
      where: { id: supplierId, companyId, deletedAt: null },
      select: { partnerType: true },
    });
    if (!supplier) {
      throw new BadRequestException(
        `El proveedor ${supplierId.toString()} no existe o no pertenece a esta empresa.`,
      );
    }
    if (supplier.partnerType !== 'SUPPLIER' && supplier.partnerType !== 'BOTH') {
      throw new BadRequestException(
        `El partner ${supplierId.toString()} no es proveedor (partnerType=${supplier.partnerType}).`,
      );
    }
  }

  private async assertBranch(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    branchId: bigint,
  ): Promise<void> {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException(
        `La sucursal ${branchId.toString()} no existe o no pertenece a esta empresa.`,
      );
    }
  }

  private async assertCurrency(tx: Prisma.TransactionClient, code: string): Promise<void> {
    const currency = await tx.currency.findUnique({
      where: { code },
      select: { code: true },
    });
    if (!currency) {
      throw new BadRequestException(`La moneda "${code}" no existe en el catálogo de monedas.`);
    }
  }

  private async assertProducts(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    lines: ParsedCreateLine[],
  ): Promise<void> {
    const ids = Array.from(new Set(lines.map((l) => l.productId)));
    const products = await tx.product.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null },
      select: { id: true, isInventoried: true, sku: true },
    });
    const map = new Map(products.map((p) => [p.id.toString(), p]));
    for (const id of ids) {
      const p = map.get(id.toString());
      if (!p) {
        throw new BadRequestException(
          `Producto ${id.toString()} no existe o no pertenece a esta empresa.`,
        );
      }
      if (!p.isInventoried) {
        throw new BadRequestException(
          `El producto ${p.sku} no es inventariado y no puede ir en una OC.`,
        );
      }
    }
  }

  private translatePrismaError(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe una OC con ese número en esta empresa.');
    }
    throw err as Error;
  }

  private toView(row: {
    id: bigint;
    orderNumber: string;
    status: string;
    supplierId: bigint;
    branchId: bigint | null;
    orderDate: Date;
    expectedDate: Date | null;
    currencyCode: string;
    exchangeRate: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    total: Prisma.Decimal;
    baseTotal: Prisma.Decimal;
    notes: string | null;
    createdBy: bigint | null;
    createdAt: Date;
    supplier: { legalName: string };
    lines: Array<{
      id: bigint;
      productId: bigint;
      quantity: Prisma.Decimal;
      receivedQty: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      product: { sku: string };
    }>;
  }): PurchaseOrderView {
    return {
      id: row.id.toString(),
      orderNumber: row.orderNumber,
      status: row.status,
      supplierId: row.supplierId.toString(),
      supplierName: row.supplier.legalName,
      branchId: row.branchId === null ? null : row.branchId.toString(),
      orderDate: row.orderDate.toISOString().slice(0, 10),
      expectedDate: row.expectedDate === null ? null : row.expectedDate.toISOString().slice(0, 10),
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate.toString(),
      subtotal: row.subtotal.toString(),
      taxAmount: row.taxAmount.toString(),
      total: row.total.toString(),
      baseTotal: row.baseTotal.toString(),
      notes: row.notes,
      createdBy: row.createdBy === null ? null : row.createdBy.toString(),
      createdAt: row.createdAt.toISOString(),
      lines: row.lines.map((l) => ({
        id: l.id.toString(),
        productId: l.productId.toString(),
        productSku: l.product.sku,
        quantity: l.quantity.toString(),
        receivedQty: l.receivedQty.toString(),
        unitCost: l.unitCost.toString(),
        taxRate: l.taxRate.toString(),
        lineTotal: l.lineTotal.toString(),
      })),
    };
  }
}
