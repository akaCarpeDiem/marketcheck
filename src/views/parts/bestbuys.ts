/**
 * "Yesterday's best buys": the five biggest gainers of the last complete day, from
 * every US stock and every coin over the size floor, across everything or per group (crypto,
 * stocks), with what $1,000 bought at the start of the day became, and a chart of how
 * the five got there.
 * Data: /api/yesterday (rules in functions/_shared/bestBuys.ts).
 */
import { animate, stagger, svg } from 'animejs';
import { scaleLinear } from 'd3-scale';
import { line, curveMonotoneX } from 'd3-shape';
import type { BestGroup, BestRow } from '../../../functions/_shared/bestBuys';
import { avatar, refFromCoin, refFromYahoo, stockLogo, type AssetRef } from '../../data/assets';
import { crypto } from '../../data/market';
import { pref, setPref } from '../../data/user';
import { getJson } from '../../lib/api';
import { esc, on, reducedMotion, render } from '../../lib/dom';
import { compact, money, pct } from '../../lib/format';
import { icon } from '../../lib/icons';
import { seriesColour } from '../../lib/palette';
import type { Scope } from '../../lib/store';
import { openAsset } from '../../ui/drawer';

type Tab = 'all' | 'crypto' | 'stocks';
type Answer = {
  ok: boolean;
  crypto?: BestGroup;
  stocks?: BestGroup;
  minCap?: number;
  minCapStock?: number;
  minCapCrypto?: number;
  minTraded?: number;
  /** A list is still to be worked out: ask again in a minute. */
  retrySoon?: boolean;
};

const TABS: [Tab, string][] = [
  ['all', 'All'],
  ['crypto', 'Crypto'],
  ['stocks', 'Stocks'],
];
const SHOW = 5;
const STAKE = 1000;

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayLabel = (key: string): string => dayFmt.format(new Date(`${key}T12:00:00Z`));

function refOf(r: BestRow): AssetRef {
  if (r.kind === 'stock') return refFromYahoo(r.yahoo ?? r.sym, r.sym, r.name, 'stock');
  const cg = r.cg ?? (r.paprika ? resolved.get(r.paprika) : undefined);
  if (cg) {
    const coin = crypto.get().byId.get(cg);
    return coin ? refFromCoin(coin) : { key: `c:${cg}`, sym: r.sym, name: r.name, kind: 'crypto', cg };
  }
  if (r.yahoo) return refFromYahoo(r.yahoo, r.sym, r.name, 'crypto');
  return { key: `p:${r.paprika ?? r.sym}`, sym: r.sym, name: r.name, kind: 'crypto' };
}

/** CoinGecko ids found for smaller coins (by CoinPaprika id), so their panel can open. */
const resolved = new Map<string, string>();

/** Find a coin the site does not list on CoinGecko by its ticker and name. */
async function resolveCoin(r: BestRow): Promise<string | null> {
  if (!r.paprika) return null;
  const known = resolved.get(r.paprika);
  if (known) return known;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(r.sym)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { coins?: { id: string; name: string; symbol: string; market_cap_rank: number | null }[] };
    const same = (j.coins ?? []).filter((c) => c.symbol.toUpperCase() === r.sym.toUpperCase());
    const pick = same.find((c) => c.name.toLowerCase() === r.name.toLowerCase()) ?? same.sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0];
    if (!pick) return null;
    resolved.set(r.paprika, pick.id);
    return pick.id;
  } catch {
    return null;
  }
}

async function open(r: BestRow): Promise<void> {
  if (r.kind === 'crypto' && !r.cg && !r.yahoo && r.paprika && !resolved.has(r.paprika)) {
    if (!(await resolveCoin(r))) {
      window.open(`https://coinpaprika.com/coin/${encodeURIComponent(r.paprika)}/`, '_blank', 'noopener');
      return;
    }
  }
  openAsset(refOf(r));
}

function rowsFor(a: Answer, tab: Tab): BestRow[] {
  const c = a.crypto?.items ?? [];
  const s = a.stocks?.items ?? [];
  const pool = tab === 'crypto' ? c : tab === 'stocks' ? s : [...c, ...s];
  return pool
    .slice()
    .sort((x, y) => y.change - x.change)
    .slice(0, SHOW);
}

