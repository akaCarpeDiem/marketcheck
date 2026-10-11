/** Headline cards with category tabs. Used on the overview (a few) and the news page (all). */
import { NEWS_CATEGORIES, loadNews, news, type Headline, type NewsCategory } from '../../data/news';
import { pref, setPref } from '../../data/user';
import { frame, html, on, raw, render } from '../../lib/dom';
import { ago } from '../../lib/format';
import { icon } from '../../lib/icons';
import type { Scope } from '../../lib/store';

/** YouTube sometimes answers a missing thumbnail with a tiny grey image; treat that as no image. */
(window as unknown as { __mcImg?: (img: HTMLImageElement) => void }).__mcImg = (img) => {
  if (img.naturalWidth > 0 && img.naturalWidth <= 160) img.closest('.story')?.classList.add('no-image');
};

export function storyCard(h: Headline, lead = false): string {
  const media = h.image
    ? `<div class="story-media"><img src="${h.image.replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.story').classList.add('no-image')" onload="window.__mcImg&&window.__mcImg(this)" />${h.mediaType === 'video' ? `<span class="story-play">${icon.play(14)}</span>` : ''}</div>`
    : '';
  return html`<a class="story card${lead ? ' story-lead' : ''}${h.image ? '' : ' no-image'}" href="${h.link}" target="_blank" rel="noopener noreferrer">
    ${raw(media)}
    <div class="story-body">
      <h3>${h.title}</h3>
      ${raw(h.summary && (lead || !h.image) ? html`<p>${h.summary}</p>` : '')}
      <div class="story-meta"><span class="story-src">${h.source}</span><span>${ago(h.publishedMs)}</span>${raw(h.mediaType === 'video' ? '<span class="tag">Video</span>' : '')}</div>
    </div>
  </a>`;
}

export function mountHeadlines(el: HTMLElement, scope: Scope, opts: { limit: number; more?: boolean; prefKey: string }): void {
  let cat = pref(opts.prefKey, 'tradfi') as NewsCategory;
  if (!NEWS_CATEGORIES.some((c) => c.id === cat)) cat = 'tradfi';

  el.innerHTML = `<div class="section-title">
      <h2>Headlines</h2>
      <p data-note></p>
      ${opts.more ? `<div class="card-tools"><a class="btn btn-ghost btn-sm" href="/news/">All headlines ${icon.chevronRight(13)}</a></div>` : ''}
    </div>
    <div class="seg seg-scroll news-tabs" role="tablist" aria-label="Topic"></div>
    <div class="stories" data-list></div>
    <p class="faint news-foot">Headlines are gathered from publishers' public RSS feeds and link to the original story. Market Check is not affiliated with the publishers.</p>`;

  const paint = frame(() => {
    render(
      el.querySelector('.news-tabs'),
      NEWS_CATEGORIES.map((c) => `<button type="button" class="seg-btn${c.id === cat ? ' is-on' : ''}" role="tab" aria-selected="${c.id === cat ? 'true' : 'false'}" data-news-cat="${c.id}">${c.label}</button>`).join(''),
    );
    const s = news.get().get(cat);
    const items = (s?.items ?? []).slice(0, opts.limit);
    render(el.querySelector('[data-note]'), !s || s.status === 'loading' ? 'Loading…' : s.status === 'error' ? '' : `${s.items.length} stories · updated ${ago(s.at)}`);
    let markup: string;
    if (items.length) markup = items.map((h, i) => storyCard(h, opts.limit > 8 && i === 0)).join('');
    else if (!s || s.status === 'loading') markup = Array.from({ length: Math.min(opts.limit, 8) }, () => `<div class="story card is-loading"><div class="story-media"></div><div class="story-body"><h3><span class="sk">A headline is loading here now</span></h3><div class="story-meta"><span class="sk">Source</span></div></div></div>`).join('');
    else markup = `<p class="stories-empty">No headlines for this topic right now. Try another topic, or check back shortly.</p>`;
    render(el.querySelector('[data-list]'), markup);
  });

  scope.add(
    news.subscribe(paint),
    on(el, 'click', '[data-news-cat]', (_ev, t) => {
      setPref(opts.prefKey, (cat = t.dataset.newsCat as NewsCategory));
      void loadNews(cat);
      paint();
    }),
  );
  scope.interval(() => {
    if (!document.hidden) void loadNews(cat);
  }, 6 * 60_000);
  void loadNews(cat);
  paint();
}
