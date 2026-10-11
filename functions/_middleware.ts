/**
 * 1) Canonical host: 301 *.pages.dev and www → https://marketcheck.money (path and query kept).
 *    Exception: a preview deployment (branch alias starting with "preview" or
 *    "redesign") is served as-is so changes can be checked before going live.
 *    Previews are marked noindex.
 * 2) Shareable /quote/:sym → 302 /?q=:sym
 * 3) A missing file under /assets/ must be a 404, never the app's HTML
 *    (HTML with a JS/CSS URL breaks the page in confusing ways).
 *
 * Static files (/assets, /fonts, images) skip Functions entirely via
 * public/_routes.json, so this only runs for pages and /api.
 */

const CANONICAL_HOST = 'marketcheck.money';
const PREVIEW_HOST = /^(preview|redesign)[a-z0-9-]*\.market-check\.pages\.dev$/;

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  const preview = PREVIEW_HOST.test(host);

  if (host !== CANONICAL_HOST && !preview) {
    const isPagesDev = host.endsWith('.pages.dev');
    const isWww = host === `www.${CANONICAL_HOST}`;
    if (isPagesDev || isWww) {
      return Response.redirect(`https://${CANONICAL_HOST}${url.pathname}${url.search}`, 301);
    }
  }

  // Shareable symbol URLs → query form (no page per symbol).
  const quoteMatch = url.pathname.match(/^\/quote\/([^/]+)\/?$/i);
  if (quoteMatch?.[1]) {
    let sym = quoteMatch[1];
    try {
      sym = decodeURIComponent(sym);
    } catch {
      /* keep raw */
    }
    // Other hosts were already sent to the canonical one above, so stay on this origin.
    const dest = new URL(url.href);
    dest.pathname = '/';
    dest.search = `?q=${encodeURIComponent(sym)}`;
    dest.hash = '';
    return Response.redirect(dest.toString(), 302);
  }

  const res = await context.next();

  if (url.pathname.startsWith('/assets/')) {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && ct.includes('text/html')) {
      return new Response('Not found', {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=60',
          'x-content-type-options': 'nosniff',
        },
      });
    }
  }

  if (preview) {
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return out;
  }
  return res;
}
