import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it('runs Research SDK requests, AST analysis, outputs and reset using only packaged Python inputs', async () => {
  const repositoryDirectory = new URL('../../../../../../', import.meta.url);
  const dockerfile = await readFile(
    new URL('apps/sandboxd/Dockerfile.python', repositoryDirectory),
    'utf8',
  );
  const ignoreRules = (await readFile(new URL('.dockerignore', repositoryDirectory), 'utf8'))
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));
  expect(ignoreRules[0]).toBe('**');
  const directory = await mkdtemp(join(tmpdir(), 'jixie-research-package-'));
  try {
    for (const match of dockerfile.matchAll(/^COPY (apps\/\S+\.py) \/opt\/jixie\/(\S+\.py)$/gm)) {
      expect(ignoreRules, `excluded build input: ${match[1]}`).toContain(`!${match[1]}`);
      let parent = dirname(match[1]);
      while (parent !== '.') {
        expect(ignoreRules, `excluded build directory: ${parent}`).toContain(`!${parent}/`);
        parent = dirname(parent);
      }
      const destination = join(directory, match[2]);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(new URL(match[1], repositoryDirectory), destination);
    }
    const source = `
frame = data.series("index", "000300.SH", start="20260101", end="20260131")
chart = charts.line(frame, x="date", y="value")
chart
`;
    const frames = [
      {
        type: 'research_start',
        runtime_version: 'research-py-v1',
        request_capabilities: ['explicit_parameters'],
      },
      { type: 'research_analyze', cells: [{ id: 'cell-1', source }] },
      { type: 'research_execute', cell_id: 'cell-1', source, parameters: { scale: 2 } },
      {
        type: 'response',
        id: 1,
        result: { rows: [{ date: '20260105', value: 12.5 }], diagnostics: [] },
      },
      {
        type: 'research_execute',
        cell_id: 'cell-2',
        source: 'parameters["scale"] * chart.spec["rows"][0]["value"]',
      },
      { type: 'research_reset' },
      {
        type: 'research_execute',
        cell_id: 'cell-3',
        source:
          'all(name in globals() for name in ["data", "results", "valuation", "charts"]) and "frame" not in globals() and "parameters" not in globals()',
      },
      { type: 'close' },
    ];
    const input = Buffer.concat(
      frames.map((frame) => {
        const payload = Buffer.from(JSON.stringify(frame));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(payload.length);
        return Buffer.concat([header, payload]);
      }),
    );
    const result = spawnSync(
      process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3',
      ['-I', '-u', join(directory, 'apps/sandboxd/python/jixie_runner.py')],
      { input, timeout: 30_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr?.toString()).toBe(0);
    const output: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < result.stdout.length; ) {
      const size = result.stdout.readUInt32BE(offset);
      const frame = JSON.parse(result.stdout.subarray(offset + 4, offset + 4 + size).toString());
      // Third-party initialization may emit framed logs before the ready handshake.
      if (frame.type !== 'log') {
        output.push(frame);
      }
      offset += 4 + size;
    }
    expect(output.map((frame) => frame.type)).toEqual([
      'research_ready',
      'research_analyzed',
      'request',
      'research_executed',
      'research_executed',
      'research_reset_done',
      'research_executed',
    ]);
    expect(output[0]).toMatchObject({ capabilities: ['explicit_parameters'] });
    expect(output[1]).toMatchObject({
      cells: [
        {
          cell_id: 'cell-1',
          definitions: ['chart', 'frame'],
          references: ['chart', 'frame'],
          series_requests: [
            { asset_type: 'index', identifier: '000300.SH', measure: 'market.adjusted_close' },
          ],
        },
      ],
    });
    expect(output[2]).toMatchObject({ id: 1, method: 'research_series' });
    expect(output[3]).toMatchObject({
      outputs: [{ type: 'chart', kind: 'line', rows: [{ value: 12.5 }] }],
    });
    expect(output[4].outputs).toEqual([{ type: 'value', value: 25 }]);
    expect(output[6].outputs).toEqual([{ type: 'value', value: true }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 35_000);
