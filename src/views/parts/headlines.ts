/** Headline cards with topic tabs. Used on the overview (a few) and the news page (all, with a type filter). */
import { DEFAULT_TOPIC, TOPICS, loadNews, news, topicFrom, typeOf, type ContentType, type Headline, type TopicId } from '../../data/news';
import { pref, setPref } from '../../data/user';
import { frame, html, on, raw, render } from '../../lib/dom';
import { ago } from '../../lib/format';
import { icon } from '../../lib/icons';
import type { Scope } from '../../lib/store';

/** YouTube sometimes answers a missing thumbnail with a tiny grey image; treat that as no image. */
(window as unknown as { __mcImg?: (img: HTMLImageElement) => void }).__mcImg = (img) => {
  if (img.naturalWidth > 0 && img.naturalWidth <= 160) img.closest('.story')?.classList.add('no-image');
};

const TYPE_TAG: Record<ContentType, string> = { article: '', video: 'Video', podcast: 'Podcast' };

export function storyCard(h: Headline, lead = false, extraTag = ''): string {
  const type = typeOf(h);
  const media = h.image
    ? `<div class="story-media"><img src="${h.image.replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.story').classList.add('no-image')" onload="window.__mcImg&&window.__mcImg(this)" />${type !== 'article' ? `<span class="story-play">${type === 'podcast' ? icon.mic(14) : icon.play(14)}</span>` : ''}</div>`
    : '';
  const tags = [TYPE_TAG[type], extraTag].filter(Boolean).map((t) => html`<span class="tag">${t}</span>`).join('');
  return html`<a class="story card${lead ? ' story-lead' : ''}${h.image ? '' : ' no-image'}" href="${h.link}" target="_blank" rel="noopener noreferrer">
    ${raw(media)}
    <div class="story-body">
      <h3>${h.title}</h3>
      ${raw(h.summary && (lead || !h.image) ? html`<p>${h.summary}</p>` : '')}
      <div class="story-meta"><span class="story-src">${h.source}</span><span>${ago(h.publishedMs)}</span>${raw(tags)}</div>
    </div>
  </a>`;
}

type TypeFilter = 'all' | ContentType;
const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'article', label: 'Articles' },
  { id: 'video', label: 'Video' },
  { id: 'podcast', label: 'Podcasts' },
];

export function mountHeadlines(
  el: HTMLElement,
  scope: Scope,
  opts: { limit: number; more?: boolean; prefKey: string; /** Show the article / video / podcast filter. */ types?: boolean; /** Keep the topic in the address bar. */ url?: boolean },
): void {
  const fromUrl = opts.url ? topicFrom(new URL(location.href).searchParams.get('topic')) : null;
  // A choice saved under the old category names is carried over to the topic that replaced it.
  let topic: TopicId = fromUrl ?? topicFrom(pref(opts.prefKey, DEFAULT_TOPIC)) ?? DEFAULT_TOPIC;
  let type: TypeFilter = 'all';

  el.innerHTML = `<div class="section-title">
      <h2>Headlines</h2>
      <p data-note></p>
      ${opts.more ? `<div class="card-tools"><a class="btn btn-ghost btn-sm" href="/podcasts/">${icon.mic(14)} Podcasts</a><a class="btn btn-ghost btn-sm" href="/news/">All headlines ${icon.chevronRight(13)}</a></div>` : ''}
    </div>
    <div class="seg seg-scroll news-tabs" role="tablist" aria-label="Topic"></div>
    ${opts.types ? '<div class="news-sub"><p class="news-about" data-about></p><div class="seg news-types" role="group" aria-label="Type of content" data-types></div></div>' : ''}
    <div class="stories" data-list></div>
    <p class="faint news-foot">Headlines are gathered from publishers' public RSS feeds and link to the original story. Market Check is not affiliated with the publishers.</p>`;

  const paint = frame(() => {
    render(
      el.querySelector('.news-tabs'),
      TOPICS.map((c) => `<button type="button" class="seg-btn${c.id === topic ? ' is-on' : ''}" role="tab" aria-selected="${c.id === topic ? 'true' : 'false'}" data-news-cat="${c.id}" title="${c.about}">${opts.types ? c.label : c.short}</button>`).join(''),
    );
    const s = news.get().get(topic);
    const all = s?.items ?? [];
    if (opts.types) {
      const count = (t: TypeFilter) => (t === 'all' ? all.length : all.filter((h) => typeOf(h) === t).length);
      // A filter with nothing behind it is not offered (but the chosen one stays, so the page does not jump).
      render(
        el.querySelector('[data-types]'),
        TYPE_FILTERS.filter((t) => t.id === 'all' || t.id === type || count(t.id) > 0)
          .map((t) => `<button type="button" class="seg-btn${t.id === type ? ' is-on' : ''}" data-news-type="${t.id}" aria-pressed="${t.id === type ? 'true' : 'false'}">${t.label}${all.length ? ` <em>${count(t.id)}</em>` : ''}</button>`)
          .join(''),
      );
      render(el.querySelector('[data-about]'), html`${TOPICS.find((t) => t.id === topic)?.about ?? ''}`);
    }
    const shown = (type === 'all' ? all : all.filter((h) => typeOf(h) === type)).slice(0, opts.limit);
    render(el.querySelector('[data-note]'), !s || s.status === 'loading' ? 'Loading…' : s.status === 'error' ? '' : `${all.length} stories · updated ${ago(s.at)}`);
    let markup: string;
    if (shown.length) markup = shown.map((h, i) => storyCard(h, opts.limit > 8 && i === 0)).join('');
    else if (!s || s.status === 'loading') markup = Array.from({ length: Math.min(opts.limit, 8) }, () => `<div class="story card is-loading"><div class="story-media"></div><div class="story-body"><h3><span class="sk">A headline is loading here now</span></h3><div class="story-meta"><span class="sk">Source</span></div></div></div>`).join('');
    else if (all.length) markup = `<p class="stories-empty">Nothing of that kind under this topic right now. Choose “Everything” to see all ${all.length} stories.</p>`;
    else markup = `<p class="stories-empty">No headlines for this topic right now. Try another topic, or check back shortly.</p>`;
    render(el.querySelector('[data-list]'), markup);
  });

  scope.add(
    news.subscribe(paint),
    on(el, 'click', '[data-news-cat]', (_ev, t) => {
      setPref(opts.prefKey, (topic = t.dataset.newsCat as TopicId));
      if (opts.url) {
        const u = new URL(location.href);
        if (topic === DEFAULT_TOPIC) u.searchParams.delete('topic');
        else u.searchParams.set('topic', topic);
        history.replaceState(history.state, '', u);
      }
      void loadNews(topic);
      paint();
    }),
    on(el, 'click', '[data-news-type]', (_ev, t) => {
      type = t.dataset.newsType as TypeFilter;
      paint();
    }),
  );
  scope.interval(() => {
    if (!document.hidden) void loadNews(topic);
  }, 6 * 60_000);
  void loadNews(topic);
  paint();
}
