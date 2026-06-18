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

import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreateUomBody,
  parseCreateUomBody,
  parseUpdateUomBody,
  UpdateUomBody,
} from './dto/units-of-measure.dto';
import { UnitsOfMeasureService, UomView } from './units-of-measure.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('units-of-measure')
@UseGuards(PermissionsGuard)
export class UnitsOfMeasureController {
  constructor(private readonly svc: UnitsOfMeasureService) {}

  @Get()
  @RequirePermission('catalogs.uom.read')
  async list(): Promise<UomView[]> {
    return this.svc.list();
  }

  @Get(':id')
  @RequirePermission('catalogs.uom.read')
  async getOne(@Param('id') id: string): Promise<UomView> {
    return this.svc.getOne(parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('catalogs.uom.manage')
  @HttpCode(201)
  async create(@Body() body: CreateUomBody): Promise<UomView> {
    return this.svc.create(parseCreateUomBody(body));
  }

  @Patch(':id')
  @RequirePermission('catalogs.uom.manage')
  async update(@Param('id') id: string, @Body() body: UpdateUomBody): Promise<UomView> {
    return this.svc.update(parseBigIntParam(id, 'id'), parseUpdateUomBody(body));
  }

  @Delete(':id')
  @RequirePermission('catalogs.uom.manage')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(parseBigIntParam(id, 'id'));
  }
}
