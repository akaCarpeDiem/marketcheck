// Checks the news structure: ten topics, where each old category went, the podcast directory,
// and that no topic asks for more feeds than one request is allowed to make.
import assert from 'node:assert/strict';
import { CONTENT_TYPES, LEGACY_TOPIC, PODCAST_SHOWS, TOPICS, TOPIC_IDS, topicFrom, topicLabel } from '../../functions/_shared/newsTopics.ts';
import { ALL_HEADLINE_CATEGORIES, listFeeds } from '../../functions/_shared/rssHeadlines.ts';

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
