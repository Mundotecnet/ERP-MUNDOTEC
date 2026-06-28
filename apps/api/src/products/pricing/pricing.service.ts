import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ParsedUpdatePricing, ParsedUpdatePricingLevel } from './pricing.dto';
import {
  isConsistent,
  isOutOfMargin,
  marginFromPrice,
  priceFromMargin,
  roundPrice,
} from './pricing.formula';

// HU-11.2 / PR-34 — Precios con 3 niveles fijos.
//
// Nomenclatura de las listas: por empresa hay 3 price_list seedeadas con
// nombres "Precio 1", "Precio 2", "Precio 3" (list_type='SALE'). Cada
// producto tiene 3 price_list_item, uno por nivel, con su propio
// (margin_pct, price). El costo y el min_margin_pct viven en el producto.
//
// El nivel "Precio 1" se considera por defecto: su (price, margin_pct) se
// sincroniza con product.sale_price y product.margin_pct para no romper a
// los consumidores legacy (listado de productos, vista v_web_catalog).
//
// product.out_of_margin pasa a ser AGREGADO: true si CUALQUIER nivel tiene
// margin < min_margin_pct. Por fila también persistimos
// price_list_item.out_of_margin (preparado para el utilitario operativo
// de req §5 que vendrá después).

export const PRICE_LEVEL_NAMES = ['Precio 1', 'Precio 2', 'Precio 3'] as const;
export type PriceLevelName = (typeof PRICE_LEVEL_NAMES)[number];
export const DEFAULT_LEVEL_NAME: PriceLevelName = 'Precio 1';

export interface PricingLevelView {
  priceListId: string;
  name: string;
  salePrice: string;
  marginPct: string;
  outOfMargin: boolean;
}

export interface PricingView {
  productId: string;
  sku: string;
  name: string;
  priceCurrency: string;
  costPrice: string;
  minMarginPct: string;
  outOfMargin: boolean;
  levels: PricingLevelView[];
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
  priceListId: string | null;
  priceListName: string | null;
  changedAt: string;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Asegura que la empresa tenga sus 3 listas P1/P2/P3 (idempotente).
   * Devuelve las 3 listas en el orden P1, P2, P3.
   *
   * Aunque el seed/migración ya las crea para empresas existentes, las
   * empresas creadas en runtime (tests o nuevas tenants) las necesitan
   * antes de poder asignar items.
   */
  async ensureCompanyPriceLists(
    tx: Tx,
    companyId: bigint,
  ): Promise<{ id: bigint; name: string }[]> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { currencyCode: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    for (const name of PRICE_LEVEL_NAMES) {
      await tx.priceList.upsert({
        where: { companyId_name: { companyId, name } },
        create: {
          companyId,
          name,
          currencyCode: company.currencyCode,
          listType: 'SALE',
          isActive: true,
        },
        update: {},
      });
    }
    const lists = await tx.priceList.findMany({
      where: { companyId, name: { in: [...PRICE_LEVEL_NAMES] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return lists;
  }

  /**
   * Asegura que el producto tenga sus 3 price_list_item (idempotente).
   * Los items faltantes se crean con price=product.sale_price y
   * margin_pct=product.margin_pct para preservar el valor único legacy.
   */
  async ensureProductPriceLevels(tx: Tx, companyId: bigint, productId: bigint): Promise<void> {
    const lists = await this.ensureCompanyPriceLists(tx, companyId);
    const existing = await tx.priceListItem.findMany({
      where: {
        productId,
        priceListId: { in: lists.map((l) => l.id) },
        minQuantity: new Prisma.Decimal(1),
      },
      select: { priceListId: true },
    });
    const existingIds = new Set(existing.map((e) => e.priceListId.toString()));
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { salePrice: true, marginPct: true, minMarginPct: true },
    });
    const baseOoM = product.minMarginPct.gt(0) && product.marginPct.lt(product.minMarginPct);
    for (const l of lists) {
      if (existingIds.has(l.id.toString())) continue;
      await tx.priceListItem.create({
        data: {
          priceListId: l.id,
          productId,
          price: product.salePrice,
          minQuantity: 1,
          marginPct: product.marginPct,
          outOfMargin: baseOoM,
        },
      });
    }
  }

  async getPricing(companyId: bigint, productId: bigint): Promise<PricingView> {
    // Auto-seed defensivo: si por alguna razón faltan items (producto
    // creado fuera del flujo nuestro) los creamos antes de leer.
    return this.prisma.client.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, companyId, deletedAt: null },
        select: {
          id: true,
          sku: true,
          name: true,
          priceCurrency: true,
          costPrice: true,
          minMarginPct: true,
          outOfMargin: true,
        },
      });
      if (!product) throw new NotFoundException('Producto no encontrado.');
      await this.ensureProductPriceLevels(tx, companyId, product.id);

