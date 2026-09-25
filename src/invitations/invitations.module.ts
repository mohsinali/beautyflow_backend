import { Module } from '@nestjs/common';
import { InvitationEmailService } from './invitation-email.service';
import { InvitationsService } from './invitations.service';

@Module({ providers: [InvitationsService, InvitationEmailService], exports: [InvitationsService] })
export class InvitationsModule {}
