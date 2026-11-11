// The car page, shared by the big screen (index.html) and the phone (phone.html). Needs carplan.js.
// CarUI.init({ api, toast, esc, demo, onChange }), then CarUI.load(), CarUI.html(), CarUI.click(e), CarUI.submit(e).
(function(){
  'use strict';
  var P = window.CarPlan, o = null, C = null, d = null, confirmAt = 0, poll = null, busy = false, view = 'main', unlockAt = 0;
  var SEATS_HEAT = [['off','Off'],['low','Low'],['medium','Med'],['high','High']];
  var SEATS_COOL = [['low cool','Cool low'],['medium cool','Cool med'],['high cool','Cool high']];

  var css = '.car-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}'
    + '.car-stat{border:2.5px solid var(--edge);border-radius:12px;box-shadow:3px 3px 0 var(--pop);padding:8px 12px;display:flex;flex-direction:column;gap:1px;background:var(--surface);min-width:0}'
    + '.car-stat small{font-weight:800;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.car-stat b{font-size:1.35rem;line-height:1.15}.car-stat span{font-size:.85rem;color:var(--muted);font-weight:600}'
    + '.car-why{font-weight:700;margin:10px 0 2px}.car-row{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1.5px solid var(--line);padding:8px 0}'
    + '.car-row .nm{font-weight:700}.car-row .nm small{display:block;font-weight:600;color:var(--muted);font-size:.82rem}'
    + '.car-step{display:flex;align-items:center;gap:6px}.car-step b{min-width:64px;text-align:center;font-size:1.2rem}.car-step .btn{min-width:48px;min-height:44px;font-size:1.2rem}'
    + '.car-go{width:100%;min-height:60px;font-size:1.15rem;margin-top:10px}.car-hold{position:relative;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}.car-hold i{position:absolute;inset:0;width:0;background:rgba(0,0,0,.18)}.car-hold.holding i{width:100%;transition:width 1s linear}.car-hold span{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px}.car-hold small{font-size:.85rem;font-weight:700;white-space:normal}.car-hold{-webkit-touch-callout:none}'
    + '.car-nav{display:flex;flex-direction:column;gap:8px;margin-top:12px}.car-navb{display:grid;grid-template-columns:1fr auto;align-items:center;text-align:left;border:2.5px solid var(--edge);border-radius:12px;background:var(--surface);color:inherit;padding:10px 14px;min-height:56px;font:inherit}'
    + '.car-navb b{grid-column:1}.car-navb span{grid-column:1;font-size:.85rem;color:var(--muted);font-weight:600}.car-navb i{grid-column:2;grid-row:1/3;font-style:normal;font-size:1.6rem;font-weight:800}'
    + '.car-run{border:2.5px solid var(--edge);border-radius:12px;padding:10px 12px;margin-top:10px;font-weight:700;background:var(--surface)}'
    + '.car-run.on{background:var(--hl);color:var(--hl-ink)}.car-run.failed{border-color:var(--bad);color:var(--bad)}'
    + '.car-form{display:flex;flex-direction:column;gap:8px;align-items:stretch}.car-form input{width:100%}.car-two{display:flex;gap:8px;flex-wrap:wrap}.car-two .btn{flex:1}'
    + '.car-note{color:var(--muted);font-size:.88rem;font-weight:600;margin-top:6px}.car-h{margin:14px 0 4px;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(s){ return o.esc(s); }
  function stat(label, big, sub){ return '<div class="car-stat"><small>' + label + '</small><b>' + big + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>'; }
  function clock(ms){ return new Date(ms).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }); }
  function sw(key, on, label){ return '<button class="sw" data-car="tog" data-k="' + key + '" aria-pressed="' + !!on + '" aria-label="' + label + '"></button>'; }
  function seg(list, cur, key){ return '<div class="seg" role="group">' + list.map(function(x){ return '<button data-car="seg" data-k="' + key + '" data-v="' + x[0] + '" aria-pressed="' + (x[0] === cur) + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
  function moving(){ return C && C.run && (C.run.state === 'sending' || C.run.state === 'waiting'); }
  function running(){ return C && C.run && C.run.state === 'on' && C.run.until > Date.now(); }

  function take(j){
    var old = C && JSON.stringify(C.plan); C = j;
    if (!d || old !== JSON.stringify(j.plan)) d = j.plan ? P.tidy({}, j.plan) : null;   // the weather changed: start from its plan again
    clearTimeout(poll); if (moving() || (C.lock && C.lock.state === 'sending')) poll = setTimeout(load, 4000);
    o.onChange();
  }
  function load(){ return o.demo ? Promise.resolve(take(demoView())) : o.api('api/car').then(take).catch(function(){}); }
  function status(fresh){
    if (o.demo){ demo.asked = true; take(demoView()); return Promise.resolve(); }
    return o.api('api/car/status' + (fresh ? '?fresh=1' : '')).then(take).catch(function(e){ o.toast(e.message); });
  }
  function send(path, body){
    if (busy) return; busy = true; o.onChange();
    var p = o.demo ? demoSend(path, body) : o.api(path, body || {});
    return p.then(function(j){ busy = false; take(j); if (j.msg) o.toast(j.msg); })
      .catch(function(e){ busy = false; o.toast(e.message); load(); });
  }

  // The car page is short: what will happen, and the button. Everything else is on its own small page.
  function html(){
    if (!C) return '<div class="car-note">Loading…</div>';
    if (C.adding) return adding();
    if (!C.linked){ view = 'main'; return linkForm(); }
    if (view === 'adjust') return back() + adjustPage();
    if (view === 'car') return back() + carPage();
    if (view === 'history') return back() + historyPage();
    if (view === 'status') return back() + statusPage();
    var c = C.car, w = C.weather, r = C.run, h = '', changed = JSON.stringify(d) !== JSON.stringify(P.tidy({}, C.plan));
    h += '<div class="car-stats">'
      + stat('Outside', w ? w.temp + '°' : '–', w ? (isFinite(w.feels) ? 'feels ' + w.feels + '°' : '') + (w.stale ? ' · from earlier' : '') : 'no weather')
      + stat('This start', d.minutes + ' min', d.temp + '° inside' + (changed ? ' · changed' : ''))
      + (C.status ? stat('Car', C.status.locked === false ? 'Unlocked' : C.status.locked ? 'Locked' : '–', fuelLine(C.status)) : '') + '</div>'
      + warn();
    h += '<div class="car-why">' + esc(changed ? 'Your own settings for this start.' : C.plan.why) + '</div>';
    if (r && r.state !== 'off') {
      var line = esc(r.msg || '');
      if (running()) line = 'Running until ' + clock(r.until) + ' · ' + esc(P.words(r.plan));
      h += '<div class="car-run ' + (running() ? 'on' : r.state) + '" role="status">' + line + '</div>';
    }
    if (running() || moving()) h += '<button class="btn car-go" data-car="stop"' + (busy ? ' disabled' : '') + '>Turn the car off</button>';
    else if (confirmAt > Date.now()) h += '<div class="car-two" style="margin-top:10px"><button class="btn primary car-go" data-car="go"' + (busy ? ' disabled' : '') + '>Yes, start it for ' + d.minutes + ' min</button><button class="btn car-go" data-car="no">Cancel</button></div>';
    else h += '<button class="btn primary car-go car-hold" data-car="hold"' + (busy ? ' disabled' : '') + '><i></i><span>Hold to start<small>' + esc(P.words(d)) + '</small></span></button>';
    var last = C.log && C.log[0];
    h += '<div class="car-nav">'
      + navBtn('status', 'Locks, fuel and doors', C.status ? statusLine(C.status) : 'Tap to ask the car')
      + navBtn('adjust', 'Change this start', changed ? 'Changed · tap to see' : 'Minutes, heat, defrost, seat')
      + navBtn('car', 'Your car', esc(c.name) + ' · ' + esc([c.year, c.model].filter(Boolean).join(' ')))
      + navBtn('history', 'Past starts and locks', last ? 'Last ' + new Date(last.at).toLocaleString([], { weekday:'short', hour:'numeric', minute:'2-digit' }) : 'None yet')
      + '</div>';
    return h;
  }
  function fuelLine(t){ return [t.fuel != null ? t.fuel + '% fuel' : '', t.range != null ? t.range + ' km' : ''].filter(Boolean).join(' · ') || 'fuel unknown'; }
  function statusLine(t){ return [t.locked === false ? 'Unlocked' : t.locked ? 'Locked' : '', fuelLine(t), 'checked ' + ago(t.at)].filter(Boolean).join(' · '); }
  function ago(ms){ var m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : clock(ms); }
  function problems(t){
    var a = [];
    if (t.locked === false) a.push('The car is unlocked.');
    if (t.doorsOpen) a.push(t.doorsOpen === 1 ? 'A door is open.' : t.doorsOpen + ' doors are open.');
    if (t.trunkOpen) a.push('The trunk is open.');
    if (t.hoodOpen) a.push('The hood is open.');
    if (t.lowFuel || (t.range != null && t.range < 80)) a.push('Fuel is low' + (t.range != null ? ', about ' + t.range + ' km left' : '') + '.');
    if (t.tires) a.push('Check the tire pressure.');
    if (t.washer) a.push('Washer fluid is low.');
    return a;
  }
  function warn(){ var a = C.status ? problems(C.status) : []; return a.length ? '<div class="car-run failed" style="margin-top:10px">' + esc(a.join(' ')) + '</div>' : ''; }
  function statusPage(){
    var t = C.status, l = C.lock, h = '<div class="car-h" style="margin-top:0">Locks, fuel and doors</div>';
    if (!t) return h + '<div class="car-note">Asking the car…</div>';
    h += '<div class="car-stats">' + stat('Doors', t.locked === false ? 'Unlocked' : t.locked ? 'Locked' : '–', t.doorsOpen ? t.doorsOpen + ' open' : 'all shut')
      + stat('Fuel', t.fuel != null ? t.fuel + '%' : '–', t.range != null ? 'about ' + t.range + ' km' : '')
      + stat('Engine', t.engine ? 'Running' : 'Off', t.trunkOpen ? 'trunk open' : t.hoodOpen ? 'hood open' : '') + '</div>';
    h += problems(t).length ? warn() : '<div class="car-why">All good: nothing open, no warnings.</div>';
    if (l && (l.state !== 'done' || Date.now() - l.at < 60e3)) h += '<div class="car-run ' + (l.state === 'failed' ? 'failed' : l.state === 'done' ? 'on' : '') + '" role="status">' + esc(l.msg) + '</div>';
    var sending = l && l.state === 'sending';
    h += '<div class="car-two" style="margin-top:10px">'
      + '<button class="btn primary car-go" data-car="lock"' + (busy || sending ? ' disabled' : '') + '>Lock the car</button>'
      + '<button class="btn car-go" data-car="unlock"' + (busy || sending ? ' disabled' : '') + '>' + (unlockAt > Date.now() ? 'Tap again to unlock' : 'Unlock') + '</button></div>'
      + '<div class="car-note">The car last reported ' + ago(t.at) + '. Locking and unlocking count toward Hyundai’s daily limit; checking doesn’t.</div>'
      + '<button class="btn" data-car="refresh" style="margin-top:8px">Check again</button>';
    return h;
  }
  function navBtn(v, name, sub){ return '<button class="car-navb" data-car="view" data-v="' + v + '"><b>' + name + '</b><span>' + sub + '</span><i aria-hidden="true">›</i></button>'; }
  function back(){ return '<button class="btn sm" data-car="view" data-v="main" style="margin-bottom:8px;align-self:flex-start;width:auto">‹ Car</button>'; }
  function adjustPage(){
    return '<div class="car-h" style="margin-top:0">This start</div>'
      + '<div class="car-note" style="margin:0 0 4px">Only for the next start. After that it goes back to what the weather picks.</div>'
      + row('Minutes', '', step('minutes', d.minutes + ' min'))
      + row('Inside temperature', '', step('temp', d.temp + '°'))
      + row('Defrost', 'Front window', sw('defrost', d.defrost, 'Defrost'))
      + row('Rear window heat', '', sw('rear', d.rear, 'Rear window heat'))
      + (C.prefs.wheel ? row('Heated wheel', '', sw('wheel', d.wheel, 'Heated wheel')) : '')
      + (C.prefs.seats ? row('Driver seat', '', seg(SEATS_HEAT.concat(C.prefs.vented ? SEATS_COOL : []), d.seats, 'seats')) : '')
      + '<div class="car-two" style="margin-top:8px"><button class="btn primary" data-car="view" data-v="main">Done</button><button class="btn" data-car="reset">Back to the weather’s plan</button></div>';
  }
  function carPage(){
    var c = C.car;
    return '<div class="car-h" style="margin-top:0">' + esc(c.name) + ' · ' + esc([c.year, c.model].filter(Boolean).join(' ')) + '</div>'
      + '<div class="car-note" style="margin:0 0 4px">What your car has, and how you like it. Used for every start.</div>'
      + row('Heated seats', '', sw('p-seats', C.prefs.seats, 'The car has heated seats'))
      + row('Heated wheel', '', sw('p-wheel', C.prefs.wheel, 'The car has a heated wheel'))
      + row('Cooled seats', '', sw('p-vented', C.prefs.vented, 'The car has cooled seats'))
      + row('I like it', 'Changes the temperature the weather picks', seg([['-2','Cooler'],['0','Normal'],['2','Warmer']], String(C.prefs.warmer), 'p-warmer'))
      + row('Run time', 'Changes the minutes the weather picks', seg([['-1','Shorter'],['0','Normal'],['1','Longer']], String(C.prefs.extra), 'p-extra'))
      + '<div class="car-note">Signed in to Bluelink as ' + esc(C.email) + '. The sign-in stays on this laptop.</div>'
      + '<button class="btn" data-car="forget" style="margin-top:8px">Remove the car from Home it</button>';
  }
  function historyPage(){
    var l = C.log || [];
    return '<div class="car-h" style="margin-top:0">Past starts and locks</div>'
      + (l.length ? l.map(function(x){ return row(new Date(x.at).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }), '', '<span>' + (x.kind === 'lock' ? 'Locked' : x.kind === 'unlock' ? 'Unlocked' : 'Started · ' + x.minutes + ' min · ' + x.temp + '°') + ' · ' + esc(x.from) + '</span>'); }).join('')
        : '<div class="car-note">No starts yet.</div>')
      + '<div class="car-note">Home it allows 3 starts an hour. Hyundai allows about 24 start or stop commands a day.</div>';
  }
  function row(name, sub, ctl){ return '<div class="car-row"><div class="nm">' + name + (sub ? '<small>' + sub + '</small>' : '') + '</div>' + ctl + '</div>'; }
  function step(k, val){ return '<div class="car-step"><button class="btn" data-car="dn" data-k="' + k + '" aria-label="Less">–</button><b>' + val + '</b><button class="btn" data-car="up" data-k="' + k + '" aria-label="More">+</button></div>'; }

  function linkForm(){
    return '<div class="car-why">Start your Hyundai from here, with the heat and run time picked from the weather.</div>'
      + (C.needPin ? '<div class="car-run failed">The PIN was wrong, so Home it stopped before Bluelink locked it. Add the car again.</div>' : '')
      + '<form class="car-form" id="carlink" autocomplete="off" style="margin-top:8px">'
      + '<label>Bluelink email<input class="kb" id="car-email" type="email" maxlength="120" autocomplete="off"></label>'
      + '<label>Bluelink password<input class="kb" id="car-pw" type="password" maxlength="200" autocomplete="off"></label>'
      + '<label>Bluelink PIN (4 numbers)<input class="kb" id="car-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>'
      + '<button class="btn primary"' + (busy ? ' disabled' : '') + '>Add my car</button></form>'
      + '<div class="car-note">Use the same email, password and PIN as the MyHyundai app (Canada). They are saved only on this laptop and only sent to Hyundai. The car needs an active Bluelink plan.</div>';
  }
  function adding(){
    var a = C.adding;
    if (a.step === 'how') return '<div class="car-why">Hyundai wants to check it’s you the first time this screen signs in.</div><div class="car-two" style="margin-top:8px">'
      + '<button class="btn primary" data-car="send" data-v="E">Email the code to ' + esc(a.email) + '</button>'
      + (a.phone ? '<button class="btn" data-car="send" data-v="S">Text it to ' + esc(a.phone) + '</button>' : '') + '</div>' + cancel();
    if (a.step === 'code') return '<form class="car-form" id="carcode"><label>The code Hyundai sent<input class="kb" id="car-code" type="text" inputmode="numeric" maxlength="8" autocomplete="one-time-code"></label>'
      + '<button class="btn primary"' + (busy ? ' disabled' : '') + '>Confirm</button></form>' + cancel();
    return '<div class="car-why">Which car?</div>' + a.cars.map(function(c){ return '<button class="btn" data-car="pick" data-v="' + esc(c.id) + '" style="width:100%;margin-top:6px">' + esc(c.name) + ' · ' + esc([c.year, c.model].filter(Boolean).join(' ')) + '</button>'; }).join('') + cancel();
  }
  function cancel(){ return '<button class="btn" data-car="cancel" style="margin-top:8px">Cancel</button>'; }

  function click(e){
    var b = e.target.closest('[data-car]'); if (!b) return false;
    var a = b.dataset.car, k = b.dataset.k;
    if (a === 'view'){ view = b.dataset.v; if (view === 'status') status(false); o.onChange(); if (o.top) o.top(); }
    else if (a === 'refresh') status(true);
    else if (a === 'lock'){ unlockAt = 0; var q0 = send('api/car/lock', { on: true, from: o.from }); if (q0) q0.then(function(){ setTimeout(load, 2500); }); }
    else if (a === 'unlock'){ if (unlockAt > Date.now()){ unlockAt = 0; send('api/car/lock', { on: false, from: o.from }); } else { unlockAt = Date.now() + 6000; setTimeout(o.onChange, 6100); o.onChange(); } }
    else if (a === 'hold'){ if (e.detail === 0){ confirmAt = Date.now() + 10000; setTimeout(o.onChange, 10100); o.onChange(); } else if (!held) o.toast('Hold the button for a second to start the car'); held = false; }
    else if (a === 'ask'){ confirmAt = Date.now() + 10000; setTimeout(o.onChange, 10100); o.onChange(); }
    else if (a === 'no'){ confirmAt = 0; o.onChange(); }
    else if (a === 'go'){ confirmAt = 0; go(); }
    else if (a === 'stop') send('api/car/stop');
    else if (a === 'reset'){ d = P.tidy({}, C.plan); o.onChange(); }
    else if (a === 'up' || a === 'dn'){ var n = a === 'up' ? 1 : -1; var x = {}; x[k] = d[k] + (k === 'temp' ? n * 0.5 : n); d = P.tidy(Object.assign({}, d, x), d); o.onChange(); }
    else if (a === 'tog' && k.indexOf('p-') === 0){ var q = {}; q[k.slice(2)] = !C.prefs[k.slice(2)]; send('api/car/prefs', q); }
    else if (a === 'tog'){ d[k] = !d[k]; o.onChange(); }
    else if (a === 'seg' && k.indexOf('p-') === 0){ var s = {}; s[k.slice(2)] = +b.dataset.v; send('api/car/prefs', s); }
    else if (a === 'seg'){ d[k] = b.dataset.v; o.onChange(); }
    else if (a === 'send') send('api/car/code-send', { via: b.dataset.v });
    else if (a === 'pick') send('api/car/pick', { id: b.dataset.v });
    else if (a === 'cancel') send('api/car/cancel');
    else if (a === 'forget'){ if (b.dataset.sure) send('api/car/forget'); else { b.dataset.sure = '1'; b.textContent = 'Tap again to remove the car'; } }
    return true;
  }
  function go(){   // a changed start is used once, then the weather's plan comes back
    var p = send('api/car/start', Object.assign({ from: o.from || 'big screen' }, d));
    if (p) p.then(function(){ if (C && C.run && C.run.state !== 'failed'){ d = P.tidy({}, C.plan); o.onChange(); } });
  }
  // press and hold for a second: a touch screen beside a bed gets bumped
  var held = false, holdT = null;
  function bind(el){
    function stopHold(){ clearTimeout(holdT); holdT = null; var b = el.querySelector('.car-hold'); if (b) b.classList.remove('holding'); }
    el.addEventListener('pointerdown', function(e){
      var b = e.target.closest('[data-car="hold"]'); if (!b || b.disabled) return;
      held = false; b.classList.add('holding');
      holdT = setTimeout(function(){ holdT = null; held = true; b.classList.remove('holding'); if (navigator.vibrate) navigator.vibrate(30); go(); }, 1000);
    });
    ['pointerup','pointerleave','pointercancel'].forEach(function(n){ el.addEventListener(n, stopHold); });
  }
  function submit(e){
    var f = e.target;
    if (f.id === 'carlink'){ e.preventDefault(); var g = function(id){ return document.getElementById(id).value; };
      send('api/car/link', { email: g('car-email').trim(), password: g('car-pw'), pin: g('car-pin').trim() }); return true; }
    if (f.id === 'carcode'){ e.preventDefault(); send('api/car/code', { code: document.getElementById('car-code').value }); return true; }
    return false;
  }
  // what the Car tile on the big screen says: one headline and one small line
  function tile(){
    if (!C) return { big:'Car', sub:'' };
    if (!C.linked) return { big:'Add your car', sub:'Tap to set it up' };
    if (running()) return { big:'On till ' + clock(C.run.until), sub: P.words(C.run.plan).split(' · ').slice(1).join(' · '), on:true };
    if (moving()) return { big:'Starting…', sub:'Waiting for the car' };
    if (C.status && problems(C.status).length) return { big:'Ready · ' + d.minutes + ' min', sub: problems(C.status)[0].replace(/\.$/, '') };
    return { big:'Ready · ' + d.minutes + ' min', sub: C.status ? (C.status.locked ? 'Locked · ' : '') + (C.status.fuel != null ? C.status.fuel + '% fuel' : fuelLine(C.status)) : P.words(d).split(' · ').slice(1, 3).join(' · ') };
  }
  // a short line for a button on the home screen
  function short(tiny){
    if (tiny) return running() ? 'On' : moving() ? '…' : 'Car';
    if (!C) return 'Start car';
    if (!C.linked) return 'Add car';
    if (running()) return 'Car on · ' + clock(C.run.until);
    if (moving()) return 'Starting…';
    return 'Start car · ' + d.minutes + 'm';
  }

  // Goodnight: ask the car if it's locked first. Unlocked opens the lock page; otherwise night(msg).
  function goodnight(night){
    if (!C || !C.linked) return night('');
    status(false).then(function(){
      if (C.status && C.status.locked === false){ view = 'status'; o.openPage(); o.toast('Your car is unlocked. Lock it, then tap Goodnight again.'); }
      else night(C.status && C.status.locked ? 'Car is locked. Goodnight!' : '');
    });
  }
  // Before a shift on a cold or hot day: is now the moment to start the car? Home it asks; you press.
  function nudge(toLeave){
    if (!C || !C.linked || running() || moving() || !d) return null;
    if (d.minutes < 4 || toLeave <= 0 || toLeave > d.minutes + 3) return null;
    return 'Start the car? ' + d.minutes + ' min' + (C.weather ? ' · ' + C.weather.temp + '° outside' : '');
  }

  // ---------- the preview: a made-up car that answers like the real one ----------
  var demo = { linked: true, run: null, prefs: P.prefsOf({}), locked: false, log: [] };
  function demoView(){
    var wx = o.demoWeather ? o.demoWeather() : { ok:true, temp:-4, feels:-11, code:71 };
    if (demo.run && demo.run.state === 'on' && demo.run.until < Date.now()) demo.run = null;
    return { linked: demo.linked, car: { name:'My Elantra', model:'ELANTRA', year:2022, fuel:'gas' }, email:'s•••@gmail.com', prefs: demo.prefs,
      plan: P.plan(wx, demo.prefs), weather: wx && wx.ok ? { temp: wx.temp, feels: wx.feels, code: wx.code } : null, run: demo.run, adding: null, status: demo.asked ? demoStatus() : null, lock: demo.lock || null, log: demo.log };
  }
  function demoStatus(){ return { at: Date.now(), locked: demo.locked, doorsOpen: 0, trunkOpen: false, hoodOpen: false, engine: !!(demo.run && demo.run.state === 'on'), fuel: 38, range: 290, lowFuel: false, tires: false, washer: false }; }
  function demoSend(path, body){
    if (path === 'api/car/lock'){ demo.locked = body.on; demo.asked = true; demo.lock = { on: body.on, at: Date.now(), state:'done', msg: body.on ? 'The car is locked.' : 'The car is unlocked.' }; demo.log.unshift({ at: Date.now(), kind: body.on ? 'lock' : 'unlock', from: o.from }); var v = demoView(); return Promise.resolve(Object.assign(v, { msg: v.lock.msg + ' (preview)' })); }
    if (path === 'api/car/start'){
      var plan = P.tidy(body, demoView().plan);
      demo.run = { state:'waiting', at: Date.now(), plan: plan, msg:'Hyundai has it. Waiting for the car to answer…' };
      demo.log.unshift({ at: Date.now(), minutes: plan.minutes, temp: plan.temp, from: o.from });
      setTimeout(function(){ if (demo.run && demo.run.state === 'waiting'){ demo.run.state = 'on'; demo.run.until = Date.now() + plan.minutes * 60e3; load(); } }, 2500);
      return Promise.resolve(Object.assign(demoView(), { msg:'Starting the car: ' + P.words(plan) + ' (preview)' }));
    }
    if (path === 'api/car/stop'){ demo.run = { state:'stopped', at: Date.now(), msg:'Asked the car to turn off.' }; return Promise.resolve(Object.assign(demoView(), { msg:'Turning the car off (preview)' })); }
    if (path === 'api/car/prefs'){ demo.prefs = P.prefsOf(Object.assign({}, demo.prefs, body)); return Promise.resolve(demoView()); }
    return Promise.resolve(Object.assign(demoView(), { msg:'This works once it’s on the laptop' }));
  }

  window.CarUI = { init: function(opts){ o = opts; }, bind: bind, load: load, html: html, click: click, submit: submit, short: short,
    busy: function(){ return moving(); }, goodnight: goodnight, nudge: nudge, status: status, reset: function(){ view = 'main'; }, tile: tile, linked: function(){ return !!(C && C.linked); } };
})();
