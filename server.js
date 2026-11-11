#!/usr/bin/env node
// Home it: a home screen for your day. Shifts, to-dos, events and the weather, drawn full screen on
// an old laptop and reachable from your phone. One file, no dependencies, data in plain JSON files.
//
//   node server.js                     start the app (http://localhost:8100)
//   node server.js add-user NAME       add a person (the first one runs it)
//   node server.js set-password NAME   change a password
//   node server.js kiosk-link NAME     a one-time address that signs the bedroom screen in for good
//   node server.js sample NAME         fill an empty account with made-up data to try things
//   node server.js list-users
//   node server.js link-split NAME  show your Split it balance on the screen (link-budget NAME for Budget it; unlink-… undoes it)
//   node server.js mcp-key NAME        a key for an AI assistant (see mcp.js); mcp-revoke NAME signs them all out
//
// Settings: PORT, HOST, DATA_DIR, TZ (your time zone, like America/Toronto), or a home-it.env file.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const zlib = require('zlib');

const VERSION = '1.2.0';
// Optional settings file next to this one: KEY=value per line (see home-it.env.example).
try {
  for (const line of fs.readFileSync(path.join(__dirname, 'home-it.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { if (e.code !== 'ENOENT') console.error('Couldn’t read home-it.env:', e.message); }

const H = require('./home');
const PORT = +process.env.PORT || 8100;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const COPY_DIR = (process.env.BACKUP_COPY_DIR || '').trim();
let lastBackup = null;
const KEEP_BACKUPS = 30, SESSION_DAYS = 90, KIOSK_DAYS = 3650;
// Weather comes from Open-Meteo (free, no key, no account). Tests point these somewhere else.
const NEWS_URL = process.env.NEWS_URL || 'https://www.cbc.ca/webfeed/rss/rss-topstories';   // used until you set your own feed in Settings
const WEATHER_URL = process.env.WEATHER_URL || 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = process.env.GEOCODE_URL || 'https://geocoding-api.open-meteo.com/v1/search';
fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });

// ---------- storage: plain JSON files, written atomically ----------
// A missing file means a fresh start. A damaged one never does: we fall back to the newest good copy,
// and refuse to start if there is none, so a bad file can't quietly be replaced by an empty one.
function load(file, empty, fallbacks = []) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return empty; throw e; }
  try { return JSON.parse(text); } catch (e) {
    console.error(`${path.basename(file)} is damaged (${e.message}).`);
    for (const fb of fallbacks) {
      try {
        const data = JSON.parse(fs.readFileSync(fb, 'utf8'));
        const keep = file + '.damaged-' + Date.now();
        fs.renameSync(file, keep); fs.copyFileSync(fb, file);
        console.error(`Restored it from ${path.basename(fb)}. The damaged file was kept as ${path.basename(keep)}.`);
        return data;
      } catch {}
    }
    console.error(`No good copy found. Home it won't start, so nothing gets overwritten. Fix or replace ${file}, then start it again.`);
    process.exit(1);
  }
}
const backups = () => { try { return fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().reverse().map(f => path.join(BACKUP_DIR, f)); } catch { return []; } };
const save = (file, obj) => {
  const tmp = file + '.tmp', fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(obj)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
};
// db: { people: { uid: state } } (the state is described in home.js)
let db = load(DB_FILE, { people: {} }, backups());
db.people = db.people || {};
let users = load(USERS_FILE, { users: {}, sessions: {} }, [USERS_FILE + '.bak']);
users.users = users.users || {}; users.sessions = users.sessions || {};
let dbTimer = null, dbDirty = false;
const flushDb = () => { if (dbTimer) { clearTimeout(dbTimer); dbTimer = null; } if (!dbDirty) return; dbDirty = false; save(DB_FILE, db); };
const saveDb = () => { dbDirty = true; if (!dbTimer) dbTimer = setTimeout(flushDb, 400); };
const saveUsers = () => save(USERS_FILE, users);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { flushDb(); process.exit(0); });
process.on('beforeExit', flushDb);
// One copy of the data a day, the last 30 kept. The users file gets a single spare.
function backup() {
  try {
    flushDb();
    const f = path.join(BACKUP_DIR, `db-${H.ymd(new Date())}.json`);
    if (fs.existsSync(DB_FILE) && !fs.existsSync(f)) fs.copyFileSync(DB_FILE, f);
    if (fs.existsSync(USERS_FILE)) { JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); fs.copyFileSync(USERS_FILE, USERS_FILE + '.bak'); }
    for (const old of backups().slice(KEEP_BACKUPS)) fs.rmSync(old, { force: true });
    lastBackup = { day: H.ymd(new Date()), copy: COPY_DIR ? copyBackups() : '' };
  } catch (e) { console.error('Backup:', e.message); }
}
// A second home for the daily data copies (a USB stick, a synced folder), so a dead disk doesn't take both.
// The sign-in file stays on this computer: it holds keys. Returns 'ok' or 'fail'.
function copyBackups() {
  try {
    fs.mkdirSync(COPY_DIR, { recursive: true, mode: 0o700 });
    const mine = backups();
    for (const f of mine) { const to = path.join(COPY_DIR, path.basename(f)); if (!fs.existsSync(to)) fs.copyFileSync(f, to); }
    const keep = new Set(mine.map(f => path.basename(f)));
    for (const f of fs.readdirSync(COPY_DIR)) if (/^db-\d{4}-\d\d-\d\d\.json$/.test(f) && !keep.has(f)) fs.rmSync(path.join(COPY_DIR, f), { force: true });
    return 'ok';
  } catch (e) { console.error('Backup copy to ' + COPY_DIR + ':', e.message); return 'fail'; }
}

