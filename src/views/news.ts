/** All headlines, by topic, with a way into the podcast hub. */
import { icon } from '../lib/icons';
import { Scope } from '../lib/store';
import type { View } from '../router';
import { adSlot, pushAds } from '../ui/ads';
import { mountHeadlines } from './parts/headlines';

export const newsView: View = {
  mount(el) {
    const scope = new Scope();
    el.innerHTML = `<div class="page-head">
        <div><h1>Headlines</h1><p>Money news in ten topics, from major publishers. Each story opens at its source.</p></div>
        <div class="page-tools"><a class="btn btn-outline" href="/podcasts/">${icon.mic(15)} Podcasts</a></div>
      </div>
      <section id="news-list"></section>
      ${adSlot('news-foot')}`;
    mountHeadlines(el.querySelector<HTMLElement>('#news-list')!, scope, { limit: 30, prefKey: 'news.cat', types: true, url: true });
    el.querySelector('#news-list .section-title h2')?.classList.add('sr-only');
    pushAds(el);
    return () => scope.dispose();
  },
};
