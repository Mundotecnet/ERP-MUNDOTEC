import { randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordPolicyService } from './password-policy.service';
import { AccessTokenPayload, RefreshTokenPayload } from './types/jwt-payload';

export interface AuthenticatedUserSummary {
  id: string;
  email: string;
  fullName: string;
  companyId: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUserSummary;
}

const BCRYPT_ROUNDS = 10;
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_LOCK_DURATION_MIN = 15;
const DEFAULT_ACCESS_EXPIRES_IN = '15m';
const DEFAULT_REFRESH_EXPIRES_IN = '7d';
const DEFAULT_RESET_EXPIRES_IN_MIN = 60;
const DEFAULT_RESET_URL_BASE = 'https://erp.example.com/reset-password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly mailer: MailerService,
  ) {}

  async login(input: {
    username: string;
    password: string;
    companyId: bigint | null;
  }): Promise<LoginResult> {
    const user = await this.findCandidateUser(input.username, input.companyId);

    // Cuenta inactiva / borrada — mensaje genérico para no filtrar info.
    if (!user || !user.isActive || user.deletedAt !== null) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // Bloqueo temporal vigente. HTTP 423 (Locked) — HttpStatus de @nestjs/common
    // 10.4 todavía no expone la constante, usamos el número.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        {
          statusCode: 423,
          message: 'Cuenta bloqueada por intentos fallidos. Vuelve a intentarlo más tarde.',
          lockedUntil: user.lockedUntil.toISOString(),
        },
        423,
      );
    }

    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // Reset contadores + last_login_at.
    await this.prisma.raw.appUser.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    return this.issueTokens(user.id, user.companyId, user.email, user.fullName);
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Tipo de token inválido.');
    }

    const row = await this.prisma.raw.refreshToken.findUnique({ where: { jti: payload.jti } });
    if (!row || row.revokedAt !== null) {
      throw new UnauthorizedException('Refresh token revocado.');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expirado.');
    }
    const matches = await bcrypt.compare(refreshToken, row.tokenHash);
    if (!matches) {
      // El JWT firma OK pero no coincide con el hash; alguien manipuló o reusó.
      this.logger.warn(`Refresh token con jti=${payload.jti} no coincide con el hash en DB`);
      throw new UnauthorizedException('Refresh token inválido.');
    }

    const accessToken = await this.signAccessToken(BigInt(payload.sub), BigInt(payload.companyId));
    return { accessToken };
  }

  /**
   * Revoca el refresh token entregado. Idempotente: si el JWT no es válido o ya
   * está revocado, igual respondemos OK para no filtrar estado de tokens a un
   * cliente no autenticado.
   */
  async logout(refreshToken: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      return;
    }
    if (payload.type !== 'refresh') return;
    await this.prisma.raw.refreshToken.updateMany({
      where: { jti: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Cambio de contraseña por el propio usuario autenticado. Valida la actual,
   * exige que la nueva cumpla la policy de su empresa y revoca todos los
   * refresh tokens activos del usuario (obliga re-login en cada dispositivo).
   */
  async changePassword(
    userId: bigint,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.raw.appUser.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt !== null) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Contraseña actual incorrecta.');
    }
    const validation = await this.passwordPolicy.validateForCompany(user.companyId, newPassword);
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'La nueva contraseña no cumple la política de la empresa.',
        errors: validation.errors,
      });
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException({
        message: 'La nueva contraseña no puede ser igual a la actual.',
      });
    }
    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.raw.appUser.update({
      where: { id: userId },
      data: { passwordHash: newHash, updatedAt: new Date() },
    });
    await this.prisma.raw.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Flujo "olvidé mi contraseña". Siempre se comporta silenciosamente: si el
   * usuario no existe, no envía nada y no lanza error — el endpoint responde
   * 204 invariante para no filtrar qué cuentas existen.
   *
   * Si el usuario existe, genera un token de un solo uso, lo guarda hasheado
   * en `password_reset_token` y envía el correo con la URL `?token=jti.secret`.
   * Si findCandidateUser detecta ambigüedad (mismo username en varias
   * empresas sin companyId), se ignora también para no filtrar.
   */
  async forgotPassword(usernameOrEmail: string, companyId: bigint | null): Promise<void> {
    let user;
    try {
      user = await this.findCandidateUser(usernameOrEmail, companyId);
    } catch {
      return;
    }
    if (!user || !user.isActive || user.deletedAt !== null) return;

    const jti = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const tokenPlain = `${jti}.${secret}`;
    const expiresIn = Number(
      this.config.get<string>('RESET_TOKEN_EXPIRES_IN_MIN') ?? DEFAULT_RESET_EXPIRES_IN_MIN,
    );
    const expiresAt = new Date(Date.now() + expiresIn * 60_000);

    await this.prisma.raw.passwordResetToken.create({
      data: {
        userId: user.id,
        jti,
        tokenHash: await bcrypt.hash(secret, BCRYPT_ROUNDS),
        expiresAt,
      },
    });

    const base = this.config.get<string>('MAIL_RESET_URL_BASE') ?? DEFAULT_RESET_URL_BASE;
    const url = `${base}?token=${encodeURIComponent(tokenPlain)}`;
    await this.mailer.send({
      to: user.email,
      subject: 'Recuperación de contraseña — MundoTec ERP',
      text:
        `Hola ${user.fullName},\n\n` +
        `Recibimos una solicitud para restablecer tu contraseña.\n` +
        `Ingresa al siguiente enlace dentro de los próximos ${expiresIn} minutos:\n\n` +
        `${url}\n\n` +
        `Si no solicitaste este cambio, ignora este correo.\n`,
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException('Token inválido.');
    }
    const [jti, secret] = parts;

    const row = await this.prisma.raw.passwordResetToken.findUnique({ where: { jti } });
    if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Token inválido o expirado.');
    }
    if (!(await bcrypt.compare(secret, row.tokenHash))) {
      throw new BadRequestException('Token inválido o expirado.');
    }

    const user = await this.prisma.raw.appUser.findUniqueOrThrow({ where: { id: row.userId } });
    const validation = await this.passwordPolicy.validateForCompany(user.companyId, newPassword);
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'La nueva contraseña no cumple la política de la empresa.',
        errors: validation.errors,
      });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.raw.$transaction([
      this.prisma.raw.appUser.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          updatedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.raw.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.raw.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async findCandidateUser(usernameOrEmail: string, companyId: bigint | null) {
    const isEmail = usernameOrEmail.includes('@');
    if (companyId !== null) {
      return this.prisma.raw.appUser.findUnique({
        where: isEmail
          ? { companyId_email: { companyId, email: usernameOrEmail } }
          : { companyId_username: { companyId, username: usernameOrEmail } },
      });
    }
    const candidates = await this.prisma.raw.appUser.findMany({
      where: isEmail ? { email: usernameOrEmail } : { username: usernameOrEmail },
      take: 2,
    });
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      throw new BadRequestException(
        'El usuario existe en varias empresas. Especifica "companyId" en la solicitud.',
      );
    }
    return candidates[0];
  }

  private async registerFailedAttempt(
    userId: bigint,
    currentFailedAttempts: number,
  ): Promise<void> {
    const next = currentFailedAttempts + 1;
    const maxAttempts = Number(
      this.config.get<string>('AUTH_MAX_FAILED_ATTEMPTS') ?? DEFAULT_MAX_FAILED_ATTEMPTS,
    );
    const lockMinutes = Number(
      this.config.get<string>('AUTH_LOCK_DURATION_MIN') ?? DEFAULT_LOCK_DURATION_MIN,
    );
    const data: { failedLoginAttempts: number; lockedUntil?: Date } = { failedLoginAttempts: next };
    if (next >= maxAttempts) {
      data.lockedUntil = new Date(Date.now() + lockMinutes * 60_000);
    }
    await this.prisma.raw.appUser.update({ where: { id: userId }, data });
  }

  private async issueTokens(
    userId: bigint,
    companyId: bigint,
    email: string,
    fullName: string,
  ): Promise<LoginResult> {
    const accessToken = await this.signAccessToken(userId, companyId);
    const { token: refreshToken, jti, expiresAt } = await this.signRefreshToken(userId, companyId);

    await this.prisma.raw.refreshToken.create({
      data: {
        userId,
        jti,
        tokenHash: await bcrypt.hash(refreshToken, BCRYPT_ROUNDS),
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: userId.toString(),
        email,
        fullName,
        companyId: companyId.toString(),
      },
    };
  }

  private async signAccessToken(userId: bigint, companyId: bigint): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: userId.toString(),
      companyId: companyId.toString(),
      type: 'access',
    };
    return this.jwt.signAsync(payload, {
      secret: this.accessSecret(),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? DEFAULT_ACCESS_EXPIRES_IN,
    });
  }

  private async signRefreshToken(
    userId: bigint,
    companyId: bigint,
  ): Promise<{ token: string; jti: string; expiresAt: Date }> {
    const jti = randomBytes(24).toString('hex'); // 48 hex chars, cabe en VARCHAR(64).
    const expiresIn =
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? DEFAULT_REFRESH_EXPIRES_IN;
    const payload: RefreshTokenPayload = {
      sub: userId.toString(),
      companyId: companyId.toString(),
      type: 'refresh',
      jti,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.refreshSecret(),
      expiresIn,
    });
    const decoded = this.jwt.decode<RefreshTokenPayload>(token);
    const expiresAt =
      decoded && typeof decoded.exp === 'number'
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + this.parseDurationMs(expiresIn));
    return { token, jti, expiresAt };
  }

  private accessSecret(): string {
    const v = this.config.get<string>('JWT_SECRET');
    if (!v) throw new Error('JWT_SECRET no está definido en el entorno.');
    return v;
  }

  private refreshSecret(): string {
    const v = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!v) throw new Error('JWT_REFRESH_SECRET no está definido en el entorno.');
    return v;
  }

  /**
   * Fallback simple para convertir cosas como '15m' / '7d' / '3600' a ms si por
   * algún motivo `jwt.decode` no devuelve `exp`. JwtService usa la librería
   * `jsonwebtoken` que ya soporta el formato; este parser es solo de respaldo.
   */
  private parseDurationMs(value: string): number {
    const match = /^(\d+)([smhd])?$/.exec(value);
    if (!match) return 0;
    const n = Number(match[1]);
    switch (match[2]) {
      case 's':
        return n * 1000;
      case 'm':
        return n * 60_000;
      case 'h':
        return n * 3_600_000;
      case 'd':
        return n * 86_400_000;
      default:
        return n * 1000;
    }
  }

  /**
   * Datos del usuario autenticado más la lista de permisos efectivos (vía
   * sus roles). Usado por el frontend para armar el menú dinámico y mostrar
   * el contexto activo. No expone passwordHash ni datos sensibles.
   */
  async me(userId: bigint): Promise<{
    id: string;
    email: string;
    username: string;
    fullName: string;
    companyId: string;
    permissions: string[];
  }> {
    const user = await this.prisma.raw.appUser.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
            },
          },
        },
      },
    });
    if (!user || user.deletedAt !== null) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }
    const permSet = new Set<string>();
    for (const ur of user.userRoles) {
      for (const rp of ur.role.rolePermissions) {
        permSet.add(rp.permission.code);
      }
    }
    return {
      id: user.id.toString(),
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      companyId: user.companyId.toString(),
      permissions: Array.from(permSet).sort(),
    };
  }

  /**
   * Usado por el JwtAuthGuard para validar el access token y armar el contexto.
   * Centraliza el secret + el chequeo del claim `type`.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.accessSecret(),
      });
    } catch {
      throw new UnauthorizedException('Access token inválido o expirado.');
    }
    if (payload.type !== 'access') {
      throw new ForbiddenException('Tipo de token inválido para este endpoint.');
    }
    return payload;
  }
}
