/** The News Leaderboard: the biggest stories per topic, ranked by coverage, Hacker News, Reddit and search trends. */
import { SIGNAL_INFO } from '../../functions/_shared/newsBoard';
import {
  DEFAULT_TOPIC,
  TOPICS,
  boardKey,
  boardState,
  boards,
  isFresh,
  loadBoard,
  markRead,
  readIds,
  topicFrom,
  yesterdayEt,
  type BoardName,
  type BoardResponse,
  type BoardStory,
  type TopicId,
} from '../data/newsboard';
import { pref, setPref } from '../data/user';
import { frame, html, on, raw, reducedMotion, render } from '../lib/dom';
import { ago, clock, until } from '../lib/format';
import { icon } from '../lib/icons';
import { count, geoName, hasUnreadTop, isHot, movement, progress, subName, traffic, updatedText, type Move } from '../lib/leaderboard';
import { poll } from '../lib/poll';
import { Scope } from '../lib/store';
import { openOverlay } from '../ui/overlay';
import type { View } from '../router';
import { mountHeadlines } from './parts/headlines';

type UiBoard = 'live' | 'today' | 'yesterday';
type Topic = TopicId | 'all';

const UI_BOARDS: { id: UiBoard; label: string }[] = [
  { id: 'live', label: 'Live now' },
  { id: 'today', label: 'Released today' },
  { id: 'yesterday', label: 'Yesterday’s top 10' },
];

const labelOf = (id: TopicId): string => TOPICS.find((t) => t.id === id)!.label;
const shortOf = (id: TopicId): string => TOPICS.find((t) => t.id === id)!.short;
const dayLabel = (date: string): string =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.parse(`${date}T00:00:00Z`));
const ms = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

function readUrl(): { topic: Topic; board: UiBoard; latest: boolean } {
  const q = new URL(location.href).searchParams;
  const rawTopic = q.get('topic');
  const topic: Topic = rawTopic === 'all' ? 'all' : (topicFrom(rawTopic) ?? (pref('nb.topic', 'all') === 'all' ? 'all' : (topicFrom(pref('nb.topic', 'all')) ?? 'all')));
  const asked = q.get('board') ?? pref('nb.board', 'live');
  const board: UiBoard = asked === 'today' || asked === 'yesterday' ? asked : 'live';
  return { topic, board, latest: q.get('view') === 'latest' };
}

