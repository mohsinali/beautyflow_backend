import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InvitationsModule } from '../invitations/invitations.module';

@Module({
  imports: [AuthorizationModule, InvitationsModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
