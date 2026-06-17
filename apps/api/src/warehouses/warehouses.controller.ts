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
  CreateWarehouseBody,
  parseCreateWarehouseBody,
  parseUpdateWarehouseBody,
  UpdateWarehouseBody,
} from './dto/warehouses.dto';
import { WarehousesService, WarehouseView } from './warehouses.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('warehouses')
@UseGuards(PermissionsGuard)
export class WarehousesController {
  constructor(private readonly svc: WarehousesService) {}

  @Get()
  @RequirePermission('warehouses.read')
  async list(@CurrentUser() user: AuthUserContext): Promise<WarehouseView[]> {
    return this.svc.list(user.companyId);
  }

  @Get(':id')
  @RequirePermission('warehouses.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<WarehouseView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('warehouses.create')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateWarehouseBody,
  ): Promise<WarehouseView> {
    return this.svc.create(user.companyId, parseCreateWarehouseBody(body));
  }

  @Patch(':id')
  @RequirePermission('warehouses.update')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateWarehouseBody,
  ): Promise<WarehouseView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdateWarehouseBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('warehouses.delete')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }
}
