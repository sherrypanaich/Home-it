// The whole server, end to end, against a stand-in for the weather service. Run with: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-it-test-'));
const PORT = 8911, WX = 8912, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', WEATHER_URL: `http://127.0.0.1:${WX}/wx`, GEOCODE_URL: `http://127.0.0.1:${WX}/geo` };
const cli = (args, extra = {}) => execFileSync('node', [SERVER, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
let proc, fake, cookie = '';

const call = async (p, body, opts = {}) => {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(opts.anon ? {} : { Cookie: opts.cookie || cookie }) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
};
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];

test.before(async () => {
  assert.match(cli(['add-user', 'Sherry'], { NEW_PASSWORD: 'correct horse' }), /Added Sherry/);
  await new Promise(res => { fake = require('./fake-weather')(WX, res); });
  proc = spawn('node', [SERVER], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(res => proc.stdout.on('data', d => String(d).includes('running at') && res()));
});
test.after(() => { proc.kill(); fake.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('nothing is shown without signing in', async () => {
  assert.equal((await call('/api/state', null, { anon: true })).status, 401);
  assert.equal((await call('/api/op', { op: 'todo.add', args: { t: 'x' } }, { anon: true })).status, 401);
  const home = await call('/', null, { anon: true });
  assert.equal(home.status, 302); assert.equal(home.headers.get('location'), '/login');
  assert.equal((await call('/login', null, { anon: true })).status, 200);
  assert.equal((await call('/home.js', null, { anon: true })).status, 200);
  assert.equal((await call('/art/luffy-happy.webp', null, { anon: true })).status, 200);
  assert.equal((await call('/../server.js', null, { anon: true })).status, 302);
});

test('sign in with the right password only', async () => {
  assert.equal((await call('/api/login', { name: 'Sherry', password: 'wrong' }, { anon: true })).status, 401);
  const r = await call('/api/login', { name: 'sherry', password: 'correct horse' }, { anon: true });
  assert.equal(r.status, 200); cookie = cookieOf(r);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const page = await call('/');
  assert.equal((await call('/phone')).status, 200); assert.equal((await call('/phone', null, { anon: true })).status, 302);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
});

test('a fresh home is empty, set to Belleville', async () => {
  const { json } = await call('/api/state');
  assert.equal(json.me.name, 'Sherry'); assert.equal(json.me.kiosk, false);
  assert.equal(json.state.settings.city, 'Belleville, Ontario'); assert.deepEqual(json.state.lists.today, []);
});

test('changes are saved and come back', async () => {
  let r = await call('/api/op', { op: 'todo.add', args: { t: 'Laundry' } });
  assert.equal(r.status, 200); assert.equal(r.json.state.lists.today[0].t, 'Laundry');
  r = await call('/api/op', { op: 'shift.add', args: { date: r.json.today, start: '14:00', end: '22:00' } });
  assert.equal(r.json.msg, 'Shift added');
  r = await call('/api/op', { op: 'shift.add', args: { date: 'nope', start: '14:00', end: '22:00' } });
  assert.equal(r.status, 400); assert.match(r.json.error, /Pick a day/);
  assert.equal((await call('/api/op', { op: 'nope' })).status, 400);
  const { json } = await call('/api/state');
  assert.equal(json.state.shifts.length, 1); assert.equal(json.state.lists.today.length, 1);
});

test('other screens hear about a change', async () => {
  const ctl = new AbortController();
  const r = await fetch(BASE + '/api/events', { headers: { Cookie: cookie }, signal: ctl.signal });
  const reader = r.body.getReader(); await reader.read();
  await call('/api/op', { op: 'todo.add', args: { t: 'Rice', list: 'shop' } });
  let got = '';
  while (!got.includes('event: changed')) got += Buffer.from((await reader.read()).value).toString();
  ctl.abort();
});

test('weather: read and tidied', async () => {
  const { json } = await call('/api/weather');
  assert.equal(json.ok, true); assert.equal(json.temp, 3); assert.equal(json.feels, -1); assert.equal(json.sunset, '16:44'); assert.equal(json.sunrise, '06:56');
  assert.equal(json.hours.length, 24); assert.equal(json.tomorrow.hi, 4); assert.equal(json.city, 'Belleville, Ontario');
});

test('changing the town looks it up', async () => {
  let r = await call('/api/city', { city: 'Nowhere at all' });
  assert.equal(r.status, 400);
  r = await call('/api/city', { city: 'Kingston' });
  assert.equal(r.json.state.settings.city, 'Kingston, Ontario'); assert.equal(r.json.state.settings.lat, 44.2298);
});

test('the bedroom screen link works once and stays signed in', async () => {
  const outp = cli(['kiosk-link', 'Sherry']);
  const link = outp.match(/http:\/\/localhost:\d+(\/kiosk\?t=\S+)/)[1];
  const r = await call(link, null, { anon: true });
  assert.equal(r.status, 302); assert.match(r.headers.get('set-cookie'), /Max-Age=315360000/);
  const kiosk = cookieOf(r);
  assert.equal((await call('/api/state', null, { cookie: kiosk })).json.me.kiosk, true);
  assert.equal((await call(link, null, { anon: true })).status, 404);
  assert.equal((await call('/kiosk?t=guess', null, { anon: true })).status, 404);
  // an ordinary screen can be switched over, and back
  assert.equal((await call('/api/kiosk', { on: true })).json.me.kiosk, true);
  assert.equal((await call('/api/kiosk', { on: false })).json.me.kiosk, false);
});

test('a new password signs every screen out, the bedroom one included', async () => {
  assert.match(cli(['set-password', 'Sherry'], { NEW_PASSWORD: 'another horse' }), /New password saved/);
  assert.equal((await call('/api/state')).status, 401);
  const r = await call('/api/login', { name: 'Sherry', password: 'another horse' }, { anon: true });
  assert.equal(r.status, 200); cookie = cookieOf(r);
  assert.equal((await call('/api/state')).json.state.lists.today[0].t, 'Laundry');   // the data is untouched
});

test('the laptop-only door stays shut to everyone else', async () => {
  assert.equal((await call('/api/local/cli', { cmd: 'ping' })).status, 404);
  const r = await fetch(BASE + '/api/local/cli', { method: 'POST', headers: { 'X-Local-Token': 'x'.repeat(48), 'Content-Type': 'application/json' }, body: '{"cmd":"ping"}' });
  assert.equal(r.status, 404);
});

// ---------- the AI assistant connector (mcp.js) ----------
let key = '';
const mcpCall = async (method, params, k = key) => {
  const r = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(k ? { Authorization: 'Bearer ' + k } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
};
const tool = async (name, args = {}) => { const r = await mcpCall('tools/call', { name, arguments: args }); return r.json.result; };

test('an assistant needs a key, and gets the tools with one', async () => {
  const no = await mcpCall('tools/list', {}, '');
  assert.equal(no.status, 401); assert.match(no.headers.get('www-authenticate'), /oauth-protected-resource/);
  assert.equal((await mcpCall('tools/list', {}, 'hik_wrong')).status, 401);
  key = cli(['mcp-key', 'Sherry']).match(/hik_\S+/)[0];
  const init = await mcpCall('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.json.result.serverInfo.name, 'home-it');
  const names = (await mcpCall('tools/list')).json.result.tools.map(t => t.name);
  assert.deepEqual(names, ['get_today', 'list_todos', 'add_todo', 'complete_todo', 'remove_todo', 'list_shifts', 'add_shift', 'remove_shift', 'list_events', 'add_event', 'remove_event']);
  assert.equal((await call('/api/assistant')).json.connected, 1);
});

test('an assistant can read the day and add, tick and remove things', async () => {
  let r = await tool('get_today');
  assert.match(r.content[0].text, /Shift today|At work now|shift is finished/); assert.match(r.content[0].text, /Laundry/); assert.match(r.content[0].text, /Weather in/);
  r = await tool('add_todo', { text: 'Oat milk', list: 'shopping' });
  assert.match(r.content[0].text, /Added “Oat milk” to Shopping/);
  r = await tool('complete_todo', { text: 'laund' });
  assert.match(r.content[0].text, /“Laundry” is done/);
  r = await tool('complete_todo', { text: 'nothing like this' });
  assert.equal(r.isError, true);
  r = await tool('add_shift', { date: 'tomorrow', start: '9:00', end: '17:00', every_week: true });
  assert.match(r.content[0].text, /9:00 AM to 5:00 PM/);
  r = await tool('add_shift', { date: 'tomorrow', start: '09:00', end: '17:00' });
  assert.equal(r.isError, true);                                         // no doubles
  assert.match((await tool('list_shifts')).content[0].text, /Total/);
  r = await tool('remove_shift', { date: 'tomorrow' });
  assert.match(r.content[0].text, /removed for that day/);
  r = await tool('add_event', { what: 'Dentist', date: 'tomorrow', time: '15:30' });
  assert.match(r.content[0].text, /at 3:30 PM/);
  assert.match((await tool('list_events')).content[0].text, /Dentist/);
  assert.match((await tool('remove_event', { what: 'dent' })).content[0].text, /Removed “Dentist”/);
  assert.equal((await tool('add_shift', { date: 'someday', start: '9:00', end: '17:00' })).isError, true);
  const s = (await call('/api/state')).json.state;
  assert.equal(s.lists.shop.at(-1).t, 'Oat milk'); assert.equal(s.lists.today[0].d, true); assert.equal(s.rules.length, 1); assert.equal(s.events.length, 0);
});

test('an assistant can sign in the way a person does (OAuth)', async () => {
  const form = (p, o) => fetch(BASE + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
  const meta = await (await fetch(BASE + '/.well-known/oauth-authorization-server')).json();
  assert.match(meta.authorization_endpoint, /\/oauth\/authorize$/);
  const reg = await (await fetch(BASE + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Test assistant', redirect_uris: ['https://assistant.example/cb'] }) })).json();
  const verifier = 'v'.repeat(50), challenge = require('crypto').createHash('sha256').update(verifier).digest('base64url');
  const q = { client_id: reg.client_id, redirect_uri: 'https://assistant.example/cb', response_type: 'code', state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256' };
  const page = await fetch(BASE + '/oauth/authorize?' + new URLSearchParams(q));
  assert.match(await page.text(), /Connect Test assistant/);
  const bad = await form('/oauth/authorize', { ...q, name: 'Sherry', password: 'wrong one' });
  assert.equal(bad.status, 401);
  const good = await form('/oauth/authorize', { ...q, name: 'Sherry', password: 'another horse' });
  assert.equal(good.status, 302);
  const back = new URL(good.headers.get('location')); assert.equal(back.searchParams.get('state'), 'xyz');
  const wrong = await form('/oauth/token', { grant_type: 'authorization_code', code: back.searchParams.get('code'), client_id: reg.client_id, code_verifier: 'nope' });
  assert.equal(wrong.status, 400);
  const again = await form('/oauth/authorize', { ...q, name: 'Sherry', password: 'another horse' });
  const tok = await (await form('/oauth/token', { grant_type: 'authorization_code', code: new URL(again.headers.get('location')).searchParams.get('code'), client_id: reg.client_id, code_verifier: verifier, redirect_uri: q.redirect_uri })).json();
  assert.ok(tok.access_token && tok.refresh_token);
  assert.equal((await mcpCall('tools/list', {}, tok.access_token)).status, 200);
  assert.equal((await mcpCall('tools/list', {}, tok.refresh_token)).status, 401);   // a refresh token is not a key
});

test('signing assistants out really does', async () => {
  assert.equal((await call('/api/assistant/signout', {})).json.ok, true);
  assert.equal((await mcpCall('tools/list')).status, 401);
});

test('too many wrong passwords means a wait', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('/api/login', { name: 'Sherry', password: 'nope' + i }, { anon: true });
  assert.equal(last.status, 429);
});
