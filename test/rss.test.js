// The news feed reader: headlines, and the picture each story comes with.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const RSS = require('../rss');

const feed = items => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>T</title>${items}</channel></rss>`;
const img = body => RSS.read(feed(`<item><title>A</title>${body}</item>`)).items[0].img;

test('a story picture is found in each of the usual places', () => {
  assert.equal(img(`<media:content url="https://a.example/1.jpg" medium="image"/>`), 'https://a.example/1.jpg');
  assert.equal(img(`<media:thumbnail width="240" url="https://a.example/s.jpg"/><media:thumbnail width="976" url="https://a.example/l.jpg"/>`), 'https://a.example/l.jpg');
  assert.equal(img(`<enclosure url='https://a.example/e.png' length="1" type='image/png'/>`), 'https://a.example/e.png');
  assert.equal(img(`<description><![CDATA[<img src='https://a.example/d.jpg?w=620&amp;h=349' alt='x'/> <p>Hi</p>]]></description>`), 'https://a.example/d.jpg?w=620&h=349');
  assert.equal(img(`<description>&lt;img src=&quot;//a.example/p.webp&quot;&gt; text</description>`), 'https://a.example/p.webp');
  assert.equal(img(`<content:encoded><![CDATA[<p>Words</p><img src="https://a.example/c.jpg">]]></content:encoded><description>Words</description>`), 'https://a.example/c.jpg');
});

test('pictures that are not safe https addresses, or not pictures, are left out', () => {
  assert.equal(img(`<enclosure url="http://a.example/e.jpg" type="image/jpeg"/>`), '');
  assert.equal(img(`<description><![CDATA[<img src="javascript:alert(1)"><img src="x.jpg"><img src="data:image/png;base64,AAAA">]]></description>`), '');
  assert.equal(img(`<media:content url="https://a.example/clip.mp4" type="video/mp4"/><enclosure url="https://a.example/sound.mp3" type="audio/mpeg"/>`), '');
  assert.equal(img(`<media:content url="https://a.example/1.jpg&quot; onerror=&quot;x" medium="image"/>`), '');
  assert.equal(img(`<description><![CDATA[<img src="https://t.example/dot.gif" width="1" height="1">Hi]]></description>`), '');
  assert.equal(img(`<description>No picture here</description>`), '');
});

test('a video story still shows its picture, and the summary never carries the picture tag', () => {
  const it = RSS.read(feed(`<item><title>B</title><media:content url="https://a.example/clip.mp4" type="video/mp4"/><media:thumbnail url="https://a.example/still.jpg"/>
    <description><![CDATA[<img src="https://a.example/d.jpg"> Bundle up.]]></description></item>`)).items[0];
  assert.equal(it.img, 'https://a.example/still.jpg'); assert.equal(it.sum, 'Bundle up.');
});

test('Atom feeds: enclosure links and thumbnails', () => {
  const atom = e => RSS.read(`<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><entry><title>A</title><link href="https://a.example/story"/>${e}<updated>2026-11-11T09:00:00Z</updated></entry></feed>`).items[0];
  assert.equal(atom(`<link rel="enclosure" type="image/jpeg" href="https://a.example/a.jpg"/>`).img, 'https://a.example/a.jpg');
  assert.equal(atom(`<media:thumbnail url="https://a.example/t.jpg"/>`).img, 'https://a.example/t.jpg');
  assert.equal(atom(`<summary>Plain</summary>`).img, ''); assert.equal(atom('').url, 'https://a.example/story');
});
