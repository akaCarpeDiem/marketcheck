/** All headlines, by topic. */
import { Scope } from '../lib/store';
import type { View } from '../router';
import { adSlot, pushAds } from '../ui/ads';
import { mountHeadlines } from './parts/headlines';

export const newsView: View = {
  mount(el) {
    const scope = new Scope();
    el.innerHTML = `<div class="page-head"><div><h1>Headlines</h1><p>Recent stories on markets, crypto, technology and more, from major publishers. Each opens the original article.</p></div></div>
      <section id="news-list"></section>
      ${adSlot('news-foot')}`;
    mountHeadlines(el.querySelector<HTMLElement>('#news-list')!, scope, { limit: 30, prefKey: 'news.cat' });
    el.querySelector('#news-list .section-title h2')?.classList.add('sr-only');
    pushAds(el);
    return () => scope.dispose();
  },
};
