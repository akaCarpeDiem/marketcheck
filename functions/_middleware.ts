/**
 * 1) Canonical host: 301 *.pages.dev and www → https://marketcheck.fun (keep path+query)
 * 2) Shareable /quote/:sym → 302 /?q=:sym
 * 3) Prevent SPA HTML soft-404s under /assets/* (wrong MIME breaks CSS/JS).
 *    Static files that exist are still served via context.next().
 * ads.txt is a real static asset (public/ads.txt) — do not 404 it.
 */

const CANONICAL_HOST = 'marketcheck.fun';

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();

  if (host !== CANONICAL_HOST) {
    const isPagesDev = host.endsWith('.pages.dev');
    const isWww = host === `www.${CANONICAL_HOST}`;
    if (isPagesDev || isWww) {
      const dest = `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
      return Response.redirect(dest, 301);
    }
  }

  // Shareable symbol URLs → query form (thin dynamic quote; no static page farm).
  const quoteMatch = url.pathname.match(/^\/quote\/([^/]+)\/?$/i);
  if (quoteMatch?.[1]) {
    let sym = quoteMatch[1];
    try {
      sym = decodeURIComponent(sym);
    } catch {
      /* keep raw */
    }
    const dest = new URL(url.href);
    dest.hostname = CANONICAL_HOST;
    dest.protocol = 'https:';
    dest.pathname = '/';
    dest.search = `?q=${encodeURIComponent(sym)}`;
    dest.hash = '';
    return Response.redirect(dest.toString(), 302);
  }

  if (!url.pathname.startsWith('/assets/')) {
    return context.next();
  }

  const res = await context.next();
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
  return res;
}
