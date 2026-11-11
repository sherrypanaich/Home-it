// Home it connector for AI assistants (Claude, Meta Muse, ChatGPT...), using MCP.
// No dependencies. server.js sends /mcp, /oauth/* and /.well-known/* here.
//
// The assistant signs in the same way a person does: it opens a Home it sign-in page,
// you type your name and password, and it can then act as you. Two ways to connect:
//   1. OAuth (what Claude and Muse use): give the assistant https://YOUR-ADDRESS/mcp
//   2. A key, for assistants that ask for an API key or bearer token:
//      node server.js mcp-key NAME   prints a key. Send it as "Authorization: Bearer KEY",
//      or as a last resort put it in the link: https://YOUR-ADDRESS/mcp?key=KEY
//      node server.js mcp-revoke NAME  signs every assistant out for that person.
// An assistant can read your day, shifts, to-dos and events, and add, tick or remove them.
// It can't change settings, passwords or anything else on the computer.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCESS_DAYS = 30, REFRESH_DAYS = 365;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = function makeMcp(h) {
  // h: helpers from server.js
  const FILE = path.join(h.DATA_DIR, 'oauth.json');
  // Kept in data/oauth.json. Re-read when it changes on disk, so `node server.js mcp-key` works without a restart.
  let store = {}, loadedAt = -1;
  const fresh = () => {
    let m = 0; try { m = fs.statSync(FILE).mtimeMs; } catch {}
    if (m !== loadedAt) { try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { store = {}; } loadedAt = m; }
    store.clients = store.clients || {}; store.codes = store.codes || {}; store.tokens = store.tokens || {};
  };
  const saveStore = () => { const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(store)); fs.renameSync(t, FILE); try { loadedAt = fs.statSync(FILE).mtimeMs; } catch {} };
  fresh();
  const tidy = () => {
    const now = Date.now();
    for (const [k, c] of Object.entries(store.codes)) if (c.exp < now) delete store.codes[k];
    for (const [k, t] of Object.entries(store.tokens)) if (t.exp && t.exp < now) delete store.tokens[k];
  };

  // This app's public address, e.g. https://old-laptop.tail1234.ts.net. Set PUBLIC_URL if it comes out wrong.
  const base = req => {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
    const local = /^(localhost|127\.|\[::1\]|10\.|192\.168\.)/.test(host);
    return `${h.secure(req) || !local ? 'https' : 'http'}://${host}`;
  };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id' };
  const json = (res, code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const readText = req => new Promise((ok, no) => {
    let n = 0; const c = [];
    req.on('data', d => { n += d.length; if (n > 1e6) { no(new Error('too big')); req.destroy(); } else c.push(d); });
    req.on('end', () => ok(Buffer.concat(c).toString()));
  });
  const readForm = async req => {
    const t = await readText(req);
    if (/json/.test(req.headers['content-type'] || '')) { try { return JSON.parse(t || '{}'); } catch { return {}; } }
    return Object.fromEntries(new URLSearchParams(t));
  };

  // ---------- keys and tokens ----------
  function issue(uid, client, kind, days) {
    const t = (kind === 'key' ? 'hik_' : '') + rand();
    store.tokens[sha(t)] = { uid, client, kind, at: Date.now(), exp: days ? Date.now() + days * 864e5 : null };
    return t;
  }
  function whoIs(req, url) {
    const m = /^Bearer\s+(\S+)/i.exec(req.headers.authorization || '');
    const t = m ? m[1] : url.searchParams.get('key');
    const rec = t && store.tokens[sha(t)];
    if (!rec || rec.kind === 'refresh' || (rec.exp && rec.exp < Date.now()) || !h.users().users[rec.uid]) return null;
    return rec.uid;
  }
  // How many assistants act as this person, and a way to sign them all out (used by the owner's admin page).
  const connected = uid => { fresh(); return Object.values(store.tokens).filter(t => t.uid === uid && t.kind !== 'refresh').length; };
  const revoke = uid => { fresh(); let n = 0; for (const [k, t] of Object.entries(store.tokens)) if (t.uid === uid) { delete store.tokens[k]; n++; } if (n) saveStore(); return n; };
  function cli(cmd, name) {
    if (cmd !== 'mcp-key' && cmd !== 'mcp-revoke') return false;
    fresh();
    const found = h.findUser(name || '');
    if (!found) { if (name) console.log(`No user called ${name}.`); else console.log(`Usage: node server.js ${cmd} NAME`); return true; }
    if (cmd === 'mcp-key') {
      const k = issue(found[0], 'key', 'key', 0); saveStore();
      console.log(`Key for ${found[1].name} (shown once, keep it private):\n\n  ${k}\n\nIt acts as ${found[1].name}. Remove it with: node server.js mcp-revoke ${found[1].name}`);
    } else {
      let n = 0; for (const [k, t] of Object.entries(store.tokens)) if (t.uid === found[0]) { delete store.tokens[k]; n++; }
      saveStore(); console.log(`Signed out ${n ? 'every assistant' : 'nothing (no assistants were connected)'} for ${found[1].name}.`);
    }
    return true;
  }

  // ---------- OAuth: just enough for MCP clients ----------
  // Where the assistant may be sent back to: https, http on this computer, or an app link like myapp://
  const okRedirect = u => { try { const x = new URL(u), s = x.protocol.slice(0, -1);
    return s === 'https' || (s === 'http' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)) || !['http', 'javascript', 'data', 'file', 'vbscript', 'blob'].includes(s); } catch { return false; } };
  const page = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' }); res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home it</title><style>
