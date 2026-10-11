/**
 * Privacy-safe pageview analytics for Market Check.
 *
 * Preferred: Cloudflare Web Analytics.
 * - Option A (no code): enable Web Analytics in the Cloudflare dashboard for
 *   marketcheck.money / the market-check Pages project. No build-time token needed.
 * - Option B (beacon): set VITE_CF_WEB_ANALYTICS_TOKEN at build time to the
 *   token from CF Web Analytics → Manage site. This module loads the beacon
 *   only when that env var is set — do not invent a token.
 *
 * Privacy rules:
 * - Pageviews only (no searched tickers, watchlists, or quote values as events).
 * - Reported URL is pathname-only (query string stripped) so ?q=AAPL never
 *   leaves the browser via this beacon.
 * - Google Analytics 4 (G-EN7YS4P0XE) is loaded via the gtag snippet placed right
 *   after <head> in every HTML page (added Oct 10, 2026 at the owner's request).
 *   Do not add a second GA tag here.
 */

const TOKEN = (import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN || '').trim();

/** Pathname-only absolute URL (no ?q= / search / hash). */
function pathOnlyUrl(): string {
  return `${location.origin}${location.pathname}`;
}

/**
 * Load Cloudflare Web Analytics beacon when a real token is configured.
 * Safe no-op when unset (prefer dashboard-level CF analytics instead).
 */
export function initAnalytics(): void {
  if (!TOKEN) return;
  if (document.querySelector('script[data-mc-cf-analytics]')) return;

  // Present a pathname-only URL for the beacon's initial pageview, then restore.
  const real = location.href;
  const clean = pathOnlyUrl();
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (location.href !== real) {
      try {
        history.replaceState(history.state, '', real);
      } catch {
        /* ignore */
      }
    }
  };

  if (real !== clean) {
    try {
      history.replaceState(history.state, '', clean);
    } catch {
      /* if replace fails, still load beacon — better than inventing GA */
    }
  }

  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: TOKEN }));
  s.dataset.mcCfAnalytics = '1';
  s.onload = restore;
  s.onerror = restore;
  document.head.appendChild(s);
  // Restore quickly even if onload is slow — beacon samples location at inject time.
  setTimeout(restore, 0);
}
