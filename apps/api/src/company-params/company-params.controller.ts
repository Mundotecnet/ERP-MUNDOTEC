import { Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { CompanyParamsService, ParamView } from './company-params.service';
import { parseParamKey, parsePutParamBody, PutParamBody } from './dto/company-params.dto';

/**
 * HU-6.3 — parámetros generales por empresa. Pensado para configuración tipo
 * key/value (prefijos de documentos, formatos, flags). El `value` puede ser
 * cualquier JSON, incluido `null`. La empresa se toma del JWT.
 */
@Controller('params')
@UseGuards(PermissionsGuard)
export class CompanyParamsController {
  constructor(private readonly svc: CompanyParamsService) {}

  @Get()
  @RequirePermission('params.read')
  async list(@CurrentUser() user: AuthUserContext): Promise<ParamView[]> {
    return this.svc.list(user.companyId);
  }

  @Get(':key')
  @RequirePermission('params.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('key') key: string,
  ): Promise<ParamView> {
    return this.svc.getOne(user.companyId, parseParamKey(key));
  }

  /** Upsert: crea si no existe, actualiza si existe. */
  @Put(':key')
  @RequirePermission('params.manage')
  async put(
    @CurrentUser() user: AuthUserContext,
    @Param('key') key: string,
    @Body() body: PutParamBody,
  ): Promise<ParamView> {
    return this.svc.upsert(user.companyId, parseParamKey(key), parsePutParamBody(body));
  }

  @Delete(':key')
  @RequirePermission('params.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('key') key: string): Promise<void> {
    await this.svc.remove(user.companyId, parseParamKey(key));
  }
}
