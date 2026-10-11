// Checks the news structure: ten topics, where each old category went, the podcast directory,
// and that no topic asks for more feeds than one request is allowed to make.
import assert from 'node:assert/strict';
import { CONTENT_TYPES, LEGACY_TOPIC, PODCAST_SHOWS, TOPICS, TOPIC_IDS, topicFrom, topicLabel } from '../../functions/_shared/newsTopics.ts';
import { ALL_HEADLINE_CATEGORIES, dedupeSort, getHeadlines, listFeeds, outletOf, parseFeedXml, spreadBySource } from '../../functions/_shared/rssHeadlines.ts';

/* ── the ten topics, in order ── */
assert.deepEqual(
  TOPICS.map((t) => t.label),
  [
    'Markets & Economy',
    'Investing',
    'Personal Finance',
    'Crypto & Digital Assets',
    'Real Estate',
    'Technology & Innovation',
    'Policy, Regulation & Politics',
    'Business & Corporate',
    'Commodities & Energy',
    'Healthcare & Longevity',
  ],
);
assert.equal(new Set(TOPIC_IDS).size, 10);
assert.ok(!TOPIC_IDS.includes('podcasts'), 'podcasts are a section of their own, not a topic');
assert.deepEqual(ALL_HEADLINE_CATEGORIES, TOPIC_IDS);
for (const t of TOPICS) assert.ok(t.short && t.about && /^[a-z-]+$/.test(t.id), `${t.id} is complete`);

/* ── every category of the old site has a home ── */
const moved = {
  tradfi: 'markets',
  crypto: 'crypto',
  web3nfts: 'crypto',
  technology: 'technology',
  ai: 'technology',
  robotics: 'technology',
  politics: 'policy',
  housing: 'real-estate',
  health: 'healthcare',
  longevity: 'healthcare',
};
for (const [old, now] of Object.entries(moved)) {
  assert.equal(LEGACY_TOPIC[old] ?? (TOPIC_IDS.includes(old) ? old : undefined), now, `${old} -> ${now}`);
  assert.equal(topicFrom(old), now, `an old link or saved choice "${old}" lands on ${now}`);
}
assert.equal(topicFrom('Personal-Finance'), 'personal-finance');
assert.equal(topicFrom('podcasts'), null);
assert.equal(topicFrom('nonsense'), null);
assert.equal(topicFrom(undefined), null);
assert.equal(topicLabel('commodities'), 'Commodities & Energy');

/* ── two independent tags: topic and type ── */
assert.deepEqual(CONTENT_TYPES.map((t) => t.id), ['article', 'video', 'podcast']);

