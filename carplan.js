// How long to run the car and how to set its heat, from the weather outside. Used by the server and both screens.
// Pure rules, no network: plan(weather, prefs) -> { minutes, temp, defrost, wheel, rear, seats, cool, why }.
(function (root, make) { if (typeof module === 'object' && module.exports) module.exports = make(); else root.CarPlan = make(); })(this, function () {
  'use strict';
  const MIN = 2, MAX = 8;                 // minutes the car may run
  const LOW = 16, HIGH = 28;              // °C every Bluelink car accepts
  const SNOW = [56, 57, 66, 67, 71, 73, 75, 77, 85, 86];                 // snow, freezing drizzle or rain (WMO codes)
  const WET = [45, 48, 51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99];  // fog, rain, storms
  const SEAT = { off: 0, low: 6, medium: 7, high: 8, 'low cool': 3, 'medium cool': 4, 'high cool': 5 };   // Bluelink seat codes
  const DEFAULTS = { seats: true, wheel: true, vented: false, warmer: 0, extra: 0 };
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const half = n => Math.round(n * 2) / 2;

  function prefsOf(p) {
    p = p || {};
    return { seats: p.seats !== false, wheel: p.wheel !== false, vented: !!p.vented,
      warmer: clamp(Math.round(+p.warmer || 0), -3, 3), extra: clamp(Math.round(+p.extra || 0), -2, 2) };
  }

  function plan(wx, prefs) {
    const p = prefsOf(prefs);
    if (!wx || !wx.ok || !Number.isFinite(+wx.temp)) {
      return finish({ minutes: 5, temp: 21, defrost: false, rear: false, wheel: false, seats: 'off', cool: false,
        why: 'No weather right now, so a normal start.' }, p);
    }
    const t = +wx.temp, f = Number.isFinite(+wx.feels) ? +wx.feels : t, code = +wx.code;
    const snow = SNOW.includes(code), wet = WET.includes(code);
    // The table from the Home it review (Nov 11): feels-like -> run time, cabin, defrost, heat.
    let r;
    if (f < -10) r = { minutes: 8, temp: 23, defrost: true, rear: true, wheel: true, seats: 'high', why: 'Very cold' };
    else if (f < 0) r = { minutes: 6, temp: 22, defrost: true, rear: true, wheel: true, seats: 'medium', why: 'Freezing' };
    else if (f < 5) r = { minutes: 4, temp: 22, defrost: t <= 3, rear: true, wheel: true, seats: 'low', why: t <= 3 ? 'Cold, frost likely' : 'Cold' };
    else if (f < 15) r = { minutes: 2, temp: 21, defrost: false, rear: false, wheel: false, seats: 'off', why: 'Cool' };
    else if (f <= 25) r = { minutes: 2, temp: 21, defrost: false, rear: false, wheel: false, seats: 'off', why: 'Mild, fan only' };
    else if (f <= 30) r = { minutes: 4, temp: 21, defrost: false, rear: false, wheel: false, seats: 'medium cool', cool: true, why: 'Warm, cooling' };
    else r = { minutes: 6, temp: 20, defrost: false, rear: false, wheel: false, seats: 'high cool', cool: true, why: 'Hot, cooling' };
    const bits = [r.why + ' (feels ' + Math.round(f) + '°)'];
    if (snow) { r.minutes += 2; r.defrost = true; r.rear = true; bits.push('snow or ice, so extra time and defrost'); }
    else if (wet && !r.cool) { r.defrost = true; bits.push(code === 45 || code === 48 ? 'foggy, so defrost' : 'wet, so defrost'); }
    r.why = bits.join(', ') + '.';
    return finish(r, p);
  }

  function finish(r, p) {
    r.cool = !!r.cool;
    r.minutes = clamp(r.minutes + p.extra, MIN, MAX);
    r.temp = clamp(half(r.temp + p.warmer), LOW, HIGH);
    if (!p.wheel) r.wheel = false;
    if (!p.seats || (/cool/.test(r.seats) && !p.vented)) r.seats = 'off';
    return r;
  }

  // what someone changed on the screen, checked and kept in range
  function tidy(o, base) {
    o = o || {}; base = base || plan(null);
    const seats = Object.prototype.hasOwnProperty.call(SEAT, o.seats) ? o.seats : base.seats;
    return { minutes: clamp(Math.round(+o.minutes || base.minutes), MIN, MAX), temp: clamp(half(+o.temp || base.temp), LOW, HIGH),
      defrost: o.defrost == null ? base.defrost : !!o.defrost, rear: o.rear == null ? base.rear : !!o.rear,
      wheel: o.wheel == null ? base.wheel : !!o.wheel, seats, cool: !!base.cool };
  }

  // one line a person can read: "6 min · 26° · defrost · heated wheel · seats medium"
  function words(r) {
    const a = [r.minutes + ' min', r.temp + '°'];
    if (r.defrost) a.push('defrost');
    if (r.wheel) a.push('heated wheel');
    if (r.seats !== 'off') a.push('seats ' + r.seats);
    return a.join(' · ');
  }

  return { plan, tidy, words, prefsOf, SEAT, MIN, MAX, LOW, HIGH, DEFAULTS };
});
