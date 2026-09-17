import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { pushRecent, readRecents, removeRecent } from './recents';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (originalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalStorage);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

function installStorage(entries: Record<string, string>, failWrites = false) {
  const values = new Map(Object.entries(entries));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) {
          throw new Error('Storage unavailable');
        }
        values.set(key, value);
      },
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

test('migrates legacy visits and preserves ordering across updates', () => {
  const values = installStorage({ 'jx-lab-recents': '["older","newer",7]' });
  assert.deepEqual(readRecents(), ['older', 'newer']);
  assert.equal(values.has('jx-lab-recents'), false);
  pushRecent('newer');
  assert.deepEqual(readRecents(), ['newer', 'older']);
  removeRecent('older');
  assert.deepEqual(readRecents(), ['newer']);
});

test('an existing empty new list takes precedence over legacy visits', () => {
  installStorage({ 'jx-strategy-recents': '[]', 'jx-lab-recents': '["legacy"]' });
  assert.deepEqual(readRecents(), []);
});

test('failed migration writes do not hide or remove legacy visits', () => {
  const values = installStorage({ 'jx-lab-recents': '["legacy"]' }, true);
  assert.deepEqual(readRecents(), ['legacy']);
  assert.equal(values.get('jx-lab-recents'), '["legacy"]');
});

test('malformed legacy storage is tolerated', () => {
  installStorage({ 'jx-lab-recents': '{invalid' });
  assert.deepEqual(readRecents(), []);
});
