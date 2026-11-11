// Home it's rules: shifts, to-dos, events, what the screen should show right now, and every change
// a person can make. The server and the page both load this one file, so they can't disagree.
// No dependencies. Dates are 'YYYY-MM-DD', times are 'HH:MM' (24 hour), minutes count from midnight.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.H = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LISTS = ['today', 'later', 'shop'];
  const CARDS = ['today', 'todo', 'week', 'coming', 'forecast', 'split', 'budget', 'room'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const blank = () => ({
    lists: { today: [], later: [], shop: [] },
    shifts: [],     // one-off: { id, date, start, end, place }
    rules: [],      // weekly: { id, dow, start, end, place, from, until?, skip: [dates] }
    events: [],     // { id, date, time?, t, d? }
    settings: { guide: 'luffy', travel: 25, rate: 0, nightFrom: '23:30', nightTo: '07:00', idle: 10, look: 'auto',
      city: 'Belleville, Ontario', lat: 44.1628, lon: -77.3832, splitUrl: '', budgetUrl: '', company: '', hide: [] },
    day: ''         // the last day the lists were tidied for
  });

  // ---------- dates and times ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const okDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && !isNaN(Date.parse(v + 'T12:00:00Z'));
  const okTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const utc = date => new Date(date + 'T12:00:00Z');
  const addDays = (date, n) => new Date(utc(date).getTime() + n * 864e5).toISOString().slice(0, 10);
  const dow = date => (utc(date).getUTCDay() + 6) % 7;            // 0 = Monday
  const weekStart = date => addDays(date, -dow(date));
  const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const hhmm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
  // '14:00' -> '2:00 PM'; short drops ':00' -> '2 PM'
  const fmtTime = (t, short) => { const m = mins(t), h = Math.floor(m / 60), mm = m % 60;
    return ((h % 12) || 12) + (short && !mm ? '' : ':' + pad(mm)) + ' ' + (h >= 12 ? 'PM' : 'AM'); };
  const fmtDur = m => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + ' h ' + r + ' min' : h + ' h') : r + ' min'; };
  const fmtHours = m => { const h = Math.round(m / 6) / 10; return (h % 1 ? h.toFixed(1) : String(h)) + ' h'; };
  const fmtDate = (date, long) => (long ? DAYS_LONG : DAYS)[dow(date)] + (long ? ', ' : ' ') + MONTHS[+date.slice(5, 7) - 1] + ' ' + +date.slice(8);
  const money = n => '$' + Math.round(n).toLocaleString('en-CA');
  const shiftMins = x => { const d = mins(x.end) - mins(x.start); return d > 0 ? d : d + 1440; };   // an end at or before the start is the next day

  // ---------- shifts ----------
  // Every shift on one day: the one-off ones plus what the weekly rules give, earliest first.
  function shiftsOn(s, date) {
    const out = [];
    for (const x of s.shifts) if (x.date === date) out.push({ id: x.id, date, start: x.start, end: x.end, place: x.place || 'Work', mins: shiftMins(x) });
    const d = dow(date);
    for (const r of s.rules) {
      if (r.dow !== d || date < r.from || (r.until && date > r.until) || (r.skip || []).includes(date)) continue;
      out.push({ id: r.id, rule: true, date, start: r.start, end: r.end, place: r.place || 'Work', mins: shiftMins(r) });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }
  // The seven days of the week that holds `date`, with hours and pay added up.
  function week(s, date) {
    const from = weekStart(date), days = []; let total = 0;
    for (let i = 0; i < 7; i++) { const d = addDays(from, i), sh = shiftsOn(s, d); for (const x of sh) total += x.mins; days.push({ date: d, shifts: sh }); }
    return { from, days, mins: total, pay: s.settings.rate ? total / 60 * s.settings.rate : null };
  }
  // The next shift that starts after `date` + `nowM`, looking up to five weeks ahead.
  function nextShift(s, date, nowM) {
    for (let i = 0; i < 35; i++) {
      const d = addDays(date, i);
      for (const x of shiftsOn(s, d)) if (i > 0 || mins(x.start) > nowM) return x;
    }
    return null;
  }

  // ---------- keeping the lists tidy as days pass ----------
  // Repeating to-dos come back (daily ones each day, weekly ones each Monday); other finished
  // Today items are cleared the next day; old events are dropped after a week. True when something changed.
  function normalize(s, today) {
    if (s.day === today) return false;
    const monday = weekStart(today);
    for (const k of LISTS) {
      s.lists[k] = s.lists[k].filter(x => !(k === 'today' && x.d && !x.rep && x.on && x.on < today));
      for (const x of s.lists[k]) {
        if (x.d && x.rep === 'daily' && x.on < today) { x.d = false; delete x.on; }
        if (x.d && x.rep === 'weekly' && x.on < monday) { x.d = false; delete x.on; }
      }
    }
    const old = addDays(today, -7);
    s.events = s.events.filter(e => e.date >= old);
    s.shifts = s.shifts.filter(x => x.date >= addDays(today, -60));
    s.day = today;
    return true;
  }

  // ---------- what the screen shows right now ----------
  // now: a Date in the person's own time. sun: { rise, set } in minutes when the weather is known.
  function dayView(s, now, sun) {
    const date = ymd(now), nowM = now.getHours() * 60 + now.getMinutes(), set = s.settings;
    const todays = shiftsOn(s, date);
    // a shift that started yesterday evening and runs past midnight
    const late = shiftsOn(s, addDays(date, -1)).find(x => mins(x.start) + x.mins > 1440 && mins(x.start) + x.mins - 1440 > nowM);
    let shift = null, phase = 'off';   // off | before | soon | working | done
    if (late) { shift = late; phase = 'working'; }
    else {
      shift = todays.find(x => mins(x.start) + x.mins > nowM) || null;
      if (shift) {
        const st = mins(shift.start), leave = st - set.travel;
        phase = nowM >= st ? 'working' : nowM >= leave - 45 ? 'soon' : 'before';
      } else if (todays.length) { shift = todays[todays.length - 1]; phase = 'done'; }
    }
    const startM = shift && !late ? mins(shift.start) : null;
    const leaveM = startM == null ? null : startM - set.travel;
    const inRange = (a, b) => a <= b ? nowM >= a && nowM < b : nowM >= a || nowM < b;
    const night = inRange(mins(set.nightFrom), mins(set.nightTo)) && phase !== 'soon';
    const rise = sun && sun.rise != null ? sun.rise : 420, sunset = sun && sun.set != null ? sun.set : 1140;
    const dark = nowM >= sunset || nowM < rise;
    const todayEvents = s.events.filter(e => e.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const tomorrow = addDays(date, 1);
    const doneM = todays.filter(x => mins(x.start) + x.mins <= nowM).reduce((a, x) => a + x.mins, 0);
    return {
      date, nowM, shift, phase, startM, leaveM,
      toLeave: leaveM == null ? null : leaveM - nowM,
      endM: shift ? (late ? mins(shift.start) + shift.mins - 1440 : mins(shift.start) + shift.mins) : null,
      night, dark, look: set.look === 'auto' ? (dark ? 'dark' : 'light') : set.look,
      events: todayEvents,
      tomorrow: { date: tomorrow, shifts: shiftsOn(s, tomorrow), events: s.events.filter(e => e.date === tomorrow) },
      next: nextShift(s, date, nowM), doneToday: doneM,
      company: !!set.company && set.company >= date
    };
  }

  // ---------- the guide: one line about the day, picked by simple rules ----------
  const LINES = {
    luffy: {
      off: ['Day off! Let’s do something fun!', 'No shift today. The whole day is yours!', 'Free day! Eat well and take it easy.'],
      before: ['Shift at {start}. Leave by {leave} and you’re set!', 'Plenty of time. Out the door by {leave}!'],
      soon: ['{left}! Keys, lunch, jacket. Go go go!', 'Almost time! Leave by {leave}!'],
      working: ['You’re at work until {end}. You’ve got this!', 'Shift’s on until {end}. Keep going!'],
      done: ['Shift done! Rest up, you earned it.', 'Work’s over. Time to eat!'],
      cleared: ['List cleared! That calls for a feast!', 'Everything’s done! Amazing!'],
      night: ['Sleep well. I’ll keep watch.']
    },
    hancock: {
      off: ['No shift today. Spend it as you please.', 'A day off. You deserve nothing less.'],
      before: ['Your shift is at {start}. Leave by {leave}, gracefully.', 'You have time. Be out the door by {leave}.'],
      soon: ['{left}. Even I would not keep them waiting.', 'It is nearly time. Leave by {leave}.'],
      working: ['You are at work until {end}. Carry yourself well.', 'Until {end}. They are lucky to have you.'],
      done: ['Your shift is done. You have earned your rest.', 'Work is finished. Now, relax.'],
      cleared: ['Every task finished. As expected of you.', 'Nothing left to do. Splendid.'],
      night: ['Rest now. Tomorrow will wait.']
    }
  };
  const MOOD = { off: 'calm', before: 'happy', soon: 'worried', working: 'happy', done: 'calm', cleared: 'celebrate', night: 'calm' };
  function guide(s, v) {
    const list = s.lists.today, cleared = list.length > 0 && list.every(x => x.d);
    const key = v.night ? 'night' : v.phase === 'soon' ? 'soon' : cleared ? 'cleared' : v.phase;
    const who = LINES[s.settings.guide] ? s.settings.guide : 'luffy', set = LINES[who][key];
    const line = set[(+v.date.slice(8) + v.date.charCodeAt(6)) % set.length]
      .replace('{start}', v.startM == null ? '' : fmtTime(hhmm(v.startM), true))
      .replace('{leave}', v.leaveM == null ? '' : fmtTime(hhmm(v.leaveM)))
      .replace('{end}', v.endM == null ? '' : fmtTime(hhmm(v.endM), true))
      .replace('{left}', v.toLeave == null ? '' : v.toLeave > 0 ? fmtDur(v.toLeave) : 'Time to go');
    return { who, mood: MOOD[key], line };
  }

  // ---------- what's coming up: the next days' shifts and events, in order ----------
  function coming(s, date, max = 5, days = 14) {
    const rows = [];
    for (let i = 1; i <= days && rows.length < max; i++) {
      const d = addDays(date, i), label = i === 1 ? 'Tomorrow' : i < 7 ? DAYS[dow(d)] : fmtDate(d);
      for (const x of shiftsOn(s, d)) rows.push({ date: d, label, kind: 'shift', start: x.start, end: hhmm(mins(x.start) + x.mins), t: x.place });
      for (const e of s.events.filter(y => y.date === d).sort((a, b) => (a.time || '').localeCompare(b.time || ''))) rows.push({ date: d, label, kind: 'event', time: e.time || '', t: e.t });
    }
    return rows.slice(0, max);
  }

  // ---------- money cards: Split it and Budget it answer in sentences; pull out the headline ----------
  // Returns { big, sub, rows }. If the wording ever changes, the first line is shown as it is.
  function moneyCard(kind, textIn) {
    const t = String(textIn || '').trim(), lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    const plain = { big: '', sub: (lines[0] || '').slice(0, 120), rows: [] };
    if (kind === 'split') {
      if (/all square/i.test(t) && !/^- /m.test(t)) return { big: 'All square', sub: 'Nobody owes anything', rows: [] };
      const o = /Overall: (you’re owed|you owe) (\$[\d,]+(?:\.\d+)?)/.exec(t);
      if (!o) return plain;
      return { big: o[2], sub: o[1] === 'you owe' ? 'you owe in total' : 'owed to you in total', owe: o[1] === 'you owe', rows: lines.filter(l => l.startsWith('- ')).map(l => l.slice(2)).slice(0, 3) };
    }
    const m = /^Safe to spend until (\d{4}-\d\d-\d\d) \((\d+) days?\): (-?\$[\d,]+(?:\.\d+)?), about (-?\$[\d,]+(?:\.\d+)?) a day/.exec(t);
    if (!m) return plain;
    const b = /bills before payday \$[\d,]+(?:\.\d+)? \(([^)]*)\)/.exec(t);
    return { big: m[3], sub: 'safe to spend · ' + m[4] + ' a day until ' + fmtDate(m[1]), owe: m[3][0] === '-',
      rows: b ? b[1].split(', ').map(x => x.replace(/ on (\d{4}-\d\d-\d\d)$/, (_, d) => ' · ' + fmtDate(d))).slice(0, 3) : [] };
  }

  // ---------- changes ----------
  class Bad extends Error { constructor(m) { super(m); this.status = 400; } }
  const bad = m => { throw new Bad(m); };
  const text = (v, max = 80) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const listOf = (s, k) => LISTS.includes(k) ? s.lists[k] : bad('No such list.');
  const need = (ok, m) => ok || bad(m);
  const shiftArgs = a => {
    need(okTime(a.start) && okTime(a.end), 'Pick a start and end time.');
    need(a.start !== a.end, 'A shift needs to end at a different time than it starts.');
    return { start: a.start, end: a.end, place: text(a.place, 40) || 'Work' };
  };
  const SETTINGS = {
    guide: v => ['luffy', 'hancock'].includes(v) ? v : bad('Pick Luffy or Hancock.'),
    look: v => ['auto', 'light', 'dark'].includes(v) ? v : bad('Pick auto, light or dark.'),
    travel: v => { v = Math.round(+v); return v >= 0 && v <= 240 ? v : bad('Travel time is 0 to 240 minutes.'); },
    rate: v => { v = Math.round(+v * 100) / 100; return v >= 0 && v <= 1000 ? v : bad('That hourly rate doesn’t look right.'); },
    idle: v => { v = Math.round(+v); return v >= 0 && v <= 120 ? v : bad('Idle time is 0 to 120 minutes (0 turns it off).'); },
    nightFrom: v => okTime(v) ? v : bad('Pick a time.'),
    nightTo: v => okTime(v) ? v : bad('Pick a time.'),
    splitUrl: v => { v = text(v, 200); return !v || /^https?:\/\/[^\s]+$/.test(v) ? v : bad('That should be a web address starting with https://'); },
    budgetUrl: v => { v = text(v, 200); return !v || /^https?:\/\/[^\s]+$/.test(v) ? v : bad('That should be a web address starting with https://'); }
  };
  // ctx: { today, rid }. Each returns a short message for the page to show.
  const OPS = {
    'todo.add'(s, a) {
      const t = text(a.t); need(t, 'Type something first.');
      const l = listOf(s, a.list || 'today'); need(l.length < 200, 'That list is full. Clear some finished ones first.');
      const x = { id: this.rid('t'), t, d: false };
      if (a.due) { need(okTime(a.due), 'Pick a time.'); x.due = a.due; }
      if (a.rep) { need(['daily', 'weekly'].includes(a.rep), 'Repeat daily or weekly.'); x.rep = a.rep; }
      l.push(x); return 'Added';
    },
    'todo.toggle'(s, a) {
      const x = listOf(s, a.list).find(y => y.id === a.id) || bad('That one is gone.');
      x.d = !x.d; if (x.d) x.on = this.today; else delete x.on;
      return x.d ? 'Done' : 'Not done';
    },
    'todo.del'(s, a) { const l = listOf(s, a.list), i = l.findIndex(y => y.id === a.id); need(i >= 0, 'That one is gone.'); l.splice(i, 1); return 'Removed'; },
    'todo.clear'(s, a) { const l = listOf(s, a.list), n = l.filter(x => x.d && !x.rep).length; s.lists[a.list] = l.filter(x => !x.d || x.rep); return n ? 'Cleared ' + n : 'Nothing to clear'; },
    'todo.move'(s, a) {
      const l = listOf(s, a.list), to = listOf(s, a.to), i = l.findIndex(y => y.id === a.id); need(i >= 0, 'That one is gone.');
      to.push(l.splice(i, 1)[0]); return 'Moved';
    },
    'shift.add'(s, a) {
      need(okDate(a.date), 'Pick a day.');
      const f = shiftArgs(a);
      if (a.repeat) { need(s.rules.length < 60, 'Too many repeating shifts.'); s.rules.push({ id: this.rid('r'), dow: dow(a.date), ...f, from: a.date, skip: [] }); return 'Shift added, every ' + DAYS_LONG[dow(a.date)]; }
      need(s.shifts.length < 2000, 'Too many shifts.');
      s.shifts.push({ id: this.rid('s'), date: a.date, ...f }); return 'Shift added';
    },
    'shift.edit'(s, a) {
      const f = shiftArgs(a), x = s.shifts.find(y => y.id === a.id) || s.rules.find(y => y.id === a.id) || bad('That shift is gone.');
      Object.assign(x, f); return 'Shift changed';
    },
    // A repeating shift: just this day (needs date), or this day and every one after (all).
    'shift.del'(s, a) {
      const i = s.shifts.findIndex(y => y.id === a.id);
      if (i >= 0) { s.shifts.splice(i, 1); return 'Shift removed'; }
      const r = s.rules.find(y => y.id === a.id) || bad('That shift is gone.');
      need(okDate(a.date), 'Pick a day.');
      if (a.all) { if (a.date <= r.from) s.rules = s.rules.filter(y => y !== r); else r.until = addDays(a.date, -1); return 'Repeating shift stopped'; }
      r.skip = [...(r.skip || []).filter(d => d >= this.today), a.date]; return 'Shift removed for that day';
    },
    'shift.copyweek'(s, a) {
      need(okDate(a.week), 'Pick a week.');
      const to = weekStart(a.week), from = addDays(to, -7); let n = 0;
      for (const x of s.shifts.filter(y => y.date >= from && y.date < to)) {
        const date = addDays(x.date, 7);
        if (s.shifts.some(y => y.date === date && y.start === x.start)) continue;
        s.shifts.push({ id: this.rid('s'), date, start: x.start, end: x.end, place: x.place }); n++;
      }
      return n ? 'Copied ' + n + ' shift' + (n === 1 ? '' : 's') : 'Nothing to copy from last week';
    },
    'event.add'(s, a) {
      const t = text(a.t); need(t, 'Give it a name.'); need(okDate(a.date), 'Pick a day.'); need(s.events.length < 2000, 'Too many events.');
      const e = { id: this.rid('e'), date: a.date, t };
      if (a.time) { need(okTime(a.time), 'Pick a time.'); e.time = a.time; }
      s.events.push(e); return 'Added';
    },
    'event.toggle'(s, a) { const e = s.events.find(y => y.id === a.id) || bad('That one is gone.'); e.d = !e.d; return e.d ? 'Done' : 'Not done'; },
    'event.del'(s, a) { const i = s.events.findIndex(y => y.id === a.id); need(i >= 0, 'That one is gone.'); s.events.splice(i, 1); return 'Removed'; },
    'settings.set'(s, a) {
      const fn = Object.prototype.hasOwnProperty.call(SETTINGS, a.key) ? SETTINGS[a.key] : bad('No such setting.');
      s.settings[a.key] = fn(a.value); return 'Saved';
    },
    'card.toggle'(s, a) {
      need(CARDS.includes(a.card), 'No such card.');
      const h = new Set(s.settings.hide); if (h.has(a.card)) h.delete(a.card); else h.add(a.card);
      s.settings.hide = CARDS.filter(c => h.has(c)); return h.has(a.card) ? 'Hidden' : 'Shown';
    },
    // Company mode hides the money cards until tomorrow morning.
    'company.set'(s, a) { s.settings.company = a.on ? this.today : ''; return a.on ? 'Money cards hidden until tomorrow' : 'Money cards shown'; }
  };
  function apply(s, op, args, ctx) {
    const fn = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : bad('Unknown change: ' + op);
    return fn.call(ctx, s, args && typeof args === 'object' ? args : {});
  }
  // Fill in anything an older or hand-edited file is missing, so the rest can trust the shape.
  function fix(s) {
    const b = blank();
    for (const k of Object.keys(b)) if (s[k] === undefined) s[k] = b[k];
    for (const k of LISTS) if (!Array.isArray(s.lists[k])) s.lists[k] = [];
    for (const k of Object.keys(b.settings)) if (s.settings[k] === undefined) s.settings[k] = b.settings[k];
    return s;
  }
  // Made-up data to try things out (and for the preview page).
  function sample(today) {
    const s = blank(), mon = weekStart(today), id = (p, i) => p + 'sample' + i;
    s.lists.today = [{ id: id('t', 1), t: 'Laundry', d: false }, { id: id('t', 2), t: 'Email the landlord', d: false, due: '12:00' },
      { id: id('t', 3), t: 'Pack lunch for work', d: false, rep: 'daily' }, { id: id('t', 4), t: 'Take out recycling', d: true, on: today }];
    s.lists.later = [{ id: id('t', 5), t: 'Book oil change', d: false }, { id: id('t', 6), t: 'Return the hoodie', d: false }];
    s.lists.shop = [{ id: id('t', 7), t: 'Rice', d: false }, { id: id('t', 8), t: 'Eggs', d: false }, { id: id('t', 9), t: 'Coffee', d: false }];
    [[0, '09:00', '17:00'], [1, '14:00', '22:00'], [3, '14:00', '22:00'], [4, '14:00', '22:00']].forEach(([d, a, b], i) =>
      s.shifts.push({ id: id('s', i), date: addDays(mon, d), start: a, end: b, place: 'Work' }));
    if (!shiftsOn(s, today).length) s.shifts.push({ id: id('s', 9), date: today, start: '14:00', end: '22:00', place: 'Work' });
    s.events = [{ id: id('e', 1), date: today, time: '09:00', t: 'Gym', d: true }, { id: id('e', 2), date: today, time: '11:30', t: 'Call the dentist' },
      { id: id('e', 3), date: addDays(today, 2), time: '19:00', t: 'Dinner with Maya' }, { id: id('e', 4), date: addDays(today, 4), t: 'Rent due' }];
    s.settings.rate = 17.5; s.day = today;
    return s;
  }

  return { LISTS, CARDS, DAYS, DAYS_LONG, MONTHS, blank, fix, sample, ymd, okDate, okTime, addDays, dow, weekStart, mins, hhmm, fmtTime, fmtDur, fmtHours, fmtDate, money,
    shiftMins, shiftsOn, week, nextShift, normalize, dayView, guide, coming, moneyCard, OPS, apply, text, Bad };
});