function rowHtml(r: BestRow, i: number, max: number): string {
  const ref = refOf(r);
  const image = r.image ?? (r.kind === 'stock' ? stockLogo(r.yahoo ?? r.sym) : null);
  const worth = STAKE * (r.to / r.from);
  const since = r.now != null && r.to > 0 ? (r.now / r.to - 1) * 100 : null;
  const width = max > 0 ? Math.max(4, (r.change / max) * 100) : 0;
  const colour = seriesColour(i);
  return `<li class="bb-row" data-i="${i}" data-asset="${esc(ref.key)}" tabindex="0" role="button" aria-label="${esc(`${r.name}: ${pct(r.change)}`)}" style="--c:${colour}">
    <span class="bb-rank num">${i + 1}</span>
    ${avatar(ref, image, 30)}
    <span class="bb-name"><b>${esc(r.sym)}</b><em>${esc(r.name)} · ${r.kind === 'crypto' ? 'Crypto' : 'Stock'} · ${compact(r.marketCap)}</em></span>
    <span class="bb-bar" aria-hidden="true"><i style="--w:${width.toFixed(1)}%"></i></span>
    <span class="bb-chg num up" data-count="${r.change}">${pct(r.change)}</span>
    <span class="bb-k num"><small>$1,000 →</small> <b data-money="${worth}">${money(worth)}</b></span>
    <span class="bb-since num ${since == null ? '' : since >= 0 ? 'up' : 'down'}">${since == null ? '' : `${pct(since, 1)} since`}</span>
  </li>`;
}

const dollars = (n: number): string => (n >= 1e6 ? `$${+(n / 1e6).toFixed(1)} million` : n >= 1e3 ? `$${+(n / 1e3).toFixed(0)}K` : `$${n}`);

function emptyText(a: Answer, tab: Tab): string {
  const c = a.crypto;
  const s = a.stocks;
  if (tab === 'stocks' || (tab === 'all' && !c?.items.length)) {
    if (s?.pending && !s.items.length) return 'The full-market list for the last session is not in yet. It is checked again every 20 minutes.';
  }
  if ((tab === 'crypto' || tab === 'all') && c?.pending && !c.items.length)
    return a.retrySoon ? 'Yesterday’s coin figures are being worked out. This takes a few minutes.' : 'Yesterday’s coin figures are not in yet. They are checked again every 20 minutes.';
  return 'This list is not in yet. It is checked again every 20 minutes.';
}

