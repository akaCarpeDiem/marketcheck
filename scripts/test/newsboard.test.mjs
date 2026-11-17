// Checks the news leaderboard: clustering, signal matching, scoring, New York day logic,
// the accumulator and snapshots, and the endpoint end to end with an injected fetch.
import assert from 'node:assert/strict';
import {
  SCORE, addDays, baseScore, canonicalUrl, clusterPool, coverageScore, buildCandidates, dayScore, etDate, etHour, etWallToMs, finalKey,
  accKey, noonKey, daysKey, liveScore, matchPosts, matchTrends, nextEtMidnight, nextEtNoon, parseHn, parseReddit, parseTraffic, parseTrendsRss,
  recordSweep, sameStory, storyId, tokenize, TIMING,
} from '../../functions/_shared/newsBoard.ts';
import { handleNewsBoard } from '../../functions/api/newsboard.ts';
import { TOPIC_IDS } from '../../functions/_shared/newsTopics.ts';

const MIN = 60_000;
const HOUR = 3_600_000;

/* ── tokens and the same-story rule ── */
assert.deepEqual(tokenize('The Fed says it cuts rates — LIVE updates!'), ['fed', 'cut', 'rate']);
assert.deepEqual(tokenize("Apple's stories: 5 big wins"), ['apple', 'story', 'big', 'win']);
assert.ok(!tokenize('Go to it and so on').length || tokenize('Go to it and so on').every((t) => t.length >= 3));
const t = (s) => tokenize(s);
assert.ok(sameStory(t('Federal Reserve cuts interest rates by a quarter point'), t('Fed cuts interest rates a quarter point, report says')), 'different wording joins');
assert.ok(!sameStory(t('Federal Reserve cuts interest rates by a quarter point'), t('Nvidia unveils new AI chip for data centers')), 'unrelated stories stay apart');
assert.ok(!sameStory(t('Oil prices slide as supply rises'), t('Gold prices climb as dollar slides')), 'two shared words are not enough');
assert.equal(storyId('Fed cuts interest rates a quarter point'), storyId('quarter point: Fed cuts interest rates'), 'id ignores word order');
assert.notEqual(storyId('Fed cuts interest rates'), storyId('Nvidia unveils new chip'));

/* ── canonical links ── */
assert.equal(canonicalUrl('https://www.Example.com/a/b/?utm=1#top'), 'example.com/a/b');
assert.equal(canonicalUrl('http://example.com/a/b///'), 'example.com/a/b');
assert.equal(canonicalUrl('ftp://example.com/x'), '');
assert.equal(canonicalUrl('not a url'), '');

/* ── fixture pool ── */
const NOW = Date.parse('2026-06-15T17:00:00Z'); // 13:00 in New York (EDT)
const item = (title, source, link, ageMin, extra = {}) => ({
  id: link, title, link, summary: 's', image: 'https://img.example/x.jpg', source,
  publishedAt: new Date(NOW - ageMin * MIN).toISOString(), publishedMs: NOW - ageMin * MIN, mediaType: 'article', topic: 'markets', type: 'article', ...extra,
});
const FED = 'Federal Reserve cuts interest rates by a quarter point';
const pool = () => [
  item('Bakery wins national sourdough award', 'Local News', 'https://local.example/bakery', 20),
  item('Fed cuts interest rates a quarter point as inflation cools', 'NYT Business', 'https://nyt.example/fed?ref=x', 60),
  item('Federal Reserve lowers rates by quarter point, citing inflation', 'BBC Business', 'https://www.bbc.example/fed/', 70),
  item('Why the Fed cut interest rates a quarter point', 'Guardian Business', 'https://guardian.example/fed', 90),
  item('Fed rate cut: quarter point lower interest rates explained', 'CNBC Markets', 'https://cnbc.example/fed', 100),
  item('Federal Reserve cuts rates, quarter point, markets rally', 'WSJ Markets', 'https://wsj.example/fed', 110),
  item(FED, 'Reuters', 'https://reuters.example/fed', 120),
  item('Nvidia unveils new AI chip for data centers', 'CNBC Technology', 'https://cnbc.example/nvidia', 200),
  item('Nvidia launches AI chip aimed at data centers', 'TechCrunch', 'https://tc.example/nvidia', 210),
  item('Oil prices slide as OPEC output rises', 'Reuters', 'https://reuters.example/oil', 22 * 60), // yesterday evening ET
  item('Bakery wins national sourdough award', 'Local News', 'https://local.example/bakery', 20), // same outlet, same title: one outlet
];

