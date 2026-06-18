import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreateProductCategoryBody,
  parseCreateProductCategoryBody,
  parseUpdateProductCategoryBody,
  UpdateProductCategoryBody,
} from './dto/product-categories.dto';
import { ProductCategoriesService, ProductCategoryView } from './product-categories.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('product-categories')
@UseGuards(PermissionsGuard)
export class ProductCategoriesController {
  constructor(private readonly svc: ProductCategoriesService) {}

  @Get()
  @RequirePermission('catalogs.product-category.read')
  async list(@CurrentUser() user: AuthUserContext): Promise<ProductCategoryView[]> {
    return this.svc.list(user.companyId);
  }

  @Get(':id')
  @RequirePermission('catalogs.product-category.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<ProductCategoryView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('catalogs.product-category.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateProductCategoryBody,
  ): Promise<ProductCategoryView> {
    return this.svc.create(user.companyId, parseCreateProductCategoryBody(body));
  }

  @Patch(':id')
  @RequirePermission('catalogs.product-category.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateProductCategoryBody,
  ): Promise<ProductCategoryView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdateProductCategoryBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('catalogs.product-category.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }
}
