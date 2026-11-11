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

// The story's picture, if the feed gives one: media:content, media:thumbnail, an enclosure, or the first <img> in the
// description. Only https addresses are kept (anything else would be blocked or unsafe to show). '' when there is none.
const attr = (el, name) => { const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(el); return m ? unent(m[1] != null ? m[1] : m[2]).trim() : ''; };
const safeImg = u => { u = String(u || '').trim(); if (u.startsWith('//')) u = 'https:' + u; return /^https:\/\/[^\s"'<>\\]+$/i.test(u) && u.length <= 600 ? u : ''; };
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;
function picture(b, atom) {
  let best = '', bestW = -1;
  for (const el of b.match(/<media:(?:content|thumbnail)\b[^>]*>/gi) || []) {
    const thumb = /^<media:thumbnail/i.test(el), type = attr(el, 'type'), medium = attr(el, 'medium'), u = safeImg(attr(el, 'url'));
    if (!u || (!thumb && ((type && !/^image\//i.test(type)) || (medium && medium !== 'image')))) continue;   // a video or sound clip, not a picture
    const w = parseInt(attr(el, 'width'), 10) || 0; if (w > bestW) { best = u; bestW = w; }
  }
  if (best) return best;
  for (const el of b.match(atom ? /<link\b[^>]*>/gi : /<enclosure\b[^>]*>/gi) || []) {
    if (atom && attr(el, 'rel') !== 'enclosure') continue;
    const u = safeImg(attr(el, atom ? 'href' : 'url')); if (u && (/^image\//i.test(attr(el, 'type')) || (!attr(el, 'type') && IMG_EXT.test(u)))) return u;
  }
  const body = [tag(b, 'content:encoded'), tag(b, atom ? 'summary' : 'description'), tag(b, 'content')].join(' ').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  for (const html of [body, unent(body)]) {
    for (const el of html.match(/<img\b[^>]*>/gi) || []) {
      const u = safeImg(attr(el, 'src')), w = parseInt(attr(el, 'width'), 10);
      if (u && !(w > 0 && w < 50)) return u;   // skip tiny tracking dots
    }
  }
  return '';
}

// text: the feed. Returns { title, items: [{ t, sum, at (ms or 0), url, img }] }, newest first, at most `max`.
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
    items.push({ t, sum: clean(tag(b, atom ? 'summary' : 'description') || tag(b, 'content'), 400), at, url: unent(url), img: picture(b, atom) });
  }
  items.sort((a, b) => b.at - a.at);
  return { title: clean(tag(head, 'title'), 80), items: items.slice(0, max) };
}

module.exports = { read };
