import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '@jixie/shared';
import * as turnBus from './turn-bus.js';

const TRACE = { name: 'runScreen', argsSummary: '{}', ok: true, rows: 3, ms: 5 };

function collect(): { events: AgentStreamEvent[]; send: (ev: AgentStreamEvent) => void } {
  const events: AgentStreamEvent[] = [];
  return { events, send: (ev) => events.push(ev) };
}

afterEach(() => turnBus._resetForTest());

describe('turnBus', () => {
  it('replays accumulated text + trace as the first snapshot frame for a late subscriber', () => {
    turnBus.start('t1', 'u1', 'strategy:s1');
    turnBus.publish('t1', { type: 'delta', text: '你好' });
    turnBus.publish('t1', { type: 'tool_done', item: TRACE });
    turnBus.publish('t1', { type: 'delta', text: ',世界' });

    const { events, send } = collect();
    const result = turnBus.subscribe('t1', 'u1', send);
    expect(result.kind).toBe('live');
    expect(events[0]).toEqual({ type: 'snapshot', text: '你好,世界', trace: [TRACE] });

    // Live events flow after the snapshot.
    turnBus.publish('t1', { type: 'delta', text: '!' });
    expect(events[1]).toEqual({ type: 'delta', text: '!' });
  });

  it('broadcasts the terminal event and serves snapshot+final to post-finish subscribers (TTL window)', () => {
    turnBus.start('t1', 'u1', null);
    turnBus.publish('t1', { type: 'delta', text: '答案' });
    const live = collect();
    turnBus.subscribe('t1', 'u1', live.send);

    const done: AgentStreamEvent = {
      type: 'done',
      parts: [{ type: 'text', text: '答案' }],
      code: '',
      changed: false,
      attempts: 1,
      toolTrace: [],
    };
    turnBus.finish('t1', done);
    expect(live.events.at(-1)).toEqual(done);

    const late = collect();
    const result = turnBus.subscribe('t1', 'u1', late.send);
    expect(result.kind).toBe('finished');
    expect(late.events).toEqual([{ type: 'snapshot', text: '答案', trace: [] }, done]);
  });

  it('rejects unknown turns and other users', () => {
    turnBus.start('t1', 'u1', null);
    expect(turnBus.subscribe('nope', 'u1', vi.fn()).kind).toBe('not_found');
    expect(turnBus.subscribe('t1', 'u2', vi.fn()).kind).toBe('forbidden');
    expect(turnBus.cancel('t1', 'u2')).toBe(false); // not the owner
  });

  it('findRunning locates the live turn by entity and forgets it after finish', () => {
    turnBus.start('t1', 'u1', 'screen:c1');
    expect(turnBus.findRunning('screen:c1', 'u1')).toBe('t1');
    expect(turnBus.findRunning('screen:c1', 'u2')).toBeNull(); // other user
    expect(turnBus.findRunning('screen:other', 'u1')).toBeNull();

    turnBus.finish('t1', { type: 'cancelled' });
    expect(turnBus.findRunning('screen:c1', 'u1')).toBeNull();
  });

  it('cancel aborts the signal exactly once for the owner', () => {
    const { signal } = turnBus.start('t1', 'u1', null);
    expect(signal.aborted).toBe(false);
    expect(turnBus.cancel('t1', 'u1')).toBe(true);
    expect(signal.aborted).toBe(true);
    turnBus.finish('t1', { type: 'cancelled' });
    expect(turnBus.cancel('t1', 'u1')).toBe(false); // already done
  });
});