/* ── feeds ── */
for (const id of TOPIC_IDS) {
  const feeds = listFeeds(id);
  const articles = feeds.filter((f) => f.mediaType !== 'video');
  assert.ok(articles.length >= 5, `${id} has written sources (${articles.length})`);
  // Cloudflare allows 50 outgoing requests per invocation, and a failed video feed may try two fallbacks.
  const worst = articles.length + feeds.filter((f) => f.mediaType === 'video').length * 3;
  assert.ok(worst <= 50, `${id} could make ${worst} requests in the worst case`);
  assert.equal(new Set(feeds.map((f) => f.name)).size, feeds.length, `${id} lists no source twice`);
  for (const f of feeds) assert.ok(/^https:\/\//.test(f.url), `${id}: ${f.name} uses https`);
}
// Merged topics really contain what they absorbed.
const names = (id) => listFeeds(id).map((f) => f.name);
assert.ok(names('crypto').includes('CoinDesk') && names('crypto').some((n) => /Decrypt|NFT/.test(n)), 'crypto holds the old crypto and web3 sources');
assert.ok(names('technology').includes('OpenAI News') && names('technology').includes('The Robot Report') && names('technology').includes('Ars Technica'), 'technology holds tech, AI and robotics');
assert.ok(names('healthcare').includes('STAT') && names('healthcare').some((n) => /Aging|Lifespan|Attia/.test(n)), 'healthcare holds health and longevity');
assert.ok(names('real-estate').includes('NYT Real Estate'));
assert.ok(names('policy').includes('SEC Press') && names('policy').includes('Federal Reserve'));

/* ── what a feed lets through ── */
const rss = (stories) =>
  `<rss><channel>${stories
    .map(([title, summary = '', path = title], i) => `<item><title>${title}</title><link>https://example.com/${encodeURIComponent(path)}-${i}</link><description>${summary}</description><pubDate>Sun, 11 Oct 2026 1${i % 10}:00:00 GMT</pubDate></item>`)
    .join('')}</channel></rss>`;
const feed = (topic, name) => {
  const f = listFeeds(topic).find((x) => x.name === name);
  assert.ok(f, `${topic} has ${name}`);
  return f;
};
const titles = (topic, name, stories) => parseFeedXml(rss(stories), feed(topic, name)).map((it) => it.title);

// A general desk is judged on its headline, not on a word somewhere in the summary.
assert.deepEqual(
  titles('commodities', 'BBC Business', [
    ['Oil jumps as OPEC+ holds output steady', 'Crude rose 3%.'],
    ['Retailer warns on profits', 'Higher energy bills squeezed shoppers, the chain said.'],
    ['Gold hits a record high', ''],
  ]),
  ['Oil jumps as OPEC+ holds output steady', 'Gold hits a record high'],
);
assert.deepEqual(
  titles('personal-finance', 'BBC Business', [
    ['How to rebuild your savings after a job loss', ''],
    ['Carmaker recalls 200,000 vehicles', 'Owners will not have to pay any money for the repair.'],
  ]),
  ['How to rebuild your savings after a job loss'],
);
// Policy means money policy: general political news is left out.
assert.deepEqual(
  titles('policy', 'NYT Politics', [
    ['Senate passes spending bill to avert shutdown', ''],
    ['Spy chief warns of foreign threats', 'The hearing touched on financial crime.'],
    ['Fed officials signal one more rate cut this year', ''],
    ['What to know about the debate in Athens', 'Markets were closed.'],
    ['New tariffs on steel take effect Monday', ''],
  ]),
  ['Senate passes spending bill to avert shutdown', 'Fed officials signal one more rate cut this year', 'New tariffs on steel take effect Monday'],
);
// The property section also runs decorating pieces.
assert.deepEqual(
  titles('real-estate', 'NYT Real Estate', [
    ['Homes for Sale in Brooklyn and Manhattan', ''],
    ['How to Choose the Right Wood Floors', 'A guide for your real estate.'],
    ['$1.5 Million Homes in California', ''],
    ['Mortgage rates fall to a two-year low', ''],
    ['A Designer Fills Her Loft With Color', ''],
  ]),
  ['Homes for Sale in Brooklyn and Manhattan', '$1.5 Million Homes in California', 'Mortgage rates fall to a two-year low'],
);
// Subscriber-only stories lead to a paywall.
assert.deepEqual(
  titles('healthcare', 'STAT', [
    ['STAT+: Inside a biotech deal', ''],
    ['FDA approves a new Alzheimer’s drug', ''],
  ]),
  ['FDA approves a new Alzheimer’s drug'],
);
// A channel that wanders off its subject is held to the topic, not trusted wholesale.
assert.deepEqual(
  titles('commodities', 'YT Kitco News', [
    ['Gold Could Hit $5,000 Before Year End, Analyst Says', ''],
    ['Home Prices Could Fall Up to 50% as Mortgages Head for 9%', ''],
    ['Stock Market Crash Risk Changed in Just 3 Days', ''],
    ['Silver squeeze: why miners are lagging', ''],
  ]),
  ['Gold Could Hit $5,000 Before Year End, Analyst Says', 'Silver squeeze: why miners are lagging'],
);
assert.ok(!feed('crypto', 'YT a16z').trustedTopic, 'a venture channel is only crypto when the episode is');
// MarketWatch stays (owner's decision, 2026-10-11); Yahoo's RSS feed no longer answers and is gone.
assert.ok(names('investing').includes('MarketWatch') && names('personal-finance').includes('MarketWatch Personal Finance'));
for (const id of TOPIC_IDS) assert.ok(!listFeeds(id).some((f) => /finance\.yahoo\.com/.test(f.url)), `${id} does not read Yahoo's RSS feed`);
// No feed address is read twice for one topic.
for (const id of TOPIC_IDS) {
  const urls = listFeeds(id).map((f) => f.url);
  assert.equal(new Set(urls).size, urls.length, `${id} reads no address twice`);
}

