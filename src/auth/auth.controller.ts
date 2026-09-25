import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-context.decorators';
import { Public } from '../common/decorators/public.decorator';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AcceptInvitationDto, ValidateInvitationDto } from '../invitations/dto/invitation.dto';
import { InvitationsService } from '../invitations/invitations.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationsService,
  ) {}
  @Public()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 100 : 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: RequestWithContext) {
    return this.auth.login(dto, request);
  }

  @Public()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 100 : 10, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() request: RequestWithContext) {
    return this.auth.refresh(dto.refreshToken, request);
  }

  @Public()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 100 : 10, ttl: 60_000 } })
  @Post('invitations/validate')
  validateInvitation(@Body() dto: ValidateInvitationDto) {
    return this.invitations.validate(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 100 : 5, ttl: 60_000 } })
  @Post('invitations/accept')
  acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() request: RequestWithContext) {
    return this.invitations.accept(dto.token, dto.password, dto.confirmPassword, request);
  }

  @ApiBearerAuth()
  @Post('logout')
  logout(@CurrentUser() user: AuthContext, @Req() request: RequestWithContext) {
    return this.auth.logout(user, request);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthContext, @Req() request: RequestWithContext) {
    return this.auth.logoutAll(user, request);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return this.auth.me(user);
  }
}
