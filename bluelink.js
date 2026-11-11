// Hyundai Bluelink, Canada (mybluelink.ca). The same calls the MyHyundai app makes, as the open-source
// hyundai_kia_connect_api project documents them. Not an official Hyundai API: it can change without notice.
'use strict';
const crypto = require('crypto');

const BASE = (process.env.BLUELINK_URL || 'https://mybluelink.ca/tods/api/').replace(/\/?$/, '/');
const HEADERS = { 'User-Agent': 'okhttp/4.12.0', 'Content-Type': 'application/json;charset=UTF-8', from: 'SPA', language: '0',
  client_id: 'HATAHSPACA0232141ED9722C67715A0B', client_secret: 'CLISCR01AHSPA' };
const MFA = '0107';

class BluelinkError extends Error { constructor(msg, code) { super(msg); this.code = code || ''; } }
const PLAIN = {   // Bluelink's error codes, in words a person can act on
  7110: 'Hyundai wants a code to trust this screen.', 7312: 'That PIN is wrong.', 7314: 'That PIN is wrong.', 7313: 'Hyundai wants a fresh sign-in.',
  7316: 'Your Bluelink PIN is locked. Unlock it in the MyHyundai app, then add the car again.',
  7401: 'That email and password don’t match.', 7404: 'That email and password don’t match.', 7435: 'There is no Bluelink account with that email.',
  7603: 'That password is wrong.', 7402: 'Your Bluelink account is locked for now.', 7530: 'Your Bluelink account is locked for now.',
  7531: 'Your Bluelink account is locked for now.', 7532: 'Your Bluelink account is locked for now.',
  7403: 'Hyundai wants a fresh sign-in.', 7602: 'Hyundai wants a fresh sign-in.', 7606: 'Hyundai wants a fresh sign-in.',
  7549: 'Hyundai is asking for a captcha. Sign in once in the MyHyundai app, then try again.' };
const EXPIRED = ['7403', '7602', '7606', '7313'];
const BAD_PIN = ['7312', '7314', '7316'];

const offset = () => String(Math.trunc(-new Date().getTimezoneOffset() / 60));
const newDeviceId = () => Buffer.from(crypto.randomUUID().replace(/-/g, '')).toString('base64');

// 21.5 °C -> the hex step Bluelink wants ("0FH"). Cars from 2020 on count from 14 °C, older ones from 16 °C.
function hexTemp(c, year) {
  const from = year && year < 2020 ? 16 : 14, i = Math.round((c - from) * 2);
  return (Math.max(0, i).toString(16) + 'H').padStart(3, '0').toUpperCase();
}