/* ── one copy of each story, and no outlet filling a topic ── */
const story = (source, title, n, mediaType = 'article') => ({
  id: `${source}-${n}`, title, link: `https://example.com/${encodeURIComponent(source)}/${n}`, summary: '', image: null,
  source, publishedAt: null, publishedMs: 1_000_000 - n, mediaType, views: null,
});
assert.equal(outletOf('NYT Business'), outletOf('NYT DealBook'));
assert.equal(outletOf('CoinDesk'), outletOf('CoinDesk Policy'));
assert.notEqual(outletOf('YT Bloomberg Television'), outletOf('YT Bloomberg Tech'));
assert.notEqual(outletOf('CNBC Markets'), outletOf('YT CNBC'), 'written stories and videos are counted separately');
{
  const out = dedupeSort([
    story('BBC Technology', 'Tech Now', 1),
    story('BBC Technology', 'Tech Now', 2),
    story('BBC Technology', 'Chip maker opens a new plant in Wales', 3),
    story('BBC Technology', 'Chip maker opens a new plant in Wales', 4),
    story('BBC Business', 'Chip maker opens a new plant in Wales', 5),
    story('Reuters', 'Chip maker opens a new plant in Wales', 6),
    story('YT Fireship', 'Tech Now', 7, 'video'),
    story('Nature News', 'Publisher Correction: Sleep chart of biological ageing clocks', 8),
    story('Nature News', 'Author Correction: A map of the ageing brain', 9),
  ]);
  assert.deepEqual(out.map((it) => it.id), ['BBC Technology-3', 'Reuters-6', 'YT Fireship-7'], 'programme pages and repeats are dropped; the newest copy is kept');
}
{
  const ranked = [];
  for (let i = 0; i < 12; i++) ranked.push(story('CoinDesk', `CoinDesk story number ${i}`, i));
  for (let i = 0; i < 3; i++) ranked.push(story('Decrypt', `Decrypt story number ${i}`, 20 + i));
  for (let i = 0; i < 3; i++) ranked.push(story('Cointelegraph NFT', `Cointelegraph story number ${i}`, 30 + i));
  for (let i = 0; i < 3; i++) ranked.push(story('CNBC Crypto/Fintech', `CNBC story number ${i}`, 40 + i));
  const picked = spreadBySource(ranked, 4, 18);
  const count = (src) => picked.filter((it) => it.source === src).length;
  assert.equal(count('Decrypt') + count('Cointelegraph NFT') + count('CNBC Crypto/Fintech'), 9, 'every other voice is in');
  assert.equal(count('CoinDesk'), 6, 'the limit loosens by two at most when the list is short');
  assert.equal(picked.length, 15);
  assert.deepEqual(picked.map((it) => it.id), ranked.filter((it) => picked.includes(it)).map((it) => it.id), 'order of merit is kept');
  // With enough voices nobody goes over the limit.
  const many = [];
  for (const src of ['A', 'B', 'C', 'D', 'E', 'F']) for (let i = 0; i < 8; i++) many.push(story(src, `${src} story number ${i}`, many.length));
  const spread = spreadBySource(many, 4, 18);
  assert.equal(spread.length, 18);
  for (const src of ['A', 'B', 'C', 'D', 'E', 'F']) assert.ok(spread.filter((it) => it.source === src).length <= 4);
}

