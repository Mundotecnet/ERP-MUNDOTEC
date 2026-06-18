import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  ParsedCreateProductCategory,
  ParsedUpdateProductCategory,
} from './dto/product-categories.dto';

export interface ProductCategoryView {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
}

@Injectable()
export class ProductCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint): Promise<ProductCategoryView[]> {
    const rows = await this.prisma.raw.productCategory.findMany({
      where: { companyId },
      orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<ProductCategoryView> {
    const row = await this.prisma.raw.productCategory.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Categoría no encontrada.');
    return this.toView(row);
  }

  async create(companyId: bigint, data: ParsedCreateProductCategory): Promise<ProductCategoryView> {
    if (data.parentId !== null) {
      await this.assertParentInCompany(companyId, data.parentId);
    }
    const row = await this.prisma.client.productCategory.create({
      data: { companyId, ...data },
    });
    return this.toView(row);
  }

  async update(
    companyId: bigint,
    id: bigint,
    data: ParsedUpdateProductCategory,
  ): Promise<ProductCategoryView> {
    const existing = await this.prisma.raw.productCategory.findFirst({
      where: { id, companyId },
    });
    if (!existing) throw new NotFoundException('Categoría no encontrada.');

    if (data.parentId !== undefined && data.parentId !== null) {
      if (data.parentId === existing.id) {
        throw new BadRequestException('Una categoría no puede ser padre de sí misma.');
      }
      await this.assertParentInCompany(companyId, data.parentId);
      await this.assertNoCycle(companyId, existing.id, data.parentId);
    }

    const row = await this.prisma.client.productCategory.update({
      where: { id: existing.id },
      data,
    });
    return this.toView(row);
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.productCategory.findFirst({
      where: { id, companyId },
      include: { _count: { select: { children: true } } },
    });
    if (!existing) throw new NotFoundException('Categoría no encontrada.');
    if (existing._count.children > 0) {
      throw new ConflictException(
        'No se puede eliminar una categoría con subcategorías. ' +
          'Reasigna o elimina las subcategorías primero.',
      );
    }
    await this.prisma.client.productCategory.delete({ where: { id: existing.id } });
  }

  private async assertParentInCompany(companyId: bigint, parentId: bigint): Promise<void> {
    const parent = await this.prisma.raw.productCategory.findFirst({
      where: { id: parentId, companyId },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException(
        `La categoría padre ${parentId.toString()} no existe o no pertenece a esta empresa.`,
      );
    }
  }

  /**
   * Recorre la cadena ascendente desde `newParentId`; si llega a `nodeId`,
   * crear esa relación crearía un ciclo. Para un árbol con n nodos el ciclo
   * detectable es O(n).
   */
  private async assertNoCycle(
    companyId: bigint,
    nodeId: bigint,
    newParentId: bigint,
  ): Promise<void> {
    let cursor: bigint | null = newParentId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (cursor === nodeId) {
        throw new BadRequestException('El cambio de "parentId" formaría un ciclo en la jerarquía.');
      }
      const key = cursor.toString();
      if (seen.has(key)) {
        // Salvaguarda contra ciclos preexistentes en datos corruptos.
        throw new BadRequestException(
          'La jerarquía actual contiene un ciclo; corrija los datos antes de continuar.',
        );
      }
      seen.add(key);
      const parent: { parentId: bigint | null } | null =
        await this.prisma.raw.productCategory.findFirst({
          where: { id: cursor, companyId },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
  }

  private toView(row: {
    id: bigint;
    name: string;
    parentId: bigint | null;
    isActive: boolean;
  }): ProductCategoryView {
    return {
      id: row.id.toString(),
      name: row.name,
      parentId: row.parentId === null ? null : row.parentId.toString(),
      isActive: row.isActive,
    };
  }
}
