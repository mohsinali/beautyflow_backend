import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderPhotoStorage, type StoredProviderPhoto } from './storage/provider-photo-storage';

export interface UploadedProviderPhoto {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class ProviderPhotoService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: ProviderPhotoStorage,
    config: ConfigService,
  ) {
    this.maxBytes = config.get<number>('PROVIDER_PHOTO_MAX_BYTES', 5 * 1024 * 1024);
  }

  async replace(
    tenantId: string,
    providerId: string,
    file: UploadedProviderPhoto | undefined,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const provider = await this.find(tenantId, providerId);
    const validated = this.validate(file);
    const stored = await this.storage.store(
      validated.buffer,
      validated.extension,
      validated.contentType,
    );
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.serviceProviderProfile.update({
          where: { id: providerId },
          data: { photoStorageKey: stored.key },
          select: { id: true, updatedAt: true },
        });
        await this.audit.record(
          {
            action: 'SERVICE_PROVIDER_PHOTO_UPDATED',
            entityType: 'ServiceProviderProfile',
            entityId: providerId,
            tenantId,
            actorUserId: actor.userId,
            request,
          },
          tx,
        );
        return result;
      });
      if (provider.photoStorageKey) await this.storage.remove(provider.photoStorageKey);
      return { ...updated, photoUrl: `/service-providers/${providerId}/photo` };
    } catch (error) {
      await this.storage.remove(stored.key);
      throw error;
    }
  }

  async remove(
    tenantId: string,
    providerId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const provider = await this.find(tenantId, providerId);
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceProviderProfile.update({
        where: { id: providerId },
        data: { photoStorageKey: null, profileImageUrl: null },
      });
      await this.audit.record(
        {
          action: 'SERVICE_PROVIDER_PHOTO_REMOVED',
          entityType: 'ServiceProviderProfile',
          entityId: providerId,
          tenantId,
          actorUserId: actor.userId,
          request,
        },
        tx,
      );
    });
    if (provider.photoStorageKey) await this.storage.remove(provider.photoStorageKey);
    return { id: providerId, photoUrl: null };
  }

  async read(tenantId: string, providerId: string) {
    const provider = await this.find(tenantId, providerId);
    if (!provider.photoStorageKey) throw this.notFound();
    const file = await this.storage.read(provider.photoStorageKey);
    if (!file) throw this.notFound();
    return file;
  }

  private async find(tenantId: string, providerId: string) {
    const provider = await this.prisma.serviceProviderProfile.findFirst({
      where: { id: providerId, tenantId, deletedAt: null },
      select: { id: true, photoStorageKey: true },
    });
    if (!provider) throw this.notFound();
    return provider;
  }

  private validate(file: UploadedProviderPhoto | undefined) {
    if (!file)
      throw new BadRequestException({
        code: 'PROVIDER_PHOTO_REQUIRED',
        message: 'Photo is required',
      });
    if (file.size > this.maxBytes)
      throw new BadRequestException({
        code: 'PROVIDER_PHOTO_TOO_LARGE',
        message: 'Photo exceeds the configured size limit',
      });
    const extension = file.originalname.split('.').pop()?.toLowerCase();
    const detected = this.detect(file.buffer);
    const expected: Record<string, StoredProviderPhoto['contentType']> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    };
    if (
      !extension ||
      !expected[extension] ||
      expected[extension] !== detected ||
      file.mimetype !== detected
    )
      throw new BadRequestException({
        code: 'PROVIDER_PHOTO_TYPE_UNSUPPORTED',
        message: 'Only JPEG, PNG and WebP photos are supported',
      });
    return {
      buffer: file.buffer,
      extension: extension === 'jpeg' ? 'jpg' : extension,
      contentType: detected,
    };
  }

  private detect(buffer: Buffer): StoredProviderPhoto['contentType'] | null {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
      return 'image/jpeg';
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      return 'image/png';
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    )
      return 'image/webp';
    return null;
  }

  private notFound() {
    return new NotFoundException({
      code: 'SERVICE_PROVIDER_PHOTO_NOT_FOUND',
      message: 'Provider photo not found',
    });
  }
}
