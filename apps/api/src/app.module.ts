import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { BranchesModule } from './branches/branches.module';
import { CompaniesModule } from './companies/companies.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { HealthModule } from './health/health.module';
import { MailerModule } from './mailer/mailer.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { RequestContextInterceptor } from './request-context/request-context.interceptor';
import { RequestContextModule } from './request-context/request-context.module';
import { RolesModule } from './roles/roles.module';
import { TaxesModule } from './taxes/taxes.module';
import { UnitsOfMeasureModule } from './units-of-measure/units-of-measure.module';
import { UsersModule } from './users/users.module';
import { WarehousesModule } from './warehouses/warehouses.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    RequestContextModule,
    PrismaModule,
    MailerModule,
    AuthModule,
    RbacModule,
    HealthModule,
    CompaniesModule,
    BranchesModule,
    WarehousesModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    CurrenciesModule,
    ExchangeRatesModule,
    TaxesModule,
    UnitsOfMeasureModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard global: TODOS los endpoints requieren Bearer access token, salvo
    // los marcados @Public() (login, refresh, health, root).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Interceptor que refresca el RequestContext con el usuario del request
    // antes del handler, para que las extensiones Prisma vean el contexto.
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
})
export class AppModule {}