// ---------- each person's home ----------
const today = () => H.ymd(new Date());
const rid = (p = '') => p + crypto.randomBytes(6).toString('hex');
const nameFor = id => users.users[id]?.name || 'Someone';
function stateOf(uid) {
  if (!db.people[uid]) { db.people[uid] = H.blank(); saveDb(); }
  const s = H.fix(db.people[uid]);
  if (H.normalize(s, today())) saveDb();
  return s;
}
const withCal = uid => { const s = stateOf(uid), c = calFor(uid); return c.rows.length ? { ...s, cal: c.rows } : s; };   // calendar rows ride along; they are never saved
const viewFor = (uid, req) => ({ me: { name: nameFor(uid), kiosk: !!sessionOf(req)?.kiosk }, version: VERSION, today: today(), state: withCal(uid), cal: calFor(uid).state });
function applyOp(uid, op, args) {
  const s = stateOf(uid), msg = H.apply(s, op, args, { today: today(), rid });
  saveDb(); return msg;
}

// ---------- passwords and sessions ----------
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const checkPw = (pw, u) => {
  if (!u.hash || !u.salt) return false;
  const h = Buffer.from(crypto.scryptSync(pw, u.salt, 64).toString('hex')), want = Buffer.from(u.hash);
  return h.length === want.length && crypto.timingSafeEqual(h, want);
};
const findUser = who => {
  const x = String(who || '').trim().toLowerCase(); if (!x) return undefined;
  return Object.entries(users.users).find(([, u]) => u.name.toLowerCase() === x) || Object.entries(users.users).find(([, u]) => u.emailVerified && u.email === x);
};
const unesc = v => { try { return decodeURIComponent(v); } catch { return v; } };   // another app's odd cookie must not break sign-in
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, unesc(v.join('='))]));
function sessionOf(req) {
  const t = req && cookies(req).hi, s = t && users.sessions[t];
  return s && s.exp > Date.now() && users.users[s.uid] ? s : null;
}
const secure = req => req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
const setCookie = (req, res, val, maxAge) => res.setHeader('Set-Cookie', `hi=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);
const newSession = (req, res, uid, days, extra = {}) => {
  const token = crypto.randomBytes(32).toString('hex');
  users.sessions[token] = { uid, exp: Date.now() + days * 864e5, ...extra }; saveUsers();
  setCookie(req, res, token, days * 86400);
};
const misses = new Map();
const isLocal = a => /^(127\.|::1$|::ffff:127\.)/.test(a || '');
const clientIp = req => { const a = req.socket.remoteAddress || '', fwd = req.headers['x-forwarded-for']; if (!fwd || !isLocal(a)) return a; return String(fwd).split(',').map(x => x.trim()).filter(Boolean).pop() || a; };
// Slow down guessing: 5 misses from one address, or 10 for one account from anywhere, then a 15 minute wait.
const recent = k => { const m = misses.get(k); return m && Date.now() - m.at < 15 * 60e3 ? m.n : 0; };
const bump = k => { misses.set(k, { n: recent(k) + 1, at: Date.now() }); if (misses.size > 5000) for (const [key, m] of misses) if (Date.now() - m.at > 15 * 60e3) misses.delete(key); };
const noteMiss = (req, uid) => { bump(clientIp(req)); if (uid) bump('acct:' + uid); };
const tooManyTries = (req, uid) => recent(clientIp(req)) >= 5 || (uid && recent('acct:' + uid) >= 10) ? 'Too many tries. Wait 15 minutes.' : null;
function checkLogin(req, name, password) {   // returns the uid, or null (and counts the miss)
  const found = findUser(name || '');
  if (found && !tooManyTries(req, found[0]) && checkPw(String(password || ''), found[1])) { misses.delete(clientIp(req)); return found[0]; }
  noteMiss(req, found && found[0]);
  return null;
}
// Sign a person out: their sessions (all, or all but `keep`) and the live streams those sessions opened.
// The bedroom screen is signed out too, so a new password really does lock everything; kiosk-link brings it back.
const listeners = new Map();   // res -> uid
const streamToken = new Map(); // res -> the session it was opened with
function endSessions(uid, { keep = null, assistants = false } = {}) {
  let n = 0;
  for (const [t, s] of Object.entries(users.sessions)) if (s.uid === uid && t !== keep) { delete users.sessions[t]; n++; }
  if (users.kiosk) for (const [k, v] of Object.entries(users.kiosk)) if (v.uid === uid) delete users.kiosk[k];
  saveUsers();
  for (const [res, who] of listeners) if (who === uid && streamToken.get(res) !== keep) { try { res.end(); } catch {} listeners.delete(res); streamToken.delete(res); }
  if (assistants) mcp.revoke(uid);
  return n;
}
function changed(uid) { for (const [res, id] of listeners) if (id === uid) res.write('event: changed\ndata: {}\n\n'); }

// ---------- sending things ----------
const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self' https://accounts.google.com"
};
function out(res, code, headers, body) {
  const req = res.req, h = { ...SECURITY, ...headers };
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? '' : String(body));
  if (buf.length > 800 && /json|text|javascript|xml|svg|manifest/.test(h['Content-Type'] || '') && /\bgzip\b/.test(req?.headers?.['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf, { level: 6 }); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding';
  }
  h['Content-Length'] = buf.length;
  res.writeHead(code, h); res.end(req && req.method === 'HEAD' ? undefined : buf);
}
const send = (res, code, body, type = 'application/json') => out(res, code, { 'Content-Type': type, 'Cache-Control': 'no-store' }, typeof body === 'string' ? body : JSON.stringify(body));
const readBody = (req, limit = 2e5) => new Promise((res, rej) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > limit) { rej(Object.assign(new Error('That’s too big.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { const j = JSON.parse(Buffer.concat(chunks).toString() || '{}'); res(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch (e) { rej(Object.assign(new Error('Bad request'), { status: 400 })); } });
});
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const fileCache = new Map();
function staticFile(name, dir = PUBLIC) {
  const fp = path.join(dir, name);
  if (!fp.startsWith(dir + path.sep) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return null;
  const mtime = fs.statSync(fp).mtimeMs, hit = fileCache.get(fp);
  if (hit && hit.mtime === mtime) return hit;
  const data = fs.readFileSync(fp), etag = '"' + crypto.createHash('sha1').update(data).digest('base64url').slice(0, 20) + '"';
  const entry = { data, etag, mtime, type: TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream' };
  fileCache.set(fp, entry); return entry;
}
function file(res, name, type, cache, dir) {
  const f = staticFile(name, dir); if (!f) return send(res, 404, { error: 'not found' });
  const h = { 'Content-Type': type || f.type, 'Cache-Control': cache || 'no-cache', ETag: f.etag };
  if (res.req.headers['if-none-match'] === f.etag) { res.writeHead(304, { ...SECURITY, ETag: f.etag, 'Cache-Control': h['Cache-Control'] }); return res.end(); }
  out(res, 200, h, f.data);
}
const PUBLIC_FILES = new Set(['/manifest.webmanifest', '/sw.js', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']);

const mcp = require('./mcp')({ DATA_DIR, users: () => users, findUser, checkLogin, tooManyTries, noteMiss, secure, H, stateOf: uid => withCal(uid), today, version: VERSION,
  applyOp: (uid, op, args) => { const msg = applyOp(uid, op, args); changed(uid); return msg; },   // the screen updates as the assistant works
  weather: uid => weatherFor(stateOf(uid).settings),
  needsCode: uid => accounts.needsCode(uid), checkCode: (uid, code) => accounts.checkCode(uid, code) });
const accounts = require('./accounts')({ appName: 'Home it', envFile: 'home-it.env', cookieName: 'hi', tagline: '',
  users: () => users, saveUsers, endSessions, docs: () => ({}), saveDb: () => {}, broadcast: () => {}, hashPw, findUser, setCookie, cookies, clientIp, misses,
  noteMiss, tooManyTries, nameFor, readBody, send, file, secure, SESSION_DAYS });

// ---------- money cards: Home it asks Split it and Budget it the way an assistant would (their /mcp address, with a key) ----------
// Linked per person with `node server.js link-split NAME` / `link-budget NAME`. Asked at most every 5 minutes; the last answer is kept if an app is down.
// tool: the headline. more: a second question whose answer fills the card's page, shown line by line.
const APPS = { split: { name: 'Split it', tool: 'get_balances', more: ['recent_expenses', { limit: 6 }, 'Lately'] },
  budget: { name: 'Budget it', tool: 'safe_to_spend', more: ['budget_status', {}, 'Budgets this month'] } };
const moneyCache = new Map();   // uid:kind -> { at, card }
async function askApp(link, tool, args = {}) {
  const r = await fetch(link.url.replace(/\/+$/, '') + '/mcp', { method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + link.key },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }) });
  if (!r.ok) throw new Error('answered ' + r.status);
  const j = await r.json(), out = j.result;
  if (!out || out.isError) throw new Error(out?.content?.[0]?.text || j.error?.message || 'no answer');
  return { text: String(out.content?.[0]?.text || ''), data: out.structuredContent && typeof out.structuredContent === 'object' ? out.structuredContent : null };
}
async function moneyFor(uid) {
  const links = users.users[uid]?.apps || {}, res = {};
  if (stateOf(uid).settings.company === today()) return { hidden: true };
  await Promise.all(Object.keys(APPS).map(async kind => {
    const link = links[kind]; if (!link) return;
    const key = uid + ':' + kind, hit = moneyCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60e3) return void (res[kind] = hit.card);
    try {
      const ans = await askApp(link, APPS[kind].tool);
      const card = { ok: true, ...H.moneyCard(kind, ans.text, ans.data) }, [tool, args, title] = APPS[kind].more;
      try { card.more = { title, lines: (await askApp(link, tool, args)).text.split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean).slice(0, 8).map(l => l.slice(0, 140)) }; } catch {}
      moneyCache.set(key, { at: Date.now(), card }); res[kind] = card;
    } catch (e) { res[kind] = hit ? { ...hit.card, stale: true } : { ok: false }; }
  }));
  return res;
}

// ---------- news: headlines from one feed (RSS or Atom), asked at most every 15 minutes, the last answer kept ----------
const RSS = require('./rss');
const newsCache = new Map();   // url -> { at, data }
async function newsFor(set) {
  const url = set.newsUrl || NEWS_URL, hit = newsCache.get(url);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.data;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'home-it', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (!r.ok) throw new Error('answered ' + r.status);
    const feed = RSS.read((await r.text()).slice(0, 2e6), 30);
    if (!feed.items.length) throw new Error('no headlines');
    const data = { ok: true, title: feed.title, items: feed.items };
    if (newsCache.size > 50) newsCache.clear();
    newsCache.set(url, { at: Date.now(), data }); return data;
  } catch (e) { return hit ? { ...hit.data, stale: true } : { ok: false }; }
}

// ---------- the car (car.js): Bluelink sign-in stays in data/car.json ----------
const car = require('./car')({ DATA_DIR, readBody, send, changed, weatherFor: set => weatherFor(set), settingsOf: uid => stateOf(uid).settings });

// ---------- a calendar link (Apple, Google, Outlook): read every 15 minutes, the next 60 days kept ----------
const ICS = require('./ics');
const calCache = new Map();   // uid -> { url, at, rows, state: 'ok' | 'wait' | 'fail', busy }
function calFor(uid) {
  const url = stateOf(uid).settings.calUrl; if (!url) return { rows: [], state: '' };
  let hit = calCache.get(uid);
  if (!hit || hit.url !== url) calCache.set(uid, hit = { url, at: 0, rows: [], state: 'wait' });
  if (!hit.busy && Date.now() - hit.at > 15 * 60e3) refreshCal(uid, hit);
  return hit;
}
async function refreshCal(uid, hit) {
  hit.busy = true; hit.at = Date.now();
  const before = JSON.stringify(hit.rows) + hit.state;
  try {
    const r = await fetch(hit.url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'home-it' } });
    if (!r.ok) throw new Error('calendar ' + r.status);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/.test(text) || text.length > 8e6) throw new Error('not a calendar');
    hit.rows = ICS.read(text, today(), H.addDays(today(), 60)); hit.state = 'ok';
  } catch (e) { hit.state = hit.rows.length ? 'ok' : 'fail'; hit.at = Date.now() - 13 * 60e3; }   // try again in a couple of minutes
  hit.busy = false;
  if (calCache.get(uid) === hit && JSON.stringify(hit.rows) + hit.state !== before) changed(uid);
}

// ---------- weather: asked at most every 15 minutes per place, and the last answer is kept if the internet drops ----------
const weatherCache = new Map();   // 'lat,lon' -> { at, data }
const getJson = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'home-it' } }); if (!r.ok) throw new Error('weather ' + r.status); return r.json(); };
async function weatherFor(set) {
  const key = set.lat + ',' + set.lon, hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.data;
  try {
    const q = new URLSearchParams({ latitude: set.lat, longitude: set.lon, timezone: 'auto', forecast_days: '8',
      current: 'temperature_2m,apparent_temperature,weather_code,is_day',
      hourly: 'temperature_2m,weather_code,precipitation_probability',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max' });
    const j = await getJson(WEATHER_URL + '?' + q), c = j.current || {}, d = j.daily || {}, h = j.hourly || {};
    const hm = t => String(t || '').slice(11, 16), now = String(c.time || '').slice(0, 13);
    const from = Math.max(0, (h.time || []).findIndex(t => t.slice(0, 13) >= now));
    const data = {
      ok: true, at: Date.now(), city: set.city,
      temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), code: c.weather_code, day: c.is_day !== 0,
      hi: Math.round(d.temperature_2m_max?.[0]), lo: Math.round(d.temperature_2m_min?.[0]), rain: d.precipitation_probability_max?.[0] ?? null,
      sunrise: hm(d.sunrise?.[0]), sunset: hm(d.sunset?.[0]),
      days: (d.time || []).slice(1, 8).map((t, i) => ({ date: t, code: d.weather_code?.[i + 1], hi: Math.round(d.temperature_2m_max?.[i + 1]), lo: Math.round(d.temperature_2m_min?.[i + 1]), rain: d.precipitation_probability_max?.[i + 1] ?? null })),
      tomorrow: { code: d.weather_code?.[1], hi: Math.round(d.temperature_2m_max?.[1]), lo: Math.round(d.temperature_2m_min?.[1]) },
      hours: (h.time || []).slice(from, from + 24).map((t, i) => ({ t: hm(t), temp: Math.round(h.temperature_2m[from + i]), code: h.weather_code[from + i], rain: h.precipitation_probability?.[from + i] ?? null }))
    };
    if (!Number.isFinite(data.temp)) throw new Error('weather came back empty');
    weatherCache.set(key, { at: Date.now(), data });
    if (weatherCache.size > 50) weatherCache.delete(weatherCache.keys().next().value);
    return data;
  } catch (e) {
    if (hit) return { ...hit.data, stale: true };
    return { ok: false, city: set.city };
  }
}
async function findCity(name) {
  const j = await getJson(GEOCODE_URL + '?' + new URLSearchParams({ name, count: '1', language: 'en', format: 'json' }));
  const r = j.results && j.results[0]; if (!r) return null;
  return { city: [r.name, r.admin1].filter(Boolean).join(', ').slice(0, 60), lat: Math.round(r.latitude * 1e4) / 1e4, lon: Math.round(r.longitude * 1e4) / 1e4 };
}

// ---------- the bedroom screen: a one-time address that signs it in and keeps it signed in ----------
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
function kioskLink(uid) {
  const t = crypto.randomBytes(24).toString('base64url');
  users.kiosk = users.kiosk || {};
  for (const [k, v] of Object.entries(users.kiosk)) if (v.exp < Date.now() || v.uid === uid) delete users.kiosk[k];
  users.kiosk[sha(t)] = { uid, exp: Date.now() + 30 * 60e3 }; saveUsers();
  return '/kiosk?t=' + t;
}

async function handle(req, res) {
  // Laptop commands (node server.js set-password NAME ...) reach the running app here. Only from this computer,
  // never through a tunnel or proxy, and only with the secret from data/server.lock.
  if (req.url === '/api/local/cli') {
    const tok = Buffer.from(String(req.headers['x-local-token'] || '')), want = Buffer.from(localToken || '');
    const direct = isLocal(req.socket.remoteAddress) && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'];
    if (req.method !== 'POST' || !direct || !want.length || tok.length !== want.length || !crypto.timingSafeEqual(tok, want)) return send(res, 404, { error: 'not found' });
    return send(res, 200, localCommand(await readBody(req)));
  }
  if (await mcp.handle(req, res)) return;   // AI assistants (mcp.js)
  const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method;
  const ses = sessionOf(req), uid = ses ? ses.uid : null;
  // Tells the updater (and anyone checking on the laptop) that the app is up and can read its data.
  if (p === '/api/health' && m === 'GET') return send(res, 200, { ok: true, version: VERSION, backup: lastBackup });
  if (PUBLIC_FILES.has(p)) return file(res, p.slice(1), null, p === '/sw.js' ? 'no-cache' : 'public, max-age=86400');
  if (/^\/art\/[a-z0-9-]+\.(webp|png)$/.test(p)) return file(res, p.slice(1), null, 'public, max-age=604800');
  if (p === '/home.js') return file(res, 'home.js', null, 'no-cache', __dirname);
  if (p === '/carplan.js') return file(res, 'carplan.js', null, 'no-cache', __dirname);
  if (p === '/car-ui.js') return file(res, 'car-ui.js', null, 'no-cache');
  if (p === '/login' && m === 'GET') return file(res, 'login.html');
  if (p === '/api/login' && m === 'POST') {
    const { name, password } = await readBody(req);
    const found = findUser(name || '');
    const wait = tooManyTries(req, found && found[0]); if (wait) return send(res, 429, { error: wait });
    const id = checkLogin(req, name, password);
    if (!id) return send(res, 401, { error: 'That name and password don’t match.' });
    // a sign-in code is on for this person: the password was step one, the code is step two (accounts.js)
    if (accounts.needsCode(id)) return send(res, 200, { need: 'code', ticket: accounts.codeTicket(id) });
    newSession(req, res, id, SESSION_DAYS);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/logout') {
    const t = cookies(req).hi; if (t) { delete users.sessions[t]; saveUsers(); }
    setCookie(req, res, '', 0); res.writeHead(302, { Location: '/login' }); return res.end();
  }
  if (p === '/kiosk' && m === 'GET') {
    const k = sha(String(url.searchParams.get('t') || '')), hit = users.kiosk && users.kiosk[k];
    if (tooManyTries(req) || !hit || hit.exp < Date.now() || !users.users[hit.uid]) { noteMiss(req); return send(res, 404, 'That link has expired or was already used. Make a new one with: node server.js kiosk-link NAME', 'text/plain; charset=utf-8'); }
    delete users.kiosk[k];
    newSession(req, res, hit.uid, KIOSK_DAYS, { kiosk: true });
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); return res.end();
  }
  if (await accounts(req, res, url, uid)) return;   // invites, email, Google, password reset (accounts.js)
  if (!uid) {
    if (p.startsWith('/api/')) return send(res, 401, { error: 'signed out' });
    res.writeHead(302, { Location: '/login' }); return res.end();
  }
  const me = users.users[uid];
  if (!me.lastSeen || Date.now() - me.lastSeen > 3600e3) { me.lastSeen = Date.now(); saveUsers(); }
  if (p === '/' || p === '/index.html') return file(res, 'index.html', null, 'private, no-cache');
  if (p === '/phone') return file(res, 'phone.html', null, 'private, no-cache');   // the phone's own screen, for adding things on the go
  if (p === '/api/state' && m === 'GET') return send(res, 200, viewFor(uid, req));
  if (p === '/api/op' && m === 'POST') {
    const { op, args } = await readBody(req);
    const msg = applyOp(uid, String(op || ''), args);
    changed(uid);
    return send(res, 200, { ok: true, msg, ...viewFor(uid, req) });
  }
  if (p === '/api/news' && m === 'GET') return send(res, 200, await newsFor(stateOf(uid).settings));
  if (p === '/api/weather' && m === 'GET') return send(res, 200, await weatherFor(stateOf(uid).settings));
  if (p === '/api/money' && m === 'GET') return send(res, 200, await moneyFor(uid));
  if (await car(req, res, uid, p, m)) return;   // start the car (car.js)
  if (p === '/api/city' && m === 'POST') {
    const name = H.text((await readBody(req)).city, 60);
    if (!name) return send(res, 400, { error: 'Type a town or city.' });
    let hit; try { hit = await findCity(name); } catch { return send(res, 502, { error: 'Couldn’t look that up right now. Try again in a bit.' }); }
    if (!hit) return send(res, 400, { error: 'Couldn’t find that place. Try the town and province, like “Belleville, Ontario”.' });
    Object.assign(stateOf(uid).settings, hit); saveDb(); changed(uid);
    return send(res, 200, { ok: true, msg: 'Weather set to ' + hit.city, ...viewFor(uid, req) });
  }
  // Turn the screen you're on into the bedroom screen (or back): it stays signed in and gets night and idle modes.
  if (p === '/api/kiosk' && m === 'POST') {
    const { on } = await readBody(req), t = cookies(req).hi;
    if (on) { ses.kiosk = true; ses.exp = Date.now() + KIOSK_DAYS * 864e5; setCookie(req, res, t, KIOSK_DAYS * 86400); }
    else { delete ses.kiosk; ses.exp = Date.now() + SESSION_DAYS * 864e5; setCookie(req, res, t, SESSION_DAYS * 86400); }
    saveUsers();
    return send(res, 200, { ok: true, msg: on ? 'This is now the bedroom screen' : 'This is an ordinary screen again', ...viewFor(uid, req) });
  }
  if (p === '/api/assistant' && m === 'GET') return send(res, 200, { connected: mcp.connected(uid) });
  if (p === '/api/assistant/signout' && m === 'POST') return send(res, 200, { ok: true, signedOut: mcp.revoke(uid) });
  if (p === '/api/events' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.write('retry: 5000\n\n'); listeners.set(res, uid); streamToken.set(res, cookies(req).hi || null);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); streamToken.delete(res); });
    return;
  }
  send(res, 404, { error: 'not found' });
}

// ---------- command line ----------
const ask = q => new Promise(res => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); let got = false;
  rl.question(q, a => { got = true; rl.close(); res(a); }); rl.on('close', () => { if (!got) res(''); }); });
async function cli([cmd, ...rest]) {
  const name = rest.join(' ').trim();
  if (mcp.cli(cmd, name)) return;
  if (cmd === 'list-users') { for (const [id, u] of Object.entries(users.users)) console.log(`${u.name}${u.owner ? ' (owner)' : ''}  ${id}`); return; }
  const link = /^(un)?link-(split|budget)$/.exec(cmd || '');
  if (!link && !['add-user', 'set-password', 'kiosk-link', 'sample'].includes(cmd)) return console.log('Commands: add-user NAME, set-password NAME, kiosk-link NAME, sample NAME, list-users, link-split NAME, link-budget NAME, unlink-split NAME, unlink-budget NAME, mcp-key NAME, mcp-revoke NAME');
  if (!name) return console.log(`Usage: node server.js ${cmd} NAME`);
  const found = findUser(name), job = { cmd, name };
  if (cmd === 'add-user' && found) return console.log(`${name} already exists. Use set-password to change it.`);
  if (cmd !== 'add-user' && !found) return console.log(`No user called ${name}.`);
  if (cmd === 'add-user' || cmd === 'set-password') {
    job.password = process.env.NEW_PASSWORD || await ask(`Password for ${name} (8+ characters): `);
    if (job.password.length < 8) return console.log('Too short, nothing saved.');
  }
  if (link && !link[1]) {
    const app = APPS[link[2]].name;
    job.url = (process.env.APP_URL || await ask(`${app} address (like http://localhost:8090): `)).trim();
    job.key = (process.env.APP_KEY || await ask(`${app} key (from "node server.js mcp-key NAME" in the ${app} folder): `)).trim();
    if (!/^https?:\/\/\S+$/.test(job.url) || !job.key) return console.log('That needs an address starting with http and a key. Nothing saved.');
  }
  // A running app keeps everything in memory and would write its own copy back over ours, so it does the job itself.
  const answer = await askServer(job);
  if (answer && answer.text) return console.log(answer.text);
  const r = localCommand(job); flushDb();
  console.log(r.text + (answer ? ' The app is running but didn’t answer, so restart it to pick this up.' : ''));
}
// What those commands do. Used here when the app is stopped, and by the running app when it is asked (see /api/local/cli).
function localCommand({ cmd, name, password, url, key }) {
  if (cmd === 'ping') return { text: 'running' };
  const found = findUser(name || '');
  const link = /^(un)?link-(split|budget)$/.exec(cmd || '');
  if (link) {
    if (!found) return { text: `No user called ${name}.` };
    const u = found[1], kind = link[2]; u.apps = u.apps || {};
    if (link[1]) delete u.apps[kind]; else u.apps[kind] = { url: String(url), key: String(key) };
    for (const k of moneyCache.keys()) if (k.startsWith(found[0] + ':')) moneyCache.delete(k);
    saveUsers(); changed(found[0]);
    return { text: link[1] ? `${APPS[kind].name} is no longer shown on ${u.name}’s screen.` : `${APPS[kind].name} is linked. Its card shows on ${u.name}’s screen within a minute.` };
  }
  if (cmd === 'add-user') {
    if (found) return { text: `${name} already exists. Use set-password to change it.` };
    if (String(password || '').length < 8) return { text: 'Too short, nothing saved.' };
    const clean = String(name).trim().replace(/\s+/g, ' ').slice(0, 30);
    users.users['u_' + crypto.randomBytes(11).toString('hex')] = { name: clean, owner: !Object.keys(users.users).length, createdAt: Date.now(), ...hashPw(String(password)) };
    saveUsers();
    return { text: `Added ${clean}. They can sign in now.` };
  }
  if (!found) return { text: `No user called ${name}.` };
  const [id, u] = found;
  if (cmd === 'set-password') {
    if (String(password || '').length < 8) return { text: 'Too short, nothing saved.' };
    Object.assign(u, hashPw(String(password)));
    const n = endSessions(id, { assistants: true });
    return { text: `New password saved for ${u.name}. Signed out ${n} session${n === 1 ? '' : 's'} and any AI assistant, the bedroom screen included (kiosk-link signs it back in).` };
  }
  if (cmd === 'kiosk-link') return { text: `Open this on the bedroom screen within 30 minutes. It works once and keeps that screen signed in as ${u.name}:\nhttp://localhost:${PORT}${kioskLink(id)}` };
  if (cmd === 'sample') {
    const s = stateOf(id);
    if (s.shifts.length || s.rules.length || s.events.length || H.LISTS.some(k => s.lists[k].length)) return { text: `${u.name} already has things saved, so nothing was changed.` };
    db.people[id] = H.sample(today()); saveDb(); changed(id);
    return { text: `Filled ${u.name}'s home with sample data.` };
  }
  return { text: 'Unknown command.' };
}
// The running app writes data/server.lock: where it listens and a secret only this computer's user can read.
const LOCK_FILE = path.join(DATA_DIR, 'server.lock');
let localToken = null;
function claimLock() {
  localToken = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, port: PORT, token: localToken }), { mode: 0o600 });
}
const dropLock = () => { try { if (JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')).pid === process.pid) fs.unlinkSync(LOCK_FILE); } catch {} };
async function askServer(job) {   // -> the running app's answer, null when none is running, {} when it didn't answer
  let lk; try { lk = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); process.kill(lk.pid, 0); } catch { return null; }
  try {
    const r = await fetch(`http://127.0.0.1:${lk.port}/api/local/cli`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Token': lk.token },
      body: JSON.stringify(job), signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : {};
  } catch { return {}; }
}

if (require.main === module) {
  if (process.argv[2]) cli(process.argv.slice(2));
  else {
    if (!Object.keys(users.users).length) console.log('No users yet. Add one with: node server.js add-user YOURNAME');
    if (+process.versions.node.split('.')[0] < 22) console.log(`Heads-up: this is Node ${process.version}. Home it is tested on Node 22 and 24; older ones no longer get security fixes.`);
    claimLock(); process.on('exit', dropLock);
    backup(); setInterval(backup, 6 * 3600e3);
    http.createServer((req, res) => handle(req, res).catch(e => {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the laptop. Try again.' });
    })).listen(PORT, HOST, () => console.log(`Home it ${VERSION} running at http://${HOST}:${PORT}`));
  }
}
module.exports = { applyOp, stateOf, weatherFor, moneyFor };
