import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { CompaniesService, CompanyView } from './companies.service';
import { parseUpdateCompanyBody, UpdateCompanyBody } from './dto/update-company.dto';

@Controller('companies')
@UseGuards(PermissionsGuard)
export class CompaniesController {
  constructor(private readonly svc: CompaniesService) {}

  @Get('current')
  @RequirePermission('company.read')
  async getCurrent(@CurrentUser() user: AuthUserContext): Promise<CompanyView> {
    return this.svc.getById(user.companyId);
  }

  @Patch('current')
  @RequirePermission('company.update')
  async updateCurrent(
    @CurrentUser() user: AuthUserContext,
    @Body() body: UpdateCompanyBody,
  ): Promise<CompanyView> {
    const data = parseUpdateCompanyBody(body);
    return this.svc.update(user.companyId, data);
  }
}
