import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { processGroupIsRunning, signalProcessGroup, waitForServiceExit } from './process-group.mjs';

test(
  'signals descendants after the process group leader has exited',
  { skip: process.platform === 'win32' },
  async (context) => {
    const wrapper = spawn(
      process.execPath,
      [
        '-e',
        [
          "const { spawn } = require('node:child_process');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' });",
          'child.unref();',
        ].join('\n'),
      ],
      { detached: true, stdio: 'ignore' },
    );

    context.after(() => {
      if (wrapper.pid) {
        try {
          process.kill(-wrapper.pid, 'SIGKILL');
        } catch (error) {
          if (error?.code !== 'ESRCH') {
            throw error;
          }
        }
      }
    });

    await once(wrapper, 'exit');
    assert.equal(wrapper.exitCode, 0);
    assert.equal(processGroupIsRunning(wrapper), true);

    assert.equal(signalProcessGroup(wrapper, 'SIGKILL'), true);
    assert.equal(await waitForServiceExit(wrapper, 2_000), true);
  },
);
