import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkCommitMessage } from './check-commit-message.mjs';

test('accepts English descriptions, technical names, bodies, and attribution', () => {
  for (const message of [
    'fix(research): preserve Python cell outputs\n',
    'docs(repo): explain contribution rules\r\n\r\nDescribe the review workflow.\r\n',
    'feat(sdk)!: rename the dataset method\n\nBREAKING CHANGE: Use datasets.read instead.\n',
    'chore(repo): update attribution\n\nCo-authored-by: 张三 <author@example.com>\n',
    'revert(api): restore the previous route\n\nThis reverts commit abc123.\n',
  ]) {
    assert.deepEqual(checkCommitMessage(message), [], message);
  }
});

test('rejects malformed messages and untranslated prose', () => {
  for (const message of [
    '',
    'fix: missing scope',
    'unknown(api): change routes',
    'fix(Web): change routes',
    'fix(web/lab): change routes',
    'fix(web): Update routes',
    'fix(web): update routes.',
    'fix(web): 更新路由',
    'fix(web): update routes\n\n修复错误',
    'fix(web): update routes\nBody without a separator',
    'fix(web)!: rename routes',
    `fix(web): ${'a'.repeat(100)}`,
    'fix(web): update\u0000routes',
    'fix(web): 123',
  ]) {
    assert.ok(checkCommitMessage(message).length > 0, JSON.stringify(message));
  }
});

test('checks files through the hook CLI and fails closed on missing input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jixie-commit-message-'));
  const filename = join(directory, 'message with spaces.txt');
  const script = new URL('./check-commit-message.mjs', import.meta.url);
  const run = (...args) =>
    spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });

  try {
    writeFileSync(filename, 'fix(api): preserve route ownership\n');
    assert.equal(run(filename).status, 0);
    writeFileSync(filename, 'invalid message\n');
    assert.equal(run(filename).status, 1);
    assert.equal(run().status, 1);
    assert.equal(run(join(directory, 'missing')).status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
