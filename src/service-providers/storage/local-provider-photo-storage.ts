import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ProviderPhotoStorage,
  type ProviderPhotoFile,
  type StoredProviderPhoto,
} from './provider-photo-storage';

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

@Injectable()
export class LocalProviderPhotoStorage extends ProviderPhotoStorage {
  private readonly directory: string;

  constructor(config: ConfigService) {
    super();
    this.directory = resolve(
      config.get<string>('PROVIDER_PHOTO_UPLOAD_DIR', './uploads/provider-photos'),
    );
  }

  async store(
    buffer: Buffer,
    extension: string,
    contentType: StoredProviderPhoto['contentType'],
  ): Promise<StoredProviderPhoto> {
    await mkdir(this.directory, { recursive: true, mode: 0o750 });
    const key = `${randomUUID()}.${extension}`;
    await writeFile(this.pathFor(key), buffer, { flag: 'wx', mode: 0o640 });
    return { key, contentType };
  }

  async read(key: string): Promise<ProviderPhotoFile | null> {
    const extension = this.extensionFor(key);
    try {
      return {
        key,
        contentType: CONTENT_TYPES[extension],
        buffer: await readFile(this.pathFor(key)),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private extensionFor(key: string): keyof typeof CONTENT_TYPES {
    const match = /^[0-9a-f-]{36}\.(jpg|png|webp)$/.exec(key);
    if (!match) throw new Error('Invalid provider photo storage key');
    return match[1] as keyof typeof CONTENT_TYPES;
  }

  private pathFor(key: string): string {
    this.extensionFor(key);
    return resolve(this.directory, key);
  }
}
