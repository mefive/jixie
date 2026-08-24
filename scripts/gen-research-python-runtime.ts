import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderResearchPythonRuntimeRequirements } from '../packages/shared/src/research-python-runtime.js';

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const outputPath = resolve(
    process.cwd(),
    'apps/sandboxd/python/requirements-research-runtime.txt',
  );
  const generated = renderResearchPythonRuntimeRequirements();

  if (process.argv.includes('--check')) {
    const current = await readFile(outputPath, 'utf8').catch(() => '');
    if (current !== generated) {
      throw new Error(
        'Research Python runtime requirements are stale. Run pnpm gen:research-runtime.',
      );
    }
    return;
  }

  await writeFile(outputPath, generated);
}
