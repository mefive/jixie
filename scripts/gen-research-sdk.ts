import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderResearchSdkPythonStub } from '../packages/shared/src/research-sdk-python-stub.js';

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const outputPath = resolve(process.cwd(), 'apps/sandboxd/python/jixie_research_sdk.pyi');
  const generated = renderResearchSdkPythonStub();

  if (process.argv.includes('--check')) {
    const current = await readFile(outputPath, 'utf8').catch(() => '');
    if (current !== generated) {
      throw new Error('Research SDK stub is stale. Run pnpm gen:research-sdk.');
    }
    return;
  }

  await writeFile(outputPath, generated);
}
