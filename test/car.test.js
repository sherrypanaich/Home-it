// The car: weather rules, and the whole start flow against a stand-in for Hyundai's Bluelink (Canada). Run with: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const P = require('../carplan');
const BL = require('../bluelink');

test('the weather picks run time and heat, always 2 to 8 minutes', () => {
  const at = (feels, code = 3, temp = feels + 2) => P.plan({ ok: true, temp, feels, code });
  assert.deepEqual([at(-25), at(-5), at(3), at(10), at(20), at(28), at(35)].map(r => r.minutes), [8, 6, 4, 2, 2, 4, 6]);
  const cold = at(-15);
  assert.equal(cold.temp, 23); assert.ok(cold.defrost && cold.wheel && cold.rear); assert.equal(cold.seats, 'high');
  assert.equal(at(2, 3, 2).defrost, true, 'frost likely at 2 °C');
  assert.equal(at(4, 3, 6).defrost, false);
  assert.equal(at(-8, 73).minutes, 8, 'snow adds 2 minutes');
  assert.equal(at(-15, 73).minutes, 8, 'never more than 8');
  assert.equal(at(12, 61).defrost, true, 'rain turns defrost on');
  assert.equal(at(28).seats, 'off', 'no cooled seats unless the car has them');
  assert.equal(P.plan({ ok: true, temp: 30, feels: 28, code: 0 }, { vented: true }).seats, 'medium cool');
  assert.equal(P.plan(null).minutes, 5, 'no weather: a normal start');
  assert.equal(P.plan({ ok: true, temp: -20, feels: -20, code: 0 }, { seats: false, wheel: false }).seats, 'off');
  assert.equal(P.plan({ ok: true, temp: -20, feels: -20, code: 0 }, { extra: 2 }).minutes, 8);
  assert.equal(P.plan({ ok: true, temp: 10, feels: 10, code: 0 }, { extra: -2 }).minutes, 2);
  assert.equal(P.plan({ ok: true, temp: -20, feels: -20, code: 0 }, { warmer: 2 }).temp, 25);
});

test('what the screen sends is kept in range', () => {
  const base = P.plan({ ok: true, temp: -5, feels: -5, code: 0 });
  assert.equal(P.tidy({ minutes: 30 }, base).minutes, 8);
  assert.equal(P.tidy({ minutes: 'lots' }, base).minutes, base.minutes);
  assert.equal(P.tidy({ minutes: 1 }, base).minutes, 2);
  assert.equal(P.tidy({ temp: 99 }, base).temp, 28);
  assert.equal(P.tidy({ temp: 21.3 }, base).temp, 21.5);
  assert.equal(P.tidy({ seats: 'lava' }, base).seats, base.seats);
  assert.equal(P.tidy({ defrost: false }, base).defrost, false);
  assert.match(P.words(base), /^6 min · 22° · defrost · heated wheel · seats medium$/);
});

test('temperatures go to Bluelink as its hex steps', () => {
  assert.equal(BL.hexTemp(14, 2022), '00H');
  assert.equal(BL.hexTemp(22, 2022), '10H');
  assert.equal(BL.hexTemp(22, 2018), '0CH');
  assert.equal(BL.hexTemp(28, 2022), '1CH');
});

// ---------- the server, end to end ----------
const SERVER = path.join(__dirname, '..', 'server.js');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-it-car-'));
const PORT = 8921, WX = 8922, BLP = 8923, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', WEATHER_URL: `http://127.0.0.1:${WX}/wx`, GEOCODE_URL: `http://127.0.0.1:${WX}/geo`,
  BLUELINK_URL: `http://127.0.0.1:${BLP}/tods/api/`, CAR_POLL_MS: '150', CAR_GAP_MS: '0' };
let proc, fakeWx, fakeBl, cookie = '';
const seen = [];   // what Hyundai was asked
const hy = { otpFirst: true, trusted: new Set(), pinOk: '1234', started: 0 };

function bluelink(req, res) {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    const p = req.url.replace('/tods/api/', ''), b = body ? JSON.parse(body) : {}, dev = req.headers.deviceid;
    seen.push({ p, b, h: req.headers });
    const ok = (result, headers = {}) => { res.writeHead(200, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify({ responseHeader: { responseCode: 0 }, result })); };
    const no = code => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ responseHeader: { responseCode: 1 }, error: { errorCode: code, errorDesc: 'no ' + code } })); };
    const token = { accessToken: 'acc-1', refreshToken: 'ref-1', expireIn: 3600 };
    if (p === 'v2/login') {
      if (b.loginId !== 'sherry@example.com' || b.password !== 'car pw') return no('7404');
      if (hy.otpFirst && !hy.trusted.has(dev)) return no('7110');
      return ok({ token });
    }
    if (p === 'mfa/selverifmeth') return ok({ userInfoUuid: 'u-1', emailList: ['sherry@example.com'], userPhone: '6135550123' });
    if (p === 'mfa/sendotp') return ok({ otpKey: 'k-' + b.otpMethod });
    if (p === 'mfa/validateotp') return ok(b.otpNo === '654321' ? { verifiedOtp: true, otpValidationKey: 'v-1' } : { verifiedOtp: false });
    if (p === 'mfa/genmfatkn') { hy.trusted.add(dev); return ok({ token }); }
    if (req.headers.accesstoken !== 'acc-1') return no('7403');
    if (p === 'vhcllst') return ok({ vehicles: [{ vehicleId: 'veh-1', nickName: 'My Kona', modelName: 'KONA', modelYear: '2022', fuelKindCode: 'G', vin: 'X', dtcCount: 0 }] });
    if (p === 'vrfypin') return b.pin === hy.pinOk ? ok({ pAuth: 'pa-1' }) : no('7312');
    if (p === 'rmtstrt' || p === 'rmtstp') { if (req.headers.pauth !== 'pa-1') return no('7313'); if (p === 'rmtstrt') hy.started++; return ok({}, { transactionId: 'tx-' + hy.started }); }
    if (p === 'rmtsts') return ok({ transaction: { apiResult: 'C' } });
    no('9999');
  });
}

