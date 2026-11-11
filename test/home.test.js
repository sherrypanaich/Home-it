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
  assert.equal(g.who, 'luffy'); assert.equal(g.mood, 'happy'); assert.doesNotMatch(g.line, /1:35 PM|\{/);   // the card already says when to leave
  H.apply(s, 'todo.add', { t: 'Pack lunch' }, ctx());
  g = H.guide(s, H.dayView(s, at('2026-11-10', '10:20')));
  assert.match(g.line, /1 to-do .*“Pack lunch”/); assert.equal(g.mood, 'happy');
  g = H.guide(s, H.dayView(s, at('2026-11-10', '15:00')));
  assert.match(g.line, /1 to-do/); assert.doesNotMatch(g.line, /\{/);
  H.apply(s, 'event.add', { date: '2026-11-10', time: '11:30', t: 'Call the dentist' }, ctx());
  g = H.guide(s, H.dayView(s, at('2026-11-10', '10:20')));
  assert.match(g.line, /Call the dentist at 11:30 AM/);
  s.lists.today = [];
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
  H.apply(s, 'event.add', { t: 'Old', date: '2024-11-01' }, c); H.apply(s, 'event.add', { t: 'Last month', date: '2026-10-20' }, c); H.apply(s, 'event.add', { t: 'New', date: '2026-11-12', time: '15:00' }, c);
  assert.equal(H.normalize(s, '2026-11-10'), false);
  assert.equal(H.normalize(s, '2026-11-11'), true);
  assert.deepEqual(s.lists.today.map(x => [x.t, x.d]), [['Lunch', false], ['Bins', true]]);
  H.normalize(s, '2026-11-16');                                        // the next Monday
  assert.equal(s.lists.today[1].d, false);
  assert.deepEqual(s.events.map(e => e.t), ['Last month', 'New']);            // kept for two years, then dropped
  assert.deepEqual(H.eventList(s, '2026-11-16').map(e => e.t), []);
});

