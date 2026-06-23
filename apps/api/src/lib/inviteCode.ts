import { randomBytes } from 'node:crypto';

// Crockford Base32: a 32-character alphabet that drops I/L/O/U to avoid visual confusion with
// 1/0/V. 12 chars = 60 bits of entropy ≈ 1.15e18 combinations — collision odds are negligible, and
// it's hard for users to mis-transcribe when reading aloud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Generate a 12-character Crockford Base32 invite code.
// randomBytes gives 12 bytes; take the low 5 bits of each byte as an alphabet index — preserving
// 60 bits of real entropy.
export function generateInviteCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

// Normalize user input to canonical form: uppercase + strip whitespace/separators + replace
// confusable chars per the Crockford spec (I/L→1, O→0, U→V).
// The result isn't guaranteed valid (length/chars may still be wrong) — validate it separately
// with isValidInviteCodeFormat.
export function normalizeInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s\-_]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

// Validates format only: length + character set. Whether it actually exists and is unconsumed is
// determined by a DB query.
export function isValidInviteCodeFormat(code: string): boolean {
  return /^[0-9A-HJ-NP-TV-Z]{12}$/.test(code);
}
