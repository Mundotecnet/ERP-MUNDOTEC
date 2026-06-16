import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { AdminCompaniesModule } from './admin/companies/admin-companies.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { HealthModule } from './health/health.module';
import { MailerModule } from './mailer/mailer.module';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { RequestContextModule } from './request-context/request-context.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    RequestContextModule,
    PrismaModule,
    MailerModule,
    AuthModule,
    RbacModule,
    HealthModule,
    AdminCompaniesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard global: TODOS los endpoints requieren Bearer access token, salvo
    // los marcados @Public() (login, refresh, health, root).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