/* ── clustering ── */
{
  const cl = clusterPool(pool());
  const fed = cl.find((c) => c.items.length >= 5);
  assert.ok(fed, 'the Fed stories form one cluster');
  assert.equal(fed.outlets.length, 6, 'one entry per outlet');
  assert.equal(fed.lead.source, 'NYT Business', 'lead is the first of the cluster in pool order');
  assert.ok(fed.urlKeys.has('nyt.example/fed'));
  const nvidia = cl.find((c) => c.lead.title.startsWith('Nvidia'));
  assert.equal(nvidia.outlets.length, 2);
  const bakery = cl.find((c) => c.lead.title.startsWith('Bakery'));
  assert.equal(bakery.outlets.length, 1, 'a repeated outlet counts once');
  // The same canonical link joins stories even when the headlines differ.
  const byUrl = clusterPool([item('Alpha beta gamma', 'A Wire', 'https://x.example/s/1?utm=a', 5), item('Totally different words here', 'B Wire', 'https://www.x.example/s/1/', 4)]);
  assert.equal(byUrl.length, 1);
  assert.equal(byUrl[0].outlets.length, 2);
  // Front pages are not an article link.
  assert.equal(clusterPool([item('Alpha beta gamma', 'A Wire', 'https://x.example/', 5), item('Totally different words here', 'B Wire', 'https://x.example', 4)]).length, 2);
}

/* ── traffic and trends parsing ── */
assert.equal(parseTraffic('200K+'), 200_000);
assert.equal(parseTraffic('1M+'), 1_000_000);
assert.equal(parseTraffic('2,000+'), 2000);
assert.equal(parseTraffic('1.5M+'), 1_500_000);
assert.equal(parseTraffic(''), 0);
const TRENDS_XML = (geo) => `<?xml version="1.0"?><rss xmlns:ht="x"><channel>
<item><title>Federal Reserve</title><ht:approx_traffic>${geo === 'GB' ? '2M+' : '500K+'}</ht:approx_traffic>
 <ht:news_item><ht:news_item_title>Fed cut</ht:news_item_title><ht:news_item_url>https://reuters.example/fed?x=1</ht:news_item_url></ht:news_item></item>
<item><title><![CDATA[AI & chips]]></title><ht:approx_traffic>1,000+</ht:approx_traffic></item>
<item><title>Fed</title><ht:approx_traffic>9M+</ht:approx_traffic></item>
<item><title>weather tomorrow</title><ht:approx_traffic>5M+</ht:approx_traffic></item>
</channel></rss>`;
{
  const tr = parseTrendsRss(TRENDS_XML('US'), 'US');
  assert.equal(tr.length, 4);
  assert.deepEqual([tr[0].query, tr[0].traffic, tr[0].urls], ['Federal Reserve', 500_000, ['https://reuters.example/fed?x=1']]);
  assert.equal(tr[1].query, 'AI & chips');
  const cl = clusterPool(pool());
  const m = matchTrends(cl, [...tr, ...parseTrendsRss(TRENDS_XML('GB'), 'GB')]);
  const fedIdx = cl.findIndex((c) => c.items.length >= 5);
  assert.deepEqual(m[fedIdx], { query: 'Federal Reserve', traffic: 2_000_000, geo: 'GB' }, 'largest traffic wins; short query "Fed" is ignored');
  assert.equal(m[cl.findIndex((c) => c.lead.title.startsWith('Bakery'))], undefined);
  // A link match works with no shared words.
  const byUrl = matchTrends(cl, [{ query: 'zzzz qqqq', traffic: 10, urls: ['https://www.wsj.example/fed/'], geo: 'US' }]);
  assert.equal(byUrl[fedIdx]?.query, 'zzzz qqqq');
}

