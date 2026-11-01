/**
 * AdSense slots. Rules kept from the site's publishing notes:
 * ads sit below the first screen only, are labelled, and never imitate content.
 *
 * A slot takes no visible space until AdSense fills it, so an unfilled or
 * not-yet-approved slot leaves no empty box behind.
 */
const CLIENT = (import.meta.env.VITE_ADSENSE_CLIENT || '').trim();
const SLOT = (import.meta.env.VITE_ADSENSE_SLOT || '').trim();

export const adsEnabled = (): boolean => /^ca-pub-\d+$/i.test(CLIENT);

export function adSlot(name: string): string {
  if (!adsEnabled()) return '';
  const slot = SLOT ? ` data-ad-slot="${SLOT.replace(/[^0-9]/g, '')}"` : '';
  return `<aside class="ad-slot" data-ad-name="${name}" aria-label="Advertisement">
    <div class="ad-label">Advertisement</div>
    <ins class="adsbygoogle" style="display:block" data-ad-client="${CLIENT}"${slot} data-ad-format="auto" data-full-width-responsive="true"></ins>
  </aside>`;
}

/**
 * News and podcast pages ship without the AdSense loader. When a visitor starts
 * there and moves to a page with slots, add the loader once.
 */
function ensureLoader(): void {
  if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
  document.head.appendChild(s);
}

/** Ask AdSense to fill any slot it has not seen yet. Safe to call after every render. */
export function pushAds(root: ParentNode = document): void {
  if (!adsEnabled()) return;
  try {
    if (!root.querySelector('ins.adsbygoogle')) return;
    ensureLoader();
    const w = window as Window & { adsbygoogle?: unknown[] };
    w.adsbygoogle = w.adsbygoogle || [];
    for (const ins of root.querySelectorAll<HTMLElement>('ins.adsbygoogle:not([data-adsbygoogle-status]):not([data-mc-pushed])')) {
      ins.dataset.mcPushed = '1';
      w.adsbygoogle.push({});
    }
  } catch {
    /* an ad blocker or a failed script must not break the page */
  }
}
