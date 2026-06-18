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
import { DepartmentsService, DepartmentView } from './departments.service';
import {
  CreateDepartmentBody,
  parseCreateDepartmentBody,
  parseUpdateDepartmentBody,
  UpdateDepartmentBody,
} from './dto/departments.dto';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('departments')
@UseGuards(PermissionsGuard)
export class DepartmentsController {
  constructor(private readonly svc: DepartmentsService) {}

  @Get()
  @RequirePermission('catalogs.department.read')
  async list(@CurrentUser() user: AuthUserContext): Promise<DepartmentView[]> {
    return this.svc.list(user.companyId);
  }

  @Get(':id')
  @RequirePermission('catalogs.department.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<DepartmentView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('catalogs.department.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateDepartmentBody,
  ): Promise<DepartmentView> {
    return this.svc.create(user.companyId, parseCreateDepartmentBody(body));
  }

  @Patch(':id')
  @RequirePermission('catalogs.department.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateDepartmentBody,
  ): Promise<DepartmentView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdateDepartmentBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('catalogs.department.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }
}