/* ── Hacker News and Reddit matching ── */
const HN_JSON = {
  hits: [
    { objectID: '1', title: 'Fed cuts rates (reuters)', url: 'https://www.reuters.example/fed', points: 400, num_comments: 150 },
    { objectID: '2', title: 'Nvidia unveils a new AI chip for data centers', url: 'https://blog.example/n', points: 120, num_comments: 30 },
    { objectID: '3', title: 'Show HN: my side project', url: 'https://x.example/p', points: 50, num_comments: 3 },
    { objectID: '4', title: 'Ask HN: no url', points: 20, num_comments: 1 },
  ],
};
const REDDIT_JSON = {
  data: { children: [
    { data: { title: 'Federal Reserve cuts interest rates by a quarter point', url: 'https://i.redd.it/x', score: 9000, num_comments: 1200, permalink: '/r/economics/comments/abc/fed/', subreddit: 'economics' } },
    { data: { title: 'Federal Reserve cuts interest rates by a quarter point', url: 'https://i.redd.it/y', score: 100, num_comments: 5, permalink: '/r/stocks/comments/def/fed/', subreddit: 'stocks' } },
    { data: { title: 'What are you buying this week', url: 'https://reddit.com/r/x', score: 5, num_comments: 400, permalink: '/r/stocks/comments/ghi/', subreddit: 'stocks' } },
  ] },
};
{
  const cl = clusterPool(pool());
  const fedIdx = cl.findIndex((c) => c.items.length >= 5);
  const nvIdx = cl.findIndex((c) => c.lead.title.startsWith('Nvidia'));
  const hn = matchPosts(cl, parseHn(HN_JSON));
  assert.equal(hn[fedIdx].a, 400, 'matched by canonical link');
  assert.equal(hn[fedIdx].link, 'https://news.ycombinator.com/item?id=1');
  assert.equal(hn[nvIdx].a, 120, 'matched by title');
  assert.equal(hn.filter(Boolean).length, 2);
  const rd = matchPosts(cl, parseReddit(REDDIT_JSON));
  assert.equal(rd[fedIdx].a, 9000, 'best post wins');
  assert.equal(rd[fedIdx].sub, 'economics');
  assert.equal(rd[fedIdx].link, 'https://www.reddit.com/r/economics/comments/abc/fed/');
  assert.equal(rd.filter(Boolean).length, 1);
  assert.throws(() => parseHn({}), /unexpected/);
}

/* ── scoring ── */
{
  assert.equal(coverageScore(1), SCORE.coverageBase);
  assert.ok(Math.abs(coverageScore(4) - (SCORE.coverageBase + 2 * SCORE.coverageLog)) < 1e-9);
  const big = { outlets: 6, hn: { points: 400, comments: 150, url: 'u' } };
  const small = { outlets: 1 };
  assert.ok(baseScore(big) > baseScore(small) + 20, 'six outlets plus Hacker News beat one outlet');
  const expected = 5 + 10 * Math.log2(6) + 8 * Math.log10(551);
  assert.ok(Math.abs(baseScore(big) - expected) < 1e-9);
  assert.ok(Math.abs(baseScore({ outlets: 1, trends: { query: 'q', traffic: 100_000, geo: 'US' } }) - (5 + 20)) < 1e-9);
  // Live decay: half after 18 hours.
  assert.ok(Math.abs(liveScore(big, 18) - baseScore(big) / 2) < 1e-9);
  assert.equal(liveScore(big, 0), baseScore(big));
  assert.ok(liveScore(small, 1) > liveScore(small, 10));
  // A fresh small story can still pass an old big one, as it should.
  assert.ok(liveScore(small, 0) > liveScore({ outlets: 2 }, 60));
  // Day score: staying power and best rank.
  assert.equal(dayScore(small, 0, null), baseScore(small));
  assert.equal(dayScore(small, 4, 1), baseScore(small) + 6 + 5);
  assert.equal(dayScore(small, 99, 40), baseScore(small) + 18, 'sweeps cap at 12, rank bonus never negative');
}

