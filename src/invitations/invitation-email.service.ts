import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character] ?? character;
  });

@Injectable()
export class InvitationEmailService {
  private readonly logger = new Logger(InvitationEmailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT', 587),
      secure: config.get<boolean>('SMTP_SECURE', false),
      requireTLS: config.get<boolean>('SMTP_REQUIRE_TLS', true),
      auth: {
        user: config.getOrThrow<string>('SMTP_USER'),
        pass: config.getOrThrow<string>('SMTP_PASSWORD'),
      },
    });
  }

  async send(input: {
    email: string;
    displayName: string;
    tenantName: string;
    language: 'EN' | 'AR';
    token: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const from = this.config.getOrThrow<string>('SMTP_FROM');
    const fromName = this.config.getOrThrow<string>('MAIL_FROM_NAME');
    const publicUrl = this.config.getOrThrow<string>('APP_PUBLIC_URL');
    const url = `${publicUrl.replace(/\/$/, '')}/accept-invitation#token=${encodeURIComponent(input.token)}`;
    const arabic = input.language === 'AR';
    const expiry = input.expiresAt.toISOString();
    const subject = arabic
      ? `دعوة للانضمام إلى ${input.tenantName} كمقدم خدمة`
      : `Invitation to join ${input.tenantName} as a Service Provider`;
    const text = arabic
      ? `مرحباً ${input.displayName}،\n\nلقد تمت دعوتك للانضمام إلى ${input.tenantName} كمقدم خدمة.\nإعداد حسابك: ${url}\nتنتهي صلاحية الدعوة في ${expiry}.\nإذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.`
      : `Hello ${input.displayName},\n\nYou have been invited to join ${input.tenantName} as a Service Provider.\nSet Up Your Account: ${url}\nThis invitation expires at ${expiry}.\nIf you did not expect this email, you can safely ignore it.`;
    const safeName = escapeHtml(input.displayName);
    const safeTenant = escapeHtml(input.tenantName);
    const safeUrl = escapeHtml(url);
    const html = arabic
      ? `<div dir="rtl" lang="ar" style="font-family:Arial,sans-serif;line-height:1.7"><h1>BeautyFlow</h1><p>مرحباً ${safeName}،</p><p>لقد تمت دعوتك للانضمام إلى <strong>${safeTenant}</strong> كمقدم خدمة.</p><p><a href="${safeUrl}">إعداد حسابك</a></p><p>تنتهي صلاحية الدعوة في ${escapeHtml(expiry)}.</p><p>${safeUrl}</p><p>إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.</p></div>`
      : `<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;line-height:1.6"><h1>BeautyFlow</h1><p>Hello ${safeName},</p><p>You have been invited to join <strong>${safeTenant}</strong> as a Service Provider.</p><p><a href="${safeUrl}">Set Up Your Account</a></p><p>This invitation expires at ${escapeHtml(expiry)}.</p><p>${safeUrl}</p><p>If you did not expect this email, you can safely ignore it.</p></div>`;
    try {
      await this.transporter.sendMail({
        from: { name: fromName, address: from },
        to: input.email,
        subject,
        text,
        html,
      });
      return true;
    } catch {
      this.logger.error('SES SMTP invitation delivery failed');
      return false;
    }
  }
}