export const newsView: View = {
  mount(el) {
    const scope = new Scope();
    const first = readUrl();
    let topic: Topic = first.topic;
    let board: UiBoard = first.board;
    let picked: string | null = null;
    let latestOpen = first.latest;
    const expanded = new Set<string>();
    let listKey = '';
    let latestScope: Scope | null = null;

    el.innerHTML = `<div class="page-head">
        <div>
          <h1>News Leaderboard</h1>
          <p>The stories getting the most coverage and engagement right now, ranked.</p>
          <div class="nb-live"><span class="nb-pulse" data-pulse aria-hidden="true"></span><span data-updated>Loading…</span><button type="button" class="btn btn-ghost btn-sm" data-act="how">${icon.info(14)} How ranking works</button></div>
        </div>
        <div class="page-tools"><a class="btn btn-outline" href="/podcasts/">${icon.mic(15)} Podcasts</a></div>
      </div>
      <div class="nb-controls"><div class="seg" role="group" aria-label="Board" data-boards></div><div class="nb-days" data-days-slot></div></div>
      <p class="nb-status" data-status></p>
      <div class="seg seg-scroll news-tabs" role="tablist" aria-label="Topic" data-tabs></div>
      <div data-progress></div>
      <div data-body aria-live="off"></div>
      <p class="sr-only" role="status" aria-live="polite" data-announce></p>
      <p class="nb-foot faint">Rankings are worked out from public data. Every link goes to the original publisher; Market Check does not write or host these stories and is not affiliated with the publishers. Not financial advice.</p>
      <p class="nb-latest-link"><span>Prefer a plain feed?</span> <button type="button" class="btn-link" data-act="latest" aria-expanded="false" aria-controls="news-list">Latest headlines</button></p>
      <section id="news-list" hidden></section>`;

    const $ = <T extends HTMLElement>(sel: string): T => el.querySelector<T>(sel)!;

    /* ── what to fetch ── */
    const spec = (): { board: BoardName; date: string | null } =>
      board === 'yesterday' && picked ? { board: 'day', date: picked } : { board, date: null };
    const stateOf = (t: TopicId) => {
      const s = spec();
      return boardState(t, s.board, s.date);
    };
    const daysTopic = (): TopicId => (topic === 'all' ? DEFAULT_TOPIC : topic);
    const daysState = () => boardState(daysTopic(), 'day', yesterdayEt());
    const visibleTopics = (): TopicId[] => TOPICS.map((t) => t.id);

    function loadAll(force = false): void {
      const s = spec();
      // The topic in view first, then the rest (they feed the tab dots and the front page).
      const order = topic === 'all' ? visibleTopics() : [topic, ...visibleTopics().filter((t) => t !== topic)];
      order.forEach((t, i) => (i === 0 ? void loadBoard(t, s.board, s.date, force) : void setTimeout(() => void loadBoard(t, s.board, s.date, force), topic === 'all' ? 0 : 600)));
      if (topic === 'all' && board !== 'live') visibleTopics().forEach((t) => void loadBoard(t, 'live')); // the hero is always a live story
      if (board === 'yesterday') void loadBoard(daysTopic(), 'day', yesterdayEt(), force);
    }

    /** Data to describe the page with (status line, signals): the topic in view, or the first one that has loaded. */
    function head(): BoardResponse | null {
      const tryTopics = topic === 'all' ? visibleTopics() : [topic];
      for (const t of tryTopics) {
        const d = stateOf(t)?.data;
        if (d && d.status !== 'empty') return d;
      }
      for (const t of tryTopics) {
        const d = stateOf(t)?.data;
        if (d) return d;
      }
      return null;
    }

    const readSetNow = () => readIds.get();
    const idsOf = (t: TopicId): string[] => stateOf(t)?.data?.stories.map((s) => s.id) ?? [];

    /* ── pieces of markup ── */
    function moveHtml(m: Move): string {
      switch (m.kind) {
        case 'up':
          return html`<span class="nb-move up"><span aria-hidden="true">▲${m.by}</span><span class="sr-only">Up ${m.by} ${m.by === 1 ? 'place' : 'places'}</span></span>`;
        case 'down':
          return html`<span class="nb-move down"><span aria-hidden="true">▼${m.by}</span><span class="sr-only">Down ${m.by} ${m.by === 1 ? 'place' : 'places'}</span></span>`;
        case 'new':
          return `<span class="nb-new">NEW</span>`;
        case 'same':
          return `<span class="nb-move flat"><span aria-hidden="true">—</span><span class="sr-only">No change</span></span>`;
        default:
          return '';
      }
    }

    function moveFor(s: BoardStory, st: { previous: BoardResponse | null } | undefined): Move {
      const seen = st?.previous?.stories.find((p) => p.id === s.id)?.rank;
      return movement(s.rank, s.prevRank, board === 'live', seen);
    }

    function chips(s: BoardStory): string {
      const g = s.signals;
      const out: string[] = [html`<span class="nb-chip">${g.outlets} ${g.outlets === 1 ? 'outlet' : 'outlets'}</span>`];
      if (g.hn) out.push(html`<a class="nb-chip nb-chip-link" href="${g.hn.url}" target="_blank" rel="noopener noreferrer" title="Hacker News thread">Hacker News ▲${g.hn.points.toLocaleString('en-US')} · ${g.hn.comments.toLocaleString('en-US')} comments</a>`);
      if (g.reddit) out.push(html`<a class="nb-chip nb-chip-link" href="${g.reddit.url}" target="_blank" rel="noopener noreferrer" title="Reddit thread">Reddit ${count(g.reddit.score)} upvotes · ${subName(g.reddit.sub)}</a>`);
      if (g.trends) out.push(html`<span class="nb-chip" title="${g.trends.query}">Searched ${traffic(g.trends.traffic)} · ${geoName(g.trends.geo)}</span>`);
      return out.join('');
    }

    function rowHtml(s: BoardStory, st: { previous: BoardResponse | null } | undefined, read: Set<string>): string {
      const m = moveFor(s, st);
      const hot = isHot(s.heat, m);
      const isRead = read.has(s.id);
      const open = expanded.has(s.id);
      const when = ms(s.publishedAt);
      const medal = s.rank <= 3 ? ` r${s.rank}` : '';
      const more = open
        ? html`<div class="nb-more" id="nb-more-${s.id}">
            ${raw(s.summary ? html`<p class="nb-sum">${s.summary}</p>` : '')}
            <h4>Who’s covering it</h4>
            <ul class="nb-outlets">${raw(
              s.outlets
                .map((o) => html`<li><a href="${o.link}" target="_blank" rel="noopener noreferrer" data-open="${s.id}">${o.source}</a><span class="nb-otitle">${o.title}</span>${raw(ms(o.publishedAt) ? html`<span class="faint">${ago(ms(o.publishedAt))}</span>` : '')}</li>`)
                .join(''),
            )}</ul>
            <p class="faint nb-sweeps">${s.sweeps > 0 ? `On the board for ${s.sweeps} ${s.sweeps === 1 ? 'sweep' : 'sweeps'}${s.peakRank ? ` · peaked at #${s.peakRank}` : ''}` : `New on the board${s.peakRank ? ` · peaked at #${s.peakRank}` : ''}`}</p>
          </div>`
        : '';
      return html`<li class="nb-row${medal}${isRead ? ' is-read' : ''}${hot ? ' is-hot' : ''}" data-id="${s.id}" data-rank="${s.rank}">
        <div class="nb-rank"><span class="nb-num">${s.rank}</span>${raw(moveHtml(m))}</div>
        <div class="nb-main">
          <h3 class="nb-title"><a href="${s.link}" target="_blank" rel="noopener noreferrer" data-open="${s.id}">${s.title}</a></h3>
          <div class="nb-meta"><span class="nb-src">${s.source}</span>${raw(when ? html`<span>${ago(when)}</span>` : '')}${raw(hot ? '<span class="tag tag-warn nb-hot">🔥 Hot</span>' : '')}${raw(isRead ? '<span class="tag nb-readtag">Read</span>' : '')}</div>
          <div class="nb-heat${hot ? ' is-hot' : ''}"><span class="nb-bar" role="meter" aria-label="Heat" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.heat}"><i style="width:${s.heat}%"></i></span><b class="num">${s.heat}</b></div>
          <div class="nb-chips">${raw(chips(s))}</div>
          ${raw(more)}
        </div>
        ${raw(s.image ? html`<img class="nb-thumb" src="${s.image}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()" />` : '')}
        <div class="nb-actions">
          <button type="button" class="nb-btn nb-check${isRead ? ' is-on' : ''}" data-act="read" data-id="${s.id}" aria-pressed="${isRead}" aria-label="${isRead ? 'Mark as unread' : 'Mark as read'}: ${s.title}" title="${isRead ? 'Mark as unread' : 'Mark as read'}">${raw(icon.check(16))}</button>
          <button type="button" class="nb-btn nb-chev" data-act="expand" data-id="${s.id}" aria-expanded="${open}" aria-controls="nb-more-${s.id}" aria-label="${open ? 'Hide' : 'Show'} who is covering: ${s.title}" title="Who’s covering it">${raw(icon.chevronDown(16))}</button>
        </div>
      </li>`;
    }

    const skeletonRows = (n: number): string =>
      `<ol class="nb-list" aria-hidden="true">${Array.from({ length: n }, () => `<li class="nb-row is-loading"><div class="nb-rank"><span class="nb-num sk">0</span></div><div class="nb-main"><h3 class="nb-title"><span class="sk">A headline is loading in this spot right now</span></h3><div class="nb-meta"><span class="sk">Source name · 3h ago</span></div><div class="nb-heat"><span class="sk nb-skbar"></span></div></div></li>`).join('')}</ol>`;

    function emptyText(): string {
      if (board === 'today') return 'The noon check hasn’t run yet today. The early look appears here once the first stories are in, and locks at noon New York time.';
      if (board === 'yesterday') return 'No ranking stored for this day yet. The final top 10 is saved when the day’s sweep finishes overnight.';
      return 'No ranking yet for this topic. Check back in a few minutes.';
    }
    const emptyHtml = (): string => html`<div class="nb-empty card"><p>${emptyText()}</p><button type="button" class="btn btn-outline btn-sm" data-act="retry">${raw(icon.refresh(14))} Check again</button></div>`;

    /* ── a single topic ── */
    function topicHtml(t: TopicId): string {
      const st = stateOf(t);
      if (!st || st.status === 'loading') return skeletonRows(8);
      if (st.status === 'error' || !st.data) {
        return `<div class="nb-empty card"><p>The leaderboard couldn’t be loaded right now.</p><button type="button" class="btn btn-outline btn-sm" data-act="retry">${icon.refresh(14)} Try again</button></div>`;
      }
      if (st.data.status === 'empty' || !st.data.stories.length) return emptyHtml();
      const read = readSetNow();
      return `<ol class="nb-list" aria-label="${labelOf(t).replace(/&/g, '&amp;')} leaderboard">${st.data.stories.map((s) => rowHtml(s, st, read)).join('')}</ol>`;
    }

    /* ── the front page ── */
    function miniMove(s: BoardStory, st: { previous: BoardResponse | null } | undefined): string {
      return moveHtml(moveFor(s, st));
    }

    function hero(): string {
      let best: { s: BoardStory; t: TopicId } | null = null;
      for (const t of visibleTopics()) {
        const d = boardState(t, 'live')?.data;
        for (const s of d?.stories ?? []) if (!best || s.score > best.s.score) best = { s, t };
      }
      if (!best) return `<div class="nb-hero card is-loading" aria-hidden="true"><span class="sk">Biggest story right now loading here</span></div>`;
      const { s, t } = best;
      const when = ms(s.publishedAt);
      return html`<div class="nb-hero card">
        <div class="nb-hero-body">
          <p class="nb-kicker">${raw(icon.flame(14))} Biggest story right now <span class="tag">${labelOf(t)}</span></p>
          <h2><a href="${s.link}" target="_blank" rel="noopener noreferrer" data-open="${s.id}">${s.title}</a></h2>
          ${raw(s.summary ? html`<p class="nb-sum">${s.summary}</p>` : '')}
          <div class="nb-meta"><span class="nb-src">${s.source}</span>${raw(when ? html`<span>${ago(when)}</span>` : '')}</div>
          <div class="nb-chips">${raw(chips(s))}</div>
          <p><button type="button" class="btn btn-outline btn-sm" data-topic="${t}">See the ${shortOf(t)} top 10 →</button></p>
        </div>
        ${raw(s.image ? html`<img class="nb-hero-img" src="${s.image}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()" />` : '')}
      </div>`;
    }

    function cardHtml(t: TopicId): string {
      const st = stateOf(t);
      const d = st?.data;
      const read = readSetNow();
      let inner: string;
      if (!st || st.status === 'loading') {
        inner = `<div class="nb-card-sk" aria-hidden="true"><span class="sk">A headline is loading in this card</span><span class="sk">Source</span><span class="sk">Another headline here</span><span class="sk">And one more headline</span></div>`;
      } else if (!d || d.status === 'empty' || !d.stories.length) {
        inner = `<p class="faint nb-card-empty">${st.status === 'error' ? 'Couldn’t load this topic.' : 'Nothing ranked yet.'}</p>`;
      } else {
        const [one, ...rest] = d.stories;
        const p = progress(d.stories.map((s) => s.id), read);
        inner = html`<div class="nb-lead${read.has(one!.id) ? ' is-read' : ''}">
            <h3><a href="${one!.link}" target="_blank" rel="noopener noreferrer" data-open="${one!.id}">${one!.title}</a></h3>
            <div class="nb-meta"><span class="nb-src">${one!.source}</span>${raw(miniMove(one!, st))}<span class="nb-minheat" title="Heat ${one!.heat} of 100"><span class="nb-bar"><i style="width:${one!.heat}%"></i></span><b class="num">${one!.heat}</b></span></div>
          </div>
          <ol class="nb-mini" start="2">${raw(
            rest
              .slice(0, 2)
              .map((s) => html`<li class="${read.has(s.id) ? 'is-read' : ''}"><span class="nb-minirank">${s.rank}</span><a href="${s.link}" target="_blank" rel="noopener noreferrer" data-open="${s.id}">${s.title}</a></li>`)
              .join(''),
          )}</ol>
          <p class="faint nb-card-prog">${p.done ? 'All caught up ✓' : `${p.read} of ${p.total} read`}</p>`;
      }
      return html`<article class="nb-card card"><header><h3>${labelOf(t)}</h3></header>${raw(inner)}<button type="button" class="btn btn-ghost btn-sm nb-more-btn" data-topic="${t}">See the top 10 →</button></article>`;
    }

    function frontHtml(): string {
      const allEmpty = visibleTopics().every((t) => {
        const s = stateOf(t);
        return s && s.status !== 'loading' && (!s.data || s.data.status === 'empty' || !s.data.stories.length);
      });
      if (allEmpty) return emptyHtml();
      return `${hero()}<div class="nb-grid">${visibleTopics().map(cardHtml).join('')}</div>`;
    }

    /* ── painting ── */
    const nav = (): void => {
      const u = new URL(location.href);
      u.searchParams.set('topic', topic);
      u.searchParams.set('board', board);
      history.replaceState(history.state, '', u);
    };

    function paintTabs(): void {
      const read = readSetNow();
      const tab = (id: Topic, long: string, short: string, dot: boolean) =>
        html`<button type="button" class="seg-btn${id === topic ? ' is-on' : ''}" role="tab" aria-selected="${id === topic}" data-topic="${id}"><span class="nb-long">${long}</span><span class="nb-short">${short}</span>${raw(dot ? '<i class="nb-unread" aria-hidden="true"></i><span class="sr-only"> (unread top stories)</span>' : '')}</button>`;
      render(
        $('[data-tabs]'),
        tab('all', 'All', 'All', false) +
          TOPICS.map((t) => {
            const ids = idsOf(t.id);
            return tab(t.id, t.label, t.short, ids.length > 0 && hasUnreadTop(ids, read));
          }).join(''),
      );
      render(
        $('[data-boards]'),
        UI_BOARDS.map((b) => html`<button type="button" class="seg-btn${b.id === board ? ' is-on' : ''}" aria-pressed="${b.id === board}" data-board="${b.id}">${b.label}</button>`).join(''),
      );
      // Previous days (yesterday board only).
      let picker = '';
      if (board === 'yesterday') {
        const y = yesterdayEt();
        const days = (daysState()?.data?.days ?? []).filter((d) => d < y).sort().reverse();
        if (days.length) {
          picker = html`<label class="nb-pick"><span>Previous days</span><select class="input" data-days aria-label="Previous days"><option value="">Yesterday (${dayLabel(y)})</option>${raw(days.map((d) => html`<option value="${d}"${d === picked ? ' selected' : ''}>${dayLabel(d)}</option>`).join(''))}</select></label>`;
        }
      }
      render($('[data-days-slot]'), picker);
    }

    function paintStatus(): void {
      const d = head();
      const now = Date.now();
      let text = '';
      if (board === 'live') text = 'Rolling last 24 hours · refreshes every few minutes';
      else if (d && d.status !== 'empty') {
        if (board === 'today') {
          const next = ms(d.nextUpdateAt);
          const locked = ms(d.lockedAt);
          if (d.status === 'final') text = locked ? `Locked at ${clock(locked)}` : 'Locked at the noon check';
          else text = next && next > now ? `Early look · locks at the noon check in ${until(next - now)}` : 'Early look · locking at the noon check now';
        } else if (d.status === 'final') text = `Final ranking for ${dayLabel(d.date)}`;
        else text = 'Provisional: the full sweep finishes overnight';
      } else if (board === 'yesterday' && picked) text = `Ranking for ${dayLabel(picked)}`;
      render($('[data-status]'), html`${text}`);
      // The "updated" indicator.
      const at = ms(d?.generatedAt);
      render($('[data-updated]'), html`${at ? updatedText(at, now) : 'Loading…'}`);
      $('[data-pulse]').classList.toggle('is-live', board === 'live' && !!at);
    }

    function paintProgress(): void {
      if (topic === 'all') return void render($('[data-progress]'), '');
      const ids = idsOf(topic);
      if (!ids.length) return void render($('[data-progress]'), '');
      const p = progress(ids, readSetNow());
      const pct = Math.round((100 * p.read) / p.total);
      const text = p.done ? `All caught up on ${shortOf(topic)} ✓` : `You’re caught up on ${p.read} of ${p.total}`;
      render(
        $('[data-progress]'),
        html`<div class="nb-progress${p.done ? ' is-done' : ''}"><svg class="nb-ring" viewBox="0 0 36 36" width="34" height="34" aria-hidden="true"><circle cx="18" cy="18" r="15.9" pathLength="100" class="nb-ring-bg"/><circle cx="18" cy="18" r="15.9" pathLength="100" class="nb-ring-fg" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/></svg><span class="nb-prog-text" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.read}" aria-label="Stories read">${text}</span>${raw(p.done ? '<span class="nb-party" aria-hidden="true">🎉</span>' : '')}</div>`,
      );
    }

    function paintBody(animate = false): void {
      const box = $('[data-body]');
      const key = `${topic}|${board}|${picked ?? ''}`;
      const sameList = animate && key === listKey && topic !== 'all';
      listKey = key;
      const before = new Map<string, { top: number; rank: number }>();
      if (sameList) {
        box.querySelectorAll<HTMLElement>('.nb-row[data-id]').forEach((r) => before.set(r.dataset.id!, { top: r.getBoundingClientRect().top, rank: Number(r.dataset.rank) }));
      }
      const active = document.activeElement as HTMLElement | null;
      const refocus = active && box.contains(active) && active.dataset.act ? `[data-act="${active.dataset.act}"][data-id="${active.dataset.id}"]` : '';
      const changed = render(box, topic === 'all' ? frontHtml() : topicHtml(topic));
      if (!changed) return;
      if (refocus) box.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
      if (!sameList || !before.size || reducedMotion()) return;
      const moved: HTMLElement[] = [];
      box.querySelectorAll<HTMLElement>('.nb-row[data-id]').forEach((r) => {
        const old = before.get(r.dataset.id!);
        if (!old) {
          r.classList.add('nb-enter');
          return;
        }
        const dy = old.top - r.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) {
          r.style.transition = 'none';
          r.style.transform = `translateY(${dy}px)`;
          moved.push(r);
        }
        if (Number(r.dataset.rank) < old.rank) r.classList.add('nb-up');
      });
      if (!moved.length) return;
      void box.offsetHeight; // commit the starting positions
      requestAnimationFrame(() => {
        for (const r of moved) {
          r.style.transition = 'transform 0.55s var(--ease)';
          r.style.transform = '';
          setTimeout(() => (r.style.transition = ''), 650);
        }
      });
    }

    const lastSeen = new Map<string, string>();
    /** A polite spoken summary when the topic in view gets a new live result. */
    function announce(): void {
      if (topic === 'all') return;
      const st = stateOf(topic);
      const d = st?.data;
      if (!d || !st.previous || d.status === 'empty' || lastSeen.get(boardKey(topic, d.board)) === d.generatedAt) return;
      lastSeen.set(boardKey(topic, d.board), d.generatedAt);
      const prev = new Set(st.previous.stories.map((s) => s.id));
      const fresh = d.stories.filter((s) => !prev.has(s.id)).length;
      const shifted = d.stories.some((s) => st.previous!.stories.find((p) => p.id === s.id && p.rank !== s.rank));
      const say = fresh ? `${fresh} new ${fresh === 1 ? 'story' : 'stories'}` : shifted ? 'rankings changed' : '';
      if (say) render($('[data-announce]'), html`${shortOf(topic)} board updated: ${say}`);
    }

    const paintAll = frame(() => {
      paintTabs();
      paintStatus();
      paintProgress();
      paintBody();
    });
    const paintData = frame(() => {
      paintTabs();
      paintStatus();
      paintProgress();
      paintBody(true);
      announce();
    });

    /* ── the explainer ── */
    function openHow(): void {
      const d = head();
      const sigs = d?.signals?.length ? d.signals : SIGNAL_INFO.map((s) => ({ ...s, ok: true }));
      const o = openOverlay({ kind: 'dialog', label: 'How ranking works', focus: '[data-close]' });
      o.panel.classList.add('nb-how');
      o.panel.innerHTML = html`<h2>How ranking works</h2>
        <p>Real click counts aren’t public, so stories are ranked by what is public: how many outlets ran the story, Hacker News and Reddit engagement, and Google search trends in the US, UK, India, Canada and Australia. The more signals a story shows up in, the hotter it is. Heat runs from 0 to 100 against the top story of its board.</p>
        <ul class="nb-signals">${raw(sigs.map((s) => html`<li class="${s.ok ? 'ok' : 'off'}"><span class="nb-sig-mark" aria-hidden="true">${s.ok ? '✓' : '✕'}</span><div><b>${s.label}</b><span class="sr-only">${s.ok ? ' (working now)' : ' (unavailable right now)'}</span><p>${s.about}</p></div></li>`).join(''))}</ul>
        <p class="faint">A signal marked ✕ could not be reached on the last update, and rankings fall back on the others.</p>
        <button type="button" class="btn btn-primary btn-sm" data-close>Got it</button>`;
    }

    /* ── latest headlines (plain feed) ── */
    function paintLatest(scrollTo = false): void {
      const box = $('#news-list');
      const btn = $('[data-act="latest"]');
      box.hidden = !latestOpen;
      btn.setAttribute('aria-expanded', String(latestOpen));
      if (latestOpen && !latestScope) {
        latestScope = new Scope();
        mountHeadlines(box, latestScope, { limit: 30, prefKey: 'news.cat', types: true, url: false });
      }
      if (!latestOpen && latestScope) {
        latestScope.dispose();
        latestScope = null;
        box.innerHTML = '';
      }
      if (latestOpen && scrollTo) box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }

    /* ── changing what is shown ── */
    function choose(next: { topic?: Topic; board?: UiBoard }): void {
      if (next.topic !== undefined) topic = next.topic;
      if (next.board !== undefined && next.board !== board) {
        board = next.board;
        picked = null;
      }
      setPref('nb.topic', topic);
      setPref('nb.board', board);
      nav();
      loadAll();
      paintAll();
    }

    scope.add(
      boards.subscribe(paintData),
      readIds.subscribe(paintAll),
      on(el, 'click', '[data-topic]', (_e, t) => {
        const next = t.dataset.topic === 'all' ? 'all' : topicFrom(t.dataset.topic);
        if (!next) return;
        const fromCard = !t.closest('[data-tabs]');
        choose({ topic: next });
        if (fromCard) window.scrollTo({ top: 0 });
      }),
      on(el, 'click', '[data-board]', (_e, t) => choose({ board: t.dataset.board as UiBoard })),
      on(el, 'change', '[data-days]', (_e, t) => {
        picked = (t as HTMLSelectElement).value || null;
        loadAll();
        paintAll();
      }),
      on(el, 'click', '[data-act="expand"]', (_e, t) => {
        const id = t.dataset.id!;
        if (!expanded.delete(id)) expanded.add(id);
        paintBody();
      }),
      on(el, 'click', '[data-act="read"]', (_e, t) => markRead(t.dataset.id!, t.getAttribute('aria-pressed') !== 'true')),
      on(el, 'click', '[data-open]', (_e, t) => markRead(t.dataset.open!)),
      on(el, 'auxclick', '[data-open]', (_e, t) => markRead(t.dataset.open!)),
      on(el, 'click', '[data-act="how"]', openHow),
      on(el, 'click', '[data-act="retry"]', () => {
        loadAll(true);
        paintAll();
      }),
      on(el, 'click', '[data-act="latest"]', () => {
        latestOpen = !latestOpen;
        const u = new URL(location.href);
        if (latestOpen) u.searchParams.set('view', 'latest');
        else u.searchParams.delete('view');
        history.replaceState(history.state, '', u);
        paintLatest(true);
      }),
      () => latestScope?.dispose(),
    );

    // Live boards refresh every five minutes while the page is visible; the others when their next update is due.
    const poller = poll(() => {
      const s = spec();
      for (const t of visibleTopics()) {
        if (!isFresh(boardState(t, s.board, s.date))) void loadBoard(t, s.board, s.date);
      }
      if (board === 'yesterday') void loadBoard(daysTopic(), 'day', yesterdayEt());
    }, 60_000, 60_000);
    scope.add(() => poller.stop());
    // Keeps "Updated 3 min ago" and the countdown ticking.
    scope.interval(() => {
      paintStatus();
    }, 30_000);

    nav();
    paintLatest(first.latest);
    loadAll();
    paintAll();
    return () => scope.dispose();
  },
};
