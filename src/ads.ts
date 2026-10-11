/**
 * AdSense — live ads when VITE_ADSENSE_CLIENT is set (ca-pub-…).
 * Missing env → labeled reserved slots below the fold only.
 *
 * Rules:
 * - No ads above the first quote row (header position always empty).
 * - No fake “Sponsored pick” ticker-style creatives.
 * - Head script + public/ads.txt are required for site verification;
 *   this module fills below-fold reserved slots when CLIENT (and optional SLOT) exist.
 *
 * Cloudflare Pages: set VITE_ADSENSE_CLIENT at build time, or rebuild after adding it.
 * Optional slot: VITE_ADSENSE_SLOT (numeric ad unit id).
 */

const CLIENT = (import.meta.env.VITE_ADSENSE_CLIENT || '').trim();
const SLOT = (import.meta.env.VITE_ADSENSE_SLOT || '').trim();

export function adsenseEnabled(): boolean {
  return /^ca-pub-\d+$/i.test(CLIENT);
}

/** Inject adsbygoogle.js once when a publisher client id is configured. */
export function ensureAdSenseScript(): void {
  if (!adsenseEnabled()) return;
  if (document.querySelector('script[data-mc-adsense]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT)}`;
  s.crossOrigin = 'anonymous';
  s.dataset.mcAdsense = '1';
  document.head.appendChild(s);
}

/**
 * Ad slot HTML.
 * - header: always empty (nothing above the first quote row).
 * - footer / below-fold: reserved labeled placeholder when AdSense is off;
 *   live <ins> when adsenseEnabled().
 */
export function adSlotHtml(position: 'header' | 'footer'): string {
  // Never place ads (or placeholders) above the first quote row.
  if (position === 'header') return '';

  if (!adsenseEnabled()) {
    return `
    <aside class="ad-slot ad-slot--footer ad-slot--reserved" aria-label="Advertisement reserved">
      <div class="ad-slot-label">Advertisement · reserved</div>
    </aside>
  `;
  }

  const slotAttr = SLOT ? ` data-ad-slot="${escapeAttr(SLOT)}"` : '';
  return `
    <aside class="ad-slot ad-slot--footer" aria-label="Advertisement">
      <div class="ad-slot-label">Advertisement</div>
      <ins class="adsbygoogle"
        style="display:block"
        data-ad-client="${escapeAttr(CLIENT)}"${slotAttr}
        data-ad-format="auto"
        data-full-width-responsive="true"></ins>
    </aside>
  `;
}

/** Push adsbygoogle after DOM insert when enabled. */
export function pushAds(): void {
  if (!adsenseEnabled()) return;
  try {
    const w = window as Window & { adsbygoogle?: unknown[] };
    w.adsbygoogle = w.adsbygoogle || [];
    document.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach(() => {
      w.adsbygoogle!.push({});
    });
  } catch {
    /* ignore ad push errors */
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
