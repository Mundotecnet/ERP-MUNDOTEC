import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ParsedCreateSalesOrder,
  ParsedCreateSoLine,
  ParsedListSalesOrdersQuery,
  ParsedUpdateSalesOrder,
  SoStatus,
} from './dto/sales-orders.dto';

export interface SalesOrderLineView {
  id: string;
  productId: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
  lineTotal: string;
  // PR-38 — nivel de precio aplicado (informativo, opcional).
  priceListId: string | null;
  priceListName: string | null;
}

export interface SalesOrderView {
  id: string;
  orderNumber: string;
  status: string;
  customerId: string;
  customerName: string;
  branchId: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  quotationId: string | null;
  quotationNumber: string | null;
  orderDate: string;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  baseTotal: string;
  notes: string | null;
  channel: string;
  externalRef: string | null;
  webStatus: string | null;
  createdBy: string | null;
  createdAt: string;
  lines: SalesOrderLineView[];
}

interface ComputedTotals {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  baseTotal: Prisma.Decimal;
  lineTotals: Prisma.Decimal[];
}

interface CreateInTxOptions {
  quotationId: bigint | null;
}

const EDITABLE_STATUSES = new Set<SoStatus>(['DRAFT']);

@Injectable()
export class SalesOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint, filter: ParsedListSalesOrdersQuery): Promise<SalesOrderView[]> {
    const where: Prisma.SalesOrderWhereInput = { companyId };
    if (filter.status !== null) where.status = filter.status;
    if (filter.customerId !== null) where.customerId = filter.customerId;
    if (filter.from !== null || filter.to !== null) {
      where.orderDate = {};
      if (filter.from !== null) where.orderDate.gte = filter.from;
      if (filter.to !== null) where.orderDate.lte = filter.to;
    }
    const rows = await this.prisma.raw.salesOrder.findMany({
      where,
      include: {
        customer: { select: { legalName: true } },
        salesperson: { select: { fullName: true } },
        quotation: { select: { quoteNumber: true } },
        lines: {
          include: { product: { select: { sku: true } }, priceList: { select: { name: true } } },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<SalesOrderView> {
    const row = await this.prisma.raw.salesOrder.findFirst({
      where: { id, companyId },
      include: {
        customer: { select: { legalName: true } },
        salesperson: { select: { fullName: true } },
        quotation: { select: { quoteNumber: true } },
        lines: {
          include: { product: { select: { sku: true } }, priceList: { select: { name: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Orden de venta no encontrada.');
    return this.toView(row);
  }

  async create(
    companyId: bigint,
    userId: bigint,
    data: ParsedCreateSalesOrder,
  ): Promise<SalesOrderView> {
    return this.prisma.client.$transaction(async (tx) => {
      return this.createInTx(tx, companyId, userId, data, { quotationId: null });
    });
  }

  /**
   * Crea una SO dentro de una transacción ya abierta. Lo usa el endpoint
   * `POST /quotations/:id/convert` para insertar la SO en la misma tx que
   * marca la cotización como CONVERTED.
   */
  async createInTx(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
    data: ParsedCreateSalesOrder,
    options: CreateInTxOptions,
  ): Promise<SalesOrderView> {
    const companyCurrency = await this.getCompanyCurrency(tx, companyId);
    const exchangeRate = this.resolveExchangeRate(
      data.currencyCode,
      companyCurrency,
      data.exchangeRate,
    );
    await this.assertCustomer(tx, companyId, data.customerId);
    if (data.branchId !== null) await this.assertBranch(tx, companyId, data.branchId);
    if (data.salespersonId !== null)
      await this.assertSalesperson(tx, companyId, data.salespersonId);
    await this.assertCurrency(tx, data.currencyCode);
    await this.assertProducts(tx, companyId, data.lines);
    await this.assertPriceLists(tx, companyId, data.lines);

    const totals = this.computeTotals(data.lines, exchangeRate);
    try {
      const created = await tx.salesOrder.create({
        data: {
          companyId,
          customerId: data.customerId,
          branchId: data.branchId,
          salespersonId: data.salespersonId,
          quotationId: options.quotationId,
          orderNumber: data.orderNumber,
          orderDate: data.orderDate ?? new Date(),
          status: 'DRAFT',
          currencyCode: data.currencyCode,
          exchangeRate,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discountAmount: totals.discountAmount,
          total: totals.total,
          baseTotal: totals.baseTotal,
          notes: data.notes,
          createdBy: userId,
          lines: {
            create: data.lines.map((line, idx) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountRate: line.discountRate,
              taxRate: line.taxRate,
              lineTotal: totals.lineTotals[idx],
              priceListId: line.priceListId,
            })),
          },
        },
        include: {
          customer: { select: { legalName: true } },
          salesperson: { select: { fullName: true } },
          quotation: { select: { quoteNumber: true } },
          lines: {
            include: {
              product: { select: { sku: true } },
              priceList: { select: { name: true } },
            },
            orderBy: { id: 'asc' },
          },
        },
      });
      return this.toView(created);
    } catch (err) {
      this.translatePrismaError(err);
    }
  }

  async update(
    companyId: bigint,
    id: bigint,
    data: ParsedUpdateSalesOrder,
  ): Promise<SalesOrderView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { lines: true },
      });
      if (!existing) throw new NotFoundException('Orden de venta no encontrada.');
      if (!EDITABLE_STATUSES.has(existing.status as SoStatus)) {
        throw new ConflictException(
          `No se puede editar una orden de venta en estado ${existing.status}. Solo DRAFT es editable.`,
        );
      }

      const companyCurrency = await this.getCompanyCurrency(tx, companyId);
      const customerId = data.customerId ?? existing.customerId;
      const branchId = data.branchId === undefined ? existing.branchId : data.branchId;
      const salespersonId =
        data.salespersonId === undefined ? existing.salespersonId : data.salespersonId;
      const currencyCode = data.currencyCode ?? existing.currencyCode;
      const exchangeRate = this.resolveExchangeRate(
        currencyCode,
        companyCurrency,
        data.exchangeRate ?? null,
        existing.exchangeRate.toString(),
      );

      if (data.customerId !== undefined) await this.assertCustomer(tx, companyId, customerId);
      if (data.branchId !== undefined && branchId !== null)
        await this.assertBranch(tx, companyId, branchId);
      if (data.salespersonId !== undefined && salespersonId !== null)
        await this.assertSalesperson(tx, companyId, salespersonId);
      if (data.currencyCode !== undefined) await this.assertCurrency(tx, currencyCode);

      const linesParsed: ParsedCreateSoLine[] =
        data.lines ??
        existing.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity.toString(),
          unitPrice: l.unitPrice.toString(),
          discountRate: l.discountRate.toString(),
          taxRate: l.taxRate.toString(),
          priceListId: l.priceListId,
        }));
      if (data.lines !== undefined) {
        await this.assertProducts(tx, companyId, linesParsed);
        await this.assertPriceLists(tx, companyId, linesParsed);
      }

      const totals = this.computeTotals(linesParsed, exchangeRate);

      if (data.lines !== undefined) {
        await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
      }

      try {
        const updated = await tx.salesOrder.update({
          where: { id },
          data: {
            customerId,
            branchId,
            salespersonId,
            orderNumber: data.orderNumber ?? existing.orderNumber,
            orderDate: data.orderDate ?? existing.orderDate,
            currencyCode,
            exchangeRate,
            notes: data.notes === undefined ? existing.notes : data.notes,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            discountAmount: totals.discountAmount,
            total: totals.total,
            baseTotal: totals.baseTotal,
            ...(data.lines !== undefined
              ? {
                  lines: {
                    create: linesParsed.map((line, idx) => ({
                      productId: line.productId,
                      quantity: line.quantity,
                      unitPrice: line.unitPrice,
                      discountRate: line.discountRate,
                      taxRate: line.taxRate,
                      lineTotal: totals.lineTotals[idx],
                      priceListId: line.priceListId,
                    })),
                  },
                }
              : {}),
          },
          include: {
            customer: { select: { legalName: true } },
            salesperson: { select: { fullName: true } },
            quotation: { select: { quoteNumber: true } },
            lines: {
              include: {
                product: { select: { sku: true } },
                priceList: { select: { name: true } },
              },
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
    const existing = await this.prisma.raw.salesOrder.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Orden de venta no encontrada.');
    if (!EDITABLE_STATUSES.has(existing.status as SoStatus)) {
      throw new ConflictException(
        `Solo se pueden eliminar órdenes de venta en DRAFT. Use cancelar para otros estados.`,
      );
    }
    await this.prisma.client.salesOrder.delete({ where: { id } });
  }

  async confirm(companyId: bigint, id: bigint): Promise<SalesOrderView> {
    return this.transition(companyId, id, ['DRAFT'], 'CONFIRMED');
  }

  async cancel(companyId: bigint, id: bigint): Promise<SalesOrderView> {
    return this.transition(companyId, id, ['DRAFT', 'CONFIRMED'], 'CANCELLED');
  }

  private async transition(
    companyId: bigint,
    id: bigint,
    allowedFrom: SoStatus[],
    to: SoStatus,
  ): Promise<SalesOrderView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { _count: { select: { lines: true } } },
      });
      if (!existing) throw new NotFoundException('Orden de venta no encontrada.');
      if (!allowedFrom.includes(existing.status as SoStatus)) {
        throw new ConflictException(
          `Transición no permitida: no se puede pasar de ${existing.status} a ${to}.`,
        );
      }
      if (to === 'CONFIRMED' && existing._count.lines === 0) {
        throw new BadRequestException('No se puede confirmar una orden de venta sin líneas.');
      }
      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: to },
        include: {
          customer: { select: { legalName: true } },
          salesperson: { select: { fullName: true } },
          quotation: { select: { quoteNumber: true } },
          lines: {
            include: { product: { select: { sku: true } }, priceList: { select: { name: true } } },
            orderBy: { id: 'asc' },
          },
        },
      });
      return this.toView(updated);
    });
  }

