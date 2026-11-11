// The rules in home.js: shifts, the week, what the screen shows at each time of day, and every change.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../home');

const ctx = (today = '2026-11-10') => { let n = 0; return { today, rid: p => p + (++n) }; };
const at = (date, time) => new Date(`${date}T${time}:00`);
const withShift = () => { const s = H.blank(); H.apply(s, 'shift.add', { date: '2026-11-10', start: '14:00', end: '22:00' }, ctx()); return s; };

test('dates and times', () => {
  assert.equal(H.dow('2026-11-10'), 1);                    // a Tuesday
  assert.equal(H.weekStart('2026-11-10'), '2026-11-09');
  assert.equal(H.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(H.fmtTime('14:00'), '2:00 PM'); assert.equal(H.fmtTime('14:00', true), '2 PM'); assert.equal(H.fmtTime('00:05'), '12:05 AM');
  assert.equal(H.fmtDur(195), '3 h 15 min'); assert.equal(H.fmtDur(25), '25 min'); assert.equal(H.fmtHours(450), '7.5 h');
  assert.equal(H.fmtDate('2026-11-10', true), 'Tuesday, Nov 10');
  assert.ok(H.okDate('2026-02-28')); assert.ok(!H.okDate('2026-13-01')); assert.ok(!H.okTime('24:00'));
});

test('one-off and weekly shifts, hours and pay for the week', () => {
  const s = withShift(), c = ctx();
  H.apply(s, 'shift.add', { date: '2026-11-12', start: '09:00', end: '17:30', repeat: true }, c);
  H.apply(s, 'settings.set', { key: 'rate', value: '17.5' }, c);
  assert.equal(H.shiftsOn(s, '2026-11-12').length, 1);
  assert.equal(H.shiftsOn(s, '2026-11-19')[0].rule, true);    // the next Thursday too
  assert.equal(H.shiftsOn(s, '2026-11-05').length, 0);        // but not before it started
  const wk = H.week(s, '2026-11-10');
  assert.equal(wk.from, '2026-11-09'); assert.equal(wk.mins, 480 + 510); assert.equal(wk.pay, 16.5 * 17.5);
  // skip one day, then stop it
  const id = s.rules[0].id;
  H.apply(s, 'shift.del', { id, date: '2026-11-19' }, c);
  assert.equal(H.shiftsOn(s, '2026-11-19').length, 0); assert.equal(H.shiftsOn(s, '2026-11-26').length, 1);
  H.apply(s, 'shift.del', { id, date: '2026-11-26', all: true }, c);
  assert.equal(H.shiftsOn(s, '2026-11-26').length, 0); assert.equal(H.shiftsOn(s, '2026-11-12').length, 1);
});

test('an overnight shift counts its hours and carries into the next morning', () => {
  const s = H.blank(); H.apply(s, 'shift.add', { date: '2026-11-10', start: '22:00', end: '06:00' }, ctx());
  assert.equal(H.shiftsOn(s, '2026-11-10')[0].mins, 480);
  const v = H.dayView(s, at('2026-11-11', '03:00'));
  assert.equal(v.phase, 'working'); assert.equal(v.endM, 360); assert.equal(v.night, true);
  assert.equal(H.dayView(s, at('2026-11-11', '07:30')).phase, 'off');
});

test('the day moves through before, soon, working and done', () => {
  const s = withShift();
  let v = H.dayView(s, at('2026-11-10', '10:20'));
  assert.equal(v.phase, 'before'); assert.equal(v.leaveM, 13 * 60 + 35); assert.equal(v.toLeave, 195); assert.equal(v.look, 'light');
  v = H.dayView(s, at('2026-11-10', '13:10'));
  assert.equal(v.phase, 'soon'); assert.equal(v.toLeave, 25);
  assert.equal(H.dayView(s, at('2026-11-10', '13:50')).phase, 'soon');      // late, but the shift hasn't started
  assert.equal(H.dayView(s, at('2026-11-10', '15:00')).phase, 'working');
  v = H.dayView(s, at('2026-11-10', '22:30'), { rise: 416, set: 1004 });
  assert.equal(v.phase, 'done'); assert.equal(v.doneToday, 480); assert.equal(v.look, 'dark'); assert.equal(v.night, false);
  assert.equal(H.dayView(s, at('2026-11-10', '23:45')).night, true);
  assert.equal(H.dayView(s, at('2026-11-11', '12:00')).phase, 'off');
  assert.equal(H.dayView(s, at('2026-11-10', '12:00'), { rise: 416, set: 1004 }).dark, false);
});

test('a chosen look wins over the time of day, and soon beats night', () => {
  const s = H.blank(), c = ctx();
  H.apply(s, 'settings.set', { key: 'look', value: 'light' }, c);
  assert.equal(H.dayView(s, at('2026-11-10', '23:00')).look, 'light');
  H.apply(s, 'shift.add', { date: '2026-11-10', start: '06:00', end: '14:00' }, c);
  const v = H.dayView(s, at('2026-11-10', '05:20'));
  assert.equal(v.phase, 'soon'); assert.equal(v.night, false);
});

test('next shift and tomorrow', () => {
  const s = withShift(); H.apply(s, 'shift.add', { date: '2026-11-12', start: '14:00', end: '22:00' }, ctx());
  const v = H.dayView(s, at('2026-11-10', '22:30'));
  assert.equal(v.next.date, '2026-11-12'); assert.equal(v.tomorrow.shifts.length, 0);
});

test('the guide picks a mood and a line with the real times in it', () => {
  const s = withShift();
  let g = H.guide(s, H.dayView(s, at('2026-11-10', '10:20')));
  assert.equal(g.who, 'luffy'); assert.equal(g.mood, 'happy'); assert.match(g.line, /1:35 PM/);
  g = H.guide(s, H.dayView(s, at('2026-11-10', '13:10')));
  assert.equal(g.mood, 'worried'); assert.doesNotMatch(g.line, /\{/);
  H.apply(s, 'todo.add', { t: 'Laundry' }, ctx()); H.apply(s, 'todo.toggle', { list: 'today', id: s.lists.today[0].id }, ctx());
  H.apply(s, 'settings.set', { key: 'guide', value: 'hancock' }, ctx());
  g = H.guide(s, H.dayView(s, at('2026-11-10', '10:20')));
  assert.equal(g.who, 'hancock'); assert.equal(g.mood, 'celebrate');
});

test('to-dos: add, tick, move, clear, and the checks on what is typed', () => {
  const s = H.blank(), c = ctx();
  H.apply(s, 'todo.add', { t: '  Laundry  ' }, c); H.apply(s, 'todo.add', { t: 'Rice', list: 'shop' }, c); H.apply(s, 'todo.add', { t: 'Lunch', rep: 'daily' }, c);
  assert.equal(s.lists.today[0].t, 'Laundry');
  H.apply(s, 'todo.toggle', { list: 'today', id: s.lists.today[0].id }, c); H.apply(s, 'todo.toggle', { list: 'today', id: s.lists.today[1].id }, c);
  assert.equal(s.lists.today[0].on, '2026-11-10');
  H.apply(s, 'todo.move', { list: 'shop', to: 'later', id: s.lists.shop[0].id }, c);
  assert.equal(s.lists.later.length, 1); assert.equal(s.lists.shop.length, 0);
  assert.equal(H.apply(s, 'todo.clear', { list: 'today' }, c), 'Cleared 1');
  assert.deepEqual(s.lists.today.map(x => x.t), ['Lunch']);           // the repeating one stays
  assert.throws(() => H.apply(s, 'todo.add', { t: '   ' }, c), /Type something/);
  assert.throws(() => H.apply(s, 'todo.add', { t: 'x', list: '__proto__' }, c), /No such list/);
  assert.throws(() => H.apply(s, 'constructor', {}, c), /Unknown change/);
  assert.throws(() => H.apply(s, 'settings.set', { key: '__proto__', value: 1 }, c), /No such setting/);
});

test('a new day: repeating to-dos come back, finished ones go, old events drop', () => {
  const s = H.blank(), c = ctx('2026-11-10'); s.day = '2026-11-10';
  for (const [t, rep] of [['Lunch', 'daily'], ['Bins', 'weekly'], ['Laundry', undefined]]) H.apply(s, 'todo.add', { t, rep }, c);
  for (const x of s.lists.today) H.apply(s, 'todo.toggle', { list: 'today', id: x.id }, c);
  H.apply(s, 'event.add', { t: 'Old', date: '2026-11-01' }, c); H.apply(s, 'event.add', { t: 'New', date: '2026-11-12', time: '15:00' }, c);
  assert.equal(H.normalize(s, '2026-11-10'), false);
  assert.equal(H.normalize(s, '2026-11-11'), true);
  assert.deepEqual(s.lists.today.map(x => [x.t, x.d]), [['Lunch', false], ['Bins', true]]);
  H.normalize(s, '2026-11-16');                                        // the next Monday
  assert.equal(s.lists.today[1].d, false);
  assert.deepEqual(s.events.map(e => e.t), ['New']);
});

test('copy last week, events, cards, company and settings', () => {
  const s = withShift(), c = ctx();
  assert.equal(H.apply(s, 'shift.copyweek', { week: '2026-11-17' }, c), 'Copied 1 shift');
  assert.equal(H.apply(s, 'shift.copyweek', { week: '2026-11-17' }, c), 'Nothing to copy from last week');
  assert.equal(H.shiftsOn(s, '2026-11-17').length, 1);
  assert.throws(() => H.apply(s, 'shift.add', { date: '2026-11-10', start: '09:00', end: '09:00' }, c), /different time/);
  assert.throws(() => H.apply(s, 'event.add', { t: 'x', date: 'soon' }, c), /Pick a day/);
  H.apply(s, 'card.toggle', { card: 'tv' }, c); assert.deepEqual(s.settings.hide, ['tv']);
  H.apply(s, 'card.toggle', { card: 'tv' }, c); assert.deepEqual(s.settings.hide, []);
  H.apply(s, 'company.set', { on: true }, c);
  assert.equal(H.dayView(s, at('2026-11-10', '20:00')).company, true); assert.equal(H.dayView(s, at('2026-11-11', '08:00')).company, false);
  assert.throws(() => H.apply(s, 'settings.set', { key: 'splitUrl', value: 'javascript:alert(1)' }, c), /web address/);
  assert.throws(() => H.apply(s, 'settings.set', { key: 'travel', value: 999 }, c), /0 to 240/);
  H.apply(s, 'settings.set', { key: 'travel', value: '40' }, c); assert.equal(s.settings.travel, 40);
});

test('sample data always has a shift today, and fix fills in missing parts', () => {
  for (const d of ['2026-11-09', '2026-11-11', '2026-11-15']) assert.ok(H.shiftsOn(H.sample(d), d).length);
  const s = H.fix({ lists: { today: [] }, settings: { guide: 'hancock' } });
  assert.equal(s.settings.travel, 25); assert.equal(s.settings.guide, 'hancock'); assert.deepEqual(s.lists.shop, []); assert.deepEqual(s.rules, []);
});
