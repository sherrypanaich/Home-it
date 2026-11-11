// The car: start Sherry's Hyundai from the screen, with run time and heat picked from the weather (carplan.js).
// Bluelink sign-in, PIN and tokens live only in data/car.json on this computer (readable by this user only).
'use strict';
const fs = require('fs');
const path = require('path');
const BL = require('./bluelink');
const CP = require('./carplan');

module.exports = function car({ DATA_DIR, readBody, send, changed, weatherFor, settingsOf }) {
  const FILE = path.join(DATA_DIR, 'car.json');
  let all = {};
  try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  const save = () => { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(all, null, 1), { mode: 0o600 }); fs.renameSync(tmp, FILE); try { fs.chmodSync(FILE, 0o600); } catch {} };
  const pending = new Map();   // uid -> { acct, otp, cars } while adding the car (never saved)
  const runs = new Map();      // uid -> { state: 'sending' | 'waiting' | 'on' | 'failed' | 'stopped', at, until, msg, plan }
  const tries = new Map();     // uid -> { n, at } failed sign-ins, to stay clear of Bluelink's lockout
  const POLL = +process.env.CAR_POLL_MS || 10000, GIVE_UP = 3 * 60e3;
  const GAP = process.env.CAR_GAP_MS != null ? +process.env.CAR_GAP_MS : 30e3, PER_HOUR = 3;   // Hyundai allows about 24 commands a day

  const mask = e => String(e || '').replace(/^(.).*?(@.*)$/, '$1•••$2');
  const maskPhone = p => p ? '•••' + String(p).slice(-3) : '';
  const blocked = uid => { const t = tries.get(uid); return t && Date.now() - t.at < 15 * 60e3 && t.n >= 4; };
  const missed = uid => { const t = tries.get(uid); tries.set(uid, { n: (t && Date.now() - t.at < 15 * 60e3 ? t.n : 0) + 1, at: Date.now() }); };

  async function view(uid) {
    const a = all[uid], prefs = CP.prefsOf(a?.prefs), wx = await weatherFor(settingsOf(uid));
    const run = runs.get(uid);
    if (run && run.state === 'on' && run.until < Date.now()) { run.state = 'off'; run.msg = 'The car has turned itself off.'; }
    return { linked: !!(a && a.car && a.pin), car: a?.car ? { name: a.car.name, model: a.car.model, year: a.car.year, fuel: a.car.fuel } : null,
      email: a ? mask(a.email) : '', log: (a?.log || []).slice(0, 10), needPin: !!(a && a.car && !a.pin), prefs, plan: CP.plan(wx, prefs),
      weather: wx && wx.ok ? { temp: wx.temp, feels: wx.feels, code: wx.code, stale: !!wx.stale } : null,
      run: run ? { state: run.state, at: run.at, until: run.until, msg: run.msg, plan: run.plan } : null,
      adding: pending.has(uid) ? { step: pending.get(uid).otp?.key ? 'code' : pending.get(uid).otp ? 'how' : 'pick',
        email: mask(pending.get(uid).otp?.email), phone: maskPhone(pending.get(uid).otp?.phone),
        cars: (pending.get(uid).cars || []).map(c => ({ id: c.id, name: c.name, model: c.model, year: c.year })) } : null };
  }
  const reply = async (res, uid, msg, code = 200) => send(res, code, { ok: code < 400, msg, ...(await view(uid)) });
  const fail = (res, e, code = 400) => send(res, code, { error: e.message || String(e) });

  async function finishSignIn(uid, p, token) {
    p.acct.token = token;
    p.cars = await BL.vehicles(p.acct);
    if (!p.cars.length) { pending.delete(uid); throw new Error('That Bluelink account has no cars on it.'); }
    p.otp = null;
    if (p.cars.length === 1) return keep(uid, p, p.cars[0]);
    return null;   // more than one car: the screen asks which
  }
  function keep(uid, p, c) {
    all[uid] = { email: p.acct.email, password: p.acct.password, pin: p.acct.pin, deviceId: p.acct.deviceId, token: p.acct.token, car: c, prefs: all[uid]?.prefs || {}, log: all[uid]?.log || [] };
    save(); pending.delete(uid); tries.delete(uid);
    return c;
  }

  // after a start, ask Hyundai every 10 s whether the car really started (up to 3 minutes)
  function follow(uid, acct, tx, run) {
    const t0 = Date.now();
    const tick = async () => {
      if (runs.get(uid) !== run || run.state !== 'waiting') return;
      let s; try { s = await BL.status(acct, tx); } catch (e) { s = 'failed'; run.why = e.message; }
      save();
      if (s === 'done') { run.state = 'on'; run.until = Date.now() + run.plan.minutes * 60e3; run.msg = 'The car is running. It turns itself off after ' + run.plan.minutes + ' minutes.'; }
      else if (s === 'failed' || Date.now() - t0 > GIVE_UP) { run.state = 'failed'; run.msg = run.why || 'The car didn’t start. Check it is locked, the doors and hood are shut, and it isn’t already running.'; }
      else return void setTimeout(tick, POLL);
      changed(uid);
    };
    setTimeout(tick, POLL);
  }

  return async function handle(req, res, uid, p, m) {
    if (!p.startsWith('/api/car')) return false;
    try {
      if (p === '/api/car' && m === 'GET') return send(res, 200, await view(uid)), true;
      if (m !== 'POST') return send(res, 404, { error: 'not found' }), true;
      const b = await readBody(req, 4000);

      if (p === '/api/car/link') {   // email, password, PIN -> signed in, or Hyundai wants a code
        if (blocked(uid)) return fail(res, new Error('Too many tries. Wait 15 minutes so Bluelink doesn’t lock the account.'), 429), true;
        const email = String(b.email || '').trim().slice(0, 120), password = String(b.password || '').slice(0, 200), pin = String(b.pin || '').trim();
        if (!/^\S+@\S+\.\S+$/.test(email) || !password) return fail(res, new Error('Type your Bluelink email and password.')), true;
        if (!/^\d{4}$/.test(pin)) return fail(res, new Error('The Bluelink PIN is 4 numbers.')), true;
        const acct = { email, password, pin, deviceId: all[uid]?.email === email && all[uid]?.deviceId || BL.newDeviceId() };
        const pend = { acct };
        pending.set(uid, pend);
        let r; try { r = await BL.login(acct); } catch (e) { pending.delete(uid); missed(uid); throw e; }
        if (r.otp) { pend.otp = r.otp; return reply(res, uid, 'Hyundai wants to send you a code first.'), true; }
        const c = await finishSignIn(uid, pend, r.token);
        return reply(res, uid, c ? 'Added ' + c.name : 'Pick your car'), true;
      }
      if (p === '/api/car/code-send') {
        const pend = pending.get(uid); if (!pend?.otp) return fail(res, new Error('Start again: type your Bluelink email and password.')), true;
        const via = b.via === 'S' && pend.otp.phone ? 'S' : 'E';
        pend.otp = await BL.sendCode(pend.acct, pend.otp, via);
        return reply(res, uid, via === 'S' ? 'Code sent by text' : 'Code sent by email'), true;
      }
      if (p === '/api/car/code') {
        const pend = pending.get(uid); if (!pend?.otp?.key) return fail(res, new Error('Send the code first.')), true;
        const code = String(b.code || '').replace(/\D/g, '');
        if (code.length < 4) return fail(res, new Error('Type the code from the email or text.')), true;
        let r; try { r = await BL.checkCode(pend.acct, pend.otp, code); } catch (e) { missed(uid); throw e; }
        const c = await finishSignIn(uid, pend, r.token);
        return reply(res, uid, c ? 'Added ' + c.name : 'Pick your car'), true;
      }
      if (p === '/api/car/pick') {
        const pend = pending.get(uid), c = pend?.cars?.find(x => x.id === b.id);
        if (!c) return fail(res, new Error('Pick one of the cars.')), true;
        keep(uid, pend, c);
        return reply(res, uid, 'Added ' + c.name), true;
      }
      if (p === '/api/car/cancel') { pending.delete(uid); return reply(res, uid, ''), true; }
      if (p === '/api/car/forget') {
        delete all[uid]; save(); pending.delete(uid); runs.delete(uid); changed(uid);
        return reply(res, uid, 'Car removed from Home it'), true;
      }
      if (p === '/api/car/prefs') {
        if (!all[uid]) return fail(res, new Error('Add the car first.')), true;
        all[uid].prefs = CP.prefsOf({ ...all[uid].prefs, ...b }); save(); changed(uid);
        return reply(res, uid, 'Saved'), true;
      }

      const acct = all[uid];
      if (!acct?.car) return fail(res, new Error('Add the car first.')), true;
      if (!acct.pin) return fail(res, new Error('Add the car again with the right PIN.')), true;
      const run = runs.get(uid);
      if (p === '/api/car/start') {
        if (run && (run.state === 'sending' || run.state === 'waiting') && Date.now() - run.at < GIVE_UP) return fail(res, new Error('Already starting the car. Give it a minute.'), 409), true;
        if (run && run.at && Date.now() - run.at < GAP) return fail(res, new Error('Wait a few seconds before trying again.'), 429), true;
        const hour = (acct.log || []).filter(x => Date.now() - x.at < 3600e3).length;
        if (hour >= PER_HOUR) return fail(res, new Error('That’s ' + PER_HOUR + ' starts in the last hour, the most Home it allows. Bluelink allows only a few a day.'), 429), true;
        const base = CP.plan(await weatherFor(settingsOf(uid)), acct.prefs);
        const plan = CP.tidy(b, base);
        const next = { state: 'sending', at: Date.now(), plan, msg: 'Asking the car to start…' };
        runs.set(uid, next); changed(uid);
        try {
          const tx = await BL.start(acct, { ...plan, seatCode: CP.SEAT[plan.seats] || 0 });
          save();
          acct.log = [{ at: Date.now(), minutes: plan.minutes, temp: plan.temp, from: b.from === 'phone' ? 'phone' : 'big screen' }, ...(acct.log || [])].slice(0, 30);
          save();
          next.state = 'waiting'; next.msg = 'Hyundai has it. Waiting for the car to answer (up to a minute)…';
          follow(uid, acct, tx, next);
        } catch (e) {
          if (BL.BAD_PIN.includes(e.code)) { acct.pin = ''; save(); }   // stop before Bluelink locks the PIN
          next.state = 'failed'; next.msg = e.message; changed(uid);
          return fail(res, e, 502), true;
        }
        changed(uid);
        return reply(res, uid, 'Starting the car: ' + CP.words(plan)), true;
      }
      if (p === '/api/car/stop') {
        try { await BL.stop(acct); save(); }
        catch (e) { if (BL.BAD_PIN.includes(e.code)) { acct.pin = ''; save(); } return fail(res, e, 502), true; }
        runs.set(uid, { state: 'stopped', at: Date.now(), msg: 'Asked the car to turn off.', plan: run?.plan });
        changed(uid);
        return reply(res, uid, 'Turning the car off'), true;
      }
      return send(res, 404, { error: 'not found' }), true;
    } catch (e) {
      return fail(res, e, e instanceof BL.BluelinkError ? 502 : 400), true;
    }
  };
};
