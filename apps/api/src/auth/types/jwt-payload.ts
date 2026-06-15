/**
 * Payload del access token. Claims mínimos para que el guard pueda armar el
 * RequestContext sin hits adicionales a DB.
 *
 *   sub        — userId (BigInt serializado como string en el JWT).
 *   companyId  — empresa activa del usuario (BigInt como string).
 *   type       — 'access' o 'refresh'; bloquea uso cruzado entre endpoints.
 *   iat / exp  — estándar JWT.
 */
export interface AccessTokenPayload {
  sub: string;
  companyId: string;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  companyId: string;
  type: 'refresh';
  jti: string;
  iat?: number;
  exp?: number;
}

export type JwtPayload = AccessTokenPayload | RefreshTokenPayload;
