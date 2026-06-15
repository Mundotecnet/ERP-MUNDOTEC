import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'mundotec:isPublic';

/**
 * Marca un controller o handler para que el JwtAuthGuard global lo deje pasar
 * sin pedir Bearer. Usar SÓLO en endpoints que deban funcionar sin sesión
 * (login, refresh, forgot-password, /health).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
