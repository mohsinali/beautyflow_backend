export const cleanText = (value: string): string => value.trim();

export const normalizeName = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

export const normalizeCode = (value?: string | null): string | null => {
  const code = value?.normalize('NFKC').trim().toUpperCase();
  return code || null;
};

export const escapeLikeSearch = (value: string): string => value.trim().replace(/[\\%_]/gu, '\\$&');

export const decimalString = (value: { toFixed(fractionDigits: number): string }): string =>
  value.toFixed(2);
