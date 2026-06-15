import { SetMetadata } from '@nestjs/common';

export const PERMISSION_METADATA_KEY = 'mundotec:permission';

/**
 * Marca un método de controlador con el código de permiso que debe tener el
 * usuario activo para ejecutarlo. El {@link PermissionsGuard} lee este metadato
 * en cada request.
 *
 * Ejemplo:
 *   @RequirePermission('company.update')
 *   @Patch(':id')
 *   updateCompany(...) { ... }
 */
export const RequirePermission = (permissionCode: string): MethodDecorator =>
  SetMetadata(PERMISSION_METADATA_KEY, permissionCode);
