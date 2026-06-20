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
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreatePartnerBody,
  ListPartnersQuery,
  parseCreateContactBody,
  parseCreatePartnerBody,
  parseListPartnersQuery,
  parseUpdateContactBody,
  parseUpdatePartnerBody,
  PartnerContactBody,
  UpdatePartnerBody,
} from './dto/partners.dto';
import { PartnerContactView, PartnersService, PartnerView } from './partners.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('partners')
@UseGuards(PermissionsGuard)
export class PartnersController {
  constructor(private readonly svc: PartnersService) {}

  @Get()
  @RequirePermission('partners.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListPartnersQuery,
  ): Promise<PartnerView[]> {
    return this.svc.list(user.companyId, parseListPartnersQuery(query));
  }

  @Get(':id')
  @RequirePermission('partners.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<PartnerView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('partners.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreatePartnerBody,
  ): Promise<PartnerView> {
    return this.svc.create(user.companyId, parseCreatePartnerBody(body));
  }

  @Patch(':id')
  @RequirePermission('partners.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdatePartnerBody,
  ): Promise<PartnerView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdatePartnerBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('partners.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }

  // --- Contactos ---

  @Get(':partnerId/contacts')
  @RequirePermission('partners.read')
  async listContacts(
    @CurrentUser() user: AuthUserContext,
    @Param('partnerId') partnerId: string,
  ): Promise<PartnerContactView[]> {
    return this.svc.listContacts(user.companyId, parseBigIntParam(partnerId, 'partnerId'));
  }

  @Post(':partnerId/contacts')
  @RequirePermission('partners.manage')
  @HttpCode(201)
  async createContact(
    @CurrentUser() user: AuthUserContext,
    @Param('partnerId') partnerId: string,
    @Body() body: PartnerContactBody,
  ): Promise<PartnerContactView> {
    return this.svc.createContact(
      user.companyId,
      parseBigIntParam(partnerId, 'partnerId'),
      parseCreateContactBody(body),
    );
  }

  @Patch(':partnerId/contacts/:contactId')
  @RequirePermission('partners.manage')
  async updateContact(
    @CurrentUser() user: AuthUserContext,
    @Param('partnerId') partnerId: string,
    @Param('contactId') contactId: string,
    @Body() body: PartnerContactBody,
  ): Promise<PartnerContactView> {
    return this.svc.updateContact(
      user.companyId,
      parseBigIntParam(partnerId, 'partnerId'),
      parseBigIntParam(contactId, 'contactId'),
      parseUpdateContactBody(body),
    );
  }

  @Delete(':partnerId/contacts/:contactId')
  @RequirePermission('partners.manage')
  @HttpCode(204)
  async removeContact(
    @CurrentUser() user: AuthUserContext,
    @Param('partnerId') partnerId: string,
    @Param('contactId') contactId: string,
  ): Promise<void> {
    await this.svc.removeContact(
      user.companyId,
      parseBigIntParam(partnerId, 'partnerId'),
      parseBigIntParam(contactId, 'contactId'),
    );
  }
}
