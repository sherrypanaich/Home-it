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
  // and a news feed: two headlines, the newer one second in the file
  if (u.pathname === '/news.xml') {
    res.setHeader('Content-Type', 'application/rss+xml');
    if (u.searchParams.get('down')) { res.statusCode = 503; return res.end('down'); }
    return res.end(`<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Test &amp; News</title>
      <item><title><![CDATA[Older story]]></title><link>https://news.example/a</link><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;First <b>line</b>.&lt;/p&gt;</description>
        <media:thumbnail width="240" url="https://img.example/small.jpg"/><media:content medium="image" width="976" url="https://img.example/big.jpg?a=1&amp;b=2"/></item>
      <item><title>Snow on the way &#8211; 10 cm</title><link>javascript:alert(1)</link><pubDate>Wed, 11 Nov 2026 09:00:00 GMT</pubDate><description><![CDATA[<img src="x.jpg"> Bundle up.]]></description></item>
      </channel></rss>`);
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
  // as many days as were asked for, like the real service
  const days = Array.from({ length: Math.max(2, +u.searchParams.get('forecast_days') || 2) }, (x, i) => { const t = new Date(d.getTime() + i * 864e5); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; });
  const time = [], temp = [], code = [], rain = [];
  for (const dd of [day, day2]) for (let h = 0; h < 24; h++) { time.push(`${dd}T${pad(h)}:00`); temp.push(2 + (h % 12) / 2); code.push(h > 16 || h < 7 ? 0 : 3); rain.push(10); }
  res.end(JSON.stringify({ current: { time: `${day}T${pad(d.getHours())}:${pad(Math.floor(d.getMinutes() / 15) * 15)}`, temperature_2m: 3.4, apparent_temperature: -0.6, weather_code: 3, is_day: 1 },
    hourly: { time, temperature_2m: temp, weather_code: code, precipitation_probability: rain },
    daily: { time: days, weather_code: days.map((x, i) => [3, 1][i] ?? 2), temperature_2m_max: days.map((x, i) => [6.2, 4.1][i] ?? 5 - i), temperature_2m_min: days.map((x, i) => [-1.2, -2.6][i] ?? -i),
      sunrise: days.map((x, i) => `${x}T06:${56 + Math.min(i, 3)}`), sunset: days.map((x, i) => `${x}T16:${44 - Math.min(i, 9)}`), precipitation_probability_max: days.map((x, i) => [20, 5][i] ?? 10 * i) } }));
}).listen(port, '127.0.0.1', cb);
if (require.main === module) module.exports(8199);
