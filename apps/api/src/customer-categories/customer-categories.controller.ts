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
import { CustomerCategoriesService, CustomerCategoryView } from './customer-categories.service';
import {
  CreateCustomerCategoryBody,
  parseCreateCustomerCategoryBody,
  parseUpdateCustomerCategoryBody,
  UpdateCustomerCategoryBody,
} from './dto/customer-categories.dto';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('customer-categories')
@UseGuards(PermissionsGuard)
export class CustomerCategoriesController {
  constructor(private readonly svc: CustomerCategoriesService) {}

  @Get()
  @RequirePermission('catalogs.customer-category.read')
  async list(@CurrentUser() user: AuthUserContext): Promise<CustomerCategoryView[]> {
    return this.svc.list(user.companyId);
  }

  @Get(':id')
  @RequirePermission('catalogs.customer-category.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<CustomerCategoryView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('catalogs.customer-category.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateCustomerCategoryBody,
  ): Promise<CustomerCategoryView> {
    return this.svc.create(user.companyId, parseCreateCustomerCategoryBody(body));
  }

  @Patch(':id')
  @RequirePermission('catalogs.customer-category.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateCustomerCategoryBody,
  ): Promise<CustomerCategoryView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdateCustomerCategoryBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('catalogs.customer-category.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }
}