/* ── New York time ── */
{
  assert.equal(etDate(Date.parse('2026-03-08T04:59:00Z')), '2026-03-07');
  assert.equal(etDate(Date.parse('2026-03-08T05:00:00Z')), '2026-03-08');
  assert.equal(etWallToMs('2026-03-08', 0), Date.parse('2026-03-08T05:00:00Z'), 'spring-forward day starts in EST');
  assert.equal(etWallToMs('2026-03-08', 12), Date.parse('2026-03-08T16:00:00Z'), 'its noon is EDT');
  assert.equal(etWallToMs('2026-11-01', 0), Date.parse('2026-11-01T04:00:00Z'), 'fall-back day starts in EDT');
  assert.equal(etWallToMs('2026-11-01', 12), Date.parse('2026-11-01T17:00:00Z'), 'its noon is EST');
  assert.equal(nextEtMidnight(Date.parse('2026-11-01T10:00:00Z')), Date.parse('2026-11-02T05:00:00Z'), 'the 25-hour day');
  assert.equal(nextEtMidnight(Date.parse('2026-03-08T10:00:00Z')), Date.parse('2026-03-09T04:00:00Z'), 'the 23-hour day');
  assert.equal(etHour(Date.parse('2026-06-15T15:59:00Z')), 11);
  assert.equal(etHour(Date.parse('2026-06-15T16:00:00Z')), 12);
  assert.equal(etHour(Date.parse('2026-01-15T16:59:00Z')), 11);
  assert.equal(etHour(Date.parse('2026-01-15T17:00:00Z')), 12);
  assert.equal(etHour(Date.parse('2026-01-15T05:00:00Z')), 0, 'midnight is hour 0, not 24');
  assert.equal(nextEtNoon(Date.parse('2026-06-15T14:00:00Z')), Date.parse('2026-06-15T16:00:00Z'));
  assert.equal(nextEtNoon(Date.parse('2026-06-15T17:00:00Z')), Date.parse('2026-06-16T16:00:00Z'));
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
}

/* ── accumulator ── */
{
  const cands = (list) => buildCandidates(clusterPool(list), null);
  const first = recordSweep(null, '2026-06-15', 'markets', cands(pool()), NOW);
  assert.ok(first.written);
  const fed = first.acc.stories.find((s) => s.outlets.length >= 5);
  assert.equal(fed.sweeps, 1);
  assert.equal(fed.lastRank, fed.peakRank);
  assert.equal(first.acc.updatedAt, NOW);
  // Too soon: untouched.
  const soon = recordSweep(first.acc, '2026-06-15', 'markets', cands(pool()), NOW + 10 * MIN);
  assert.equal(soon.written, false);
  assert.equal(soon.acc, first.acc);
  // Later: sweeps count up, peaks keep the best, signals keep the highest, ids stay.
  const rich = cands(pool());
  const fedC = rich.find((c) => c.cluster.items.length >= 5);
  fedC.signals = { ...fedC.signals, hn: { points: 500, comments: 10, url: 'h' } };
  const second = recordSweep(first.acc, '2026-06-15', 'markets', rich, NOW + TIMING.accWriteEveryMs);
  assert.ok(second.written);
  const fed2 = second.acc.stories.find((s) => s.id === fed.id);
  assert.equal(fed2.sweeps, 2);
  assert.equal(fed2.signals.hn.points, 500);
  assert.ok(fed2.firstSeenAt === fed.firstSeenAt);
  // Lower numbers later do not lower the maxima; a worse rank does not lose the peak.
  const reordered = cands(pool()).reverse();
  const third = recordSweep(second.acc, '2026-06-15', 'markets', reordered, NOW + 2 * TIMING.accWriteEveryMs);
  const fed3 = third.acc.stories.find((s) => s.id === fed.id);
  assert.equal(fed3.signals.hn.points, 500);
  assert.equal(fed3.sweeps, 3);
  assert.ok(fed3.peakRank <= fed3.lastRank);
  assert.equal(new Set(third.acc.stories.map((s) => s.id)).size, third.acc.stories.length, 'no duplicate stories');
}

