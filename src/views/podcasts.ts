/**
 * The podcast hub: a directory of shows to browse, filed by topic, and the
 * newest episodes across them. A section of its own, not one of the news topics.
 */
import { loadPodcasts, podcasts, type Headline, type Show, type TopicId } from '../data/news';
import { TOPICS } from '../data/news';
import { pref, setPref } from '../data/user';
import { frame, html, on, raw, render } from '../lib/dom';
import { ago } from '../lib/format';
import { icon } from '../lib/icons';
import { Scope } from '../lib/store';
import type { View } from '../router';
import { adSlot, pushAds } from '../ui/ads';
import { storyCard } from './parts/headlines';

type Filter = 'all' | 'general' | TopicId;

const topicName = (id: TopicId | null | undefined): string => (id ? (TOPICS.find((t) => t.id === id)?.label ?? '') : 'General interest');
const topicShort = (id: TopicId | null | undefined): string => (id ? (TOPICS.find((t) => t.id === id)?.short ?? '') : 'General');

function showCard(s: Show): string {
  const first = s.episodes[0]!;
  const rest = s.episodes.slice(1, 3);
  const art = first.image
    ? `<img src="${first.image.replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()" />`
    : '';
  return html`<article class="show card">
    <a class="show-art" href="${first.link}" target="_blank" rel="noopener noreferrer" aria-label="Latest episode of ${s.name}: ${first.title}">${raw(art)}<span class="story-play">${raw(icon.play(14))}</span></a>
    <div class="show-body">
      <div class="show-head"><h3>${s.name}</h3><a class="tag" href="${s.topic ? `/news/?topic=${s.topic}` : '/news/'}" title="Headlines on ${topicName(s.topic)}">${topicShort(s.topic)}</a></div>
      <p class="show-about">${s.about}</p>
      <a class="show-latest" href="${first.link}" target="_blank" rel="noopener noreferrer"><em>Latest</em><strong>${first.title}</strong><span>${ago(first.publishedMs)}</span></a>
      ${raw(rest.length ? `<ul class="show-more">${rest.map((e) => html`<li><a href="${e.link}" target="_blank" rel="noopener noreferrer">${e.title}</a><span>${ago(e.publishedMs)}</span></li>`).join('')}</ul>` : '')}
      <a class="show-all" href="${s.url}" target="_blank" rel="noopener noreferrer">All episodes ${raw(icon.external(12))}</a>
    </div>
  </article>`;
}

export const podcastsView: View = {
  mount(el) {
    const scope = new Scope();
    const fromUrl = new URL(location.href).searchParams.get('topic');
    let filter = (fromUrl ?? pref('pod.topic', 'all')) as Filter;

    el.innerHTML = `<div class="page-head">
        <div><h1>Podcasts</h1><p>Shows worth your time on markets, investing, crypto, business and more. Browse by topic, or catch the newest episodes.</p></div>
        <div class="page-tools"><a class="btn btn-outline" href="/news/">${icon.news(15)} Headlines</a></div>
      </div>
      <div class="seg seg-scroll pod-tabs" role="tablist" aria-label="Topic" data-tabs></div>
      <section aria-labelledby="pod-shows-h">
        <div class="section-title"><h2 id="pod-shows-h">Shows</h2><p data-count></p></div>
        <div class="shows" data-shows></div>
      </section>
      ${adSlot('podcasts-mid')}
      <section aria-labelledby="pod-latest-h">
        <div class="section-title"><h2 id="pod-latest-h">Newest episodes</h2><p data-latest-note></p></div>
        <div class="stories" data-latest></div>
      </section>
      <p class="faint news-foot">Episodes open on YouTube. Market Check is not affiliated with these shows; the list is a starting point, not an endorsement of any view expressed in them.</p>`;

    const paint = frame(() => {
      const p = podcasts.get();
      const hasGeneral = p.shows.some((s) => !s.topic);
      const tabs: { id: Filter; label: string }[] = [
        { id: 'all', label: 'All shows' },
        ...p.topics.map((t) => ({ id: t.id as Filter, label: t.label })),
        ...(hasGeneral ? [{ id: 'general' as Filter, label: 'General interest' }] : []),
      ];
      if (p.status === 'ok' && !tabs.some((t) => t.id === filter)) filter = 'all';
      render(
        el.querySelector('[data-tabs]'),
        tabs.map((t) => `<button type="button" class="seg-btn${t.id === filter ? ' is-on' : ''}" role="tab" aria-selected="${t.id === filter ? 'true' : 'false'}" data-pod-topic="${t.id}">${t.label}</button>`).join(''),
      );
      const match = (topic: TopicId | null | undefined): boolean => filter === 'all' || (filter === 'general' ? !topic : topic === filter);
      const shows = p.shows.filter((s) => match(s.topic));
      const latest: Headline[] = p.latest.filter((e) => match(e.topic)).slice(0, 12);
      const loading = p.status === 'loading' || p.status === 'idle';

      render(el.querySelector('[data-count]'), loading ? 'Loading…' : p.status === 'error' ? '' : `${shows.length} of ${p.shows.length}`);
      render(
        el.querySelector('[data-shows]'),
        loading
          ? Array.from({ length: 6 }, () => `<div class="show card is-loading"><div class="show-art"></div><div class="show-body"><h3><span class="sk">A show name</span></h3><p><span class="sk">What the show is about, in a line</span></p></div></div>`).join('')
          : p.status === 'error'
            ? `<p class="stories-empty">The podcast list is not available right now. Try again in a few minutes.</p>`
            : shows.length
              ? shows.map(showCard).join('')
              : `<p class="stories-empty">No shows under this topic yet.</p>`,
      );
      render(el.querySelector('[data-latest-note]'), loading || p.status === 'error' ? '' : filter === 'all' ? 'Across every show' : `From ${shows.length === 1 ? 'this show' : 'these shows'}`);
      render(
        el.querySelector('[data-latest]'),
        latest.length
          ? latest.map((e) => storyCard(e, false, filter === 'all' ? topicShort(e.topic) : '')).join('')
          : loading
            ? ''
            : `<p class="stories-empty">No recent episodes here.</p>`,
      );
    });

    scope.add(
      podcasts.subscribe(paint),
      on(el, 'click', '[data-pod-topic]', (_e, t) => {
        setPref('pod.topic', (filter = t.dataset.podTopic as Filter));
        const u = new URL(location.href);
        if (filter === 'all') u.searchParams.delete('topic');
        else u.searchParams.set('topic', filter);
        history.replaceState(history.state, '', u);
        paint();
      }),
    );
    scope.interval(() => {
      if (!document.hidden) void loadPodcasts();
    }, 20 * 60_000);
    void loadPodcasts();
    paint();
    pushAds(el);
    return () => scope.dispose();
  },
};
