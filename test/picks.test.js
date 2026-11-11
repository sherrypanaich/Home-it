// Stories an assistant sends to the News page ("For you").
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../home.js');

let n = 0;
const NOW = Date.UTC(2026, 10, 11, 12);
const ctx = { today: '2026-11-11', rid: p => p + 'x' + (++n), now: NOW };
const fresh = () => H.fix(H.blank());

test('picks: newest first, tidy text, same headline twice replaces the old one', () => {
  const s = fresh();
  H.apply(s, 'pick.add', { t: '  Snow  tonight ', sum: 'Up to 10 cm.', src: 'CBC', url: 'https://example.com/a' }, ctx);
  H.apply(s, 'pick.add', { t: 'Tire deals', sum: 'Two shops.' }, ctx);
  assert.deepStrictEqual(s.picks.map(x => x.t), ['Tire deals', 'Snow tonight']);
  assert.strictEqual(s.picks[1].url, 'https://example.com/a');
  H.apply(s, 'pick.add', { t: 'snow tonight', sum: 'Now 15 cm.' }, ctx);
  assert.deepStrictEqual(s.picks.map(x => x.t), ['snow tonight', 'Tire deals']);
});

test('picks: needs a headline and a safe link; keeps twelve; three days and they are gone', () => {
  const s = fresh();
  assert.throws(() => H.apply(s, 'pick.add', { t: ' ' }, ctx), /headline/);
  assert.throws(() => H.apply(s, 'pick.add', { t: 'x', url: 'javascript:alert(1)' }, ctx), /https/);
  for (let i = 0; i < 15; i++) H.apply(s, 'pick.add', { t: 'Story ' + i }, ctx);
  assert.strictEqual(s.picks.length, 12);
  assert.strictEqual(s.picks[0].t, 'Story 14');
  assert.strictEqual(H.freshPicks(s, NOW + 2 * 864e5).length, 12);
  assert.strictEqual(H.freshPicks(s, NOW + 4 * 864e5).length, 0);
  H.apply(s, 'pick.add', { t: 'Later' }, { ...ctx, now: NOW + 4 * 864e5 });
  assert.deepStrictEqual(s.picks.map(x => x.t), ['Later']);
});

test('picks: remove one, clear all, and an odd saved file is tidied', () => {
  const s = fresh();
  H.apply(s, 'pick.add', { t: 'A' }, ctx); H.apply(s, 'pick.add', { t: 'B' }, ctx);
  H.apply(s, 'pick.del', { id: s.picks[0].id }, ctx);
  assert.deepStrictEqual(s.picks.map(x => x.t), ['A']);
  assert.throws(() => H.apply(s, 'pick.del', { id: 'nope' }, ctx), /gone/);
  H.apply(s, 'pick.clear', {}, ctx);
  assert.strictEqual(s.picks.length, 0);
  const o = H.blank(); o.picks = [null, { id: 'n1', t: 'Ok', at: NOW, url: 'http://plain.example' }, { id: 'n2', at: NOW }, 'x'];
  H.fix(o);
  assert.deepStrictEqual(o.picks, [{ id: 'n1', t: 'Ok', sum: '', src: '', url: '', at: NOW }]);
});
