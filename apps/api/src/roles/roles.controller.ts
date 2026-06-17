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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreateRoleBody,
  ListRolesQuery,
  parseCreateRoleBody,
  parseListRolesQuery,
  parseReplaceRolePermissions,
  parseUpdateRoleBody,
  ReplaceRolePermissionsBody,
  UpdateRoleBody,
} from './dto/roles.dto';
import { PaginatedRoles, RolesService, RoleView } from './roles.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('roles')
@UseGuards(PermissionsGuard)
export class RolesController {
  constructor(private readonly svc: RolesService) {}

  @Get()
  @RequirePermission('roles.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListRolesQuery,
  ): Promise<PaginatedRoles> {
    return this.svc.list(user.companyId, parseListRolesQuery(query));
  }

  @Get(':id')
  @RequirePermission('roles.read')
  async getOne(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<RoleView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('roles.create')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateRoleBody,
  ): Promise<RoleView> {
    return this.svc.create(user.companyId, parseCreateRoleBody(body));
  }

  @Patch(':id')
  @RequirePermission('roles.update')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateRoleBody,
  ): Promise<RoleView> {
    return this.svc.update(user.companyId, parseBigIntParam(id, 'id'), parseUpdateRoleBody(body));
  }

  @Delete(':id')
  @RequirePermission('roles.delete')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }

  /** Reemplaza el conjunto completo de permisos del rol. */
  @Put(':id/permissions')
  @RequirePermission('roles.update')
  async replacePermissions(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: ReplaceRolePermissionsBody,
  ): Promise<RoleView> {
    const codes = parseReplaceRolePermissions(body);
    return this.svc.replacePermissions(user.companyId, parseBigIntParam(id, 'id'), codes);
  }
}
