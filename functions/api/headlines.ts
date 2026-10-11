/**
 * Cloudflare Pages Function — Recent Headlines from public RSS.
 * GET /api/headlines?category=tradfi|crypto|politics|housing|web3nfts|health|longevity|technology|ai|robotics|genart|podcasts
 * No API keys. Server-side fetch + ~7 min cache.
 */

import {
  getHeadlines,
  ALL_HEADLINE_CATEGORIES,
  type HeadlineCategory,
} from '../_shared/rssHeadlines';

const VALID = new Set<HeadlineCategory>(ALL_HEADLINE_CATEGORIES);
const VALID_HELP = 'tradfi|crypto|politics|housing|web3nfts|health|longevity|technology|ai|robotics|genart|podcasts';

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const category = (url.searchParams.get('category') ?? 'tradfi') as HeadlineCategory;
    if (!VALID.has(category)) {
      return new Response(
        JSON.stringify({ error: `invalid category; use ${VALID_HELP}` }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    const data = await getHeadlines(category);
    return new Response(
      JSON.stringify({
        category: data.category,
        items: data.items,
        feedsUsed: data.feedsUsed,
        feedsFailed: data.feedsFailed,
        thin: data.thin,
        note: data.note,
        stale: data.stale,
        source: 'public-rss',
        fetchedAt: data.fetchedAt,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': data.stale
            ? 'public, max-age=60'
            : 'public, max-age=180, s-maxage=420',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        items: [],
        error: e instanceof Error ? e.message : 'fetch failed',
        source: 'public-rss',
        fetchedAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=30',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}
