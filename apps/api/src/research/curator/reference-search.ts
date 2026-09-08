import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import type { ResearchCuratorVerificationMatchV1 } from '@jixie/shared';

export type CuratorRepositoryReferenceKind = Extract<
  ResearchCuratorVerificationMatchV1['kind'],
  'code_reference' | 'help_article' | 'roadmap_item' | 'design_document'
>;

export interface CuratorRepositoryReference {
  kind: CuratorRepositoryReferenceKind;
  id: string;
  excerpt: string;
}

interface IndexedReference {
  kind: CuratorRepositoryReferenceKind;
  path: string;
  lines: string[];
  normalized: string;
}

const INDEX_TARGETS: Array<{
  path: string;
  kind: CuratorRepositoryReferenceKind;
}> = [
  { path: 'ROADMAP.md', kind: 'roadmap_item' },
  { path: 'docs/design', kind: 'design_document' },
  { path: 'apps/docs/src/content/help', kind: 'help_article' },
  { path: 'apps/api/src', kind: 'code_reference' },
  { path: 'packages/shared/src', kind: 'code_reference' },
];

const INDEXED_EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.mjs']);
const STOP_TERMS = new Set([
  '一个',
  '一些',
  '这个',
  '那个',
  '可以',
  '需要',
  '应该',
  '没有',
  '什么',
  '数据',
  '研究',
  '功能',
  '用户',
  '系统',
  'the',
  'and',
  'with',
  'from',
  'this',
  'that',
]);

let cachedDefaultIndex: Promise<IndexedReference[]> | undefined;

/** Search is deliberately read-only and limited to checked-in product knowledge. */
export async function searchCuratorRepositoryReferences(
  text: string,
  options: { repositoryRoot?: string; limit?: number } = {},
): Promise<CuratorRepositoryReference[]> {
  const root = options.repositoryRoot ?? resolve(process.cwd(), '../..');
  const index = options.repositoryRoot
    ? await buildReferenceIndex(root)
    : await (cachedDefaultIndex ??= buildReferenceIndex(root));
  const terms = extractSearchTerms(text);
  if (terms.length === 0) {
    return [];
  }

  const ranked = index
    .map((entry) => scoreReference(entry, terms))
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .sort(
      (left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path),
    );
  const perKind = new Map<CuratorRepositoryReferenceKind, number>();
  const matches: CuratorRepositoryReference[] = [];
  for (const result of ranked) {
    if ((perKind.get(result.entry.kind) ?? 0) >= 2) {
      continue;
    }
    matches.push({
      kind: result.entry.kind,
      id: `${result.entry.path}:${result.line + 1}`,
      excerpt: result.entry.lines[result.line]!.trim().slice(0, 300),
    });
    perKind.set(result.entry.kind, (perKind.get(result.entry.kind) ?? 0) + 1);
    if (matches.length >= (options.limit ?? 8)) {
      break;
    }
  }
  return matches;
}

async function buildReferenceIndex(repositoryRoot: string): Promise<IndexedReference[]> {
  const files: Array<{ absolutePath: string; kind: CuratorRepositoryReferenceKind }> = [];
  for (const target of INDEX_TARGETS) {
    await collectFiles(resolve(repositoryRoot, target.path), target.kind, files);
  }
  const entries = await Promise.all(
    files.map(async ({ absolutePath, kind }) => {
      const content = await readFile(absolutePath, 'utf8');
      return {
        kind,
        path: relative(repositoryRoot, absolutePath),
        lines: content.split(/\r?\n/),
        normalized: content.toLowerCase(),
      } satisfies IndexedReference;
    }),
  );
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectFiles(
  path: string,
  kind: CuratorRepositoryReferenceKind,
  files: Array<{ absolutePath: string; kind: CuratorRepositoryReferenceKind }>,
): Promise<void> {
  try {
    if ((await stat(path)).isFile()) {
      if (INDEXED_EXTENSIONS.has(extname(path))) {
        files.push({ absolutePath: path, kind });
      }
      return;
    }
  } catch {
    return;
  }
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolutePath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      if (!['dist', 'generated', 'node_modules'].includes(entry.name)) {
        await collectFiles(absolutePath, kind, files);
      }
      continue;
    }
    if (
      entry.isFile() &&
      INDEXED_EXTENSIONS.has(extname(entry.name)) &&
      !/\.(?:test|generated)\./.test(entry.name)
    ) {
      files.push({ absolutePath, kind });
    }
  }
}

function extractSearchTerms(text: string): string[] {
  const identifiers = text.toLowerCase().match(/[a-z][a-z0-9]*(?:[_./-][a-z0-9]+)+/g) ?? [];
  const segmenter = new Intl.Segmenter(['zh-CN', 'en'], { granularity: 'word' });
  const words = [...segmenter.segment(text.toLowerCase())]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment.trim())
    .filter((term) => term.length >= 2 && !STOP_TERMS.has(term));
  return [...new Set([...identifiers, ...words])].slice(0, 40);
}

function scoreReference(entry: IndexedReference, terms: string[]) {
  const matched = terms.filter((term) => entry.normalized.includes(term));
  if (matched.length === 0) {
    return null;
  }
  let bestLine = 0;
  let bestLineScore = 0;
  entry.lines.forEach((line, index) => {
    const normalized = line.toLowerCase();
    const score = matched.reduce(
      (sum, term) => sum + (normalized.includes(term) ? (term.includes('_') ? 5 : 2) : 0),
      0,
    );
    if (score > bestLineScore) {
      bestLine = index;
      bestLineScore = score;
    }
  });
  return {
    entry,
    line: bestLine,
    score: matched.length * 3 + bestLineScore,
  };
}
