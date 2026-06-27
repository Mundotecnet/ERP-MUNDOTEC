import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ParsedUpdatePricing } from './pricing.dto';
import {
  isConsistent,
  isOutOfMargin,
  marginFromPrice,
  priceFromMargin,
  MARGIN_SCALE,
  PRICE_SCALE,
} from './pricing.formula';

export interface PricingView {
  productId: string;
  sku: string;
  name: string;
  priceCurrency: string;
  costPrice: string;
  salePrice: string;
  marginPct: string;
  minMarginPct: string;
  outOfMargin: boolean;
}

export interface PricingHistoryEntry {
  id: string;
  changeType: string;
  source: string | null;
  reason: string | null;
  costValue: string | null;
  marginPct: string | null;
  oldValue: string | null;
  newValue: string;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async getPricing(companyId: bigint, productId: bigint): Promise<PricingView> {
    const row = await this.prisma.raw.product.findFirst({
      where: { id: productId, companyId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        priceCurrency: true,
        costPrice: true,
        salePrice: true,
        marginPct: true,
        minMarginPct: true,
        outOfMargin: true,
      },
    });
    if (!row) throw new NotFoundException('Producto no encontrado.');
    return this.toPricingView(row);
  }

  async getHistory(companyId: bigint, productId: bigint): Promise<PricingHistoryEntry[]> {
    // Multi-tenant: solo si el producto pertenece al tenant.
    const product = await this.prisma.raw.product.findFirst({
      where: { id: productId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado.');

    const rows = await this.prisma.raw.productPriceHistory.findMany({
      where: { companyId, productId },
      orderBy: { changedAt: 'desc' },
      include: { changedByUser: { select: { id: true, fullName: true } } },
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      changeType: r.changeType,
      source: r.source,
      reason: r.reason,
      costValue: r.costValue ? r.costValue.toString() : null,
      marginPct: r.marginPct ? r.marginPct.toString() : null,
      oldValue: r.oldValue ? r.oldValue.toString() : null,
      newValue: r.newValue.toString(),
      changedBy: r.changedBy ? r.changedBy.toString() : null,
      changedByName: r.changedByUser?.fullName ?? null,
      changedAt: r.changedAt.toISOString(),
    }));
  }

  /**
   * Actualiza costo/margen/precio/piso del producto.
   *
   * Reglas:
   * - Si solo llega `salePrice`: el margen se recalcula con el costo vigente
   *   (o el `costPrice` enviado).
   * - Si solo llega `marginPct`: el precio se recalcula con el costo vigente
   *   (o el `costPrice` enviado).
   * - Si llegan ambos: deben ser consistentes con el costo (tolerancia
   *   `CONSISTENCY_TOLERANCE`), si no se rechaza con 400.
   * - Si solo llega `costPrice`: el margen se mantiene como intención del
   *   usuario y el precio se recalcula. Si el margen vigente es 0, el precio
   *   se deja como está.
   * - `out_of_margin` se computa contra `min_margin_pct` final.
   *
   * Inserta una fila en `product_price_history` con el snapshot completo
   * (cost_value, margin_pct, new_value=salePrice) y `change_type='SALE'`,
   * `source='MANUAL'`. Audit log lo emite la extensión Prisma.
   *
   * TODO PR-33: el costo NO debería editarse desde acá; vendrá del kardex
   * (promedio ponderado al recibir compras) y la edición manual será un
   * ajuste auditado separado con permiso propio. Para PR-32 se permite la
   * edición manual como valor inicial.
   */
  async updatePricing(
    companyId: bigint,
    userId: bigint,
    productId: bigint,
    data: ParsedUpdatePricing,
  ): Promise<PricingView> {
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.product.findFirst({
        where: { id: productId, companyId, deletedAt: null },
        select: {
          id: true,
          sku: true,
          name: true,
          priceCurrency: true,
          costPrice: true,
          salePrice: true,
          marginPct: true,
          minMarginPct: true,
          outOfMargin: true,
        },
      });
      if (!current) throw new NotFoundException('Producto no encontrado.');

      const oldCost = current.costPrice;
      const oldSale = current.salePrice;
      const oldMargin = current.marginPct;

      const newCost = data.costPrice !== undefined ? new Prisma.Decimal(data.costPrice) : oldCost;
      const newMinMargin =
        data.minMarginPct !== undefined
          ? new Prisma.Decimal(data.minMarginPct)
          : current.minMarginPct;

      // Resolución del trío costo/margen/precio respetando lo enviado.
      let newSale: Prisma.Decimal;
      let newMargin: Prisma.Decimal;

      if (data.salePrice !== undefined && data.marginPct !== undefined) {
        const s = new Prisma.Decimal(data.salePrice);
        const m = new Prisma.Decimal(data.marginPct);
        if (!isConsistent(newCost, s, m)) {
          throw new BadRequestException(
            'salePrice y marginPct enviados no son consistentes con el costo (tolerancia 0.0001).',
          );
        }
        newSale = s.toDecimalPlaces(PRICE_SCALE);
        newMargin = m.toDecimalPlaces(MARGIN_SCALE);
      } else if (data.salePrice !== undefined) {
        const s = new Prisma.Decimal(data.salePrice).toDecimalPlaces(PRICE_SCALE);
        newSale = s;
        try {
          newMargin = marginFromPrice(newCost, s);
        } catch (err) {
          throw new BadRequestException((err as Error).message);
        }
      } else if (data.marginPct !== undefined) {
        const m = new Prisma.Decimal(data.marginPct).toDecimalPlaces(MARGIN_SCALE);
        newMargin = m;
        try {
          newSale = priceFromMargin(newCost, m);
        } catch (err) {
          throw new BadRequestException((err as Error).message);
        }
      } else if (data.costPrice !== undefined) {
        // Solo cambió el costo: mantener margen, recalcular precio si hay margen.
        newMargin = oldMargin;
        if (oldMargin.eq(0)) {
          newSale = oldSale;
        } else {
          try {
            newSale = priceFromMargin(newCost, oldMargin);
          } catch (err) {
            throw new BadRequestException((err as Error).message);
          }
        }
      } else {
        // Solo cambió minMarginPct: precio y margen no se tocan.
        newSale = oldSale;
        newMargin = oldMargin;
      }

      const newOutOfMargin = isOutOfMargin(newMargin, newMinMargin);

      const updated = await tx.product.update({
        where: { id: current.id },
        data: {
          costPrice: newCost,
          salePrice: newSale,
          marginPct: newMargin,
          minMarginPct: newMinMargin,
          outOfMargin: newOutOfMargin,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          sku: true,
          name: true,
          priceCurrency: true,
          costPrice: true,
          salePrice: true,
          marginPct: true,
          minMarginPct: true,
          outOfMargin: true,
        },
      });

      await tx.productPriceHistory.create({
        data: {
          companyId,
          productId: current.id,
          changeType: 'SALE',
          source: 'MANUAL',
          oldValue: oldSale,
          newValue: newSale,
          costValue: newCost,
          marginPct: newMargin,
          reason: data.reason ?? null,
          changedBy: userId,
        },
      });

      return this.toPricingView(updated);
    });
  }

  private toPricingView(row: {
    id: bigint;
    sku: string;
    name: string;
    priceCurrency: string;
    costPrice: Prisma.Decimal;
    salePrice: Prisma.Decimal;
    marginPct: Prisma.Decimal;
    minMarginPct: Prisma.Decimal;
    outOfMargin: boolean;
  }): PricingView {
    return {
      productId: row.id.toString(),
      sku: row.sku,
      name: row.name,
      priceCurrency: row.priceCurrency,
      costPrice: row.costPrice.toString(),
      salePrice: row.salePrice.toString(),
      marginPct: row.marginPct.toString(),
      minMarginPct: row.minMarginPct.toString(),
      outOfMargin: row.outOfMargin,
    };
  }
}
