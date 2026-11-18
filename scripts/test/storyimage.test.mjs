// Checks story pictures: bigger copies from image services, preview pictures read from
// article pages, the per-article cache and the lookup budget, and the feed parser's use of them.
import assert from 'node:assert/strict';
import { BBC_WIDTH, IMAGE_LOOKUP, biggerImage, illustrate, isJunkImage, lookupPageImage, pageImage, pageKey, readHead } from '../../functions/_shared/storyImage.ts';
import { parseFeedXml } from '../../functions/_shared/rssHeadlines.ts';
import { brandOf } from '../../src/lib/brands.ts';

/* ── bigger copies ── */
{
  const thumb = 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/1f2c/live/abc-123.jpg';
  assert.deepEqual(biggerImage(thumb), { url: `https://ichef.bbci.co.uk/ace/standard/${BBC_WIDTH}/cpsprodpb/1f2c/live/abc-123.jpg`, width: BBC_WIDTH, height: null });
  assert.equal(biggerImage('https://ichef.bbci.co.uk/news/240/cpsprodpb/x.jpg')?.url, `https://ichef.bbci.co.uk/news/${BBC_WIDTH}/cpsprodpb/x.jpg`);
  assert.equal(biggerImage('https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/x.jpg'), null, 'already large');
  assert.equal(biggerImage('https://i.guim.co.uk/img/media/x/master/1.jpg?width=140&s=abc'), null, 'signed addresses are left alone');
}