const call = async (p, body) => {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const until = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 100)); } };

test.before(async () => {
  execFileSync('node', [SERVER, 'add-user', 'Sherry'], { env: { ...env, NEW_PASSWORD: 'correct horse' }, encoding: 'utf8' });
  await new Promise(res => { fakeWx = require('./fake-weather')(WX, res); });
  await new Promise(res => { fakeBl = http.createServer(bluelink).listen(BLP, '127.0.0.1', res); });
  proc = spawn('node', [SERVER], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(res => proc.stdout.on('data', d => String(d).includes('running at') && res()));
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sherry', password: 'correct horse' }) });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
});
test.after(() => { proc.kill(); fakeWx.close(); fakeBl.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('the car pages need signing in, the scripts do not', async () => {
  const anon = await fetch(BASE + '/api/car'); assert.equal(anon.status, 401);
  assert.equal((await fetch(BASE + '/carplan.js')).status, 200);
  assert.equal((await fetch(BASE + '/car-ui.js')).status, 200);
});

test('adding the car: email, password, PIN, then the code Hyundai sends', async () => {
  let r = await call('/api/car');
  assert.equal(r.json.linked, false);
  assert.equal(r.json.plan.minutes, 6, 'feels -0.6° in the stand-in weather');
  assert.equal((await call('/api/car/link', { email: 'sherry@example.com', password: 'car pw', pin: '12' })).status, 400);
  assert.equal((await call('/api/car/link', { email: 'sherry@example.com', password: 'wrong', pin: '1234' })).json.error, 'That email and password don’t match.');
  r = await call('/api/car/link', { email: 'sherry@example.com', password: 'car pw', pin: '1234' });
  assert.equal(r.status, 200); assert.equal(r.json.adding.step, 'how'); assert.equal(r.json.adding.phone, '•••123');
  r = await call('/api/car/code-send', { via: 'S' });
  assert.equal(r.json.adding.step, 'code');
  assert.equal(seen.filter(x => x.p === 'mfa/sendotp').pop().b.otpMethod, 'S');
  assert.equal((await call('/api/car/code', { code: '111111' })).json.error, 'That code didn’t work.');
  r = await call('/api/car/code', { code: '654321' });
  assert.equal(r.json.linked, true); assert.equal(r.json.car.name, 'My Kona'); assert.equal(r.json.adding, null);
  assert.doesNotMatch(JSON.stringify(r.json), /car pw|1234|acc-1|ref-1/, 'no password, PIN or token goes to the screen');
  const file = path.join(DATA, 'car.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only this user can read the saved sign-in');
});

test('starting the car sends the weather plan, then follows it until it runs', async () => {
  let r = await call('/api/car/start', { minutes: 7, temp: 23, defrost: true, rear: true, wheel: true, seats: 'high', from: 'phone' });
  assert.equal(r.status, 200, r.text);
  const sent = seen.filter(x => x.p === 'rmtstrt').pop();
  assert.equal(sent.b.pin, '1234'); assert.equal(sent.h.pauth, 'pa-1'); assert.equal(sent.h.vehicleid, 'veh-1');
  assert.deepEqual(sent.b.setting, { airCtrl: 1, defrost: true, heating1: 1, igniOnDuration: 7, ims: 0, airTemp: { value: '12H', unit: 0, hvacTempType: 0 },
    seatHeaterVentCMD: { drvSeatOptCmd: 8, astSeatOptCmd: 0, rlSeatOptCmd: 0, rrSeatOptCmd: 0 } });
  r = await until(async () => { const v = await call('/api/car'); return v.json.run.state === 'on' && v; });
  assert.ok(r.json.run.until > Date.now() + 6 * 60e3);
  assert.equal(r.json.log[0].from, 'phone'); assert.equal(r.json.log[0].minutes, 7);
  r = await call('/api/car/stop', {});
  assert.equal(r.json.run.state, 'stopped');
  assert.ok(seen.some(x => x.p === 'rmtstp'));
});

test('a wrong PIN stops before Bluelink locks it', async () => {
  hy.pinOk = '9999';
  let r = await call('/api/car/start', {});
  assert.equal(r.status, 502); assert.equal(r.json.error, 'That PIN is wrong.');
  r = await call('/api/car');
  assert.equal(r.json.linked, false); assert.equal(r.json.needPin, true);
  const tries = seen.filter(x => x.p === 'vrfypin').length;
  assert.equal((await call('/api/car/start', {})).status, 400, 'no second guess with the wrong PIN');
  assert.equal(seen.filter(x => x.p === 'vrfypin').length, tries);
  // add it again with the right PIN: this screen is trusted now, so no code this time
  r = await call('/api/car/link', { email: 'sherry@example.com', password: 'car pw', pin: '9999' });
  assert.equal(r.json.linked, true); assert.equal(r.json.adding, null);
});

test('no more than 3 starts an hour', async () => {
  for (let i = 0; i < 2; i++) {
    assert.equal((await call('/api/car/start', {})).status, 200);
    await until(async () => (await call('/api/car')).json.run.state === 'on');
  }
  const r = await call('/api/car/start', {});
  assert.equal(r.status, 429); assert.match(r.json.error, /3 starts in the last hour/);
  assert.equal((await call('/api/car')).json.log.length, 3);
});

test('removing the car forgets the sign-in', async () => {
  const r = await call('/api/car/forget', {});
  assert.equal(r.json.linked, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'car.json'), 'utf8')), {});
});
