// Lists the person makes themselves, beside Today, Later and Shopping.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../home.js');

let n = 0;
const ctx = { today: '2026-11-11', rid: p => p + 'x' + (++n) };
const fresh = () => H.fix(H.blank());

test('lists: add one, put things on it, move between lists', () => {
  const s = fresh();
  H.apply(s, 'list.add', { name: '  Gift ideas ' }, ctx);
  assert.strictEqual(s.myLists.length, 1);
  const id = s.myLists[0].id;
  assert.strictEqual(H.listName(s, id), 'Gift ideas');
  assert.deepStrictEqual(H.listKeys(s), ['today', 'later', 'shop', id]);
  H.apply(s, 'todo.add', { list: id, t: 'Scarf for Mum' }, ctx);
  assert.strictEqual(s.lists[id].length, 1);
  H.apply(s, 'todo.move', { list: id, id: s.lists[id][0].id, to: 'shop' }, ctx);
  assert.strictEqual(s.lists[id].length, 0);
  assert.strictEqual(s.lists.shop.length, 1);
});

test('lists: no empty names, no doubles, no more than eight', () => {
  const s = fresh();
  assert.throws(() => H.apply(s, 'list.add', { name: '   ' }, ctx), /name/);
  assert.throws(() => H.apply(s, 'list.add', { name: 'shopping' }, ctx), /already/);
  H.apply(s, 'list.add', { name: 'Trip' }, ctx);
  assert.throws(() => H.apply(s, 'list.add', { name: 'trip' }, ctx), /already/);
  for (let i = 0; i < 7; i++) H.apply(s, 'list.add', { name: 'List ' + i }, ctx);
  assert.throws(() => H.apply(s, 'list.add', { name: 'One too many' }, ctx), /lot of lists/);
});

test('lists: rename and remove; a removed list takes its items with it', () => {
  const s = fresh();
  H.apply(s, 'list.add', { name: 'Trip' }, ctx);
  const id = s.myLists[0].id;
  H.apply(s, 'todo.add', { list: id, t: 'Passport' }, ctx);
  H.apply(s, 'list.rename', { id, name: 'Montreal trip' }, ctx);
  assert.strictEqual(H.listName(s, id), 'Montreal trip');
  H.apply(s, 'list.del', { id }, ctx);
  assert.strictEqual(s.myLists.length, 0);
  assert.strictEqual(s.lists[id], undefined);
  assert.throws(() => H.apply(s, 'todo.add', { list: id, t: 'x' }, ctx), /No such list/);
  assert.throws(() => H.apply(s, 'list.del', { id: 'later' }, ctx), /gone/);
});

test('lists: an odd saved file is tidied, and built-in names cannot be shadowed', () => {
  const s = H.blank();
  s.myLists = [{ id: 'today', name: 'Fake' }, { id: '__proto__', name: 'Bad' }, { id: 'lok1', name: 'Real' }, null];
  H.fix(s);
  assert.deepStrictEqual(s.myLists, [{ id: 'lok1', name: 'Real' }]);
  assert.ok(Array.isArray(s.lists.lok1));
});
