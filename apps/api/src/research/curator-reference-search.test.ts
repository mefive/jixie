import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { searchCuratorRepositoryReferences } from './curator-reference-search.js';

describe('Curator repository reference search', () => {
  it('searches only the fixed code, help, roadmap and design surfaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jixie-curator-index-'));
    await Promise.all([
      mkdir(join(root, 'docs/design'), { recursive: true }),
      mkdir(join(root, 'apps/docs/src/content/help/zh'), { recursive: true }),
      mkdir(join(root, 'apps/api/src/tool'), { recursive: true }),
      mkdir(join(root, 'packages/shared/src'), { recursive: true }),
      mkdir(join(root, 'private'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, 'ROADMAP.md'), '宏观数据发布日历 cn_schedule\n'),
      writeFile(join(root, 'docs/design/macro.md'), 'cn_schedule 设计说明\n'),
      writeFile(join(root, 'apps/docs/src/content/help/zh/macro.md'), '如何读取 cn_schedule\n'),
      writeFile(join(root, 'apps/api/src/tool/macro.ts'), 'const apiName = "cn_schedule";\n'),
      writeFile(join(root, 'packages/shared/src/types.ts'), 'type ScheduleApi = "cn_schedule";\n'),
      writeFile(join(root, 'private/secret.md'), 'cn_schedule must not be indexed\n'),
    ]);

    const matches = await searchCuratorRepositoryReferences('需要 cn_schedule 发布日历', {
      repositoryRoot: root,
      limit: 10,
    });

    expect(matches.map((match) => match.kind)).toEqual(
      expect.arrayContaining(['roadmap_item', 'design_document', 'help_article', 'code_reference']),
    );
    expect(matches.every((match) => !match.id.startsWith('private/'))).toBe(true);
    expect(matches.every((match) => /:\d+$/.test(match.id))).toBe(true);
  });
});
