import { Module } from '@nestjs/common';
import { AdminCompaniesModule } from './admin/companies/admin-companies.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { RequestContextModule } from './request-context/request-context.module';

@Module({
  imports: [RequestContextModule, PrismaModule, RbacModule, HealthModule, AdminCompaniesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
