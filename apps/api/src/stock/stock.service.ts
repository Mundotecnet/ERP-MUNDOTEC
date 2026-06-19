import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedStockListQuery } from './dto/stock.dto';

export interface StockView {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: string;
  avgCost: string;
  updatedAt: string;
}

interface StockRow {
  id: bigint;
  productId: bigint;
  warehouseId: bigint;
  quantity: Prisma.Decimal;
  avgCost: Prisma.Decimal;
  updatedAt: Date;
  product: { sku: string; name: string };
  warehouse: { code: string; name: string };
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista snapshots de existencias filtrando por la empresa del usuario. El
   * aislamiento se hace por el `companyId` del producto: la tabla `stock` no
   * tiene `company_id` propio. Las filas con producto soft-deleted se omiten.
   */
  async list(companyId: bigint, filter: ParsedStockListQuery): Promise<StockView[]> {
    const where: Prisma.StockWhereInput = {
      product: { companyId, deletedAt: null },
    };
    if (filter.productId !== null) where.productId = filter.productId;
    if (filter.warehouseId !== null) where.warehouseId = filter.warehouseId;

    const rows = await this.prisma.raw.stock.findMany({
      where,
      include: {
        product: { select: { sku: true, name: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { warehouse: { code: 'asc' } }],
    });
    return rows.map((r) => this.toView(r));
  }

  private toView(row: StockRow): StockView {
    return {
      id: row.id.toString(),
      productId: row.productId.toString(),
      productSku: row.product.sku,
      productName: row.product.name,
      warehouseId: row.warehouseId.toString(),
      warehouseCode: row.warehouse.code,
      warehouseName: row.warehouse.name,
      quantity: row.quantity.toString(),
      avgCost: row.avgCost.toString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