      const items = await tx.priceListItem.findMany({
        where: {
          productId: product.id,
          minQuantity: new Prisma.Decimal(1),
          priceList: {
            companyId,
            name: { in: [...PRICE_LEVEL_NAMES] },
          },
        },
        include: { priceList: { select: { id: true, name: true } } },
      });
      const byName = new Map<string, (typeof items)[number]>();
      items.forEach((it) => byName.set(it.priceList.name, it));

      const levels: PricingLevelView[] = PRICE_LEVEL_NAMES.map((n) => {
        const it = byName.get(n);
        if (!it) {
          // Esto no debería pasar tras ensureProductPriceLevels.
          throw new Error(`Falta el item de la lista "${n}".`);
        }
        return {
          priceListId: it.priceList.id.toString(),
          name: it.priceList.name,
          salePrice: it.price.toString(),
          marginPct: it.marginPct.toString(),
          outOfMargin: it.outOfMargin,
        };
      });

      return {
        productId: product.id.toString(),
        sku: product.sku,
        name: product.name,
        priceCurrency: product.priceCurrency,
        costPrice: product.costPrice.toString(),
        minMarginPct: product.minMarginPct.toString(),
        outOfMargin: product.outOfMargin,
        levels,
      };
    });
  }

  async getHistory(companyId: bigint, productId: bigint): Promise<PricingHistoryEntry[]> {
    const product = await this.prisma.raw.product.findFirst({
      where: { id: productId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado.');

    const rows = await this.prisma.raw.productPriceHistory.findMany({
      where: { companyId, productId },
      orderBy: { changedAt: 'desc' },
      include: {
        changedByUser: { select: { id: true, fullName: true } },
        priceList: { select: { id: true, name: true } },
      },
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
      priceListId: r.priceListId ? r.priceListId.toString() : null,
      priceListName: r.priceList?.name ?? null,
      changedAt: r.changedAt.toISOString(),
    }));
  }

  /**
   * Actualiza costo / min_margin / niveles del producto.
   *
   * Reglas por nivel (igual fórmula que PR-32):
   * - Solo `salePrice`: margen se recalcula con el costo final.
   * - Solo `marginPct`: precio se recalcula con el costo final.
   * - Ambos: deben ser consistentes (tolerancia 0.0001) con el costo final.
   *
   * Si solo cambia el costo (sin niveles enviados): para cada nivel con
   * `margin_pct > 0` se recalcula el precio manteniendo su margen vigente.
   *
   * El nivel "Precio 1" se sincroniza a product.sale_price + product.margin_pct.
   * product.out_of_margin = OR de los out_of_margin de los 3 niveles.
   *
   * Historial:
   * - Una fila por nivel modificado (change_type='SALE', source='MANUAL',
   *   price_list_id seteado).
   * - Si cambia el costo, una fila adicional con change_type='COST',
   *   price_list_id=NULL.
   *
   * TODO PR-33+: el costo dejará de editarse desde acá y vendrá del kardex
   * (promedio ponderado al recibir compras). La edición manual será un
   * ajuste auditado con permiso propio. Tampoco se implementa acá todavía
   * el recálculo automático del precio al confirmar una recepción.
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
      await this.ensureProductPriceLevels(tx, companyId, current.id);

      const oldCost = current.costPrice;
      const newCost = data.costPrice !== undefined ? new Prisma.Decimal(data.costPrice) : oldCost;
      const newMinMargin =
        data.minMarginPct !== undefined
          ? new Prisma.Decimal(data.minMarginPct)
          : current.minMarginPct;
      const costChanged = !newCost.eq(oldCost);

      // Carga los 3 items vigentes.
      const items = await tx.priceListItem.findMany({
        where: {
          productId: current.id,
          minQuantity: new Prisma.Decimal(1),
          priceList: { companyId, name: { in: [...PRICE_LEVEL_NAMES] } },
        },
        include: { priceList: { select: { id: true, name: true } } },
      });
      const itemsByListId = new Map<string, (typeof items)[number]>();
      items.forEach((it) => itemsByListId.set(it.priceList.id.toString(), it));
      const itemsByName = new Map<string, (typeof items)[number]>();
      items.forEach((it) => itemsByName.set(it.priceList.name, it));

      // Validar que cada priceListId enviado pertenezca al tenant + sea P1/P2/P3.
      const updatesByListId = new Map<string, ParsedUpdatePricingLevel>();
      for (const lvl of data.levels ?? []) {
        const key = lvl.priceListId.toString();
        if (!itemsByListId.has(key)) {
          throw new BadRequestException(
            `priceListId ${key} no pertenece a este producto o no es un nivel válido.`,
          );
        }
        updatesByListId.set(key, lvl);
      }

      // Resolver por cada nivel (sea o no enviado): si vino algo, aplica
      // la fórmula bidireccional; si solo cambió el costo, recalcula
      // precio respetando el margen vigente (cuando margin > 0).
      type Resolved = {
        item: (typeof items)[number];
        newSale: Prisma.Decimal;
        newMargin: Prisma.Decimal;
        changed: boolean;
      };
      // PR-35: el precio de venta SIEMPRE se redondea a PRICE_SCALE (2 dec).
      // El margen guardado es el efectivo del precio redondeado — garantiza
      // que (cost, margin, price) siempre cuadren tras el round.
      const resolved: Resolved[] = items.map((it) => {
        const lvl = updatesByListId.get(it.priceList.id.toString());
        const oldSale = it.price;
        const oldMargin = it.marginPct;
        let newSale: Prisma.Decimal;
        let newMargin: Prisma.Decimal;

        if (lvl && lvl.salePrice !== undefined && lvl.marginPct !== undefined) {
          const sIn = new Prisma.Decimal(lvl.salePrice);
          const mIn = new Prisma.Decimal(lvl.marginPct);
          if (!isConsistent(newCost, sIn, mIn)) {
            throw new BadRequestException(
              `${it.priceList.name}: salePrice y marginPct no son consistentes con el costo tras el redondeo del precio a 2 decimales.`,
            );
          }
          newSale = roundPrice(sIn);
          // Aún cuando el cliente envía el margen "intencional", guardamos
          // el efectivo del precio redondeado para mantener el invariante.
          try {
            newMargin = marginFromPrice(newCost, newSale);
          } catch (err) {
            throw new BadRequestException(`${it.priceList.name}: ${(err as Error).message}`);
          }
        } else if (lvl && lvl.salePrice !== undefined) {
          newSale = roundPrice(new Prisma.Decimal(lvl.salePrice));
          try {
            newMargin = marginFromPrice(newCost, newSale);
          } catch (err) {
            throw new BadRequestException(`${it.priceList.name}: ${(err as Error).message}`);
          }
        } else if (lvl && lvl.marginPct !== undefined) {
          const m = new Prisma.Decimal(lvl.marginPct);
          try {
            // priceFromMargin ya redondea a PRICE_SCALE.
            newSale = priceFromMargin(newCost, m);
            // Margen efectivo del precio redondeado (no el intencional).
            newMargin = marginFromPrice(newCost, newSale);
          } catch (err) {
            throw new BadRequestException(`${it.priceList.name}: ${(err as Error).message}`);
          }
        } else if (costChanged && oldMargin.gt(0)) {
          // Costo cambió sin tocar este nivel: mantener intención del margen
          // vigente y recalcular precio (redondeado). Margen guardado es el
          // efectivo del precio redondeado.
          try {
            newSale = priceFromMargin(newCost, oldMargin);
            newMargin = marginFromPrice(newCost, newSale);
          } catch (err) {
            throw new BadRequestException(`${it.priceList.name}: ${(err as Error).message}`);
          }
        } else {
          // Sin cambios para este nivel.
          newSale = oldSale;
          newMargin = oldMargin;
        }

        const changed = !newSale.eq(oldSale) || !newMargin.eq(oldMargin);
        return { item: it, newSale, newMargin, changed };
      });

      // Computar out_of_margin por fila y agregado a nivel producto.
      const resolvedWithFlag = resolved.map((r) => ({
        ...r,
        outOfMargin: isOutOfMargin(r.newMargin, newMinMargin),
      }));
      const productOutOfMargin = resolvedWithFlag.some((r) => r.outOfMargin);

      // Aplicar updates: items + producto (sincronizando snapshot P1).
      for (const r of resolvedWithFlag) {
        await tx.priceListItem.update({
          where: { id: r.item.id },
          data: { price: r.newSale, marginPct: r.newMargin, outOfMargin: r.outOfMargin },
        });
      }
      const p1 =
        resolvedWithFlag.find((r) => r.item.priceList.name === DEFAULT_LEVEL_NAME) ??
        resolvedWithFlag[0];
      await tx.product.update({
        where: { id: current.id },
        data: {
          costPrice: newCost,
          // Snapshot de P1 para consumidores legacy (listado, v_web_catalog).
          salePrice: p1.newSale,
          marginPct: p1.newMargin,
          minMarginPct: newMinMargin,
          outOfMargin: productOutOfMargin,
          updatedAt: new Date(),
        },
      });

      // Historial: una fila por nivel cambiado + opcional COST.
      if (costChanged) {
        await tx.productPriceHistory.create({
          data: {
            companyId,
            productId: current.id,
            changeType: 'COST',
            source: 'MANUAL',
            oldValue: oldCost,
            newValue: newCost,
            costValue: newCost,
            marginPct: null,
            priceListId: null,
            reason: data.reason ?? null,
            changedBy: userId,
          },
        });
      }
      for (const r of resolvedWithFlag) {
        if (!r.changed) continue;
        await tx.productPriceHistory.create({
          data: {
            companyId,
            productId: current.id,
            changeType: 'SALE',
            source: 'MANUAL',
            oldValue: r.item.price,
            newValue: r.newSale,
            costValue: newCost,
            marginPct: r.newMargin,
            priceListId: r.item.priceList.id,
            reason: data.reason ?? null,
            changedBy: userId,
          },
        });
      }

      // Devolver vista hidratada (releemos vía getPricing dentro de la misma tx).
      const fresh = await tx.product.findUniqueOrThrow({
        where: { id: current.id },
        select: {
          id: true,
          sku: true,
          name: true,
          priceCurrency: true,
          costPrice: true,
          minMarginPct: true,
          outOfMargin: true,
        },
      });
      const freshItems = await tx.priceListItem.findMany({
        where: {
          productId: current.id,
          minQuantity: new Prisma.Decimal(1),
          priceList: { companyId, name: { in: [...PRICE_LEVEL_NAMES] } },
        },
        include: { priceList: { select: { id: true, name: true } } },
      });
      const freshByName = new Map<string, (typeof freshItems)[number]>();
      freshItems.forEach((it) => freshByName.set(it.priceList.name, it));
      return {
        productId: fresh.id.toString(),
        sku: fresh.sku,
        name: fresh.name,
        priceCurrency: fresh.priceCurrency,
        costPrice: fresh.costPrice.toString(),
        minMarginPct: fresh.minMarginPct.toString(),
        outOfMargin: fresh.outOfMargin,
        levels: PRICE_LEVEL_NAMES.map((n) => {
          const it = freshByName.get(n)!;
          return {
            priceListId: it.priceList.id.toString(),
            name: it.priceList.name,
            salePrice: it.price.toString(),
            marginPct: it.marginPct.toString(),
            outOfMargin: it.outOfMargin,
          };
        }),
      };
    });
  }
}
