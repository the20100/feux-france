import test from 'node:test';
import assert from 'node:assert/strict';
import {englishPresentation} from '../src/lib/omni/presentation.mjs';

test('English presentation leaves original evidence, IDs, dates and counts intact', () => {
  const original = {id: 7, title: 'Irkoutsk : signal sanitaire à vérifier', occurredAt: '2026-10-02T00:00:00Z', metrics: {confirmed: 0}, sourceTitle: 'An untouched original document', nested: [{actor: 'Contrôle russe évalué'}]};
  const evidence = JSON.stringify(original);
  const translated = englishPresentation(original);
  assert.equal(translated.title, 'Irkutsk: unverified health signal');
  assert.equal(translated.nested[0].actor, 'Assessed Russian control');
  assert.equal(translated.sourceTitle, original.sourceTitle);
  assert.equal(translated.id, original.id);
  assert.equal(translated.occurredAt, original.occurredAt);
  assert.deepEqual(translated.metrics, original.metrics);
  assert.equal(JSON.stringify(original), evidence);
});
