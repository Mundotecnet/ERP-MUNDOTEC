import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ParsedCreateQuotation,
  ParsedCreateQuoteLine,
  ParsedListQuotationsQuery,
  ParsedUpdateQuotation,
  QuoteStatus,
} from './dto/quotations.dto';

export interface QuotationLineView {
  id: string;
  productId: string | null;
  productSku: string | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
  lineTotal: string;
}

export interface QuotationView {
  id: string;
  quoteNumber: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  quoteDate: string;
  validUntil: string | null;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  baseTotal: string;
  notes: string | null;
  convertedSalesOrderId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lines: QuotationLineView[];
}

interface ComputedTotals {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  baseTotal: Prisma.Decimal;
  lineTotals: Prisma.Decimal[];
}

const EDITABLE_STATUSES = new Set<QuoteStatus>(['DRAFT', 'SENT']);

@Injectable()
export class QuotationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint, filter: ParsedListQuotationsQuery): Promise<QuotationView[]> {
    const where: Prisma.QuotationWhereInput = { companyId };
    if (filter.status !== null) where.status = filter.status;
    if (filter.customerId !== null) where.customerId = filter.customerId;
    if (filter.from !== null || filter.to !== null) {
      where.quoteDate = {};
      if (filter.from !== null) where.quoteDate.gte = filter.from;
      if (filter.to !== null) where.quoteDate.lte = filter.to;
    }
    const rows = await this.prisma.raw.quotation.findMany({
      where,
      include: {
        customer: { select: { legalName: true } },
        salesperson: { select: { fullName: true } },
        lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
      },
      orderBy: [{ quoteDate: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<QuotationView> {
    const row = await this.prisma.raw.quotation.findFirst({
      where: { id, companyId },
      include: {
        customer: { select: { legalName: true } },
        salesperson: { select: { fullName: true } },
        lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Cotización no encontrada.');
    return this.toView(row);
  }

  async create(
    companyId: bigint,
    userId: bigint,
    data: ParsedCreateQuotation,
  ): Promise<QuotationView> {
    return this.prisma.client.$transaction(async (tx) => {
      const companyCurrency = await this.getCompanyCurrency(tx, companyId);
      const exchangeRate = this.resolveExchangeRate(
        data.currencyCode,
        companyCurrency,
        data.exchangeRate,
      );
      if (data.customerId !== null) await this.assertCustomer(tx, companyId, data.customerId);
      if (data.branchId !== null) await this.assertBranch(tx, companyId, data.branchId);
      if (data.salespersonId !== null)
        await this.assertSalesperson(tx, companyId, data.salespersonId);
      await this.assertCurrency(tx, data.currencyCode);
      await this.assertProducts(tx, companyId, data.lines);

      const totals = this.computeTotals(data.lines, exchangeRate);
      try {
        const created = await tx.quotation.create({
          data: {
            companyId,
            customerId: data.customerId,
            branchId: data.branchId,
            salespersonId: data.salespersonId,
            quoteNumber: data.quoteNumber,
            quoteDate: data.quoteDate ?? new Date(),
            validUntil: data.validUntil,
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
            updatedAt: new Date(),
            lines: {
              create: data.lines.map((line, idx) => ({
                productId: line.productId,
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountRate: line.discountRate,
                taxRate: line.taxRate,
                lineTotal: totals.lineTotals[idx],
              })),
            },
          },
          include: {
            customer: { select: { legalName: true } },
            salesperson: { select: { fullName: true } },
            lines: {
              include: { product: { select: { sku: true } } },
              orderBy: { id: 'asc' },
            },
          },
        });
        return this.toView(created);
      } catch (err) {
        this.translatePrismaError(err);
      }
    });
  }

  async update(companyId: bigint, id: bigint, data: ParsedUpdateQuotation): Promise<QuotationView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.quotation.findFirst({
        where: { id, companyId },
        include: { lines: true },
      });
      if (!existing) throw new NotFoundException('Cotización no encontrada.');
      if (!EDITABLE_STATUSES.has(existing.status as QuoteStatus)) {
        throw new ConflictException(
          `No se puede editar una cotización en estado ${existing.status}. Solo DRAFT/SENT son editables.`,
        );
      }

      const companyCurrency = await this.getCompanyCurrency(tx, companyId);
      const customerId = data.customerId === undefined ? existing.customerId : data.customerId;
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

      if (data.customerId !== undefined && customerId !== null) {
        await this.assertCustomer(tx, companyId, customerId);
      }
      if (data.branchId !== undefined && branchId !== null) {
        await this.assertBranch(tx, companyId, branchId);
      }
      if (data.salespersonId !== undefined && salespersonId !== null) {
        await this.assertSalesperson(tx, companyId, salespersonId);
      }
      if (data.currencyCode !== undefined) await this.assertCurrency(tx, currencyCode);

      const linesParsed: ParsedCreateQuoteLine[] =
        data.lines ??
        existing.lines.map((l) => ({
          productId: l.productId,
          description: l.description,
          quantity: l.quantity.toString(),
          unitPrice: l.unitPrice.toString(),
          discountRate: l.discountRate.toString(),
          taxRate: l.taxRate.toString(),
        }));
      if (data.lines !== undefined) {
        await this.assertProducts(tx, companyId, linesParsed);
      }

      const totals = this.computeTotals(linesParsed, exchangeRate);

      if (data.lines !== undefined) {
        await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      }

      try {
        const updated = await tx.quotation.update({
          where: { id },
          data: {
            customerId,
            branchId,
            salespersonId,
            quoteNumber: data.quoteNumber ?? existing.quoteNumber,
            quoteDate: data.quoteDate ?? existing.quoteDate,
            validUntil: data.validUntil === undefined ? existing.validUntil : data.validUntil,
            currencyCode,
            exchangeRate,
            notes: data.notes === undefined ? existing.notes : data.notes,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            discountAmount: totals.discountAmount,
            total: totals.total,
            baseTotal: totals.baseTotal,
            updatedAt: new Date(),
            ...(data.lines !== undefined
              ? {
                  lines: {
                    create: linesParsed.map((line, idx) => ({
                      productId: line.productId,
                      description: line.description,
                      quantity: line.quantity,
                      unitPrice: line.unitPrice,
                      discountRate: line.discountRate,
                      taxRate: line.taxRate,
                      lineTotal: totals.lineTotals[idx],
                    })),
                  },
                }
              : {}),
          },
          include: {
            customer: { select: { legalName: true } },
            salesperson: { select: { fullName: true } },
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
    const existing = await this.prisma.raw.quotation.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Cotización no encontrada.');
    if (existing.status !== 'DRAFT') {
      throw new ConflictException(
        `Solo se pueden eliminar cotizaciones en DRAFT. Use cancelación/rechazo para otros estados.`,
      );
    }
    await this.prisma.client.quotation.delete({ where: { id } });
  }

  async send(companyId: bigint, id: bigint): Promise<QuotationView> {
    return this.transition(companyId, id, ['DRAFT'], 'SENT', { sentAt: new Date() });
  }

  async accept(companyId: bigint, id: bigint): Promise<QuotationView> {
    return this.transition(companyId, id, ['SENT'], 'ACCEPTED');
  }

  async reject(companyId: bigint, id: bigint): Promise<QuotationView> {
    return this.transition(companyId, id, ['SENT', 'ACCEPTED'], 'REJECTED');
  }

  async expire(companyId: bigint, id: bigint): Promise<QuotationView> {
    return this.transition(companyId, id, ['DRAFT', 'SENT'], 'EXPIRED');
  }

  private async transition(
    companyId: bigint,
    id: bigint,
    allowedFrom: QuoteStatus[],
    to: QuoteStatus,
    extra: Prisma.QuotationUpdateInput = {},
  ): Promise<QuotationView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.quotation.findFirst({
        where: { id, companyId },
        include: { _count: { select: { lines: true } } },
      });
      if (!existing) throw new NotFoundException('Cotización no encontrada.');
      if (!allowedFrom.includes(existing.status as QuoteStatus)) {
        throw new ConflictException(
          `Transición no permitida: no se puede pasar de ${existing.status} a ${to}.`,
        );
      }
      if (to === 'SENT' && existing._count.lines === 0) {
        throw new BadRequestException('No se puede enviar una cotización sin líneas.');
      }
      const updated = await tx.quotation.update({
        where: { id },
        data: { status: to, updatedAt: new Date(), ...extra },
        include: {
          customer: { select: { legalName: true } },
          salesperson: { select: { fullName: true } },
          lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
        },
      });
      return this.toView(updated);
    });
  }

  private computeTotals(lines: ParsedCreateQuoteLine[], exchangeRate: string): ComputedTotals {
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
    lines: ParsedCreateQuoteLine[],
  ): Promise<void> {
    const ids = Array.from(
      new Set(lines.filter((l) => l.productId !== null).map((l) => l.productId as bigint)),
    );
    if (ids.length === 0) return;
    const products = await tx.product.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null },
      select: { id: true },
    });
    const map = new Map(products.map((p) => [p.id.toString(), p]));
    for (const id of ids) {
      if (!map.has(id.toString())) {
        throw new BadRequestException(
          `Producto ${id.toString()} no existe o no pertenece a esta empresa.`,
        );
      }
    }
  }

  private translatePrismaError(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe una cotización con ese número en esta empresa.');
    }
    throw err as Error;
  }

  private toView(row: {
    id: bigint;
    quoteNumber: string;
    status: string;
    customerId: bigint | null;
    branchId: bigint | null;
    salespersonId: bigint | null;
    quoteDate: Date;
    validUntil: Date | null;
    currencyCode: string;
    exchangeRate: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    total: Prisma.Decimal;
    baseTotal: Prisma.Decimal;
    notes: string | null;
    convertedSalesOrderId: bigint | null;
    createdBy: bigint | null;
    createdAt: Date;
    updatedAt: Date;
    customer: { legalName: string } | null;
    salesperson: { fullName: string } | null;
    lines: Array<{
      id: bigint;
      productId: bigint | null;
      description: string | null;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      discountRate: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      product: { sku: string } | null;
    }>;
  }): QuotationView {
    return {
      id: row.id.toString(),
      quoteNumber: row.quoteNumber,
      status: row.status,
      customerId: row.customerId?.toString() ?? null,
      customerName: row.customer?.legalName ?? null,
      branchId: row.branchId?.toString() ?? null,
      salespersonId: row.salespersonId?.toString() ?? null,
      salespersonName: row.salesperson?.fullName ?? null,
      quoteDate: row.quoteDate.toISOString().slice(0, 10),
      validUntil: row.validUntil ? row.validUntil.toISOString().slice(0, 10) : null,
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate.toString(),
      subtotal: row.subtotal.toString(),
      taxAmount: row.taxAmount.toString(),
      discountAmount: row.discountAmount.toString(),
      total: row.total.toString(),
      baseTotal: row.baseTotal.toString(),
      notes: row.notes,
      convertedSalesOrderId: row.convertedSalesOrderId?.toString() ?? null,
      createdBy: row.createdBy?.toString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lines: row.lines.map((l) => ({
        id: l.id.toString(),
        productId: l.productId?.toString() ?? null,
        productSku: l.product?.sku ?? null,
        description: l.description,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discountRate: l.discountRate.toString(),
        taxRate: l.taxRate.toString(),
        lineTotal: l.lineTotal.toString(),
      })),
    };
  }
}
