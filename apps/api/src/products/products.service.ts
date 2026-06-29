import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateProduct, ParsedUpdateProduct } from './dto/products.dto';
import { PricingService } from './pricing/pricing.service';

export interface ProductView {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  uomId: string;
  taxId: string | null;
  costPrice: string;
  salePrice: string;
  marginPct: string;
  minMarginPct: string;
  outOfMargin: boolean;
  priceCurrency: string;
  isInventoried: boolean;
  trackingType: string;
  warrantyMonths: number;
  minStock: string;
  maxStock: string;
  isActive: boolean;
  departmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProductRow {
  id: bigint;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: bigint | null;
  uomId: bigint;
  taxId: bigint | null;
  costPrice: Prisma.Decimal;
  salePrice: Prisma.Decimal;
  marginPct: Prisma.Decimal;
  minMarginPct: Prisma.Decimal;
  outOfMargin: boolean;
  priceCurrency: string;
  isInventoried: boolean;
  trackingType: string;
  warrantyMonths: number;
  minStock: Prisma.Decimal;
  maxStock: Prisma.Decimal;
  isActive: boolean;
  departmentId: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async list(companyId: bigint): Promise<ProductView[]> {
    const rows = await this.prisma.raw.product.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<ProductView> {
    const row = await this.prisma.raw.product.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Producto no encontrado.');
    return this.toView(row);
  }

  async create(companyId: bigint, data: ParsedCreateProduct): Promise<ProductView> {
    await this.assertReferencesValid(companyId, {
      categoryId: data.categoryId,
      uomId: data.uomId,
      taxId: data.taxId,
      departmentId: data.departmentId,
      priceCurrency: data.priceCurrency,
    });
    // PR-39 + follow-up: asegura la fila de secuencia y RESERVA el SKU FUERA
    // de la tx interactiva, ambas con autocommit.
    //
    // - `ensureSkuSequenceRow` es un INSERT ON CONFLICT DO NOTHING idempotente.
    // - `reserveProductSku` es un UPDATE ... RETURNING atómico. Postgres
    //   aplica un row-lock implícito mientras dura el statement; en autocommit
    //   el lock se libera inmediatamente al terminar el query (no se sostiene
    //   hasta el final de la tx principal).
    //
    // Si la tx principal falla, el SKU asignado queda "saltado" en la
    // secuencia. Aceptable porque el SKU no es un número fiscal regulado.
    //
    // Beneficio: bajo concurrencia (N POST simultáneos sobre la misma empresa),
    // las N tx interactivas ya no se serializan sobre el row-lock de la
    // secuencia + audit_log writes concurrentes — antes saturaba el connection
    // pool (timeout P2024). Ver fix/audit-tx-pool / discusión en PR.
    await this.ensureSkuSequenceRow(companyId);
    const sku = await this.reserveProductSku(companyId);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.product.create({
          data: { companyId, sku, ...data, updatedAt: new Date() },
        });
        await this.pricing.ensureProductPriceLevels(tx, companyId, row.id);
        return this.toView(row);
      });
    } catch (err) {
      this.translatePrismaError(err);
    }
  }

  /**
   * PR-39 — inicializa la fila de secuencia PRODUCT_SKU para la empresa
   * arrancando en 100000. Idempotente (ON CONFLICT DO NOTHING). Autocommit:
   * la fila queda persistida apenas termine el statement.
   */
  private async ensureSkuSequenceRow(companyId: bigint): Promise<void> {
    await this.prisma.client.$executeRaw`
      INSERT INTO "document_sequence" ("company_id", "sequence_type", "next_value", "updated_at")
      VALUES (${companyId}, 'PRODUCT_SKU', 100000, now())
      ON CONFLICT ("company_id", "sequence_type") DO NOTHING
    `;
  }

  /**
   * PR-39 — reserva el siguiente SKU autoincremental para la empresa.
   *
   * Patrón atómico: `UPDATE ... SET next_value = next_value + 1 ... RETURNING
   * next_value - 1`. Postgres adquiere un row-lock implícito sobre la fila
   * actualizada **mientras dura el statement**; en autocommit el lock se
   * libera al terminar el UPDATE, no se sostiene hasta el final de la tx
   * principal del producto. Esto elimina la presión sobre el pool de
   * conexiones cuando hay N POST concurrentes sobre la misma empresa.
   *
   * Nunca usar MAX(sku)+1: en alta concurrencia dos tx leerían el mismo MAX y
   * duplicarían.
   *
   * Requiere que `ensureSkuSequenceRow(companyId)` ya haya corrido.
   */
  private async reserveProductSku(companyId: bigint): Promise<string> {
    const rows = await this.prisma.client.$queryRaw<{ assigned: bigint }[]>`
      UPDATE "document_sequence"
         SET "next_value" = "next_value" + 1,
             "updated_at" = now()
       WHERE "company_id" = ${companyId} AND "sequence_type" = 'PRODUCT_SKU'
      RETURNING ("next_value" - 1) AS assigned
    `;
    const assigned = rows[0]?.assigned;
    if (assigned === undefined) {
      throw new Error('No se pudo asignar SKU automático (secuencia inexistente).');
    }
    return assigned.toString();
  }

  async update(companyId: bigint, id: bigint, data: ParsedUpdateProduct): Promise<ProductView> {
    const existing = await this.prisma.raw.product.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Producto no encontrado.');

    await this.assertReferencesValid(companyId, {
      categoryId: data.categoryId,
      uomId: data.uomId,
      taxId: data.taxId,
      departmentId: data.departmentId,
      priceCurrency: data.priceCurrency,
    });

    try {
      const row = await this.prisma.client.product.update({
        where: { id: existing.id },
        data: { ...data, updatedAt: new Date() },
      });
      return this.toView(row);
    } catch (err) {
      this.translatePrismaError(err);
    }
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.product.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Producto no encontrado.');
    // La extensión softDelete convierte el delete en update({ deletedAt: now() }).
    await this.prisma.client.product.delete({ where: { id: existing.id } });
  }

  private async assertReferencesValid(
    companyId: bigint,
    refs: {
      categoryId?: bigint | null;
      uomId?: bigint;
      taxId?: bigint | null;
      departmentId?: bigint | null;
      priceCurrency?: string;
    },
  ): Promise<void> {
    if (refs.categoryId !== undefined && refs.categoryId !== null) {
      const cat = await this.prisma.raw.productCategory.findFirst({
        where: { id: refs.categoryId, companyId },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException(
          `La categoría ${refs.categoryId.toString()} no existe o no pertenece a esta empresa.`,
        );
      }
    }
    if (refs.uomId !== undefined) {
      const uom = await this.prisma.raw.unitOfMeasure.findUnique({
        where: { id: refs.uomId },
        select: { id: true },
      });
      if (!uom) {
        throw new BadRequestException(`La unidad de medida ${refs.uomId.toString()} no existe.`);
      }
    }
    if (refs.taxId !== undefined && refs.taxId !== null) {
      const tax = await this.prisma.raw.tax.findFirst({
        where: { id: refs.taxId, companyId },
        select: { id: true },
      });
      if (!tax) {
        throw new BadRequestException(
          `El impuesto ${refs.taxId.toString()} no existe o no pertenece a esta empresa.`,
        );
      }
    }
    if (refs.departmentId !== undefined && refs.departmentId !== null) {
      const dep = await this.prisma.raw.department.findFirst({
        where: { id: refs.departmentId, companyId },
        select: { id: true },
      });
      if (!dep) {
        throw new BadRequestException(
          `El departamento ${refs.departmentId.toString()} no existe o no pertenece a esta empresa.`,
        );
      }
    }
    if (refs.priceCurrency !== undefined) {
      const currency = await this.prisma.raw.currency.findUnique({
        where: { code: refs.priceCurrency },
        select: { code: true },
      });
      if (!currency) {
        throw new BadRequestException(
          `La moneda "${refs.priceCurrency}" no existe en el catálogo de monedas.`,
        );
      }
    }
  }

  private translatePrismaError(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe un producto con ese SKU en esta empresa.');
    }
    throw err as Error;
  }

  private toView(row: ProductRow): ProductView {
    return {
      id: row.id.toString(),
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      description: row.description,
      categoryId: row.categoryId === null ? null : row.categoryId.toString(),
      uomId: row.uomId.toString(),
      taxId: row.taxId === null ? null : row.taxId.toString(),
      costPrice: row.costPrice.toString(),
      salePrice: row.salePrice.toString(),
      marginPct: row.marginPct.toString(),
      minMarginPct: row.minMarginPct.toString(),
      outOfMargin: row.outOfMargin,
      priceCurrency: row.priceCurrency,
      isInventoried: row.isInventoried,
      trackingType: row.trackingType,
      warrantyMonths: row.warrantyMonths,
      minStock: row.minStock.toString(),
      maxStock: row.maxStock.toString(),
      isActive: row.isActive,
      departmentId: row.departmentId === null ? null : row.departmentId.toString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
