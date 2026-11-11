// The car page, shared by the big screen (index.html) and the phone (phone.html). Needs carplan.js.
// CarUI.init({ api, toast, esc, demo, onChange }), then CarUI.load(), CarUI.html(), CarUI.click(e), CarUI.submit(e).
(function(){
  'use strict';
  var P = window.CarPlan, o = null, C = null, d = null, confirmAt = 0, poll = null, busy = false, view = 'main', unlockAt = 0;
  var SEATS_HEAT = [['off','Off'],['low','Low'],['medium','Med'],['high','High']];
  var SEATS_COOL = [['low cool','Cool low'],['medium cool','Cool med'],['high cool','Cool high']];

  var css = '.car-main{display:flex;flex-direction:column;gap:10px;min-width:0}.car-sub{display:flex;flex-direction:column;gap:8px;min-width:0}.car-split{flex:1;min-height:0}'
    + '.car-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}'
    + '.car-stat{border:2.5px solid var(--edge);border-radius:12px;box-shadow:3px 3px 0 var(--pop);padding:8px 12px;display:flex;flex-direction:column;gap:1px;background:var(--surface);min-width:0}'
    + '.car-stat small{font-weight:800;font-size:.82rem;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}.car-stat b{font-size:1.35rem;line-height:1.15}.car-stat span{font-size:.9rem;color:var(--muted);font-weight:600;min-height:1.2em}'
    + '.car-stat.bad{border-color:var(--bad);box-shadow:3px 3px 0 var(--bad)}.car-stat.bad b{color:var(--bad)}'
    + '.car-why{font-weight:700;font-size:1.06rem;line-height:1.3}'
    + '.car-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 10px;border-top:1.5px solid var(--line);padding:6px 0 0;min-height:51px}'
    + '.car-row .nm{font-weight:700;flex:1 1 150px;min-width:0}.car-row > .btn{flex:none}.car-row .nm small{display:block;font-weight:600;color:var(--muted);font-size:.85rem}.car-row .what{font-weight:600;text-align:right}'
    + '.car-step{display:flex;align-items:center;gap:6px}.car-step b{min-width:70px;text-align:center;font-size:1.2rem}.car-step .btn{min-width:52px;min-height:44px;font-size:1.3rem}'
    // the start button: big, in the middle, and it fills up while you hold it
    + '.car-stage{display:flex;flex-direction:column;justify-content:center;gap:12px}.car-split .car-stage{flex:1;min-height:0}'
    + '.car-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}.car-chip{border:2px solid var(--edge);border-radius:999px;padding:4px 12px;font-weight:800;font-size:.95rem;background:var(--surface2);white-space:nowrap}'
    + '.car-go{width:100%;min-height:60px;font-size:1.15rem}'
    + '.car-hold{position:relative;overflow:hidden;min-height:112px;border-width:3px;border-radius:16px;box-shadow:5px 5px 0 var(--pop);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}'
    + '.car-split .car-hold{flex:1;min-height:100px;max-height:190px}'
    + '.car-hold i{position:absolute;inset:0;background:#FF7A45;transform:scaleX(0);transform-origin:0 50%}.car-hold.holding i{transform:scaleX(1);transition:transform 1s linear}'
    + '.car-hold span{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px}.car-hold b{font-family:var(--display,inherit);font-weight:400;font-size:1.9rem;line-height:1.1;white-space:normal}.car-hold small{font-size:.95rem;font-weight:800}'
    + '.car-hold .t1,.car-hold.holding .t0{display:none}.car-hold.holding .t1{display:block}'
    + '.car-stop{min-height:76px;font-size:1.35rem;background:#E0243C;color:#fff;border-width:3px;border-radius:16px}'
    + '.car-c{text-align:center}'
    // starting, running, failed
    + '.car-state{border:3px solid var(--edge);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;font-weight:700;background:var(--surface2)}'
    + '.car-state b{font-family:var(--display,inherit);font-weight:400;font-size:1.6rem;line-height:1.15}.car-split .car-state.big{flex:1;max-height:230px;justify-content:center;gap:10px}.car-split .car-state.big > b{font-size:2.1rem}.car-state.big > span{font-size:1.05rem}.car-state.small b{font-size:1.1rem}'
    + '.car-state.on{background:var(--hl);color:var(--hl-ink);border-color:#14112A;box-shadow:4px 4px 0 var(--pop)}.car-state.on .car-chip{background:#fff;color:#14112A;border-color:#14112A}'
    + '.car-state.failed{border-color:var(--bad);background:var(--surface)}.car-state.failed b{color:var(--bad)}'
    + '.car-state em{display:block;width:100%;max-width:320px;height:12px;border:2px solid var(--edge);border-radius:999px;background:repeating-linear-gradient(-45deg,var(--hl) 0 10px,var(--surface) 10px 20px);background-size:28.28px 100%;animation:carwait .7s linear infinite}'
    + '@keyframes carwait{to{background-position:28.28px 0}}'
    // something to look at: unlocked, a door open, low fuel
    + '.car-warn{display:flex;align-items:center;gap:12px;border:3px solid var(--bad);border-radius:14px;box-shadow:3px 3px 0 var(--bad);padding:8px 10px 8px 12px;background:var(--surface);font-weight:800;line-height:1.3}'
    + '.car-warn i{flex:none;width:34px;height:34px;border-radius:50%;background:var(--bad);color:var(--surface);display:grid;place-items:center;font-style:normal;font-size:1.3rem}'
    + '.car-warn span{flex:1;min-width:0}.car-warn span b{display:block;font-weight:800}.car-warn .btn{flex:none;min-height:56px;min-width:116px;font-size:1.1rem}'
    + '.car-nav{display:flex;flex-direction:column;gap:10px}.car-split.car-nav{padding:0 5px 5px 0}'
    + '.car-navb{display:grid;grid-template-columns:1fr auto;column-gap:12px;align-content:center;align-items:center;text-align:left;border:2.5px solid var(--edge);border-radius:12px;box-shadow:3px 3px 0 var(--pop);background:var(--surface);color:inherit;padding:8px 12px 8px 14px;min-height:66px;font:inherit;transition:transform .06s,box-shadow .06s}'
    + '.car-split .car-navb{flex:1;max-height:104px}.car-navb:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--pop)}'
    + '.car-navb b{grid-column:1;font-size:1.08rem}.car-navb span{grid-column:1;font-size:.9rem;color:var(--muted);font-weight:600}.car-navb.bad span:first-of-type{color:var(--bad);font-weight:800}'
    + '.car-navb i{grid-column:2;grid-row:1/4;width:40px;height:40px;border:2.5px solid var(--edge);border-radius:10px;background:var(--hl);color:var(--hl-ink);position:relative}.car-navb i::before{content:"";position:absolute;left:11px;top:12px;width:10px;height:10px;border:solid currentColor;border-width:3px 3px 0 0;transform:rotate(45deg)}'
    + '.car-form{display:flex;flex-direction:column;gap:10px;align-items:stretch}.car-form label{display:flex;flex-direction:column;gap:3px;font-weight:800}.car-form input{width:100%;flex:none}.car-form .btn{min-height:56px;font-size:1.1rem}'
    + '.car-two{display:flex;gap:10px;flex-wrap:wrap}.car-two .btn{flex:1}'
    + '.car-steps{display:flex;flex-direction:column;gap:14px;margin:0;padding:0;list-style:none;counter-reset:cs}.car-steps li{display:flex;gap:12px;align-items:flex-start;font-weight:700;font-size:1.15rem;line-height:1.3;counter-increment:cs}'
    + '.car-steps li::before{content:counter(cs);flex:none;width:36px;height:36px;border:2.5px solid var(--edge);border-radius:10px;background:var(--hl);color:var(--hl-ink);display:grid;place-items:center;font-weight:800}'
    + '.car-note{color:var(--muted);font-size:.9rem;font-weight:600;line-height:1.35}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(s){ return o.esc(s); }
  function stat(label, big, sub, bad){ return '<div class="car-stat' + (bad ? ' bad' : '') + '"><small>' + label + '</small><b>' + big + '</b><span>' + (sub || '') + '</span></div>'; }
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

  var VIEWS = { status:'Locks, fuel and doors', adjust:'Change this start', car:'Your car', history:'Past starts and locks' };
  // The big screen shows two panels side by side: html(true) gives both, split by <!--cut:more-->, and heads() names them.
  // The phone shows one thing at a time: html().
  function heads(){
    if (!C || C.adding) return { a:'Car' };
    if (!C.linked) return { a:'Add your car', b:'Bluelink sign-in' };
    return { a:'Start the car', b: VIEWS[view] || 'More', back: !!VIEWS[view] };
  }
  function html(split){
    if (!C) return '<div class="car-note">Loading…</div>';
    if (C.adding) return adding();
    if (!C.linked){ view = 'main'; return linkForm(split); }
    var sub = view === 'adjust' ? adjustPage() : view === 'car' ? carPage() : view === 'history' ? historyPage() : view === 'status' ? statusPage(split) : '';
    if (sub) sub = '<div class="car-sub">' + (split ? '' : back() + '<div class="car-why">' + VIEWS[view] + '</div>') + sub + '</div>';
    if (sub && !split) return sub;
    return startPanel(split) + '<!--cut:more-->' + (sub || navPanel(split));
  }
  // why the weather picked this start, as a sentence: "It feels like 1° outside: cold."
  function reason(changed){
    if (changed) return 'Your own settings, just for this start.';
    var why = C.plan.why || '', m = /^(.+?) \(feels (-?\d+)°\)(?:, (.+))?\.$/.exec(why);
    if (!m) return why;
    return 'It feels like ' + m[2] + '° outside: ' + m[1].charAt(0).toLowerCase() + m[1].slice(1) + (m[3] ? ', ' + m[3] : '') + '.' + (C.weather && C.weather.stale ? ' (Weather from earlier.)' : '');
  }
  function chips(r){
    var a = [r.minutes + ' min', r.temp + '° inside'];
    if (r.defrost) a.push('Defrost');
    if (r.rear) a.push('Rear window heat');
    if (r.wheel) a.push('Heated wheel');
    if (r.seats && r.seats !== 'off') a.push(/cool/.test(r.seats) ? 'Seat cooling ' + r.seats.replace(' cool', '') : 'Seat heat ' + r.seats);
    return '<div class="car-chips">' + a.map(function(x){ return '<span class="car-chip">' + esc(x) + '</span>'; }).join('') + '</div>';
  }
  // The start panel is short: why, what will happen, and the button. Everything else is on its own small page.
  function startPanel(split){
    var r = C.run, changed = JSON.stringify(d) !== JSON.stringify(P.tidy({}, C.plan)), dis = busy ? ' disabled' : '';
    var h = '<div class="car-main' + (split ? ' car-split' : '') + '">' + warn(true) + '<div class="car-stage">';
    if (running()) h += '<div class="car-state big on" role="status"><b>The car is on</b><span>It turns itself off at ' + clock(r.until) + '</span>' + (r.plan ? chips(r.plan) : '') + '</div>'
      + '<button class="btn car-go car-stop" data-car="stop"' + dis + '>Stop the car</button>';
    else if (moving()) h += '<div class="car-state big" role="status"><b>Starting…</b><em></em><span>' + esc(r.msg || 'Asking the car to start…') + '</span></div>'
      + '<button class="btn car-go car-stop" data-car="stop"' + dis + '>Stop the car</button>';
    else {
      var age = r && r.at ? Date.now() - r.at : 1e12;
      if (r && r.state === 'failed' && age < 15 * 60e3) h += '<div class="car-state failed" role="alert"><b>The car didn’t start</b><span>' + esc(r.msg || 'Try again in a minute.') + '</span></div>';
      else if (r && r.state === 'stopped' && age < 5 * 60e3) h += '<div class="car-state small" role="status"><b>' + esc(r.msg || 'Asked the car to turn off.') + '</b></div>';
      else h += '<div class="car-why car-c">' + esc(reason(changed)) + '</div>';
      h += chips(d);
      if (confirmAt > Date.now()) h += '<div class="car-two"><button class="btn primary car-go" data-car="go"' + dis + '>Yes, start it for ' + d.minutes + ' min</button><button class="btn car-go" data-car="no">Cancel</button></div>';
      else h += '<button class="btn primary car-go car-hold" data-car="hold"' + dis + ' aria-label="Hold for one second to start the car: ' + esc(P.words(d)) + '"><i></i><span><b class="t0">Hold to start</b><b class="t1">Keep holding…</b><small>Press and hold for 1 second</small></span></button>'
        + '<div class="car-note car-c">The car turns itself off after ' + d.minutes + ' minutes.</div>';
    }
    return h + '</div></div>';
  }
  // Home's car card: one line on what the weather calls for, and the hold button. Nothing else.
  function home(){
    if (!C) return '<div class="car-home"><div class="car-hline"><small>Checking the car…</small></div></div>';
    if (!C.linked) return '<div class="car-home"><div class="car-hline">Add your car once<small>Then one button here warms it up for the weather.</small></div><button class="btn primary" data-detail="car" style="min-height:52px">Set it up</button></div>';
    var r = C.run, dis = busy ? ' disabled' : '', pr = C.status ? problems(C.status) : [], h = '<div class="car-home">';
    if (running()) return h + '<div class="car-hline">The car is on<small>It turns itself off at ' + clock(r.until) + '</small></div><button class="btn car-go car-stop" data-car="stop"' + dis + '>Stop the car</button></div>';
    if (moving()) return h + '<div class="car-hline">Starting…<small>' + esc(r.msg || 'Asking the car to start…') + '</small></div><button class="btn car-go car-stop" data-car="stop"' + dis + '>Stop the car</button></div>';
    var age = r && r.at ? Date.now() - r.at : 1e12;
    if (r && r.state === 'failed' && age < 15 * 60e3) h += '<div class="car-hline bad">The car didn’t start<small>' + esc(r.msg || 'Try again in a minute.') + '</small></div>';
    else if (pr.length) h += '<div class="car-hline bad">' + esc(pr[0]) + '</div>';
    else h += '<div class="car-hline">' + esc(reason(false)) + '</div>';
    return h + '<button class="btn primary car-go car-hold" data-car="hold"' + dis + ' aria-label="Hold for one second to start the car: ' + esc(P.words(d)) + '"><i></i><span><b class="t0">Hold to start</b><b class="t1">Keep holding…</b><small>' + esc(P.words(d)) + '</small></span></button></div>';
  }
  function navPanel(split){
    var c = C.car, t = C.status, last = C.log && C.log[0], changed = JSON.stringify(d) !== JSON.stringify(P.tidy({}, C.plan));
    return '<div class="car-nav' + (split ? ' car-split' : '') + '">'
      + navBtn('status', VIEWS.status, t ? esc(statusLine(t)) : 'Tap to ask the car', t ? 'Checked ' + ago(t.at) : '', t && problems(t).length)
      + navBtn('adjust', VIEWS.adjust, changed ? 'Changed, just for the next start' : 'Minutes, heat, defrost, seat')
      + navBtn('car', VIEWS.car, esc(c.name) + ' · ' + esc([c.year, c.model].filter(Boolean).join(' ')))
      + navBtn('history', VIEWS.history, last ? 'Last: ' + new Date(last.at).toLocaleString([], { weekday:'short', hour:'numeric', minute:'2-digit' }) : 'None yet')
      + '</div>';
  }
  function fuelLine(t){ return [t.fuel != null ? t.fuel + '% fuel' : '', t.range != null ? t.range + ' km' : ''].filter(Boolean).join(' · ') || 'fuel unknown'; }
  function lowFuel(t){ return !!(t.lowFuel || (t.range != null && t.range < 80)); }
  function statusLine(t){ return [t.locked === false ? 'Unlocked' : t.locked ? 'Locked' : '', t.doorsOpen ? (t.doorsOpen === 1 ? 'a door open' : t.doorsOpen + ' doors open') : '', (lowFuel(t) ? 'low fuel, ' : '') + fuelLine(t)].filter(Boolean).join(' · '); }
  function ago(ms){ var m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 720 ? 'at ' + clock(ms) : 'on ' + new Date(ms).toLocaleDateString([], { weekday:'long' }); }
  function problems(t){
    var a = [];
    if (t.locked === false) a.push('The car is unlocked.');
    if (t.doorsOpen) a.push(t.doorsOpen === 1 ? 'A door is open.' : t.doorsOpen + ' doors are open.');
    if (t.trunkOpen) a.push('The trunk is open.');
    if (t.hoodOpen) a.push('The hood is open.');
    if (lowFuel(t)) a.push('Fuel is low' + (t.range != null ? ', about ' + t.range + ' km left' : '') + '.');
    if (t.tires) a.push('Check the tire pressure.');
    if (t.washer) a.push('Washer fluid is low.');
    return a;
  }
  function warn(lock){
    var a = C.status ? problems(C.status) : []; if (!a.length) return '';
    return '<div class="car-warn" role="alert"><i aria-hidden="true">!</i><span>' + a.map(function(x){ return '<b>' + esc(x) + '</b>'; }).join('') + '</span>'
      + (lock && C.status.locked === false ? '<button class="btn primary" data-car="lock"' + (busy ? ' disabled' : '') + '>Lock it</button>' : '') + '</div>';
  }
  function statusPage(split){
    var t = C.status, l = C.lock, h = '';
    if (!t) return '<div class="car-note">Asking the car…</div>';
    h += '<div class="car-stats">' + stat('Doors', t.locked === false ? 'Unlocked' : t.locked ? 'Locked' : '–', t.doorsOpen ? t.doorsOpen + ' open' : 'all shut', t.locked === false || t.doorsOpen)
      + stat('Fuel', t.fuel != null ? t.fuel + '%' : '–', t.range != null ? 'about ' + t.range + ' km' : '', lowFuel(t))
      + stat('Engine', t.engine ? 'Running' : 'Off', t.trunkOpen ? 'trunk open' : t.hoodOpen ? 'hood open' : '', t.trunkOpen || t.hoodOpen) + '</div>';
    if (!problems(t).length) h += '<div class="car-why">All good: nothing open, no warnings.</div>';
    else if (!split) h += warn(false);   // the big screen already says it in the panel beside this one
    if (l && (l.state !== 'done' || Date.now() - l.at < 60e3)) h += '<div class="car-state small' + (l.state === 'failed' ? ' failed' : '') + '" role="status"><b>' + esc(l.msg) + '</b></div>';
    var sending = l && l.state === 'sending', dis = busy || sending ? ' disabled' : '';
    h += '<div class="car-two"><button class="btn car-go' + (t.locked === false ? ' primary' : '') + '" data-car="lock"' + dis + '>' + (t.locked ? 'Lock again' : 'Lock the car') + '</button>'
      + '<button class="btn car-go" data-car="unlock"' + dis + '>' + (unlockAt > Date.now() ? 'Tap again to unlock' : 'Unlock') + '</button></div>'
      + '<div class="car-row"><div class="nm">Checked ' + ago(t.at) + '<small>Checking is free. Locking and unlocking count toward Hyundai’s daily limit.</small></div><button class="btn" data-car="refresh">Check again</button></div>';
    return h;
  }
  function navBtn(v, name, sub, sub2, bad){ return '<button class="car-navb' + (bad ? ' bad' : '') + '" data-car="view" data-v="' + v + '"><b>' + name + '</b><span>' + sub + '</span>' + (sub2 ? '<span>' + sub2 + '</span>' : '') + '<i aria-hidden="true"></i></button>'; }
  function back(){ return '<button class="btn" data-car="view" data-v="main" style="align-self:flex-start;width:auto">‹ Back</button>'; }
  function adjustPage(){
    return '<div class="car-note">Only for the next start. After that it goes back to what the weather picks.</div>'
      + row('Minutes', '', step('minutes', d.minutes + ' min'))
      + row('Inside temperature', '', step('temp', d.temp + '°'))
      + row('Defrost', 'Front window', sw('defrost', d.defrost, 'Defrost'))
      + row('Rear window heat', '', sw('rear', d.rear, 'Rear window heat'))
      + (C.prefs.wheel ? row('Heated wheel', '', sw('wheel', d.wheel, 'Heated wheel')) : '')
      + (C.prefs.seats ? row('Driver seat', '', seg(SEATS_HEAT.concat(C.prefs.vented ? SEATS_COOL : []), d.seats, 'seats')) : '')
      + '<div class="car-two" style="margin-top:4px"><button class="btn primary" data-car="view" data-v="main">Done</button><button class="btn" data-car="reset">Use the weather’s plan</button></div>';
  }
  function carPage(){
    var c = C.car;
    return '<div class="car-note"><b>' + esc(c.name) + ' · ' + esc([c.year, c.model].filter(Boolean).join(' ')) + '.</b> Switch on what your car has. Home it uses this for every start.</div>'
      + row('Heated seats', '', sw('p-seats', C.prefs.seats, 'The car has heated seats'))
      + row('Heated wheel', '', sw('p-wheel', C.prefs.wheel, 'The car has a heated wheel'))
      + row('Cooled seats', '', sw('p-vented', C.prefs.vented, 'The car has cooled seats'))
      + row('Warmth', 'Than the weather picks', seg([['-2','Cooler'],['0','Normal'],['2','Warmer']], String(C.prefs.warmer), 'p-warmer'))
      + row('Run time', 'Than the weather picks', seg([['-1','Shorter'],['0','Normal'],['1','Longer']], String(C.prefs.extra), 'p-extra'))
      + '<div class="car-row"><div class="nm"><small>Signed in to Bluelink as ' + esc(C.email) + '. The sign-in stays on this laptop.</small></div><button class="btn" data-car="forget">Remove the car</button></div>';
  }
  function historyPage(){
    var l = C.log || [];
    return '<div class="car-note">Home it allows 3 starts an hour. Hyundai allows about 24 start or stop commands a day.</div>'
      + (l.length ? l.map(function(x){ return row(new Date(x.at).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }), '', '<span class="what">' + (x.kind === 'lock' ? 'Locked' : x.kind === 'unlock' ? 'Unlocked' : 'Started · ' + x.minutes + ' min · ' + x.temp + '°') + ' · ' + esc(x.from) + '</span>'); }).join('')
        : '<div class="car-why">Nothing yet. Starts, locks and unlocks will show up here.</div>');
  }
  function row(name, sub, ctl){ return '<div class="car-row"><div class="nm">' + name + (sub ? '<small>' + sub + '</small>' : '') + '</div>' + ctl + '</div>'; }
  function step(k, val){ return '<div class="car-step"><button class="btn" data-car="dn" data-k="' + k + '" aria-label="Less">–</button><b>' + val + '</b><button class="btn" data-car="up" data-k="' + k + '" aria-label="More">+</button></div>'; }

  function linkForm(split){
    var how = '<div class="car-main"><ol class="car-steps"><li>Type the email, password and PIN you use in the MyHyundai app (Bluelink Canada).</li><li>Tap “Add my car”. After that you can start, lock and check your car from here.</li></ol>'
      + (C.needPin ? '<div class="car-state small failed"><b>The PIN was wrong, so Home it stopped before Bluelink locked it. Add the car again.</b></div>' : '')
      + '<div class="car-note">They are saved only on this laptop and only sent to Hyundai. The car needs an active Bluelink plan.</div></div>';
    var form = '<form class="car-form" id="carlink" autocomplete="off">'
      + '<label>Bluelink email<input class="kb" id="car-email" type="email" maxlength="120" autocomplete="off"></label>'
      + '<label>Bluelink password<input class="kb" id="car-pw" type="password" maxlength="200" autocomplete="off"></label>'
      + '<label>Bluelink PIN (4 numbers)<input class="kb" id="car-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>'
      + '<button class="btn primary"' + (busy ? ' disabled' : '') + '>Add my car</button></form>';
    return how + (split ? '<!--cut:more-->' : '') + form;
  }
  function adding(){
    var a = C.adding;
    if (a.step === 'how') return '<div class="car-sub"><div class="car-why">Hyundai wants to check it’s you the first time this screen signs in. Where should it send the code?</div><div class="car-two">'
      + '<button class="btn primary car-go" data-car="send" data-v="E">Email it to ' + esc(a.email) + '</button>'
      + (a.phone ? '<button class="btn car-go" data-car="send" data-v="S">Text it to ' + esc(a.phone) + '</button>' : '') + '</div>' + cancel() + '</div>';
    if (a.step === 'code') return '<div class="car-sub"><form class="car-form" id="carcode"><label>The code Hyundai sent<input class="kb" id="car-code" type="text" inputmode="numeric" maxlength="8" autocomplete="one-time-code"></label>'
      + '<button class="btn primary"' + (busy ? ' disabled' : '') + '>Confirm</button></form>' + cancel() + '</div>';
    return '<div class="car-sub"><div class="car-why">Which car?</div>' + a.cars.map(function(c){ return '<button class="btn car-go" data-car="pick" data-v="' + esc(c.id) + '">' + esc(c.name) + ' · ' + esc([c.year, c.model].filter(Boolean).join(' ')) + '</button>'; }).join('') + cancel() + '</div>';
  }
  function cancel(){ return '<button class="btn" data-car="cancel" style="align-self:flex-start">Cancel</button>'; }

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
    else if (a === 'forget'){ if (b.dataset.sure) send('api/car/forget'); else { b.dataset.sure = '1'; b.textContent = 'Tap again to remove'; } }
    return true;
  }
  function go(){   // a changed start is used once, then the weather's plan comes back
    var p = send('api/car/start', Object.assign({ from: o.from || 'big screen' }, d));
    if (p) p.then(function(){ if (C && C.run && C.run.state !== 'failed'){ d = P.tidy({}, C.plan); o.onChange(); } });
  }
  // press and hold for a second: a touch screen beside a bed gets bumped
  var held = false, holdT = null;
  function bind(el){
    function stopHold(){ var was = holdT; clearTimeout(holdT); holdT = null; var b = el.querySelector('.car-hold'); if (b) b.classList.remove('holding'); if (was) o.onChange(); }
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
    if (C.status && problems(C.status).length) return { big:'Car is off', sub: problems(C.status)[0].replace(/\.$/, '') };
    return { big:'Car is off', sub: 'Tap to warm it up' };
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
      plan: P.plan(wx, demo.prefs), weather: wx && wx.ok ? { temp: wx.temp, feels: wx.feels, code: wx.code } : null, run: demo.run, adding: demo.adding || null, status: demo.asked ? demoStatus() : null, lock: demo.lock || null, log: demo.log };
  }
  function demoStatus(){ return { at: demo.at || Date.now(), locked: demo.locked, doorsOpen: demo.doorsOpen || 0, trunkOpen: false, hoodOpen: false, engine: !!(demo.run && demo.run.state === 'on'), fuel: demo.fuel == null ? 38 : demo.fuel, range: demo.range == null ? 290 : demo.range, lowFuel: !!demo.lowFuel, tires: false, washer: false }; }
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

  window.CarUI = { init: function(opts){ o = opts; }, bind: bind, load: load, html: html, heads: heads, holding: function(){ return !!holdT; }, demo: demo, click: click, submit: submit, short: short,
    busy: function(){ return moving(); }, goodnight: goodnight, nudge: nudge, status: status, reset: function(){ view = 'main'; }, tile: tile, home: home, linked: function(){ return !!(C && C.linked); } };
})();