  private computeTotals(lines: ParsedCreateSoLine[], exchangeRate: string): ComputedTotals {
    const er = new Prisma.Decimal(exchangeRate);
    let subtotal = new Prisma.Decimal(0);
    let discountAmount = new Prisma.Decimal(0);
    let taxAmount = new Prisma.Decimal(0);
    const lineTotals: Prisma.Decimal[] = [];
    for (const line of lines) {
      const qty = new Prisma.Decimal(line.quantity);
      const price = new Prisma.Decimal(line.unitPrice);
      const disc = new Prisma.Decimal(line.discountRate);
      const rate = new Prisma.Decimal(line.taxRate);
      const gross = qty.mul(price);
      const discValue = gross.mul(disc);
      const lineSubtotal = gross.sub(discValue);
      const lineTax = lineSubtotal.mul(rate);
      const lineTotal = lineSubtotal.add(lineTax);
      subtotal = subtotal.add(gross);
      discountAmount = discountAmount.add(discValue);
      taxAmount = taxAmount.add(lineTax);
      lineTotals.push(lineTotal);
    }
    const total = subtotal.sub(discountAmount).add(taxAmount);
    const baseTotal = total.mul(er);
    return { subtotal, discountAmount, taxAmount, total, baseTotal, lineTotals };
  }