/** Every line is rebased to the close before the day, so they all meet there and fan out over it. */
function trailChart(rows: BestRow[], w: number, h: number): string {
  if (!rows.length) return '';
  const pad = { l: 8, r: 52, t: 14, b: 22 };
  const len = Math.max(...rows.map((r) => r.trail.length));
  const series = rows.map((r) => {
    const base = r.from;
    // Pad shorter trails on the left so every line ends on the same day.
    const lead = len - r.trail.length;
    return r.trail.map((v, k) => ({ x: k + lead, y: (v / base - 1) * 100 }));
  });
  let lo = 0;
  let hi = 0;
  for (const s of series) for (const p of s) (lo = Math.min(lo, p.y)), (hi = Math.max(hi, p.y));
  // The day itself gets a third of the width: it is the part that matters, the days before are context.
  const split = pad.l + (w - pad.l - pad.r) * 0.66;
  const x = len > 2 ? scaleLinear().domain([0, len - 2, len - 1]).range([pad.l, split, w - pad.r]) : scaleLinear().domain([0, len - 1]).range([pad.l, w - pad.r]);
  const y = scaleLinear().domain([lo, hi]).nice(4).range([h - pad.b, pad.t]);
  const path = line<{ x: number; y: number }>()
    .x((p) => x(p.x))
    .y((p) => y(p.y))
    .curve(curveMonotoneX);
  const grid = y
    .ticks(4)
    .map((t) => `<g class="bb-tick"><line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"${t === 0 ? ' class="zero"' : ''}/><text x="${w - pad.r + 6}" y="${y(t)}" dy="0.32em">${t > 0 ? '+' : ''}${t}%</text></g>`)
    .join('');
  const dayX0 = x(len - 2);
  const dayX1 = x(len - 1);
  const band = `<rect class="bb-day" x="${dayX0}" y="${pad.t - 6}" width="${dayX1 - dayX0}" height="${h - pad.b - pad.t + 6}" rx="6"/><text class="bb-day-label" x="${(dayX0 + dayX1) / 2}" y="${h - 6}" text-anchor="middle">The day</text><text class="bb-day-label" x="${pad.l}" y="${h - 6}">${len - 1} days before</text>`;
  const lines = series
    .map((s, i) => {
      const last = s[s.length - 1]!;
      return `<g class="bb-line" data-i="${i}" style="--c:${seriesColour(i)}"><path d="${path(s) ?? ''}"/><circle cx="${x(last.x)}" cy="${y(last.y)}" r="4"/></g>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Price over the ${len} days up to the day, each rebased to the close before it">${band}${grid}${lines}</svg>`;
}

export function mountBestBuys(el: HTMLElement, scope: Scope): void {
  let tab = pref('ov.best', 'all') as Tab;
  if (!TABS.some(([t]) => t === tab)) tab = 'all';
  let answer: Answer | null = null;
  let failed = false;

  el.innerHTML = `<div class="card-head">
      <h2 class="card-title"><span class="ico">${icon.trophy(16)}</span>Yesterday’s best buys</h2>
      <span class="card-sub">The whole market’s biggest gainers, if bought at the start of the day</span>
      <div class="card-tools"><div class="seg" role="group" aria-label="Show" data-tabs></div></div>
    </div>
    <div class="bb-body">
      <ol class="bb-list" data-list></ol>
      <figure class="bb-chart" data-chart><figcaption>How they got there <span class="faint">· rebased to the close before the day</span></figcaption><div data-svg></div></figure>
    </div>
    <div class="card-foot"><span data-note></span><span>Hindsight, not a tip.</span></div>`;

  const tabsEl = el.querySelector<HTMLElement>('[data-tabs]')!;
  const listEl = el.querySelector<HTMLElement>('[data-list]')!;
  const svgEl = el.querySelector<HTMLElement>('[data-svg]')!;
  const noteEl = el.querySelector<HTMLElement>('[data-note]')!;

  const paintTabs = () =>
    render(
      tabsEl,
      TABS.map(([t, label]) => `<button type="button" class="seg-btn${t === tab ? ' is-on' : ''}" data-tab="${t}" aria-pressed="${t === tab}">${label}</button>`).join(''),
    );

  function paintChart(rows: BestRow[]): void {
    const w = Math.max(260, Math.floor(svgEl.getBoundingClientRect().width) || 420);
    svgEl.innerHTML = trailChart(rows, w, 200);
  }

  function intro(): void {
    if (reducedMotion()) return;
    animate(listEl.querySelectorAll('.bb-row'), {
      opacity: [0, 1],
      x: [-14, 0],
      delay: stagger(70),
      duration: 520,
      ease: 'out(3)',
    });
    animate(listEl.querySelectorAll('.bb-bar i'), {
      scaleX: [0, 1],
      delay: stagger(70, { start: 120 }),
      duration: 900,
      ease: 'out(4)',
    });
    // Count the numbers up with the bars.
    listEl.querySelectorAll<HTMLElement>('[data-count]').forEach((n, i) => {
      const target = Number(n.dataset.count);
      const box = { v: 0 };
      animate(box, { v: target, delay: 120 + i * 70, duration: 900, ease: 'out(4)', onUpdate: () => (n.textContent = pct(box.v)) });
    });
    listEl.querySelectorAll<HTMLElement>('[data-money]').forEach((n, i) => {
      const target = Number(n.dataset.money);
      const box = { v: STAKE };
      animate(box, { v: target, delay: 120 + i * 70, duration: 900, ease: 'out(4)', onUpdate: () => (n.textContent = money(box.v)) });
    });
    const paths = svgEl.querySelectorAll<SVGPathElement>('.bb-line path');
    if (paths.length) {
      animate(svg.createDrawable(paths), { draw: ['0 0', '0 1'], delay: stagger(90), duration: 1100, ease: 'inOut(2)' });
      animate(svgEl.querySelectorAll('.bb-line circle'), { scale: [0, 1], opacity: [0, 1], delay: stagger(90, { start: 900 }), duration: 400, ease: 'out(3)' });
    }
  }

  function paint(animateIn: boolean): void {
    paintTabs();
    if (!answer) {
      noteEl.textContent = failed ? 'Yesterday’s figures are not available right now.' : 'Loading yesterday’s figures…';
      if (!listEl.childElementCount)
        listEl.innerHTML = Array.from({ length: SHOW }, () => `<li class="bb-row is-loading"><span class="sk">0</span><span class="sk">Asset name here</span><span class="sk">+0.00%</span></li>`).join('');
      return;
    }
    const rows = rowsFor(answer, tab);
    const max = rows[0]?.change ?? 0;
    listEl.innerHTML = rows.length ? rows.map((r, i) => rowHtml(r, i, max)).join('') : `<li class="bb-empty">${esc(emptyText(answer, tab))}</li>`;
    paintChart(rows);
    const parts: string[] = [];
    const c = answer.crypto;
    const s = answer.stocks;
    if (tab !== 'stocks' && c?.items.length)
      parts.push(`Crypto: ${dayLabel(c.day)} (UTC)${c.pending ? ' (the latest saved; yesterday’s is on its way)' : ''}, ${c.checked.toLocaleString('en-US')} coins compared`);
    if (tab !== 'crypto' && s?.items.length)
      parts.push(`Stocks: ${dayLabel(s.day)} session${s.pending ? ' (the latest available; the newest is on its way)' : ''}, ${s.checked.toLocaleString('en-US')} US stocks compared`);
    const capS = answer.minCapStock ?? answer.minCap ?? 5e7;
    const capC = answer.minCapCrypto ?? answer.minCap ?? 2.5e7;
    const cap = tab === 'stocks' ? `market cap over ${dollars(capS)}` : tab === 'crypto' ? `market cap over ${dollars(capC)}` : `market cap over ${dollars(capS)} (stocks) or ${dollars(capC)} (crypto)`;
    parts.push(`${cap}, ${dollars(answer.minTraded ?? 1e5)}+ traded`);
    noteEl.textContent = parts.join(' · ');
    if (animateIn) intro();
  }

  let retry = 0;
  async function load(): Promise<void> {
    clearTimeout(retry);
    try {
      const a = await getJson<Answer>('/api/yesterday', { timeout: 30_000 });
      if (!a.ok) throw new Error('not ok');
      const first = !answer;
      const key = (x: Answer | null) => JSON.stringify([x?.crypto?.day, x?.stocks?.day, x?.crypto?.items[0]?.sym, x?.stocks?.items[0]?.sym]);
      const changed = key(a) !== key(answer);
      answer = a;
      failed = false;
      if (first || changed) paint(true);
      // A list still being worked out (the first visit after the close does it): look again shortly.
      if (a.retrySoon) retry = window.setTimeout(() => void load(), 75_000);
    } catch {
      failed = true;
      if (!answer) paint(false);
    }
  }

  // Highlight a row's line in the chart, and the row when its line is hovered.
  const focus = (i: number | null) => {
    el.classList.toggle('bb-focus', i != null);
    el.querySelectorAll<HTMLElement | SVGElement>('[data-i]').forEach((n) => n.classList.toggle('is-hot', i != null && n.getAttribute('data-i') === String(i)));
  };
  const over = (ev: Event) => {
    const hit = (ev.target as Element).closest('[data-i]');
    focus(hit ? Number(hit.getAttribute('data-i')) : null);
  };
  el.addEventListener('pointerover', over);
  el.addEventListener('focusin', over);
  el.addEventListener('pointerleave', () => focus(null));

  scope.add(
    on(el, 'click', '[data-tab]', (_ev, t) => {
      const next = t.dataset.tab as Tab;
      if (next === tab) return;
      tab = next;
      setPref('ov.best', tab);
      paint(true);
    }),
    on(el, 'click', '.bb-row[data-asset]', (_ev, row) => {
      const rows = answer ? rowsFor(answer, tab) : [];
      const r = rows[Number(row.dataset.i)];
      if (r) void open(r);
    }),
    on(el, 'keydown', '.bb-row[data-asset]', (ev, row) => {
      if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') {
        ev.preventDefault();
        row.click();
      }
    }),
  );

  // The chart is drawn to its width; redraw it (without the intro) when that changes.
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.floor(svgEl.getBoundingClientRect().width);
    if (!answer || Math.abs(w - lastW) < 8) return;
    lastW = w;
    paintChart(rowsFor(answer, tab));
    focus(null);
  });
  ro.observe(svgEl);
  // Once the day rolls over the answer changes; look again every 20 minutes.
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, 20 * 60_000);
  scope.add(() => {
    ro.disconnect();
    clearInterval(timer);
    clearTimeout(retry);
  });

  paint(false);
  void load();
}
