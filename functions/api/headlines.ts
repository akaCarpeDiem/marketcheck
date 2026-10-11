/**
 * GET /api/headlines?topic=<id>
 * Recent headlines for one of the ten topics in newsTopics.ts, gathered from
 * public RSS and Atom feeds. No API keys.
 *
 * Topics: markets, investing, personal-finance, crypto, real-estate,
 * technology, policy, business, commodities, healthcare.
 * `category=` is accepted as another name for `topic=`, and the ids of the
 * old site (tradfi, housing, ai, web3nfts and so on) are mapped to the topic
 * that replaced them, so old links and open tabs keep working.
 * `topic=podcasts` answers with the newest podcast episodes; the podcast hub
 * itself is /api/podcasts.
 *
 * Each item carries `topic` and `type` (article, video or podcast).
 *
 * Results are shared for about six minutes through the edge cache, so a busy
 * minute does not turn into hundreds of feed requests. If the feeds fail, the
 * last good set is served and marked stale.
 */

import { cached, type WaitUntil } from '../_shared/edgeCache';
import { DEFAULT_TOPIC, TOPIC_IDS, topicFrom, topicLabel } from '../_shared/newsTopics';
import { getHeadlines, getPodcasts, type HeadlinesResult } from '../_shared/rssHeadlines';

const json = (body: unknown, status: number, cacheControl: string): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl, 'Access-Control-Allow-Origin': '*' },
  });

export async function onRequestGet(context: { request: Request; waitUntil?: WaitUntil }): Promise<Response> {
  const url = new URL(context.request.url);
  const asked = (url.searchParams.get('topic') ?? url.searchParams.get('category') ?? DEFAULT_TOPIC).trim().toLowerCase();
  try {
    if (asked === 'podcasts') {
      const hit = await cached('podcasts:v1', {
        freshMs: 20 * 60_000,
        keepSec: 24 * 3600,
        retryMs: 2 * 60_000,
        load: getPodcasts,
        valid: (d) => d.shows.length > 0,
        waitUntil: context.waitUntil,
      });
      return json(
        { category: 'podcasts', topic: 'podcasts', label: 'Podcasts', items: hit.data.latest.slice(0, 18), stale: hit.stale, source: 'public-rss', fetchedAt: hit.data.fetchedAt },
        200,
        'public, max-age=300',
      );
    }
    const topic = topicFrom(asked);
    if (!topic) {
      return json({ error: `unknown topic; use ${TOPIC_IDS.join('|')}` }, 400, 'public, max-age=60');
    }
    let data: HeadlinesResult;
    try {
      const hit = await cached(`headlines:v2:${topic}`, {
        freshMs: 6 * 60_000,
        keepSec: 12 * 3600,
        retryMs: 60_000,
        load: () => getHeadlines(topic),
        // An empty set is never kept; a quiet topic is answered directly below.
        valid: (d) => d.items.length > 0,
        waitUntil: context.waitUntil,
      });
      data = hit.stale ? { ...hit.data, stale: true } : hit.data;
    } catch {
      data = await getHeadlines(topic);
    }
    return json(
      {
        category: topic,
        topic,
        label: topicLabel(topic),
        items: data.items,
        feedsUsed: data.feedsUsed,
        feedsFailed: data.feedsFailed,
        thin: data.thin,
        note: data.note,
        stale: data.stale,
        source: 'public-rss',
        fetchedAt: data.fetchedAt,
      },
      200,
      data.stale ? 'public, max-age=60' : 'public, max-age=180, s-maxage=420',
    );
  } catch (e) {
    return json(
      { items: [], error: e instanceof Error ? e.message : 'fetch failed', source: 'public-rss', fetchedAt: new Date().toISOString() },
      200,
      'public, max-age=30',
    );
  }
}