/* ── endpoint, end to end with injected fetch and an in-memory KV ── */
function memKv() {
  const m = new Map();
  const puts = [];
  return {
    m, puts,
    async get(k) { return m.get(k) ?? null; },
    async put(k, v, o) { puts.push([k, o]); m.set(k, v); },
  };
}
const makeFetch = (opts = {}) => {
  const calls = [];
  const fn = async (url) => {
    const u = new URL(url);
    calls.push(u.hostname + u.pathname);
    const ok = (body, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'Content-Type': type } });
    if (u.pathname === '/api/headlines') return opts.pool === false ? new Response('x', { status: 500 }) : ok({ topic: 'markets', items: [], pool: opts.poolItems ?? pool() });
    if (u.hostname === 'hn.algolia.com') return opts.hn === false ? new Response('no', { status: 503 }) : ok(HN_JSON);
    if (u.hostname === 'www.reddit.com') return opts.reddit === false ? new Response('blocked', { status: 403 }) : ok(REDDIT_JSON);
    if (u.hostname === 'trends.google.com') return opts.trends === false ? new Response('no', { status: 500 }) : ok(TRENDS_XML(u.searchParams.get('geo')), 'application/rss+xml');
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fn, calls };
};
let nsN = 0;
const ask = async (query, { kv, now = NOW, fetchFn, ns } = {}) => {
  const f = fetchFn ?? makeFetch();
  const res = await handleNewsBoard(new Request(`https://t.example/api/newsboard?${query}`), kv ? { LAYOUTS: kv } : {}, undefined, { fetchFn: f.fn ?? f, now, ns: ns ?? `t${++nsN}` });
  return { res, body: await res.json(), calls: f.calls };
};

