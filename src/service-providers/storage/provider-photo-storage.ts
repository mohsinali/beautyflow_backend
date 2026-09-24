export interface StoredProviderPhoto {
  key: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface ProviderPhotoFile extends StoredProviderPhoto {
  buffer: Buffer;
}

export abstract class ProviderPhotoStorage {
  abstract store(
    buffer: Buffer,
    extension: string,
    contentType: StoredProviderPhoto['contentType'],
  ): Promise<StoredProviderPhoto>;
  abstract read(key: string): Promise<ProviderPhotoFile | null>;
  abstract remove(key: string): Promise<void>;
}