async function call(path, { body, headers = {}, deviceId, token, vehicleId, timeout = 20000 } = {}) {
  const h = { ...HEADERS, offset: offset(), ...headers };
  if (deviceId) h.Deviceid = deviceId;
  if (token) h.accessToken = token;
  if (vehicleId) h.vehicleId = vehicleId;
  let r;
  try { r = await fetch(BASE + path, { method: 'POST', headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new BluelinkError('Can’t reach Hyundai right now.', 'net'); }
  let j; try { j = await r.json(); } catch { throw new BluelinkError('Hyundai sent back something odd (' + r.status + ').', 'shape'); }
  const head = j && j.responseHeader;
  if (!head) throw new BluelinkError('Hyundai sent back something odd.', 'shape');
  if (head.responseCode === 1) {
    const code = String(j.error?.errorCode || '');
    if (code === '7110') return { otp: true, json: j, headers: r.headers };
    throw new BluelinkError(PLAIN[code] || 'Hyundai said: ' + (j.error?.errorDesc || code || 'no'), code);
  }
  return { json: j, headers: r.headers };
}

const tokenOf = t => ({ access: t.accessToken, refresh: t.refreshToken, until: Date.now() + (Math.max(120, +t.expireIn || 0) - 60) * 1000 });

// Step 1: email and password. Either signed in, or Hyundai wants a one-time code first (a new device).
async function login(acct) {
  const r = await call('v2/login', { body: { loginId: acct.email, password: acct.password }, deviceId: acct.deviceId });
  if (!r.otp) return { token: tokenOf(r.json.result.token) };
  const m = await call('mfa/selverifmeth', { body: { mfaApiCode: MFA, userAccount: acct.email }, deviceId: acct.deviceId });
  const res = m.json.result || {};
  return { otp: { uuid: res.userInfoUuid, email: (res.emailList || [])[0] || acct.email, phone: res.userPhone || '' } };
}
// Step 2: send the code by email ('E') or text ('S').
async function sendCode(acct, otp, via) {
  const r = await call('mfa/sendotp', { deviceId: acct.deviceId, body: { otpMethod: via === 'S' ? 'S' : 'E', mfaApiCode: MFA, userAccount: otp.email,
    userPhone: via === 'S' ? otp.phone : '', userInfoUuid: otp.uuid } });
  return { ...otp, key: r.json.result.otpKey };
}
// Step 3: the code from the email or text -> signed in.
async function checkCode(acct, otp, code) {
  const v = await call('mfa/validateotp', { deviceId: acct.deviceId, body: { otpNo: String(code), userAccount: acct.email, otpKey: otp.key, mfaApiCode: MFA } });
  if (!v.json.result?.verifiedOtp) throw new BluelinkError('That code didn’t work.', 'otp');
  const g = await call('mfa/genmfatkn', { deviceId: acct.deviceId, body: { userAccount: acct.email, otpEmail: otp.email, mfaApiCode: MFA,
    otpValidationKey: v.json.result.otpValidationKey, mfaYn: 'Y' } });
  return { token: tokenOf(g.json.result.token) };
}

// A signed-in token that still works: refresh it, or sign in again with the saved password.
async function fresh(acct) {
  if (acct.token && acct.token.until > Date.now()) return acct.token;
  if (acct.token?.refresh) {
    try {
      const r = await call('gtothbyrftkn', { body: { refTokenData: acct.token.refresh }, deviceId: acct.deviceId });
      return (acct.token = tokenOf(r.json.result));
    } catch (e) { if (BAD_PIN.includes(e.code)) throw e; }
  }
  const l = await login(acct);
  if (l.otp) throw new BluelinkError('Hyundai wants a code again. Open the car page and add the car again.', 'otp-again');
  return (acct.token = l.token);
}
// Runs fn(token), and once more with a fresh sign-in if Hyundai says the token is old.
async function signedIn(acct, fn) {
  try { return await fn(await fresh(acct)); }
  catch (e) { if (!EXPIRED.includes(e.code)) throw e; acct.token = null; return fn(await fresh(acct)); }
}

async function vehicles(acct) {
  return signedIn(acct, async tok => (await call('vhcllst', { deviceId: acct.deviceId, token: tok.access })).json.result.vehicles.map(v => ({
    id: v.vehicleId, name: v.nickName || v.modelName || 'My car', model: v.modelName || '', year: +v.modelYear || null,
    fuel: v.fuelKindCode === 'E' ? 'ev' : v.fuelKindCode === 'P' ? 'phev' : 'gas' })));
}
async function pinAuth(acct, tok) {
  return (await call('vrfypin', { deviceId: acct.deviceId, token: tok.access, vehicleId: acct.car.id, body: { pin: acct.pin } })).json.result.pAuth;
}

// Start with a plan from carplan.js. Returns Hyundai's transaction id, used to ask whether the car really started.
async function start(acct, p) {
  const car = acct.car, ev = car.fuel === 'ev';
  const seats = { drvSeatOptCmd: p.seatCode, astSeatOptCmd: 0, rlSeatOptCmd: 0, rrSeatOptCmd: 0 };
  const heat = p.rear && p.wheel ? 1 : p.rear ? 2 : p.wheel ? 3 : 0;
  const air = { airCtrl: 1, defrost: !!p.defrost, heating1: heat, igniOnDuration: p.minutes };
  const body = ev
    ? { pin: acct.pin, hvacInfo: { ...air, airTemp: { value: hexTemp(p.temp, car.year), unit: 0, hvacTempType: 1 }, seatHeaterVentCMD: seats } }
    : { pin: acct.pin, setting: { ...air, ims: 0, airTemp: { value: hexTemp(p.temp, car.year), unit: 0, hvacTempType: 0 }, seatHeaterVentCMD: seats } };
  return signedIn(acct, async tok => {
    const r = await call(ev ? 'evc/rfon' : 'rmtstrt', { deviceId: acct.deviceId, token: tok.access, vehicleId: car.id, headers: { pAuth: await pinAuth(acct, tok) }, body });
    return r.headers.get('transactionId') || '';
  });
}
async function stop(acct) {
  const ev = acct.car.fuel === 'ev';
  return signedIn(acct, async tok => {
    const r = await call(ev ? 'evc/rfoff' : 'rmtstp', { deviceId: acct.deviceId, token: tok.access, vehicleId: acct.car.id, headers: { pAuth: await pinAuth(acct, tok) }, body: { pin: acct.pin } });
    return r.headers.get('transactionId') || '';
  });
}
// 'done' | 'waiting' | 'failed'
async function status(acct, tx) {
  return signedIn(acct, async tok => {
    let r;
    try { r = await call('rmtsts', { deviceId: acct.deviceId, token: tok.access, vehicleId: acct.car.id, headers: { transactionId: tx, pAuth: await pinAuth(acct, tok) } }); }
    catch (e) { if (EXPIRED.includes(e.code) || BAD_PIN.includes(e.code)) throw e; return 'failed'; }
    const t = r.json.result?.transaction || {};
    return t.apiResult === 'C' ? 'done' : t.apiResult === 'P' ? 'waiting' : 'failed';
  });
}

// What the car last told Hyundai (does not wake the car, so it costs nothing against the daily limit).
async function carStatus(acct) {
  return signedIn(acct, async tok => {
    const st = (await call('lstvhclsts', { deviceId: acct.deviceId, token: tok.access, vehicleId: acct.car.id })).json.result?.status || {};
    const d = st.doorOpen || {}, t = st.tirePressureLamp || {};
    const when = String(st.lastStatusDate || '');   // 20261111203000, Hyundai's local time
    return {
      locked: st.doorLock == null ? null : !!st.doorLock,
      doorsOpen: ['frontLeft', 'frontRight', 'backLeft', 'backRight'].filter(k => d[k]).length,
      trunkOpen: !!st.trunkOpen, hoodOpen: !!st.hoodOpen, engine: !!st.engine,
      fuel: Number.isFinite(+st.fuelLevel) && st.fuelLevel !== null ? +st.fuelLevel : null,
      range: st.dte && Number.isFinite(+st.dte.value) ? Math.round(+st.dte.value) : null,
      lowFuel: !!st.lowFuelLight, tires: !!(t.tirePressureLampAll || t.tirePressureLampFL || t.tirePressureLampFR || t.tirePressureLampRL || t.tirePressureLampRR),
      washer: !!st.washerFluidStatus,
      seen: /^\d{12}/.test(when) ? when.slice(0, 4) + '-' + when.slice(4, 6) + '-' + when.slice(6, 8) + 'T' + when.slice(8, 10) + ':' + when.slice(10, 12) : null
    };
  });
}
async function lock(acct, on) {
  return signedIn(acct, async tok => {
    const r = await call(on ? 'drlck' : 'drulck', { deviceId: acct.deviceId, token: tok.access, vehicleId: acct.car.id, headers: { pAuth: await pinAuth(acct, tok) }, body: { pin: acct.pin } });
    return r.headers.get('transactionId') || '';
  });
}

module.exports = { carStatus, lock, login, sendCode, checkCode, vehicles, start, stop, status, hexTemp, newDeviceId, BluelinkError, BAD_PIN };
