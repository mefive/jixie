import { readFileSync, writeFileSync } from 'node:fs';
import { buildStatsDoc, undocumentedExports } from '../src/lib/stats-doc-gen.js';

// Materialize lib/stats.ts's JSDoc into the checked-in stats-doc.ts (the analyzeData tool manual).
// stats-doc.test.ts fails when this file is stale — run me after touching stats.ts.
const sourcePath = new URL('../src/lib/stats.ts', import.meta.url);
const targetPath = new URL('../src/lib/stats-doc.ts', import.meta.url);

const source = readFileSync(sourcePath, 'utf8');
const missing = undocumentedExports(source);
if (missing.length) {
  console.error(
    `stats.ts has exported functions missing JSDoc (the agent will not see them): ${missing.join(', ')}`,
  );
  process.exit(1);
}

const doc = buildStatsDoc(source);
const banner = `// GENERATED FILE — do not edit. Source of truth: lib/stats.ts JSDoc.
// Regenerate: pnpm --filter api gen:stats-doc   (stats-doc.test.ts fails on drift)
`;
writeFileSync(targetPath, `${banner}export const STATS_DOC = ${JSON.stringify(doc)};\n`);
console.log(`stats-doc.ts generated (${doc.split('\n').length} functions)`);