{
  const bad = await ask('topic=nonsense');
  assert.equal(bad.res.status, 400);
  assert.equal((await ask('topic=markets&board=nope')).res.status, 400);
  assert.equal((await ask('topic=markets&board=day')).res.status, 400, 'day needs a date');

  // live
  const kv = memKv();
  const f = makeFetch();
  const live = await ask('topic=markets&board=live', { kv, fetchFn: f });
  assert.equal(live.res.status, 200);
  const b = live.body;
  assert.equal(b.board, 'live');
  assert.equal(b.status, 'live');
  assert.equal(b.date, '2026-06-15');
  assert.equal(b.topic, 'markets');
  assert.ok(b.label);
  assert.deepEqual(b.signals.map((s) => [s.id, s.ok]), [['coverage', true], ['hn', true], ['reddit', true], ['trends', true]]);
  assert.ok(b.signals.every((s) => s.about.length > 10));
  assert.ok(b.stories.length >= 3 && b.stories.length <= 10);
  const top = b.stories[0];
  assert.equal(top.rank, 1);
  assert.equal(top.signals.outlets, 6, 'the six-outlet Fed story with Hacker News on top');
  assert.equal(top.signals.hn.points, 400);
  assert.equal(top.signals.reddit.sub, 'economics');
  assert.equal(top.signals.trends.geo, 'GB');
  assert.equal(top.heat, 100);
  assert.equal(top.prevRank, null);
  assert.equal(top.outlets.length, 6);
  assert.ok(top.outlets.every((o) => /^https?:/.test(o.link) && o.source && o.title));
  for (let i = 1; i < b.stories.length; i++) assert.ok(b.stories[i].score <= b.stories[i - 1].score, 'sorted by score');
  assert.ok(b.stories.every((s, i) => s.rank === i + 1 && /^https?:/.test(s.link) && typeof s.id === 'string'));
  assert.ok(Date.parse(b.nextUpdateAt) - Date.parse(b.generatedAt) === 10 * MIN);
  assert.ok(f.calls.length <= 8, `subrequests per board request: ${f.calls.length}`);
  assert.equal(f.calls.filter((c) => c.includes('/api/headlines')).length, 1, 'one self-fetch');

  // The sweep wrote the accumulator once, and (it is past noon) the noon snapshot.
  assert.ok(kv.m.has(accKey('2026-06-15', 'markets')));
  assert.ok(kv.m.has(noonKey('2026-06-15', 'markets')), 'noon freeze on a request after 12:00 ET');
  assert.ok(kv.puts.every(([, o]) => o.expirationTtl === 14 * 86400));
  const noonSnap = JSON.parse(kv.m.get(noonKey('2026-06-15', 'markets')));
  assert.ok(noonSnap.stories.length >= 1 && noonSnap.stories.every((s) => Date.parse(s.publishedAt) >= Date.parse('2026-06-15T04:00:00Z')), 'only stories released today');
  assert.ok(!noonSnap.stories.some((s) => s.title.startsWith('Oil')));

  // today is now locked
  const today = await ask('topic=markets&board=today', { kv });
  assert.equal(today.body.status, 'final');
  assert.equal(today.body.lockedAt, noonSnap.lockedAt);
  assert.equal(today.body.nextUpdateAt, '2026-06-16T04:00:00.000Z');
  assert.deepEqual(today.body.stories.map((s) => s.id), noonSnap.stories.map((s) => s.id));
  assert.equal(today.calls.length, 0, 'a locked board needs no upstream calls');

  // a second sweep soon after: the accumulator is not rewritten, prevRank comes from the first
  const writes = kv.puts.length;
  const again = await ask('topic=markets&board=live&sweep=1', { kv, now: NOW + 12 * MIN });
  assert.equal(kv.puts.length, writes, 'write throttle: nothing written within the hour');
  assert.equal(again.body.stories[0].prevRank, 1);
  // after an hour the sweep count goes up
  await ask('topic=markets&board=live&sweep=1', { kv, now: NOW + 61 * MIN });
  const acc = JSON.parse(kv.m.get(accKey('2026-06-15', 'markets')));
  assert.equal(acc.stories.find((s) => s.outlets.length >= 5).sweeps, 2);

  // yesterday: nothing stored yet -> provisional from the pool
  const y1 = await ask('topic=markets&board=yesterday', { kv });
  assert.equal(y1.body.status, 'provisional');
  assert.equal(y1.body.date, '2026-06-14');
  assert.deepEqual(y1.body.stories.map((s) => s.title), ['Oil prices slide as OPEC output rises']);

  // Given yesterday's accumulator, a request creates the final and the days index.
  const yAcc = { date: '2026-06-14', topic: 'markets', updatedAt: NOW - 20 * HOUR, stories: [
    { ...acc.stories[0], id: 'old1', title: 'Yesterday big story', link: 'https://y.example/1', publishedAt: '2026-06-14T15:00:00.000Z', sweeps: 5, peakRank: 1, lastRank: 2 },
    { ...acc.stories[0], id: 'old2', title: 'Late night story', link: 'https://y.example/2', publishedAt: '2026-06-14T04:00:00.000Z', sweeps: 1, peakRank: 9, lastRank: 9, signals: { outlets: 1 } },
    { ...acc.stories[0], id: 'old3', title: 'Day before story', link: 'https://y.example/3', publishedAt: '2026-06-14T03:59:00.000Z', sweeps: 9, peakRank: 1, lastRank: 1 },
  ] };
  kv.m.set(accKey('2026-06-14', 'markets'), JSON.stringify(yAcc));
  const y2 = await ask('topic=markets&board=yesterday', { kv });
  assert.equal(y2.body.status, 'final');
  assert.deepEqual(y2.body.stories.map((s) => s.id), ['old1', 'old2'], 'ranked, and only stories released that day (ET)');
  assert.ok(kv.m.has(finalKey('2026-06-14', 'markets')));
  assert.deepEqual(JSON.parse(kv.m.get(daysKey('markets'))), ['2026-06-14']);
  const y3 = await ask('topic=markets&board=yesterday', { kv });
  assert.equal(y3.body.status, 'final');
  assert.equal(y3.calls.length, 0, 'served from the stored final');

  // archive
  const day = await ask('topic=markets&board=day&date=2026-06-14', { kv });
  assert.equal(day.body.status, 'final');
  assert.deepEqual(day.body.days, ['2026-06-14']);
  assert.equal(day.body.stories.length, 2);
  const none = await ask('topic=markets&board=day&date=2026-06-01', { kv });
  assert.equal(none.body.status, 'empty');
  assert.deepEqual(none.body.stories, []);
}