/* ── the feed parser asks for the bigger BBC copy ── */
{
  const xml = `<rss><channel><item><title>Nvidia beats forecasts again</title><link>https://www.bbc.co.uk/news/articles/c1</link>
    <pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate>
    <media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/a/live/b.jpg"/></item>
    <item><title>A story with only a tiny picture</title><link>https://tiny.example/a</link>
    <media:thumbnail width="130" height="86" url="https://tiny.example/t.jpg"/></item></channel></rss>`;
  const items = parseFeedXml(xml, { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' });
  assert.equal(items[0].image, `https://ichef.bbci.co.uk/ace/standard/${BBC_WIDTH}/cpsprodpb/a/live/b.jpg`, 'BBC thumbnails are no longer dropped as too small');
  assert.equal(items[1].image, null, 'a tiny picture from elsewhere is still dropped (the board looks up the article instead)');
}

/* ── preview pictures on a page ── */
{
  const page = 'https://news.example/markets/2026/11/17/story.html';
  assert.equal(pageImage('<head><meta property="og:image" content="https://cdn.example/a.jpg"></head>', page), 'https://cdn.example/a.jpg');
  assert.equal(pageImage(`<meta content='https://cdn.example/b.jpg' property='og:image' />`, page), 'https://cdn.example/b.jpg', 'either attribute order, single quotes');
  assert.equal(pageImage('<meta name="twitter:image" content="/img/c.jpg">', page), 'https://news.example/img/c.jpg', 'relative address resolved');
  assert.equal(pageImage('<meta property="og:image" content="//cdn.example/d.jpg?w=1200&amp;h=630">', page), 'https://cdn.example/d.jpg?w=1200&h=630', 'protocol-relative and entities');
  assert.equal(
    pageImage('<meta name="twitter:image" content="https://cdn.example/tw.jpg"><meta property="og:image" content="https://cdn.example/og.jpg">', page),
    'https://cdn.example/og.jpg',
    'og:image wins over twitter:image wherever it appears',
  );
  assert.equal(pageImage('<link rel="image_src" href="https://cdn.example/e.jpg">', page), 'https://cdn.example/e.jpg');
  assert.equal(pageImage('<meta property="og:image" content="https://news.example/static/logo-share.png">', page), null, 'a logo is not a story picture');
  assert.equal(
    pageImage('<meta property="og:image" content="https://news.example/assets/default-share.jpg"><meta name="twitter:image" content="https://cdn.example/real.jpg">', page),
    'https://cdn.example/real.jpg',
    'a placeholder is skipped for the next best',
  );
  assert.equal(pageImage('<meta property="og:title" content="Hello">', page), null);
  assert.equal(pageImage('<meta property="og:image" content="javascript:alert(1)">', page), null, 'only http(s)');
  assert.ok(isJunkImage('https://x.example/favicon-32.png') && isJunkImage('https://x.example/icon.svg') && !isJunkImage('https://x.example/photos/2026/rates.jpg'));
  assert.equal(pageKey('https://a.example/s?id=4&utm_source=rss#top'), 'newsimg:v1:https://a.example/s?id=4', 'tracking and fragment dropped');
}

/* ── reading only the top of a page ── */
{
  let pulled = 0;
  const enc = new TextEncoder();
  const chunks = ['<html><head><title>x</title>', '<meta property="og:image" content="https://cdn.example/top.jpg">', '<script>'.padEnd(50_000, 'x'), '</head><body>'];
  const body = new ReadableStream({
    pull(ctl) {
      if (pulled >= chunks.length) return ctl.close();
      ctl.enqueue(enc.encode(chunks[pulled++]));
    },
  });
  const text = await readHead(new Response(body));
  assert.ok(text.includes('top.jpg'));
  assert.ok(pulled <= 3, `stops once the preview tag is in (read ${pulled} chunks)`);
}

/* ── lookups: cache, budget, failures ── */
const html = (img) => `<!doctype html><html><head><meta property="og:image" content="${img}"></head><body>…</body></html>`;
const pages = (map) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const v = map[url];
    if (v === undefined) throw new TypeError('unreachable');
    if (typeof v === 'number') return new Response('no', { status: v, headers: { 'content-type': 'text/html' } });
    return new Response(v, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  return { fn, calls };
};
{
  const f = pages({
    'https://a.example/found': html('https://cdn.example/found.jpg'),
    'https://a.example/none': '<html><head><title>No picture</title></head></html>',
    'https://a.example/blocked': 403,
  });
  assert.equal(await lookupPageImage('https://a.example/found', { fetchFn: f.fn }), 'https://cdn.example/found.jpg');
  assert.equal(await lookupPageImage('https://a.example/found', { fetchFn: f.fn }), 'https://cdn.example/found.jpg');
  assert.equal(f.calls.length, 1, 'a found picture is cached');
  assert.equal(await lookupPageImage('https://a.example/none', { fetchFn: f.fn }), null);
  assert.equal(await lookupPageImage('https://a.example/none', { fetchFn: f.fn }), null);
  assert.equal(await lookupPageImage('https://a.example/blocked', { fetchFn: f.fn }), null);
  assert.equal(await lookupPageImage('https://a.example/blocked', { fetchFn: f.fn }), null);
  assert.equal(await lookupPageImage('https://a.example/gone', { fetchFn: f.fn }), null, 'a thrown fetch is a miss, not an error');
  assert.equal(await lookupPageImage('https://a.example/gone', { fetchFn: f.fn }), null);
  assert.equal(f.calls.length, 4, 'misses and failures are remembered too');
  assert.equal(await lookupPageImage('ftp://a.example/x', { fetchFn: f.fn }), null);
  const budget = { left: 1 };
  const g = pages({ 'https://b.example/1': html('https://cdn.example/1.jpg'), 'https://b.example/2': html('https://cdn.example/2.jpg') });
  assert.equal(await lookupPageImage('https://b.example/1', { fetchFn: g.fn, budget }), 'https://cdn.example/1.jpg');
  assert.equal(await lookupPageImage('https://b.example/2', { fetchFn: g.fn, budget }), null, 'no fetch once the budget is spent');
  assert.equal(g.calls.length, 1);
  assert.equal(await lookupPageImage('https://b.example/1', { fetchFn: g.fn, budget }), 'https://cdn.example/1.jpg', 'cache hits are free');
}

/* ── illustrate: own article, then another outlet's; pictures already there are kept ── */
{
  const f = pages({
    'https://c.example/own': html('https://cdn.example/own.jpg'),
    'https://c.example/lead-blocked': 403,
    'https://other.example/same-story': html('https://cdn.example/other.jpg'),
  });
  const stories = [
    { id: 'a', link: 'https://c.example/has', image: 'https://cdn.example/has.jpg', outlets: [] },
    { id: 'b', link: 'https://c.example/own', image: null, outlets: [{ link: 'https://c.example/own' }] },
    { id: 'c', link: 'https://c.example/lead-blocked', image: null, outlets: [{ link: 'https://c.example/lead-blocked' }, { link: 'https://other.example/same-story' }] },
    { id: 'd', link: 'https://c.example/nothing', image: null, outlets: [] },
  ];
  const out = await illustrate(stories, { fetchFn: f.fn });
  assert.deepEqual(out.map((s) => s.image), ['https://cdn.example/has.jpg', 'https://cdn.example/own.jpg', 'https://cdn.example/other.jpg', null]);
  assert.ok(!f.calls.includes('https://c.example/has'), 'a story with a picture is not looked up');
  assert.equal(stories[1].image, null, 'the input is not changed');

  // Never more than the budget per build, however many stories lack a picture.
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, link: `https://d.example/${i}`, image: null, outlets: [{ link: `https://d.example/${i}` }, { link: `https://e.example/${i}` }] }));
  const h = pages({});
  await illustrate(many, { fetchFn: h.fn });
  assert.ok(h.calls.length <= IMAGE_LOOKUP.perBuild, `fetches per build: ${h.calls.length}`);
}

/* ── artwork logos: the company or coin a headline is about ── */
{
  const name = (t) => brandOf(t)?.name ?? null;
  assert.equal(name('Nvidia doubles revenue as board says it does not intend to reinstate Jensen Huang'), 'Nvidia');
  assert.equal(brandOf('Bitcoin tops $100,000 as ETF inflows return')?.coin, 'bitcoin');
  assert.equal(brandOf('Apple faces EU fine over App Store rules')?.stock, 'AAPL');
  assert.equal(name('Microsoft and Nvidia agree chip deal'), 'Microsoft', 'the first name in the headline wins');
  assert.equal(name('How to make apple pie on a budget'), null, 'ordinary words are not companies');
  assert.equal(name('Intelligence agencies warn of cyber attacks'), null);
  assert.equal(name('A meta-analysis of savings habits'), null);
  assert.equal(name('Fed holds rates steady'), null);
}

console.log('storyimage: all checks passed');
