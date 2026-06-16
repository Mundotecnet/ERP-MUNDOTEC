import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthService } from './auth.service';
import { AuthUserContext, CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ChangePasswordBody,
  LoginRequestBody,
  parseChangePasswordBody,
  parseLoginBody,
  parseRefreshBody,
  RefreshRequestBody,
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
