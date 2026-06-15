import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  providers: [PermissionsGuard],
  exports: [PermissionsGuard],
})
export class RbacModule {}
