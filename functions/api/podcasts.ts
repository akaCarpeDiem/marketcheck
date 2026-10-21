/**
 * GET /api/podcasts
 * The podcast hub: a directory of shows, each filed under a topic, with their
 * recent episodes, plus the newest episodes across all of them. Episodes carry
 * both tags, the show's topic and the type "podcast".
 *
 * Read from each show's public YouTube channel feed (no API key) and shared
 * for twenty minutes. Each load starts from the last stored copy, so a show
 * whose feed is down keeps its last good episodes, and a load where most feeds
 * failed never replaces a better copy (it is retried two minutes later).
 */
import { cacheGet, cached, jsonResponse, type WaitUntil } from '../_shared/edgeCache';
import { PODCAST_SHOWS, TOPICS } from '../_shared/newsTopics';
import { getPodcasts, type PodcastsResult } from '../_shared/rssHeadlines';

const KEY = 'podcasts:v2';

export async function onRequestGet(context: { request: Request; waitUntil?: WaitUntil }): Promise<Response> {
  try {
    const prev = (await cacheGet<PodcastsResult>(KEY).catch(() => null))?.data ?? null;
    const hit = await cached(KEY, {
      freshMs: 20 * 60_000,
      keepSec: 7 * 86_400,
      retryMs: 2 * 60_000,
      load: () => getPodcasts(prev),
      // Mostly failed (YouTube's feeds are having one of their outages): keep the copy we have.
      valid: (d) =>
        d.shows.length > 0 &&
        (!prev || d.answered * 2 >= PODCAST_SHOWS.length || d.shows.length > prev.shows.length),
      waitUntil: context.waitUntil,
    });
    const used = new Set(hit.data.shows.map((s) => s.topic));
    return jsonResponse(
      {
        ok: true,
        shows: hit.data.shows,
        latest: hit.data.latest,
        // Topics that have at least one show, in the site's order, for the filter.
        topics: TOPICS.filter((t) => used.has(t.id)).map((t) => ({ id: t.id, label: t.label, short: t.short })),
        failed: hit.data.failed,
        stale: hit.stale,
        fetchedAt: hit.data.fetchedAt,
      },
      { cacheControl: 'public, max-age=300' },
    );
  } catch (e) {
    return jsonResponse(
      { ok: false, shows: [], latest: [], topics: [], error: e instanceof Error ? e.message : 'unavailable' },
      { cacheControl: 'public, max-age=30' },
    );
  }
}
