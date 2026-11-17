import { z } from 'zod';
import { getApplicationDatabase } from '#infra/database/prisma.js';
import { getMarketDatabase } from '#infra/database/market-database.js';

type Asset = 'etf' | 'index';
const codesSchema = z.array(z.string());

/**
 * 旧名单与其后显式编辑按顺序合并。
 *
 * Replay explicit edits on the previous effective list.
 */
export async function configuredSelection(assetType: Asset, defaults: readonly string[] = []) {
  const app = getApplicationDatabase();
  const pointer = await app.marketPublication.findUniqueOrThrow({ where: { key: 'global' } });
  const parent = pointer.currentVersionId
    ? await app.marketVersion.findUniqueOrThrow({ where: { id: pointer.currentVersionId } })
    : null;
  const previous = await getMarketDatabase().ingestionSelection.findUnique({
    where: { assetType },
  });
  const codes = new Set(previous ? codesSchema.parse(previous.codes) : defaults);
  const edits = await app.marketSelectionEdit.findMany({
    where: {
      assetType,
      sequence: { gt: parent?.selectionVersion ?? 0, lte: pointer.selectionVersion },
    },
    orderBy: { sequence: 'asc' },
  });
  for (const edit of edits) {
    for (const code of codesSchema.parse(edit.removed)) {
      codes.delete(code);
    }
    for (const code of codesSchema.parse(edit.added)) {
      codes.add(code);
    }
  }

  return {
    codes: [...codes].sort(),
    initialized: !!previous || edits.length > 0,
    updatedAt: edits.at(-1)?.createdAt ?? previous?.updatedAt ?? null,
  };
}

/**
 * 写入配置和版本号，不修改已经封存的市场表。
 *
 * Persist configuration and revision without modifying sealed data.
 */
export async function saveSelectionEdit(
  assetType: Asset,
  added: string[],
  removed: string[],
  defaults: readonly string[] = [],
) {
  const { codes } = await configuredSelection(assetType, defaults);
  const current = new Set(codes);
  const additions = added.filter((code) => !current.has(code));
  const removals = removed.filter((code) => current.has(code));
  if (!additions.length && !removals.length) {
    return codes;
  }

  await getApplicationDatabase().$transaction(async (tx) => {
    const publication = await tx.marketPublication.update({
      where: { key: 'global' },
      data: { selectionVersion: { increment: 1 } },
    });
    await tx.marketSelectionEdit.create({
      data: {
        sequence: publication.selectionVersion,
        assetType,
        added: additions,
        removed: removals,
      },
    });
  });

  for (const code of removals) {
    current.delete(code);
  }
  for (const code of additions) {
    current.add(code);
  }
  return [...current].sort();
}
