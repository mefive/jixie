import { prisma } from '../src/lib/prisma.js';

interface FactorIdentityRow {
  id: string;
  userId: string;
  key: string | null;
  keyCandidate: string | null;
}

const KEY_MAX_LENGTH = 32;

function normalizeKey(value: string): string {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (/^[0-9]/.test(normalized)) {
    normalized = `factor_${normalized}`;
  }
  return normalized.slice(0, KEY_MAX_LENGTH).replace(/_+$/g, '') || 'factor';
}

async function main(): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Factor'`,
  );
  if (tables.length === 0) {
    console.log('[factor-identity] Factor table does not exist; nothing to migrate');
    return;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("Factor")`,
  );
  const hasKeyCandidate = columns.some((column) => column.name === 'keyCandidate');
  const candidateExpression = hasKeyCandidate ? `"keyCandidate"` : `NULL`;
  const rows = await prisma.$queryRawUnsafe<FactorIdentityRow[]>(
    `SELECT "id", "userId", "key", ${candidateExpression} AS "keyCandidate" FROM "Factor" ORDER BY "createdAt", "id"`,
  );

  const usedByUser = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.key) {
      const used = usedByUser.get(row.userId) ?? new Set<string>();
      used.add(row.key);
      usedByUser.set(row.userId, used);
    }
  }

  let migrated = 0;
  for (const row of rows) {
    if (row.key) {
      continue;
    }
    const used = usedByUser.get(row.userId) ?? new Set<string>();
    const base = normalizeKey(row.keyCandidate || `factor_${row.id.toLowerCase()}`);
    let key = base;
    for (let version = 2; used.has(key); version++) {
      const suffix = `_v${version}`;
      key = `${base.slice(0, KEY_MAX_LENGTH - suffix.length).replace(/_+$/g, '')}${suffix}`;
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "Factor" SET "key" = ? WHERE "id" = ? AND "key" IS NULL`,
      key,
      row.id,
    );
    used.add(key);
    usedByUser.set(row.userId, used);
    migrated++;
  }

  console.log(`[factor-identity] assigned immutable keys to ${migrated} factor(s)`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