/* ── a whole topic, from feeds to the list a visitor sees ── */
{
  const realFetch = globalThis.fetch;
  const asked = [];
  const when = (hoursAgo) => new Date(Date.now() - hoursAgo * 3_600_000).toUTCString();
  const doc = (name, n, title) =>
    `<rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>${title(i)}</title><link>https://example.com/${encodeURIComponent(name)}/${i}</link><description>Summary of story ${i} from ${name}, long enough to keep.</description><pubDate>${when(i + 1)}</pubDate></item>`).join('')}</channel></rss>`;
  globalThis.fetch = async (url) => {
    const u = String(url);
    asked.push(u);
    const f = listFeeds('markets').find((x) => x.url === u);
    if (!f) return new Response('not found', { status: 404 });
    if (f.name === 'Guardian Business') return new Response('upstream error', { status: 502 });
    if (f.name === 'BBC Business') return new Response(doc(f.name, 6, (i) => `Village fete raises funds for new roof, part ${i}`), { headers: { 'content-type': 'application/xml' } });
    if (f.mediaType === 'video') return new Response('<feed></feed>'.padEnd(120, ' '), { headers: { 'content-type': 'application/xml' } });
    // One desk publishes far more than the others.
    const n = f.name === 'NYT Business' ? 14 : 3;
    return new Response(doc(f.name, n, (i) => `Stocks and bonds: ${f.name} markets report number ${i}`), { headers: { 'content-type': 'application/xml' } });
  };
  try {
    const res = await getHeadlines('markets');
    const per = new Map();
    for (const it of res.items) per.set(it.source, (per.get(it.source) ?? 0) + 1);
    assert.ok(res.items.length >= 12, `markets shows ${res.items.length} stories`);
    assert.ok((per.get('NYT Business') ?? 0) <= 6, `the busiest desk has ${per.get('NYT Business')} of ${res.items.length}`);
    assert.ok(per.size >= 4, 'several outlets are represented');
    assert.deepEqual(res.feedsFailed, ['Guardian Business'], 'only the feed that could not be read is reported as failed');
    assert.ok(res.feedsQuiet.includes('BBC Business'), 'a feed with nothing on topic is quiet, not failed');
    assert.ok(res.feedsQuiet.includes('YT CNBC'), 'so is an empty video feed');
    assert.ok(!asked.some((u) => /piped/.test(u)), 'and no second request is spent on a feed that answered');
    assert.ok(res.items.every((it) => it.topic === 'markets' && it.type), 'every item carries its topic and type');
  } finally {
    globalThis.fetch = realFetch;
  }
}

/* ── the podcast directory ── */
assert.ok(PODCAST_SHOWS.length >= 20);
assert.equal(new Set(PODCAST_SHOWS.map((s) => s.id)).size, PODCAST_SHOWS.length);
assert.equal(new Set(PODCAST_SHOWS.map((s) => s.channel)).size, PODCAST_SHOWS.length);
for (const s of PODCAST_SHOWS) {
  assert.ok(s.topic === null || TOPIC_IDS.includes(s.topic), `${s.name} is filed under a real topic`);
  assert.ok(/^UC[\w-]{22}$/.test(s.channel), `${s.name} has a channel id`);
  assert.ok(s.about.length > 15 && s.about.length < 140);
}
// One request per show, in one invocation.
assert.ok(PODCAST_SHOWS.length <= 40);
// The shows the old "Podcasts & video" tab carried are all still here.
for (const old of ['UCzQUP1qoWDoEbmsQxvdjxgQ', 'UCGq-a57w-aPwyi3pW7XLiHw', 'UC5AQEUAwCh1sGDvkQtkDWUQ', 'UCLe_q9axMaeTbjN0hy1Z9xA', 'UC9cn0TuPq4dnbTY-CBsm8XA']) {
  assert.ok(PODCAST_SHOWS.some((s) => s.channel === old), `show ${old} was kept`);
}
const covered = new Set(PODCAST_SHOWS.map((s) => s.topic).filter(Boolean));
assert.ok(covered.size >= 8, `shows cover ${covered.size} topics`);

console.log(`news: all checks passed (${TOPIC_IDS.map((id) => `${id} ${listFeeds(id).length}`).join(', ')})`);
