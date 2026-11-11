// Reads a news feed (RSS or Atom) into plain headlines. No packages; only what a news page needs.
'use strict';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
const unent = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
});
// The words inside a tag's text: CDATA unwrapped, entities read, any HTML inside dropped.
const clean = (s, max) => unent(unent(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);
const tag = (block, name) => { const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(block); return m ? m[1] : ''; };

// text: the feed. Returns { title, items: [{ t, sum, at (ms or 0), url }] }, newest first, at most `max`.
function read(text, max = 30) {
  const xml = String(text || ''), atom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = xml.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  const head = xml.slice(0, blocks.length ? xml.indexOf(blocks[0]) : 2000);
  const items = [];
  for (const b of blocks) {
    const t = clean(tag(b, 'title'), 200); if (!t) continue;
    let url = atom ? (/<link[^>]*href="([^"]+)"/i.exec(b) || [])[1] || '' : clean(tag(b, 'link'), 500);
    if (!/^https?:\/\//i.test(url)) url = '';
    const at = Date.parse(clean(tag(b, atom ? 'updated' : 'pubDate') || tag(b, 'published') || tag(b, 'dc:date'), 80)) || 0;
    items.push({ t, sum: clean(tag(b, atom ? 'summary' : 'description') || tag(b, 'content'), 400), at, url: unent(url) });
  }
  items.sort((a, b) => b.at - a.at);
  return { title: clean(tag(head, 'title'), 80), items: items.slice(0, max) };
}

module.exports = { read };