:root{--bg:#F5F1E8;--surface:#fff;--ink:#14112A;--muted:#5D5870;--hl:#FFD23F;--owe:#E0243C}
@media (prefers-color-scheme:dark){:root{--bg:#13111C;--surface:#1E1B2C;--ink:#F1EEFF;--muted:#A9A3C2;--owe:#FF6B7D}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}
form,.box{width:100%;max-width:380px;background:var(--surface);border:2.5px solid var(--ink);border-radius:14px;box-shadow:5px 5px 0 var(--ink);padding:22px}
h1{margin:0 0 6px;font-size:1.5rem}p{margin:0 0 14px;color:var(--muted)}label{display:block;font-weight:600;font-size:.88rem;color:var(--muted);margin:12px 0 6px}
input{width:100%;font:inherit;font-size:1rem;padding:12px 14px;border:2.5px solid var(--ink);border-radius:12px;background:var(--surface);color:var(--ink)}
button{width:100%;margin-top:18px;font:inherit;font-weight:800;font-size:1rem;padding:13px;border:2.5px solid var(--ink);border-radius:12px;background:var(--hl);color:#14112A;box-shadow:3px 3px 0 var(--ink);cursor:pointer}
.err{color:var(--owe);margin:12px 0 0}</style></head><body>${body}</body></html>`); };

  function authorizeForm(res, q, clientName, err) {
    const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']
      .map(k => `<input type="hidden" name="${k}" value="${esc(q[k])}">`).join('');
    page(res, err ? 401 : 200, `<form method="post" action="/oauth/authorize">${hidden}
  <h1>Connect ${esc(clientName || 'an assistant')}</h1>
  <p>Sign in to let it see your day, shifts, to-do lists and events in Home it, and add, tick or remove them. It can’t change your settings or password.</p>
  <label for="n">Name</label><input id="n" name="name" autocomplete="username" required>
  <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
  <label for="cd">Sign-in code <span style="font-weight:400">(only if you turned one on)</span></label><input id="cd" name="code" inputmode="numeric" autocomplete="one-time-code">
  <button>Sign in and allow</button>${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}</form>`);
  }

  async function oauth(req, res, url) {
    const p = url.pathname, b = base(req);
    if (req.method === 'OPTIONS') return json(res, 204);
    if (p.startsWith('/.well-known/oauth-protected-resource'))
      return json(res, 200, { resource: b + '/mcp', authorization_servers: [b], bearer_methods_supported: ['header'], resource_name: 'Home it' });
    if (p.startsWith('/.well-known/oauth-authorization-server') || p.startsWith('/.well-known/openid-configuration'))
      return json(res, 200, {
        issuer: b, authorization_endpoint: b + '/oauth/authorize', token_endpoint: b + '/oauth/token', registration_endpoint: b + '/oauth/register',
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'], scopes_supported: ['home-it']
      });
    if (p === '/oauth/register' && req.method === 'POST') {
      const m = await readForm(req);
      const uris = Array.isArray(m.redirect_uris) ? m.redirect_uris.map(String) : [];
      if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) return json(res, 400, { error: 'invalid_redirect_uri' });
      if (Object.keys(store.clients).length > 500) return json(res, 400, { error: 'invalid_client_metadata', error_description: 'too many clients' });
      const id = 'c_' + rand(12), method = ['client_secret_post', 'client_secret_basic'].includes(m.token_endpoint_auth_method) ? m.token_endpoint_auth_method : 'none';
      const secret = method === 'none' ? null : rand();
      store.clients[id] = { name: String(m.client_name || '').slice(0, 60), redirect_uris: uris, secret: secret && sha(secret), at: Date.now() };
      saveStore();
      return json(res, 201, { client_id: id, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: store.clients[id].name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: method });
    }
    if (p === '/oauth/authorize') {
      const q = req.method === 'POST' ? await readForm(req) : Object.fromEntries(url.searchParams);
      const c = store.clients[q.client_id];
      if (!c) return page(res, 400, `<div class="box"><h1>Unknown app</h1><p>Try connecting Home it from your assistant again.</p></div>`);
      if (!c.redirect_uris.includes(q.redirect_uri)) return page(res, 400, `<div class="box"><h1>That link doesn’t match</h1><p>Try connecting again from your assistant.</p></div>`);
      const back = params => { const u = new URL(q.redirect_uri); for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v); res.writeHead(302, { Location: u.toString(), 'Cache-Control': 'no-store' }); res.end(); };
      if (req.method === 'GET' && q.response_type !== 'code') return back({ error: 'unsupported_response_type', state: q.state });
      if (!q.code_challenge || (q.code_challenge_method || 'plain') !== 'S256') return back({ error: 'invalid_request', error_description: 'PKCE S256 required', state: q.state });
      if (req.method !== 'POST') return authorizeForm(res, q, c.name);
      const wait = h.tooManyTries(req);
      if (wait) return authorizeForm(res, q, c.name, wait);
      const uid = h.checkLogin(req, q.name, q.password);
      if (!uid) return authorizeForm(res, q, c.name, 'That name and password don’t match.');
      if (h.needsCode && h.needsCode(uid)) {
        const wait2 = h.tooManyTries(req, uid); if (wait2) return authorizeForm(res, q, c.name, wait2);
        if (!h.checkCode(uid, q.code)) { h.noteMiss(req, uid); return authorizeForm(res, q, c.name, 'Enter the 6-digit code from your authenticator app.'); }
      }
      tidy();
      const code = rand();
      store.codes[sha(code)] = { uid, client: q.client_id, redirect_uri: q.redirect_uri, challenge: q.code_challenge, exp: Date.now() + 10 * 60e3 };
      saveStore();
      return back({ code, state: q.state });
    }
    if (p === '/oauth/token' && req.method === 'POST') {
      const m = await readForm(req);
      const basic = /^Basic\s+(\S+)/i.exec(req.headers.authorization || '');
      if (basic) { const [i, s] = Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent); m.client_id = m.client_id || i; m.client_secret = m.client_secret || s; }
      const c = store.clients[m.client_id];
      if (!c || (c.secret && sha(m.client_secret || '') !== c.secret)) return json(res, 401, { error: 'invalid_client' });
      let uid;
      if (m.grant_type === 'authorization_code') {
        const k = sha(m.code || ''), rec = store.codes[k];
        delete store.codes[k];
        const challenge = crypto.createHash('sha256').update(String(m.code_verifier || '')).digest('base64url');
        if (!rec || rec.exp < Date.now() || rec.client !== m.client_id || (m.redirect_uri && m.redirect_uri !== rec.redirect_uri) || challenge !== rec.challenge) {
          saveStore(); return json(res, 400, { error: 'invalid_grant' });
        }
        uid = rec.uid;
      } else if (m.grant_type === 'refresh_token') {
        const k = sha(m.refresh_token || ''), rec = store.tokens[k];
        if (!rec || rec.kind !== 'refresh' || rec.client !== m.client_id || rec.exp < Date.now()) return json(res, 400, { error: 'invalid_grant' });
        delete store.tokens[k];
        uid = rec.uid;
      } else return json(res, 400, { error: 'unsupported_grant_type' });
      if (!h.users().users[uid]) return json(res, 400, { error: 'invalid_grant' });
      tidy();
      const access = issue(uid, m.client_id, 'access', ACCESS_DAYS), refresh = issue(uid, m.client_id, 'refresh', REFRESH_DAYS);
      saveStore();
      return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: ACCESS_DAYS * 86400, refresh_token: refresh, scope: 'home-it' });
    }
    return json(res, 404, { error: 'not_found' });
  }

  // ---------- reading and changing Home it ----------
  const H = h.H;
  const tm = (t, short) => H.fmtTime(t, short);
  const endOf = x => H.hhmm(H.mins(x.start) + x.mins);
  const shiftText = x => `${tm(x.start)} to ${tm(endOf(x))} at ${x.place} (${H.fmtHours(x.mins)}${x.rule ? ', repeats weekly' : ''})`;
  const LIST_HELP = 'today, later or shop (the shopping list). Default today.';
  const listArg = v => { const x = String(v || 'today').toLowerCase().trim(); return x.startsWith('shop') ? 'shop' : x.startsWith('later') ? 'later' : x === 'today' || !x ? 'today' : null; };
  // A day given as YYYY-MM-DD, "today" or "tomorrow"
  const dayArg = (v, dflt) => { const x = String(v || '').toLowerCase().trim(), t = h.today();
    if (!x) return dflt === undefined ? t : dflt; if (x === 'today') return t; if (x === 'tomorrow') return H.addDays(t, 1);
    if (!H.okDate(x)) throw new Error('Give the day as YYYY-MM-DD, like ' + t + '.'); return x; };
  const timeArg = (v, what) => { const m = /^(\d{1,2}):(\d\d)$/.exec(String(v || '').trim()), x = m && m[1].padStart(2, '0') + ':' + m[2];
    if (!x || !H.okTime(x)) throw new Error(`Give the ${what} in 24-hour time, like 14:00.`); return x; };
  const findOne = (items, q, what) => {
    const x = String(q || '').toLowerCase().trim(); if (!x) throw new Error('Say which ' + what + '.');
    const hits = items.filter(i => i.id === q || i.t.toLowerCase() === x); const loose = hits.length ? hits : items.filter(i => i.t.toLowerCase().includes(x));
    if (!loose.length) throw new Error(`No ${what} like "${q}". There ${items.length ? 'is: ' + items.map(i => i.t).join(', ') : 'are none'}.`);
    if (loose.length > 1) throw new Error(`More than one ${what} matches: ${loose.map(i => i.t).join(', ')}. Say which.`);
    return loose[0];
  };
  const todoLine = x => `${x.d ? '[done]' : '[ ]'} ${x.t}${x.due ? ' (by ' + tm(x.due) + ')' : ''}${x.rep ? ' (' + x.rep + ')' : ''}`;
  const NAMES = { today: 'Today', later: 'Later', shop: 'Shopping' };
  // One of the person's own events (not a linked-calendar row), found by name and, if given, day.
  const ownEvent = (uid, a) => {
    const s = h.stateOf(uid), date = a.date ? dayArg(a.date) : null;
    return findOne((date ? H.eventsOn(s, date) : H.eventList(s, h.today())).filter(e => !e.cal), a.what, 'event');
  };
  const tools = [
    { name: 'get_today', title: 'Today at a glance', annotations: { readOnlyHint: true },
      description: 'The person’s day in Home it: today’s shift and when to leave for it, today’s events, the Today to-do list, tomorrow, the next shift and the weather.',
      inputSchema: { type: 'object', properties: {} },
      async run(uid) {
        const s = h.stateOf(uid), v = H.dayView(s, new Date()), x = v.shift, out = [H.fmtDate(v.date, true) + '.'];
        if (v.phase === 'off') out.push('No shift today.');
        else if (v.phase === 'done') out.push(`Today’s shift is finished (${shiftText(x)}).`);
        else if (v.phase === 'working') out.push(`At work now until ${tm(H.hhmm(v.endM))} at ${x.place}.`);
        else out.push(`Shift today: ${shiftText(x)}. Leave by ${tm(H.hhmm(v.leaveM))} (${s.settings.travel} min to get there)${v.toLeave > 0 ? ', which is in ' + H.fmtDur(v.toLeave) : ', which is now'}.`);
        out.push(v.events.length ? 'Events today: ' + v.events.map(e => `${e.t}${e.time ? ' at ' + tm(e.time) : ''}${e.d ? ' (done)' : ''}`).join('; ') + '.' : 'No events today.');
        out.push(s.lists.today.length ? 'To do today:\n' + s.lists.today.map(todoLine).join('\n') : 'Nothing on the Today list.');
        const ts = v.tomorrow.shifts[0];
        out.push('Tomorrow: ' + (ts ? 'shift ' + shiftText(ts) : 'no shift') + (v.tomorrow.events.length ? '; ' + v.tomorrow.events.map(e => e.t + (e.time ? ' at ' + tm(e.time) : '')).join('; ') : '') + '.');
        if (v.next && v.next.date > v.tomorrow.date) out.push(`Next shift: ${H.fmtDate(v.next.date, true)}, ${shiftText(v.next)}.`);
        try { const w = await h.weather(uid); if (w.ok) out.push(`Weather in ${w.city}: ${w.temp}°C (feels ${w.feels}°), high ${w.hi}°, low ${w.lo}°${w.rain != null ? ', ' + w.rain + '% chance of rain or snow' : ''}. Sunset ${tm(w.sunset)}.`); } catch {}
        return out.join('\n');
      } },
    { name: 'list_todos', title: 'To-do lists', annotations: { readOnlyHint: true },
      description: 'Shows a to-do list: today, later or shop (the shopping list). Leave the list out to see all three.',
      inputSchema: { type: 'object', properties: { list: { type: 'string', description: LIST_HELP.replace(' Default today.', '') } } },
      run(uid, a) {
        const s = h.stateOf(uid), names = { today: 'Today', later: 'Later', shop: 'Shopping' };
        const one = a.list ? listArg(a.list) : null; if (a.list && !one) throw new Error('The lists are ' + LIST_HELP);
        return (one ? [one] : H.LISTS).map(k => `${names[k]}:\n${s.lists[k].map(todoLine).join('\n') || '(empty)'}`).join('\n\n');
      } },
    { name: 'add_todo', title: 'Add a to-do', annotations: { destructiveHint: false },
      description: 'Adds something to a to-do list. Use list "shop" for things to buy. It shows on the home screen straight away.',
      inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'What to do or buy, up to 80 characters' }, list: { type: 'string', description: LIST_HELP }, repeat: { type: 'string', enum: ['daily', 'weekly'], description: 'Leave out for a one-off' }, by: { type: 'string', description: 'A time today it should be done by, 24-hour, like 11:30' } }, required: ['text'] },
      run(uid, a) {
        const list = listArg(a.list); if (!list) throw new Error('The lists are ' + LIST_HELP);
        h.applyOp(uid, 'todo.add', { t: a.text, list, rep: a.repeat || undefined, due: a.by ? timeArg(a.by, 'time') : undefined });
        const l = h.stateOf(uid).lists[list];
        return `Added “${l[l.length - 1].t}” to ${{ today: 'Today', later: 'Later', shop: 'Shopping' }[list]}.`;
      } },
    { name: 'complete_todo', title: 'Tick off a to-do', annotations: { destructiveHint: false, idempotentHint: true },
      description: 'Marks a to-do as done (or not done again with done=false). Give its text or part of it.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' }, list: { type: 'string', description: LIST_HELP }, done: { type: 'boolean', default: true } }, required: ['text'] },
      run(uid, a) {
        const list = listArg(a.list); if (!list) throw new Error('The lists are ' + LIST_HELP);
        const x = findOne(h.stateOf(uid).lists[list], a.text, 'to-do'), want = a.done !== false;
        if (!!x.d !== want) h.applyOp(uid, 'todo.toggle', { list, id: x.id });
        return `“${x.t}” is ${want ? 'done' : 'not done'}.`;
      } },
    { name: 'change_todo', title: 'Rename or move a to-do', annotations: { destructiveHint: false },
      description: 'Renames a to-do, moves it to another list, or both. Give its text or part of it.',
      inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The to-do as it is now' }, list: { type: 'string', description: 'The list it is in. ' + LIST_HELP }, new_text: { type: 'string', description: 'Its new wording' }, move_to: { type: 'string', description: 'The list to move it to. ' + LIST_HELP } }, required: ['text'] },
      run(uid, a) {
        const list = listArg(a.list); if (!list) throw new Error('The lists are ' + LIST_HELP);
        const to = a.move_to ? listArg(a.move_to) : null; if (a.move_to && !to) throw new Error('The lists are ' + LIST_HELP);
        if (!a.new_text && (!to || to === list)) throw new Error('Say the new wording, the list to move it to, or both.');
        const x = findOne(h.stateOf(uid).lists[list], a.text, 'to-do'), was = x.t;
        if (a.new_text) h.applyOp(uid, 'todo.edit', { list, id: x.id, t: a.new_text });
        if (to && to !== list) h.applyOp(uid, 'todo.move', { list, id: x.id, to });
        const names = NAMES, now = h.stateOf(uid).lists[to || list].find(y => y.id === x.id);
        return `“${was}” is now “${now.t}” in ${names[to || list]}.`;
      } },
    { name: 'remove_todo', title: 'Remove a to-do', annotations: { destructiveHint: true },
      description: 'Deletes a to-do from a list. Confirm with the user first.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' }, list: { type: 'string', description: LIST_HELP } }, required: ['text'] },
      run(uid, a) {
        const list = listArg(a.list); if (!list) throw new Error('The lists are ' + LIST_HELP);
        const x = findOne(h.stateOf(uid).lists[list], a.text, 'to-do');
        h.applyOp(uid, 'todo.del', { list, id: x.id }); return `Removed “${x.t}”.`;
      } },
    { name: 'list_shifts', title: 'Work shifts', annotations: { readOnlyHint: true },
      description: 'Work shifts for the week that holds a day (default this week), with total hours and estimated pay, plus the next shift coming up.',
      inputSchema: { type: 'object', properties: { week_of: { type: 'string', description: 'Any day in the week, YYYY-MM-DD. Default today.' } } },
      run(uid, a) {
        const s = h.stateOf(uid), wk = H.week(s, dayArg(a.week_of)), v = H.dayView(s, new Date());
        return `Week of ${H.fmtDate(wk.from, true)}:\n` + wk.days.map(d => `${H.fmtDate(d.date)} (${d.date}): ${d.shifts.map(shiftText).join('; ') || 'off'}`).join('\n')
          + `\nTotal ${H.fmtHours(wk.mins)}${wk.pay != null ? ', about ' + H.money(wk.pay) + ' before tax' : ''}.` + (v.next ? `\nNext shift: ${H.fmtDate(v.next.date, true)}, ${shiftText(v.next)}.` : '\nNo shifts coming up.');
      } },
    { name: 'add_shift', title: 'Add a work shift', annotations: { destructiveHint: false },
      description: 'Adds a work shift. Times are 24-hour (14:00); an end at or before the start means it ends the next day. Set every_week=true for a shift that repeats on that weekday. Confirm the day and times with the user first.',
      inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, or "today" / "tomorrow"' }, start: { type: 'string', description: 'Like 14:00' }, end: { type: 'string', description: 'Like 22:00' }, place: { type: 'string', description: 'Default "Work"' }, every_week: { type: 'boolean', default: false } }, required: ['date', 'start', 'end'] },
      run(uid, a) {
        const date = dayArg(a.date, null); if (!date) throw new Error('Say which day.');
        const start = timeArg(a.start, 'start'), end = timeArg(a.end, 'end');
        if (H.shiftsOn(h.stateOf(uid), date).some(x => x.start === start)) throw new Error(`There is already a shift starting at ${tm(start)} on ${date}.`);
        const msg = h.applyOp(uid, 'shift.add', { date, start, end, place: a.place, repeat: !!a.every_week });
        return `${msg}: ${H.fmtDate(date, true)}, ${tm(start)} to ${tm(end)}.`;
      } },
    { name: 'change_shift', title: 'Change a work shift', annotations: { destructiveHint: false },
      description: 'Changes the times, place or day of the shift on a day. Leave out what stays the same. For a weekly shift the change applies from that day on; the weeks before keep their hours. Confirm with the user first.',
      inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'The day the shift is on now: YYYY-MM-DD, or "today" / "tomorrow"' }, start: { type: 'string', description: 'Its start now. Only needed when the day has more than one shift' },
        new_date: { type: 'string', description: 'Move it to this day' }, new_start: { type: 'string', description: 'Like 14:00' }, new_end: { type: 'string', description: 'Like 22:00' }, place: { type: 'string' } }, required: ['date'] },
      run(uid, a) {
        const date = dayArg(a.date, null); if (!date) throw new Error('Say which day.');
        let on = H.shiftsOn(h.stateOf(uid), date); if (a.start) on = on.filter(x => x.start === timeArg(a.start, 'start'));
        if (!on.length) throw new Error('No shift on ' + date + (a.start ? ' at that time.' : '.'));
        if (on.length > 1) throw new Error('That day has shifts at ' + on.map(x => x.start).join(' and ') + '. Say which start time.');
        const x = on[0], day = a.new_date ? dayArg(a.new_date, null) : ''; if (a.new_date && !day) throw new Error('Say which day to move it to.');
        if (!day && !a.new_start && !a.new_end && a.place == null) throw new Error('Say what to change: the day, the times or the place.');
        const start = a.new_start ? timeArg(a.new_start, 'start') : x.start, end = a.new_end ? timeArg(a.new_end, 'end') : x.end;
        const msg = h.applyOp(uid, 'shift.edit', { id: x.id, date, day: day && day !== date ? day : '', start, end, place: a.place != null ? a.place : x.place });
        return `${msg}: ${H.fmtDate(day || date, true)}, ${tm(start)} to ${tm(end)}.`;
      } },
    { name: 'hours_by_month', title: 'Hours and pay by month', annotations: { readOnlyHint: true },
      description: 'Hours worked and estimated pay for each month with a shift, newest first (default the last 12 months). Good for checking a pay stub.',
      inputSchema: { type: 'object', properties: { months: { type: 'integer', minimum: 1, maximum: 24, default: 12 } } },
      run(uid, a) {
        const l = H.months(h.stateOf(uid), h.today(), Math.min(24, Math.max(1, a.months | 0 || 12)));
        return l.map(m => `${m.ym}: ${H.fmtHours(m.mins)} over ${m.shifts} shift${m.shifts === 1 ? '' : 's'}${m.pay != null ? ', about ' + H.money(m.pay) + ' before tax' : ''}${m.doneMins != null ? ` (${H.fmtHours(m.doneMins)} worked so far)` : ''}`).join('\n') || 'No shifts in that time.';
      } },
    { name: 'remove_shift', title: 'Remove a work shift', annotations: { destructiveHint: true },
      description: 'Removes the shift on a day. For a weekly shift this skips just that day, unless stop_repeating=true, which ends it from that day on. Confirm with the user first.',
      inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, or "today" / "tomorrow"' }, start: { type: 'string', description: 'Only needed when the day has more than one shift' }, stop_repeating: { type: 'boolean', default: false } }, required: ['date'] },
      run(uid, a) {
        const date = dayArg(a.date, null); if (!date) throw new Error('Say which day.');
        let on = H.shiftsOn(h.stateOf(uid), date); if (a.start) on = on.filter(x => x.start === timeArg(a.start, 'start'));
        if (!on.length) throw new Error('No shift on ' + date + (a.start ? ' at that time.' : '.'));
        if (on.length > 1) throw new Error('That day has shifts at ' + on.map(x => x.start).join(' and ') + '. Say which start time.');
        return h.applyOp(uid, 'shift.del', { id: on[0].id, date, all: !!a.stop_repeating }) + ` (${H.fmtDate(date, true)}, ${shiftText(on[0])}).`;
      } },
    { name: 'list_events', title: 'Events coming up', annotations: { readOnlyHint: true },
      description: 'Events and appointments from today on (default the next 30 days).',
      inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } } },
      run(uid, a) {
        const s = h.stateOf(uid), t = h.today(), to = H.addDays(t, Math.min(365, Math.max(1, a.days | 0 || 30)));
        const l = H.eventList(s, t).filter(e => e.date <= to);
        return l.map(e => `${H.fmtDate(e.date, true)} (${e.date})${e.time ? ' at ' + tm(e.time) : ''}: ${e.t}${e.rep ? ' (repeats ' + e.rep + ')' : ''}${e.d ? ' (done)' : ''}`).join('\n') || 'Nothing coming up.';
      } },
    { name: 'add_event', title: 'Add an event', annotations: { destructiveHint: false },
      description: 'Adds an event or appointment on a day, with an optional time (24-hour). It shows on Today and in the week.',
      inputSchema: { type: 'object', properties: { what: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, or "today" / "tomorrow"' }, time: { type: 'string', description: 'Like 15:30. Leave out for no set time.' }, repeat: { type: 'string', enum: ['weekly', 'monthly', 'yearly'], description: 'Leave out for a one-off.' } }, required: ['what', 'date'] },
      run(uid, a) {
        const date = dayArg(a.date, null); if (!date) throw new Error('Say which day.');
        const time = a.time ? timeArg(a.time, 'time') : undefined;
        h.applyOp(uid, 'event.add', { t: a.what, date, time, rep: a.repeat || undefined });
        return `Added “${H.text(a.what)}” on ${H.fmtDate(date, true)}${time ? ' at ' + tm(time) : ''}${a.repeat ? ', repeating ' + a.repeat : ''}.`;
      } },
    { name: 'change_event', title: 'Change an event', annotations: { destructiveHint: false },
      description: 'Renames an upcoming event or changes its day, time or repeat. Leave out what stays the same. Events from a linked calendar can’t be changed here.',
      inputSchema: { type: 'object', properties: { what: { type: 'string', description: 'Its name now, or part of it' }, date: { type: 'string', description: 'Its day now, only needed when two events share a name' }, new_name: { type: 'string' }, new_date: { type: 'string', description: 'YYYY-MM-DD, or "today" / "tomorrow"' },
        new_time: { type: 'string', description: 'Like 15:30, or "none" for no set time' }, repeat: { type: 'string', enum: ['none', 'weekly', 'monthly', 'yearly'] } }, required: ['what'] },
      run(uid, a) {
        const x = ownEvent(uid, a), s = h.stateOf(uid), e = s.events.find(y => y.id === x.id);
        if (!a.new_name && !a.new_date && !a.new_time && !a.repeat) throw new Error('Say what to change: the name, the day, the time or the repeat.');
        const date = a.new_date ? dayArg(a.new_date, null) : e.date; if (!date) throw new Error('Say which day.');
        const time = a.new_time ? (/^none$/i.test(a.new_time) ? '' : timeArg(a.new_time, 'time')) : e.time || '';
        const rep = a.repeat ? (a.repeat === 'none' ? '' : a.repeat) : e.rep || '';
        h.applyOp(uid, 'event.edit', { id: e.id, t: a.new_name || e.t, date, time, rep });
        return `“${e.t}” is on ${H.fmtDate(date, true)}${time ? ' at ' + tm(time) : ''}${rep ? ', repeating ' + rep : ''}.`;
      } },
    { name: 'complete_event', title: 'Tick off an event', annotations: { destructiveHint: false, idempotentHint: true },
      description: 'Marks an event as done (or not done again with done=false). For a repeating event this ticks just that day.',
      inputSchema: { type: 'object', properties: { what: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, only needed when two events share a name' }, done: { type: 'boolean', default: true } }, required: ['what'] },
      run(uid, a) {
        const x = ownEvent(uid, a), want = a.done !== false, is = x.rep ? x.done === x.date : !!x.d;
        if (is !== want) h.applyOp(uid, 'event.toggle', { id: x.id, date: x.date });
        return `“${x.t}” (${H.fmtDate(x.date, true)}) is ${want ? 'done' : 'not done'}.`;
      } },
    { name: 'remove_event', title: 'Remove an event', annotations: { destructiveHint: true },
      description: 'Deletes an upcoming event. Give its name or part of it. Confirm with the user first.',
      inputSchema: { type: 'object', properties: { what: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, only needed when two events share a name' } }, required: ['what'] },
      run(uid, a) {
        const t = h.today(), date = a.date ? dayArg(a.date) : null;
        const x = findOne(date ? H.eventsOn(h.stateOf(uid), date) : H.eventList(h.stateOf(uid), t), a.what, 'event');
        h.applyOp(uid, 'event.del', { id: x.id }); return `Removed “${x.t}” (${H.fmtDate(x.date, true)}).`;
      } }
  ];

  // ---------- MCP over streamable HTTP (stateless, plain JSON replies) ----------
  const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
  async function rpc(uid, msg) {
    const { id, method } = msg || {}, params = msg && msg.params && typeof msg.params === 'object' ? msg.params : {};
    const ok = result => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
    if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid request');
    if (id === undefined) return null;   // a notification: nothing to send back
    if (method === 'initialize') return ok({
      protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[1],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'home-it', title: 'Home it', version: h.version },
      instructions: 'Home it is a personal home screen kept on the person’s own laptop: work shifts, three to-do lists (today, later, shop), events, and the weather. Days are YYYY-MM-DD and times are 24-hour (14:00) in the person’s own time zone. Tools act as the person who signed in, and anything added shows on their home screen straight away. Before removing anything or adding a shift, check the details with the user.'
    });
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: tools.map(({ run, ...t }) => t) });
    if (method === 'tools/call') {
      const t = tools.find(x => x.name === params.name);
      if (!t) return fail(-32602, 'Unknown tool: ' + params.name);
      try {
        const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
        const text = await t.run(uid, args); return ok({ content: [{ type: 'text', text }] }); }
      catch (e) { return ok({ content: [{ type: 'text', text: e.message }], isError: true }); }
    }
    return fail(-32601, 'Method not found: ' + method);
  }
  async function mcp(req, res, url) {
    if (req.method === 'OPTIONS') return json(res, 204);
    const uid = whoIs(req, url);
    if (!uid) return json(res, 401, { error: 'invalid_token', error_description: 'Sign in to Home it first.' },
      { 'WWW-Authenticate': `Bearer resource_metadata="${base(req)}/.well-known/oauth-protected-resource"` });
    if (req.method === 'GET') return json(res, 405, { error: 'This server only answers POST.' }, { Allow: 'POST' });
    if (req.method === 'DELETE') return json(res, 200, {});
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }, { Allow: 'POST' });
    let body;
    try { body = JSON.parse(await readText(req)); } catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const out = Array.isArray(body) ? (await Promise.all(body.map(m => rpc(uid, m)))).filter(Boolean) : await rpc(uid, body);
    if (!out || (Array.isArray(out) && !out.length)) return json(res, 202);
    return json(res, 200, out);
  }

  return {
    cli, connected, revoke,
    // Returns true when it handled the request.
    async handle(req, res) {
      const url = new URL(req.url, 'http://x'), p = url.pathname;
      if (p === '/mcp' || p === '/mcp/' || p.startsWith('/oauth/') || p.startsWith('/.well-known/')) fresh();
      if (p === '/mcp' || p === '/mcp/') { await mcp(req, res, url); return true; }
      if (p.startsWith('/oauth/') || p.startsWith('/.well-known/oauth-') || p === '/.well-known/openid-configuration') { await oauth(req, res, url); return true; }
      return false;
    }
  };
};
