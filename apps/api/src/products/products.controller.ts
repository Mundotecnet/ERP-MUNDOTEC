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
  CreateProductBody,
  parseCreateProductBody,
  parseUpdateProductBody,
  UpdateProductBody,
} from './dto/products.dto';
import { ProductsService, ProductView } from './products.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('products')
@UseGuards(PermissionsGuard)
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Get()
  @RequirePermission('catalogs.product.read')
  async list(@CurrentUser() user: AuthUserContext): Promise<ProductView[]> {
    return this.svc.list(user.companyId);
  }

  @Get(':id')
  @RequirePermission('catalogs.product.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<ProductView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('catalogs.product.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateProductBody,
  ): Promise<ProductView> {
    return this.svc.create(user.companyId, parseCreateProductBody(body));
  }

  @Patch(':id')
  @RequirePermission('catalogs.product.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateProductBody,
  ): Promise<ProductView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdateProductBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('catalogs.product.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }
}