test('copy last week, events, cards, company and settings', () => {
  const s = withShift(), c = ctx();
  assert.equal(H.apply(s, 'shift.copyweek', { week: '2026-11-17' }, c), 'Copied 1 shift');
  assert.equal(H.apply(s, 'shift.copyweek', { week: '2026-11-17' }, c), 'Nothing to copy from last week');
  assert.equal(H.shiftsOn(s, '2026-11-17').length, 1);
  assert.throws(() => H.apply(s, 'shift.add', { date: '2026-11-10', start: '09:00', end: '09:00' }, c), /different time/);
  assert.throws(() => H.apply(s, 'event.add', { t: 'x', date: 'soon' }, c), /Pick a day/);
  H.apply(s, 'card.toggle', { card: 'coming' }, c); assert.deepEqual(s.settings.hide, ['coming']);
  H.apply(s, 'card.toggle', { card: 'coming' }, c); assert.deepEqual(s.settings.hide, []);
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

test('coming up lists the next days in order, shifts and events together', () => {
  const s = H.blank();
  s.shifts.push({ id: 's1', date: '2026-11-12', start: '14:00', end: '22:00', place: 'Work' });
  s.events.push({ id: 'e2', date: '2026-11-14', time: '18:00', t: 'Dinner' }, { id: 'e1', date: '2026-11-12', t: 'Bins out' }, { id: 'e0', date: '2026-11-11', t: 'Today, not listed' });
  const rows = H.coming(s, '2026-11-11');
  assert.deepEqual(rows.map(r => r.label + ' ' + r.kind + ' ' + r.t), ['Tomorrow shift Work', 'Tomorrow event Bins out', 'Sat event Dinner']);
  assert.equal(rows[0].end, '22:00');
  assert.equal(H.coming(s, '2026-11-11', 1).length, 1);
});

test('money cards pull the headline out of what Split it and Budget it say', () => {
  const a = H.moneyCard('split', 'Balances for Sherry:\n- You owe Sam $12.50\n- Maya owes you $40.00\nOverall: you’re owed $27.50.');
  assert.equal(a.big, '$27.50'); assert.equal(a.owe, false); assert.deepEqual(a.rows, ['You owe Sam $12.50', 'Maya owes you $40.00']);
  assert.equal(H.moneyCard('split', 'Balances for Sherry:\n- You owe Sam $12.50\nOverall: you owe $12.50.').owe, true);
  assert.equal(H.moneyCard('split', 'Sherry, you’re all square with everyone.').big, 'All square');
  const b = H.moneyCard('budget', 'Safe to spend until 2026-11-20 (9 days): $318, about $35 a day.\nChequing $900, credit cards $400, bills before payday $182 (Phone $55 on 2026-11-16, Internet $127 on 2026-11-18).\nPay: Work, about $1,200, every 2 weeks.');
  assert.equal(b.big, '$318'); assert.match(b.sub, /\$35 a day until Fri Nov 20/); assert.deepEqual(b.rows, ['Phone $55 · Mon Nov 16', 'Internet $127 · Wed Nov 18']);
  const c = H.moneyCard('budget', 'Budget it hasn’t spotted a paycheque yet (it needs two pay deposits).');
  assert.equal(c.big, ''); assert.match(c.sub, /hasn’t spotted a paycheque/);
});

test('events can repeat, be edited, and are ticked one day at a time', () => {
  const s = H.blank(), c = { today: '2026-11-11', rid: p => p + Math.random() };
  H.apply(s, 'event.add', { t: 'Rent', date: '2026-01-31', rep: 'monthly' }, c);
  H.apply(s, 'event.add', { t: 'Gym', date: '2026-11-04', time: '09:00', rep: 'weekly' }, c);
  H.apply(s, 'event.add', { t: 'Birthday', date: '2024-02-29', rep: 'yearly' }, c);
  assert.deepEqual(H.eventsOn(s, '2026-02-28').map(e => e.t).sort(), ['Birthday', 'Rent']);   // no 31st (or 29th) this February
  assert.deepEqual(H.eventsOn(s, '2026-03-31').map(e => e.t), ['Rent']);
  assert.deepEqual(H.eventsOn(s, '2027-02-28').map(e => e.t).sort(), ['Birthday', 'Rent']);
  assert.deepEqual(H.eventsOn(s, '2026-11-11').map(e => e.t), ['Gym']);
  assert.deepEqual(H.eventsOn(s, '2026-10-28').map(e => e.t), []);              // not before it starts
  const gym = s.events[1];
  H.apply(s, 'event.toggle', { id: gym.id }, c);
  assert.equal(H.eventsOn(s, '2026-11-11')[0].d, true); assert.equal(H.eventsOn(s, '2026-11-18')[0].d, false);
  assert.deepEqual(H.eventList(s, '2026-11-11').map(e => e.t + ' ' + e.date), ['Gym 2026-11-11', 'Rent 2026-11-30', 'Birthday 2027-02-28']);
  H.normalize(s, '2026-12-25'); assert.equal(s.events.length, 3);               // repeating ones are never tidied away
  H.apply(s, 'event.edit', { id: gym.id, t: 'Swim', date: '2026-11-12', time: '' }, c);
  assert.deepEqual(H.eventsOn(s, '2026-11-12').map(e => e.t + (e.time || '') + (e.rep || '')), ['Swim']);
  assert.equal(H.coming(s, '2026-11-11')[0].t, 'Swim');
});

test('to-dos can be renamed, and the same shift can’t be added twice', () => {
  const s = H.blank(), c = { today: '2026-11-11', rid: p => p + Math.random() };
  H.apply(s, 'todo.add', { t: 'Milk' }, c);
  H.apply(s, 'todo.edit', { list: 'today', id: s.lists.today[0].id, t: 'Oat milk' }, c);
  assert.equal(s.lists.today[0].t, 'Oat milk');
  H.apply(s, 'shift.add', { date: '2026-11-12', start: '14:00', end: '22:00' }, c);
  assert.throws(() => H.apply(s, 'shift.add', { date: '2026-11-12', start: '14:00', end: '20:00' }, c), /already a shift/);
  assert.throws(() => H.apply(s, 'shift.add', { date: '2026-11-12', start: '14:00', end: '20:00', repeat: true }, c), /already a shift/);
  H.apply(s, 'shift.edit', { id: s.shifts[0].id, start: '15:00', end: '23:00' }, c);
  assert.equal(H.shiftsOn(s, '2026-11-12')[0].start, '15:00');
});

test('changing a repeating shift leaves the weeks already worked alone, and a shift can move day', () => {
  const s = H.blank(), c = { today: '2026-11-11', rid: p => p + Math.random() }; s.settings.rate = 20;
  H.apply(s, 'shift.add', { date: '2026-10-05', start: '09:00', end: '17:00', repeat: true }, c);      // Mondays, 8 h
  H.apply(s, 'shift.del', { id: s.rules[0].id, date: '2026-10-12' }, c);                               // one Monday off
  const id = s.rules[0].id, oct = () => H.months(s, '2026-11-11').find(m => m.ym === '2026-10');
  assert.equal(oct().mins, 3 * 480);
  H.apply(s, 'shift.edit', { id, date: '2026-11-16', start: '10:00', end: '14:00' }, c);
  assert.equal(oct().mins, 3 * 480);                                    // October didn't change
  assert.equal(H.shiftsOn(s, '2026-11-09')[0].mins, 480);
  assert.equal(H.shiftsOn(s, '2026-11-16')[0].mins, 240);
  assert.equal(H.shiftsOn(s, '2026-11-23')[0].start, '10:00');
  // move it to Tuesdays from the 24th: the Monday before stays, later Mondays go
  H.apply(s, 'shift.edit', { id: H.shiftsOn(s, '2026-11-23')[0].id, date: '2026-11-23', day: '2026-11-24', start: '10:00', end: '14:00' }, c);
  assert.equal(H.shiftsOn(s, '2026-11-16').length, 1);
  assert.equal(H.shiftsOn(s, '2026-11-23').length, 0);
  assert.equal(H.shiftsOn(s, '2026-11-24').length, 1);
  assert.equal(H.shiftsOn(s, '2026-12-01').length, 1);
  // a one-off shift moves day, but not onto another shift at the same time
  H.apply(s, 'shift.add', { date: '2026-11-13', start: '10:00', end: '12:00' }, c);
  assert.throws(() => H.apply(s, 'shift.edit', { id: s.shifts[0].id, day: '2026-11-24', start: '10:00', end: '12:00' }, c), /already a shift/);
  H.apply(s, 'shift.edit', { id: s.shifts[0].id, day: '2026-11-14', start: '10:00', end: '12:00' }, c);
  assert.equal(H.shiftsOn(s, '2026-11-14').length, 1);
  // months: this month knows what is already worked, and pay follows the rate
  const nov = H.months(s, '2026-11-11')[0];
  assert.equal(nov.ym, '2026-11'); assert.equal(nov.doneMins, 2 * 480); assert.equal(nov.pay, nov.mins / 60 * 20);
  // old shifts stay after many new days
  H.normalize(s, '2027-06-01');
  assert.equal(H.months(s, '2027-06-01', 12).some(m => m.ym === '2026-10'), true);
});

test('a shared calendar file is read into days: time zones, repeats, skipped and moved days', () => {
  const read = require('../ics').read;
  const ics = ['BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Dentist\\, downtown', 'DTSTART;VALUE=DATE:20261112', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Yoga', 'DTSTART:20261102T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261118T000000', 'EXDATE:20261109T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'RECURRENCE-ID:20261111T100000', 'SUMMARY:Yoga (moved)', 'DTSTART:20261111T190000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261114', 'DTEND;VALUE=DATE:20261116', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:d', 'SUMMARY:Rent', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:e', 'SUMMARY:Stand', ' up', 'DTSTART:20261110T090000', 'RRULE:FREQ=DAILY;COUNT=2', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:f', 'SUMMARY:Called off', 'STATUS:CANCELLED', 'DTSTART:20261110T090000', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  assert.deepEqual(read(ics, '2026-11-09', '2026-12-31').map(r => `${r.date} ${r.time || 'all-day'} ${r.t}`), [
    '2026-11-10 09:00 Standup', '2026-11-11 09:00 Standup', '2026-11-11 19:00 Yoga (moved)', '2026-11-12 all-day Dentist, downtown',
    '2026-11-14 all-day Trip', '2026-11-15 all-day Trip', '2026-11-16 10:00 Yoga', '2026-12-31 all-day Rent']);
  const s = H.blank(); s.cal = [{ date: '2026-11-12', time: '17:00', t: 'Dentist' }];
  assert.equal(H.eventsOn(s, '2026-11-12')[0].cal, true); assert.equal(H.coming(s, '2026-11-11')[0].t, 'Dentist');
});

test('money cards use the plain numbers when an app sends them, and the sentence when it doesn’t', () => {
  const sp = H.moneyCard('split', 'Reworded sentence nobody can read', { net: -27.5, people: [{ name: 'Sam', amount: -40 }, { name: 'Jo', amount: 12.5 }] });
  assert.deepEqual(sp, { big: '$27.50', sub: 'you owe in total', owe: true, rows: ['You owe Sam $40.00', 'Jo owes you $12.50'] });
  assert.equal(H.moneyCard('split', '', { net: 0, people: [] }).big, 'All square');
  const bu = H.moneyCard('budget', 'Something new', { safe: 412.3, perDay: 34.36, until: '2026-11-20', bills: [{ name: 'Phone', amount: 60, date: '2026-11-15' }] });
  assert.equal(bu.big, '$412.30'); assert.match(bu.sub, /\$34\.36 a day until Fri Nov 20/); assert.deepEqual(bu.rows, ['Phone $60.00 · Sun Nov 15']);
  assert.equal(H.moneyCard('split', 'Overall: you owe $27.50.', { nonsense: true }).big, '$27.50');   // falls back to the sentence
});
