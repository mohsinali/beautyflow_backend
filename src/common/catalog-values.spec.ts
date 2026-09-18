import { escapeLikeSearch, normalizeCode, normalizeName } from './catalog-values';

describe('catalog value normalization', () => {
  it('normalizes case and whitespace without removing Unicode text', () => {
    expect(normalizeName('  Hair   Styling  ')).toBe('hair styling');
    expect(normalizeName('  قص   الشعر  ')).toBe('قص الشعر');
  });

  it('normalizes optional codes consistently', () => {
    expect(normalizeCode(' cut-ar ')).toBe('CUT-AR');
    expect(normalizeCode('  ')).toBeNull();
  });

  it('escapes PostgreSQL LIKE wildcard characters in partial searches', () => {
    expect(escapeLikeSearch('  50%_off\\today  ')).toBe('50\\%\\_off\\\\today');
  });
});
