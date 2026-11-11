// A stand-in for Open-Meteo with the same answer shape.
const http = require('http');
const pad = n => String(n).padStart(2, '0');
module.exports = (port, cb) => http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('Content-Type', 'application/json');
  // and for a shared calendar: one event tomorrow at 18:30 UTC and a yearly all-day one that falls tomorrow too
  if (u.pathname === '/cal.ics') {
    const t = new Date(Date.now() + 864e5), d = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
    res.setHeader('Content-Type', 'text/calendar');
    return res.end(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Dinner at Mum’s', `DTSTART:${d}T120000`, 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:2', 'SUMMARY:Maya’s birthday', `DTSTART;VALUE=DATE:2020${d.slice(4)}`, 'RRULE:FREQ=YEARLY', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  }
  // also a stand-in for Split it's assistant address: answers one tool, only with the right key
  if (u.pathname === '/mcp') {
    if (req.headers.authorization !== 'Bearer good-key') { res.statusCode = 401; return res.end('{}'); }
    let body = ''; req.on('data', d => body += d);
    return req.on('end', () => {
      const lately = JSON.parse(body).params.name === 'recent_expenses';
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: lately ? '- Groceries $80.00, paid by you\n- Internet $70.00, paid by Maya' : 'Balances for Sherry:\n- Maya owes you $40.00\nOverall: you’re owed $40.00.' }] } }));
    });
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Balances for Sherry:\n- Maya owes you $40.00\nOverall: you’re owed $40.00.' }] } }));
  }
  if (u.pathname === '/geo') return res.end(JSON.stringify(u.searchParams.get('name').startsWith('Nowhere') ? {} : { results: [{ name: 'Kingston', admin1: 'Ontario', latitude: 44.2298, longitude: -76.481 }] }));
  const d = new Date(), day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, t2 = new Date(d.getTime() + 864e5), day2 = `${t2.getFullYear()}-${pad(t2.getMonth() + 1)}-${pad(t2.getDate())}`;
  const time = [], temp = [], code = [], rain = [];
  for (const dd of [day, day2]) for (let h = 0; h < 24; h++) { time.push(`${dd}T${pad(h)}:00`); temp.push(2 + (h % 12) / 2); code.push(h > 16 || h < 7 ? 0 : 3); rain.push(10); }
  res.end(JSON.stringify({ current: { time: `${day}T${pad(d.getHours())}:${pad(Math.floor(d.getMinutes() / 15) * 15)}`, temperature_2m: 3.4, apparent_temperature: -0.6, weather_code: 3, is_day: 1 },
    hourly: { time, temperature_2m: temp, weather_code: code, precipitation_probability: rain },
    daily: { time: [day, day2], weather_code: [3, 1], temperature_2m_max: [6.2, 4.1], temperature_2m_min: [-1.2, -2.6], sunrise: [`${day}T06:56`, `${day2}T06:57`], sunset: [`${day}T16:44`, `${day2}T16:43`], precipitation_probability_max: [20, 5] } }));
}).listen(port, '127.0.0.1', cb);
if (require.main === module) module.exports(8199);
