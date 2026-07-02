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
  CreateUserBody,
  ListUsersQuery,
  parseCreateUserBody,
  parseListUsersQuery,
  parseReplaceUserBranches,
  parseReplaceUserRoles,
  parseUpdateUserBody,
  ReplaceUserBranchesBody,
  ReplaceUserRolesBody,
  UpdateUserBody,
} from './dto/users.dto';
import { PaginatedUsers, UserBranchesView, UsersService, UserView } from './users.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  @RequirePermission('users.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListUsersQuery,
  ): Promise<PaginatedUsers> {
    return this.svc.list(user.companyId, parseListUsersQuery(query));
  }

  /**
   * Sucursales operables por el usuario logueado (útil para inyectar en
   * cabeceras/estado del cliente). Con `branch.access_all` devuelve todas
   * las activas de la empresa. Sin ese permiso, las de `user_branch`.
   */
  @Get('me/branches')
  @RequirePermission('branch.read')
  async myBranches(@CurrentUser() user: AuthUserContext): Promise<UserBranchesView> {
    return this.svc.getBranchesFor(user.companyId, user.userId);
  }

  @Get(':id')
  @RequirePermission('users.read')
  async getOne(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<UserView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Get(':id/branches')
  @RequirePermission('users.read')
  async userBranches(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<UserBranchesView> {
    return this.svc.getBranchesFor(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('users.create')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateUserBody,
  ): Promise<UserView> {
    return this.svc.create(user.companyId, parseCreateUserBody(body));
  }

  @Patch(':id')
  @RequirePermission('users.update')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateUserBody,
  ): Promise<UserView> {
    return this.svc.update(user.companyId, parseBigIntParam(id, 'id'), parseUpdateUserBody(body));
  }

  @Delete(':id')
  @RequirePermission('users.delete')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }

  /**
   * Reemplaza el conjunto completo de roles del usuario. Permiso separado
   * para granularidad: un admin puede tener `users.update` (edita datos) pero
   * NO `users.assign-roles` (no escala permisos a otros).
   */
  @Put(':id/roles')
  @RequirePermission('users.assign-roles')
  async replaceRoles(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: ReplaceUserRolesBody,
  ): Promise<UserView> {
    const roleIds = parseReplaceUserRoles(body);
    return this.svc.replaceRoles(user.companyId, parseBigIntParam(id, 'id'), roleIds);
  }

  /**
   * Reemplaza el conjunto de sucursales asignadas al usuario y (opcional) el
   * defaultBranchId. Reutiliza el permiso `users.update` para no explotar la
   * matriz RBAC — quien puede editar el usuario también puede reasignarle
   * sucursales.
   */
  @Put(':id/branches')
  @RequirePermission('users.update')
  async replaceBranches(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: ReplaceUserBranchesBody,
  ): Promise<UserBranchesView> {
    return this.svc.replaceBranches(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseReplaceUserBranches(body),
    );
  }
}
