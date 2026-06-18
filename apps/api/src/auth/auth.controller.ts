import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';

import { AuthService } from './auth.service';
import { AuthUserContext, CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginRequestBody,
  parseChangePasswordBody,
  parseForgotPasswordBody,
  parseLoginBody,
  parseRefreshBody,
  parseResetPasswordBody,
  RefreshRequestBody,
  ResetPasswordBody,
} from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginRequestBody) {
    const input = parseLoginBody(body);
    return this.auth.login(input);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: RefreshRequestBody) {
    const refreshToken = parseRefreshBody(body);
    return this.auth.refresh(refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: RefreshRequestBody): Promise<void> {
    const refreshToken = parseRefreshBody(body);
    await this.auth.logout(refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  async forgotPassword(@Body() body: ForgotPasswordBody): Promise<void> {
    const input = parseForgotPasswordBody(body);
    await this.auth.forgotPassword(input.usernameOrEmail, input.companyId);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() body: ResetPasswordBody): Promise<void> {
    const input = parseResetPasswordBody(body);
    await this.auth.resetPassword(input.token, input.newPassword);
  }

  /**
   * Sesión actual: datos del usuario + permisos efectivos. Requiere Bearer.
   * El frontend lo usa para armar el menú dinámico y mostrar el contexto.
   */
  @Get('me')
  async me(@CurrentUser() user: AuthUserContext) {
    return this.auth.me(user.userId);
  }

  /**
   * Requiere Bearer (lo enforce el JwtAuthGuard global). El `@CurrentUser` lee
   * el user del request (puesto por el mismo guard).
   */
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUserContext,
    @Body() body: ChangePasswordBody,
  ): Promise<void> {
    const input = parseChangePasswordBody(body);
    await this.auth.changePassword(user.userId, input.currentPassword, input.newPassword);
  }
}
