import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import {
  InvoiceStatus,
  ParsedCreateInvoice,
  ParsedCreateInvoiceLine,
  ParsedListInvoicesQuery,
} from './dto/invoices.dto';

export interface InvoiceLineView {
  id: string;
  productId: string | null;
  productSku: string | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  lineTotal: string;
}

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  status: string;
  customerId: string;
  customerName: string;
  branchId: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  baseTotal: string;
  paidAmount: string;
  balance: string;
  createdBy: string | null;
  createdAt: string;
  lines: InvoiceLineView[];
}

interface ComputedTotals {
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  baseTotal: Prisma.Decimal;
  lineTotals: Prisma.Decimal[];
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: StockMovementsService,
  ) {}

  async list(companyId: bigint, filter: ParsedListInvoicesQuery): Promise<InvoiceView[]> {
    const where: Prisma.InvoiceWhereInput = { companyId };
    if (filter.status !== null) where.status = filter.status;
    if (filter.customerId !== null) where.customerId = filter.customerId;
    if (filter.from !== null || filter.to !== null) {
      where.invoiceDate = {};
      if (filter.from !== null) where.invoiceDate.gte = filter.from;
      if (filter.to !== null) where.invoiceDate.lte = filter.to;
    }
    const rows = await this.prisma.raw.invoice.findMany({
      where,
      include: {
        customer: { select: { legalName: true } },
        salesperson: { select: { fullName: true } },
        salesOrder: { select: { orderNumber: true } },
        lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
      },
      orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<InvoiceView> {
    const row = await this.prisma.raw.invoice.findFirst({
      where: { id, companyId },
      include: {
        customer: { select: { legalName: true } },
        salesperson: { select: { fullName: true } },
        salesOrder: { select: { orderNumber: true } },
        lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Factura no encontrada.');
    return this.toView(row);
  }

  /**
   * Emite una factura en una sola transacción:
   *  1. Valida cliente, almacén, OV opcional (debe ser CONFIRMED + mismo
   *     cliente), productos del tenant.
   *  2. Verifica que cada línea con producto sea inventariable.
   *  3. Calcula totales server-side y graba header + líneas en status
   *     ISSUED.
   *  4. Por cada línea inventariada, genera StockMovement OUT vía
   *     applyMovementInTx (rechaza con 409 si dejaría saldo negativo;
   *     todo se cae atómicamente).
   *  5. Si trae salesOrderId, transiciona la SO a INVOICED.
   */
  async create(companyId: bigint, userId: bigint, data: ParsedCreateInvoice): Promise<InvoiceView> {
    return this.prisma.client.$transaction(async (tx) => {
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
      const warehouse = await this.assertWarehouse(tx, companyId, data.warehouseId);
      await this.assertProducts(tx, companyId, data.lines);

      // Si trae salesOrderId, debe ser CONFIRMED y mismo cliente.
      let salesOrder: { id: bigint; status: string; customerId: bigint; companyId: bigint } | null =
        null;
      if (data.salesOrderId !== null) {
        const so = await tx.salesOrder.findFirst({
          where: { id: data.salesOrderId, companyId },
          select: { id: true, status: true, customerId: true, companyId: true },
        });
        if (!so) {
          throw new BadRequestException(
            `La orden de venta ${data.salesOrderId.toString()} no existe o no pertenece a esta empresa.`,
          );
        }
        if (so.status !== 'CONFIRMED') {
          throw new BadRequestException(
            `La orden de venta está en estado ${so.status}; solo se pueden facturar OV CONFIRMED.`,
          );
        }
        if (so.customerId !== data.customerId) {
          throw new BadRequestException(
            'El cliente de la factura no coincide con el cliente de la orden de venta.',
          );
        }
        salesOrder = so;
      }

      const totals = this.computeTotals(data.lines, exchangeRate);

      let invoice;
      try {
        invoice = await tx.invoice.create({
          data: {
            companyId,
            customerId: data.customerId,
            branchId: data.branchId,
            salespersonId: data.salespersonId,
            salesOrderId: data.salesOrderId,
            invoiceNumber: data.invoiceNumber,
            invoiceDate: data.invoiceDate ?? new Date(),
            dueDate: data.dueDate,
            status: 'ISSUED',
            currencyCode: data.currencyCode,
            exchangeRate,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            total: totals.total,
            baseTotal: totals.baseTotal,
            // En este sprint no se procesan pagos: arranca íntegra como
            // balance pendiente. El sprint de Pagos moverá paidAmount.
            paidAmount: '0',
            balance: totals.total.toFixed(4),
            createdBy: userId,
            lines: {
              create: data.lines.map((line, idx) => ({
                productId: line.productId,
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                taxRate: line.taxRate,
                lineTotal: totals.lineTotals[idx],
              })),
            },
          },
          include: {
            customer: { select: { legalName: true } },
            salesperson: { select: { fullName: true } },
            salesOrder: { select: { orderNumber: true } },
            lines: {
              include: { product: { select: { sku: true } } },
              orderBy: { id: 'asc' },
            },
          },
        });
      } catch (err) {
        this.translatePrismaError(err);
      }

      // Movimientos de kardex: una salida por cada línea inventariada.
      // Las líneas sin producto (servicios) no mueven stock.
      for (const line of data.lines) {
        if (line.productId === null) continue;
        await this.movements.applyMovementInTx(tx, {
          companyId,
          userId,
          productId: line.productId,
          warehouseId: warehouse.id,
          movementType: 'OUT',
          quantity: new Prisma.Decimal(line.quantity).neg().toFixed(4),
          unitCost: '0', // applyMovementInTx ignora unitCost para salidas
          sourceDoc: 'INVOICE',
          sourceId: invoice.id,
          movementDate: data.invoiceDate ?? null,
          notes: null,
        });
      }

      // Transición de la SO si aplica.
      if (salesOrder !== null) {
        await tx.salesOrder.update({
          where: { id: salesOrder.id },
          data: { status: 'INVOICED' },
        });
      }

      return this.toView(invoice);
    });
  }

  /**
   * Cancela una factura ISSUED o PARTIAL. **NO revierte el kardex** — sólo
   * cambia status para dejar pista. Las devoluciones físicas se procesan
   * por sales_return (sprint posterior).
   */
  async cancel(companyId: bigint, id: bigint): Promise<InvoiceView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({ where: { id, companyId } });
      if (!existing) throw new NotFoundException('Factura no encontrada.');
      const status = existing.status as InvoiceStatus;
      if (status !== 'ISSUED' && status !== 'PARTIAL') {
        throw new ConflictException(
          `Transición no permitida: no se puede cancelar una factura en estado ${existing.status}.`,
        );
      }
      const updated = await tx.invoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: {
          customer: { select: { legalName: true } },
          salesperson: { select: { fullName: true } },
          salesOrder: { select: { orderNumber: true } },
          lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } },
        },
      });
      return this.toView(updated);
    });
  }

  private computeTotals(lines: ParsedCreateInvoiceLine[], exchangeRate: string): ComputedTotals {
    const er = new Prisma.Decimal(exchangeRate);
    let subtotal = new Prisma.Decimal(0);
    let taxAmount = new Prisma.Decimal(0);
    const lineTotals: Prisma.Decimal[] = [];
    for (const line of lines) {
      const qty = new Prisma.Decimal(line.quantity);
      const price = new Prisma.Decimal(line.unitPrice);
      const rate = new Prisma.Decimal(line.taxRate);
      const lineSubtotal = qty.mul(price);
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
  ): string {
    if (currencyCode === companyCurrency) return '1';
    if (provided !== null) return provided;
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

  private async assertWarehouse(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    warehouseId: bigint,
  ): Promise<{ id: bigint }> {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, companyId },
      select: { id: true },
    });
    if (!warehouse) {
      throw new BadRequestException(
        `El almacén ${warehouseId.toString()} no existe o no pertenece a esta empresa.`,
      );
    }
    return warehouse;
  }

  private async assertProducts(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    lines: ParsedCreateInvoiceLine[],
  ): Promise<void> {
    const ids = Array.from(
      new Set(lines.filter((l) => l.productId !== null).map((l) => l.productId as bigint)),
    );
    if (ids.length === 0) return;
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
          `El producto ${p.sku} no es inventariado. Para facturar servicios, omita "productId" y use "description".`,
        );
      }
    }
  }

  private translatePrismaError(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe una factura con ese número en esta empresa.');
    }
    throw err as Error;
  }

  private toView(row: {
    id: bigint;
    invoiceNumber: string;
    status: string;
    customerId: bigint;
    branchId: bigint | null;
    salespersonId: bigint | null;
    salesOrderId: bigint | null;
    invoiceDate: Date;
    dueDate: Date | null;
    currencyCode: string;
    exchangeRate: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    total: Prisma.Decimal;
    baseTotal: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    balance: Prisma.Decimal;
    createdBy: bigint | null;
    createdAt: Date;
    customer: { legalName: string };
    salesperson: { fullName: string } | null;
    salesOrder: { orderNumber: string } | null;
    lines: Array<{
      id: bigint;
      productId: bigint | null;
      description: string | null;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      product: { sku: string } | null;
    }>;
  }): InvoiceView {
    return {
      id: row.id.toString(),
      invoiceNumber: row.invoiceNumber,
      status: row.status,
      customerId: row.customerId.toString(),
      customerName: row.customer.legalName,
      branchId: row.branchId?.toString() ?? null,
      salespersonId: row.salespersonId?.toString() ?? null,
      salespersonName: row.salesperson?.fullName ?? null,
      salesOrderId: row.salesOrderId?.toString() ?? null,
      salesOrderNumber: row.salesOrder?.orderNumber ?? null,
      invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
      dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate.toString(),
      subtotal: row.subtotal.toString(),
      taxAmount: row.taxAmount.toString(),
      total: row.total.toString(),
      baseTotal: row.baseTotal.toString(),
      paidAmount: row.paidAmount.toString(),
      balance: row.balance.toString(),
      createdBy: row.createdBy?.toString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lines: row.lines.map((l) => ({
        id: l.id.toString(),
        productId: l.productId?.toString() ?? null,
        productSku: l.product?.sku ?? null,
        description: l.description,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        taxRate: l.taxRate.toString(),
        lineTotal: l.lineTotal.toString(),
      })),
    };
  }
}
