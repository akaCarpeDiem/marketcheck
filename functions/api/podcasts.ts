/**
 * GET /api/podcasts
 * The podcast hub: a directory of shows, each filed under a topic, with their
 * recent episodes, plus the newest episodes across all of them. Episodes carry
 * both tags, the show's topic and the type "podcast".
 *
 * Read from each show's public YouTube channel feed (no API key) and shared
 * for twenty minutes.
 */
import { cached, jsonResponse, type WaitUntil } from '../_shared/edgeCache';
import { TOPICS } from '../_shared/newsTopics';
import { getPodcasts } from '../_shared/rssHeadlines';

export async function onRequestGet(context: { request: Request; waitUntil?: WaitUntil }): Promise<Response> {
  try {
    const hit = await cached('podcasts:v1', {
      freshMs: 20 * 60_000,
      keepSec: 24 * 3600,
      retryMs: 2 * 60_000,
      load: getPodcasts,
      valid: (d) => d.shows.length > 0,
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
