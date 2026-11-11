// Reads a calendar link (.ics, the kind Apple, Google and Outlook calendars can share) into plain
// { date, time?, t } rows for the days asked for. Times are turned into this computer's local time.
// Covers what personal calendars use: all-day and timed events, daily / weekly / monthly / yearly
// repeats with INTERVAL, COUNT, UNTIL and BYDAY, skipped days (EXDATE) and moved ones (RECURRENCE-ID).
'use strict';
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const unesc = v => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();

// The offset (ms) of a named time zone at a moment, from the clock on its wall.
function zoneOffset(tz, utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(new Date(utcMs)).map(x => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}
// '20261112T183000Z', '20261112T183000' with a TZID, or '20261112' -> { date, time? } in local time
function when(value, params) {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined) return { date: `${y}-${mo}-${d}` };
  let at;
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  if (z) at = new Date(wall);
  else if (params.TZID) {
    try { let off = zoneOffset(params.TZID, wall); off = zoneOffset(params.TZID, wall - off); at = new Date(wall - off); }
    catch { at = new Date(+y, +mo - 1, +d, +h, +mi); }      // a zone name we don't know: read it as local
  } else at = new Date(+y, +mo - 1, +d, +h, +mi);
  return { date: ymd(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
}
function parse(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n'), events = [];
  let cur = null, depth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { ex: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }      // alarms inside an event
    if (line.startsWith('END:') && depth) { depth--; continue; }
    if (line === 'END:VEVENT') { if (cur.start) events.push(cur); cur = null; continue; }
    if (depth) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(';'), value = line.slice(i + 1);
    const params = Object.fromEntries(ps.map(p => { const k = p.indexOf('='); return [p.slice(0, k).toUpperCase(), p.slice(k + 1).replace(/^"|"$/g, '')]; }));
    const key = name.toUpperCase();
    if (key === 'SUMMARY') cur.t = unesc(value).slice(0, 80);
    else if (key === 'UID') cur.uid = value;
    else if (key === 'DTSTART') cur.start = when(value, params);
    else if (key === 'DTEND') cur.end = when(value, params);
    else if (key === 'STATUS') cur.status = value.toUpperCase();
    else if (key === 'RRULE') cur.rule = Object.fromEntries(value.split(';').map(p => p.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
    else if (key === 'EXDATE') for (const v of value.split(',')) { const w = when(v, params); if (w) cur.ex.push(w.date); }
    else if (key === 'RECURRENCE-ID') cur.moved = when(value, params);
  }
  return events;
}
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// Every day an event lands on between from and to (both YYYY-MM-DD, inclusive).
function days(ev, from, to, skip) {
  const out = [], r = ev.rule, first = ev.start.date;
  const push = d => { if (d >= from && d <= to && !ev.ex.includes(d) && !skip.has(d)) out.push(d); };
  if (!r) {
    // an all-day event over several days shows on each of them (DTEND is the morning after the last day)
    const last = !ev.start.time && ev.end && ev.end.date > first ? addDays(ev.end.date, -1) : first;
    for (let d = first, n = 0; d <= last && n < 31; d = addDays(d, 1), n++) push(d);
    return out;
  }
  const every = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || Infinity, u = r.UNTIL ? when(r.UNTIL, {}) : null;
  const until = !u ? null : u.time && ev.start.time && u.time < ev.start.time ? addDays(u.date, -1) : u.date;   // an UNTIL earlier in the day than the event leaves that day out
  const stop = until && until < to ? until : to, [y0, m0, d0] = first.split('-').map(Number);
  const byday = r.FREQ === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map(x => DOW.indexOf(x.slice(-2))).filter(x => x >= 0) : null;
  let made = 0;
  for (let i = 0; i < 4000 && made < count; i++) {
    let batch;
    if (r.FREQ === 'DAILY') batch = [addDays(first, i * every)];
    else if (r.FREQ === 'WEEKLY') {
      const wk = addDays(first, i * every * 7);
      batch = byday ? byday.map(w => addDays(wk, w - new Date(wk + 'T12:00:00').getDay())).filter(d => d >= first).sort() : [wk];
    } else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') {
      const t = r.FREQ === 'MONTHLY' ? y0 * 12 + (m0 - 1) + i * every : (y0 + i * every) * 12 + (m0 - 1), y = Math.floor(t / 12), m = t % 12 + 1;
      batch = d0 <= new Date(y, m, 0).getDate() ? [`${y}-${pad(m)}-${pad(d0)}`] : [];      // no 31st this month: calendars skip it
    } else return out;
    for (const d of batch) { if (d > stop) return out; if (made++ >= count) return out; push(d); }
    if (batch.length && batch[0] > stop) break;
  }
  return out;
}
// rows for the screen: [{ date, time?, t }], in order
function read(text, from, to) {
  const events = parse(text).filter(e => e.status !== 'CANCELLED' && e.t), moved = new Map(), rows = [];
  for (const e of events) if (e.moved && e.uid) { if (!moved.has(e.uid)) moved.set(e.uid, new Set()); moved.get(e.uid).add(e.moved.date); }
  for (const e of events) {
    const skip = !e.moved && e.uid && moved.get(e.uid) || new Set();
    for (const date of days(e.moved ? { ...e, rule: null } : e, from, to, skip)) rows.push(e.start.time ? { date, time: e.start.time, t: e.t } : { date, t: e.t });
  }
  return rows.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 500);
}
module.exports = { read, parse };