/* ── before noon: provisional, then the next noon is announced ── */
{
  const kv = memKv();
  const early = Date.parse('2026-06-15T14:00:00Z'); // 10:00 ET
  const shifted = pool().map((it) => ({ ...it, publishedMs: it.publishedMs - 3 * HOUR, publishedAt: new Date(it.publishedMs - 3 * HOUR).toISOString() }));
  const r = await ask('topic=markets&board=today', { kv, now: early, fetchFn: makeFetch({ poolItems: shifted }) });
  assert.equal(r.body.status, 'provisional');
  assert.equal(r.body.nextUpdateAt, '2026-06-15T16:00:00.000Z');
  assert.ok(!kv.m.has(noonKey('2026-06-15', 'markets')), 'no freeze before noon');
  assert.ok(r.body.stories.length >= 1);
}

/* ── upstream failures never break the board ── */
{
  const kv = memKv();
  const r = await ask('topic=technology&board=live', { kv, fetchFn: makeFetch({ hn: false, reddit: false, trends: false }) });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body.signals.map((s) => s.ok), [true, false, false, false]);
  assert.ok(r.body.stories.length > 0);
  assert.equal(r.body.stories[0].signals.outlets, 6);
  assert.equal(r.body.stories[0].signals.hn, undefined);

  const partial = await ask('topic=technology&board=live', { kv, fetchFn: makeFetch({ reddit: false }) });
  assert.deepEqual(partial.body.signals.map((s) => s.ok), [true, true, false, true]);

  const dead = await ask('topic=crypto&board=live', { fetchFn: makeFetch({ pool: false, hn: false, reddit: false, trends: false }) });
  assert.equal(dead.res.status, 200);
  assert.equal(dead.body.status, 'empty');
  assert.deepEqual(dead.body.stories, []);
  const thrown = await ask('topic=crypto&board=live', { fetchFn: async () => { throw new TypeError('network down'); } });
  assert.equal(thrown.res.status, 200);
  assert.equal(thrown.body.status, 'empty');
}

/* ── the response cache: a second plain request does not rebuild ── */
{
  const f = makeFetch();
  const ns = 'cachetest';
  await ask('topic=policy&board=live', { fetchFn: f, ns });
  const n = f.calls.length;
  await ask('topic=policy&board=live', { fetchFn: f, ns });
  assert.equal(f.calls.length, n);
  await ask('topic=policy&board=live&sweep=1', { fetchFn: f, ns });
  assert.ok(f.calls.length > n, 'sweep=1 bypasses it');
}

for (const id of TOPIC_IDS) {
  const r = await ask(`topic=${id}&board=live`, { fetchFn: makeFetch() });
  assert.equal(r.res.status, 200, id);
}

console.log('newsboard: all checks passed');
