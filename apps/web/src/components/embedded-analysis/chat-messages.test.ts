import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmbeddedAnalysisPart } from '@jixie/shared';
import { embeddedUserMessage, retainEmbeddedPart, upsertAssistantMessage } from './chat-messages';

const part: EmbeddedAnalysisPart = {
  type: 'embedded_analysis',
  title: 'Sample',
  reference: { analysisId: 'analysis', versionId: 'version', runId: 'original' },
};
test('stream replay restores a card once and completion replaces the same assistant message', () => {
  const user = embeddedUserMessage('Inspect this sample', []);
  const first = retainEmbeddedPart([user], part, 'turn');
  assert.deepEqual(retainEmbeddedPart(first, part, 'turn'), first);
  const done = upsertAssistantMessage(first, {
    role: 'assistant',
    turnId: 'turn',
    parts: [{ type: 'text', text: 'Result' }, part],
  });
  assert.equal(done.length, 2);
  assert.deepEqual(done[0], user);
  assert.equal(done[1].parts.length, 2);
  const nextPart = { ...part, reference: { ...part.reference, runId: 'next' } };
  assert.equal(retainEmbeddedPart(done, nextPart, 'next-turn').length, 3);
  assert.deepEqual(done[1].parts[1], part);
});
