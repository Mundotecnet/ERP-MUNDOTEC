import { Module } from '@nestjs/common';
import { AdminCompaniesController } from './admin-companies.controller';

/**
 * Módulo stub para PR-4. Ejercita las extensiones audit / tenant / RBAC con
 * un CRUD mínimo de Company. Se elimina cuando entre el CompaniesModule del
 * Sprint 2/3.
 *
 * @deprecated Remover al implementar el módulo Company definitivo.
 */
@Module({
  controllers: [AdminCompaniesController],
})
export class AdminCompaniesModule {}