  private resolveExchangeRate(
    currencyCode: string,
    companyCurrency: string,
    provided: string | null,
    fallback?: string,
  ): string {
    if (currencyCode === companyCurrency) return '1';
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
    if (!company) throw new BadRequestException('Empresa del usuario no encontrada.');
    return company.currencyCode;
  }

  private async assertCustomer(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    customerId: bigint,
  ): Promise<void> {
    const customer = await tx.partner.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: { partnerType: true },
    });
    if (!customer) {
      throw new BadRequestException(
        `El cliente ${customerId.toString()} no existe o no pertenece a esta empresa.`,
      );
    }
    if (customer.partnerType !== 'CUSTOMER' && customer.partnerType !== 'BOTH') {
      throw new BadRequestException(
        `El partner ${customerId.toString()} no es cliente (partnerType=${customer.partnerType}).`,
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

  private async assertSalesperson(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<void> {
    const user = await tx.appUser.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException(
        `El vendedor ${userId.toString()} no existe o no pertenece a esta empresa.`,
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
    lines: ParsedCreateSoLine[],
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
          `El producto ${p.sku} no es inventariado y no puede ir en una orden de venta.`,
        );
      }
    }
  }

  /**
   * PR-38 — valida que cada priceListId enviado pertenezca al tenant y sea
   * lista activa de tipo SALE. NULL ignorado.
   */
  private async assertPriceLists(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    lines: ParsedCreateSoLine[],
  ): Promise<void> {
    const ids = Array.from(
      new Set(lines.filter((l) => l.priceListId !== null).map((l) => l.priceListId as bigint)),
    );
    if (ids.length === 0) return;
    const lists = await tx.priceList.findMany({
      where: { id: { in: ids }, companyId, listType: 'SALE' },
      select: { id: true },
    });
    const map = new Map(lists.map((l) => [l.id.toString(), l]));
    for (const id of ids) {
      if (!map.has(id.toString())) {
        throw new BadRequestException(
          `Lista de precios ${id.toString()} no existe, no pertenece a esta empresa o no es de venta.`,
        );
      }
    }
  }

  private translatePrismaError(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe una orden de venta con ese número en esta empresa.');
    }
    throw err as Error;
  }

  private toView(row: {
    id: bigint;
    orderNumber: string;
    status: string;
    customerId: bigint;
    branchId: bigint | null;
    salespersonId: bigint | null;
    quotationId: bigint | null;
    orderDate: Date;
    currencyCode: string;
    exchangeRate: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    total: Prisma.Decimal;
    baseTotal: Prisma.Decimal;
    notes: string | null;
    channel: string;
    externalRef: string | null;
    webStatus: string | null;
    createdBy: bigint | null;
    createdAt: Date;
    customer: { legalName: string };
    salesperson: { fullName: string } | null;
    quotation: { quoteNumber: string } | null;
    lines: Array<{
      id: bigint;
      productId: bigint;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      discountRate: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      priceListId: bigint | null;
      product: { sku: string };
      priceList: { name: string } | null;
    }>;
  }): SalesOrderView {
    return {
      id: row.id.toString(),
      orderNumber: row.orderNumber,
      status: row.status,
      customerId: row.customerId.toString(),
      customerName: row.customer.legalName,
      branchId: row.branchId?.toString() ?? null,
      salespersonId: row.salespersonId?.toString() ?? null,
      salespersonName: row.salesperson?.fullName ?? null,
      quotationId: row.quotationId?.toString() ?? null,
      quotationNumber: row.quotation?.quoteNumber ?? null,
      orderDate: row.orderDate.toISOString().slice(0, 10),
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate.toString(),
      subtotal: row.subtotal.toString(),
      taxAmount: row.taxAmount.toString(),
      discountAmount: row.discountAmount.toString(),
      total: row.total.toString(),
      baseTotal: row.baseTotal.toString(),
      notes: row.notes,
      channel: row.channel,
      externalRef: row.externalRef,
      webStatus: row.webStatus,
      createdBy: row.createdBy?.toString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lines: row.lines.map((l) => ({
        id: l.id.toString(),
        productId: l.productId.toString(),
        productSku: l.product.sku,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discountRate: l.discountRate.toString(),
        taxRate: l.taxRate.toString(),
        lineTotal: l.lineTotal.toString(),
        priceListId: l.priceListId?.toString() ?? null,
        priceListName: l.priceList?.name ?? null,
      })),
    };
  }
}
