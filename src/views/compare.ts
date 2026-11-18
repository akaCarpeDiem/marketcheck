/**
 * Compare: up to five stocks, funds, coins, indexes or commodities side by side.
 * - One chart of percent change from the start of the range (lines up assets that trade on different days).
 * - A table of return, volatility, worst drop, best and worst day, and share of up days.
 * - How they move together: a correlation grid of daily returns.
 * - How deep each fell from its high along the way (an "underwater" chart).
 * The choice lives in the address (?s=AAPL,c:bitcoin,GC%3DF&r=1Y), so any comparison can be shared.
 */
import { scaleLinear, scaleTime } from 'd3-scale';
import { area, line } from 'd3-shape';
import { avatar, KIND_LABEL, lookup, priceText, refFromYahoo, stockLogo, type AssetRef } from '../data/assets';
import { DAILY_RANGES, dailyHistory, rangeStart, type Bar, type DailyRange } from '../data/history';
import { crypto, equities } from '../data/market';
import { cssVar, theme } from '../data/theme';
import { esc, on, render } from '../lib/dom';
import { pct } from '../lib/format';
import { icon } from '../lib/icons';
import { seriesColour } from '../lib/palette';
import { correlation, maxDrawdown, pairedDailyReturns, returns, volatility } from '../lib/stats';
import { Scope } from '../lib/store';
import { setQuery, type View } from '../router';
import { createChart, type Chart } from '../ui/chart';
import { assetQuery, openAsset, refFromQuery } from '../ui/drawer';
import { openSearch } from '../ui/search';
import { toast } from '../ui/toast';

const MAX = 5;

const PRESETS: { label: string; syms: string[] }[] = [
  { label: 'Stocks vs bitcoin vs gold', syms: ['^GSPC', 'c:bitcoin', 'GC=F'] },
  { label: 'Big Tech', syms: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'] },
  { label: 'Crypto majors', syms: ['c:bitcoin', 'c:ethereum', 'c:solana', 'c:ripple'] },
  { label: 'Index race', syms: ['^GSPC', '^IXIC', '^DJI', '^RUT'] },
  { label: 'Metals and oil', syms: ['GC=F', 'SI=F', 'HG=F', 'CL=F'] },
  { label: 'Bonds vs stocks', syms: ['SPY', 'TLT', 'GLD'] },
];

/** Friendly names for the indexes and futures the presets use (the feeds only name stocks and coins). */
const KNOWN: Record<string, [string, string]> = {
  '^GSPC': ['S&P 500', 'S&P 500 index'],
  '^IXIC': ['Nasdaq', 'Nasdaq Composite'],
  '^DJI': ['Dow', 'Dow Jones Industrial Average'],
  '^RUT': ['Russell 2000', 'Russell 2000 small caps'],
  'GC=F': ['Gold', 'Gold futures'],
  'SI=F': ['Silver', 'Silver futures'],
  'HG=F': ['Copper', 'Copper futures'],
  'CL=F': ['Oil', 'WTI crude oil futures'],
};

function refFor(q: string): AssetRef {
  const known = KNOWN[q.toUpperCase()];
  if (known) return refFromYahoo(q.toUpperCase(), known[0], known[1]);
  return refFromQuery(q) ?? refFromYahoo(q);
}

type Result = { bars: Bar[]; source: string } | null;

type Stats = {
  ret: number | null;
  vol: number | null;
  dd: { pct: number; from: number; to: number } | null;
  best: number | null;
  worst: number | null;
  upShare: number | null;
};

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const tipTime = (ms: number): string => dayFmt.format(ms);
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const yearFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric' });
const shortDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function periodsPerYear(ref: AssetRef, range: DailyRange): number {
  if (range === '5Y') return 52;
  return ref.kind === 'crypto' ? 365 : 252;
}

function statsFor(ref: AssetRef, bars: Bar[], range: DailyRange): Stats {
  const from = rangeStart(range);
  const shown = bars.filter((b) => b.t >= from);
  const use = shown.length >= 2 ? shown : bars;
  const closes = use.map((b) => b.v);
  const rets = returns(closes);
  const dd = maxDrawdown(closes);
  return {
    ret: closes.length >= 2 ? (closes[closes.length - 1]! / closes[0]! - 1) * 100 : null,
    vol: volatility(rets, periodsPerYear(ref, range)),
    dd: dd.pct < 0 ? { pct: dd.pct, from: use[dd.peak]!.t, to: use[dd.trough]!.t } : null,
    best: rets.length ? Math.max(...rets) * 100 : null,
    worst: rets.length ? Math.min(...rets) * 100 : null,
    upShare: rets.length ? (rets.filter((r) => r > 0).length / rets.length) * 100 : null,
  };
}

/** A small bar in a table cell, centred on zero. */
function cellBar(v: number | null, max: number): string {
  if (v == null || !max) return '';
  const w = Math.min(50, (Math.abs(v) / max) * 50);
  return `<span class="cmp-bar" aria-hidden="true"><i class="${v >= 0 ? 'up' : 'down'}" style="${v >= 0 ? `left:50%` : `right:50%`};width:${w.toFixed(1)}%"></i></span>`;
}

export const compareView: View = {
  mount(el) {
    const scope = new Scope();
    const url = new URL(location.href);
    let range: DailyRange = (DAILY_RANGES as string[]).includes(url.searchParams.get('r') ?? '') ? (url.searchParams.get('r') as DailyRange) : '1Y';
    let wanted = (url.searchParams.get('s') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX);
    if (!wanted.length) wanted = PRESETS[0]!.syms.slice();
    let refs: AssetRef[] = [];
    const results = new Map<string, Result>();
    let token = 0;
    let loading = false;

    el.innerHTML = `<div class="page-head">
        <div><h1>Compare</h1><p>Put up to five stocks, funds, coins, indexes or commodities side by side: how far each moved, how bumpy the ride was, and whether they move together.</p></div>
        <div class="page-tools">
          <button type="button" class="btn btn-outline" data-cmp="share">${icon.link(15)} Copy link</button>
        </div>
      </div>
      <div class="card cmp-pick">
        <div class="cmp-chips" data-chips></div>
        <div class="cmp-presets"><span class="faint">Try</span><div class="seg seg-scroll" data-presets></div></div>
      </div>
      <div class="card cmp-main">
        <div class="card-head">
          <h2 class="card-title">Performance <span class="card-sub">percent change from the start of the range</span></h2>
          <div class="card-tools"><div class="seg" role="group" aria-label="Range" data-ranges></div></div>
        </div>
        <div class="cmp-chart" data-chart></div>
        <p class="chart-hint faint">Hover to read every line on one day. Press and drag to measure the first asset between two dates.</p>
      </div>
      <div class="cmp-grid">
        <div class="card cmp-stats">
          <div class="card-head"><h2 class="card-title">Scorecard <span class="card-sub" data-period></span></h2></div>
          <div class="table-wrap" data-stats></div>
        </div>
        <div class="card cmp-corr">
          <div class="card-head"><h2 class="card-title">Do they move together? <span class="card-sub">correlation of daily moves</span></h2></div>
          <div class="cmp-corr-body" data-corr></div>
        </div>
      </div>
      <div class="card cmp-under">
        <div class="card-head"><h2 class="card-title">Below the high <span class="card-sub">how far each was under its best price so far in the range</span></h2></div>
        <div class="cmp-under-chart" data-under></div>
      </div>`;

    const $ = (sel: string) => el.querySelector<HTMLElement>(sel)!;
    const chart: Chart = createChart($('[data-chart]'));
    scope.add(() => chart.destroy());

    const resolve = () => {
      refs = wanted.map(refFor).filter((r, i, all) => all.findIndex((x) => x.key === r.key) === i);
    };

    function writeUrl(): void {
      setQuery({ s: refs.map(assetQuery).join(','), r: range }, { replace: true });
    }

    function paintPicker(): void {
      const chips = refs
        .map((ref, i) => {
          const p = lookup(ref);
          const res = results.get(ref.key);
          const failed = res === null && !loading;
          return `<span class="cmp-chip${failed ? ' is-failed' : ''}" style="--c:${seriesColour(i)}" title="${esc(failed ? `No history for ${ref.name}` : ref.name)}">
            <i class="cmp-dot"></i>${avatar(ref, p.image ?? ((ref.kind === 'stock' || ref.kind === 'etf') && ref.yahoo ? stockLogo(ref.yahoo) : null), 22)}<button type="button" class="cmp-chip-name" data-open="${i}"><b>${esc(ref.sym)}</b><span>${esc(ref.name)}</span></button>
            <button type="button" class="cmp-chip-x" data-remove="${i}" aria-label="Remove ${esc(ref.name)}">${icon.close(13)}</button>
          </span>`;
        })
        .join('');
      const add = refs.length < MAX ? `<button type="button" class="cmp-add" data-cmp="add">${icon.plus(15)} Add${refs.length ? '' : ' an asset'}</button>` : `<span class="faint cmp-full">Five is the most at once</span>`;
      render($('[data-chips]'), chips + add);
      const current = refs.map(assetQuery).join(',');
      render(
        $('[data-presets]'),
        PRESETS.map((p, i) => `<button type="button" class="seg-btn${p.syms.join(',') === current ? ' is-on' : ''}" data-preset="${i}">${esc(p.label)}</button>`).join(''),
      );
      render(
        $('[data-ranges]'),
        DAILY_RANGES.map((r) => `<button type="button" class="seg-btn${r === range ? ' is-on' : ''}" data-range="${r}" aria-pressed="${r === range}">${r}</button>`).join(''),
      );
    }

    async function load(): Promise<void> {
      const t = (token += 1);
      loading = true;
      $('[data-chart]').classList.add('is-loading');
      paintPicker();
      const out = await Promise.all(refs.map((r) => dailyHistory(r, range).catch(() => null)));
      if (t !== token) return;
      loading = false;
      results.clear();
      refs.forEach((r, i) => results.set(r.key, out[i] ?? null));
      $('[data-chart]').classList.remove('is-loading');
      paintAll();
    }

    /** Bars inside the range, for the stats and the drawdown chart. */
    const inRange = (bars: Bar[]) => {
      const from = rangeStart(range);
      const shown = bars.filter((b) => b.t >= from);
      return shown.length >= 2 ? shown : bars;
    };

    function paintChart(): void {
      const ready = refs.map((r, i) => ({ r, i, res: results.get(r.key) })).filter((x) => x.res && x.res.bars.length > 1);
      if (!ready.length) {
        chart.clear(refs.length ? 'No price history is available for these right now.' : 'Add something to compare.');
        return;
      }
      const [main, ...rest] = ready;
      const bars = inRange(main!.res!.bars);
      if (rest.length) {
        chart.set(bars, {
          formatValue: (v) => priceText(main!.r, v),
          formatTime: tipTime,
          label: main!.r.sym,
          colour: seriesColour(main!.i),
          compare: rest.map((x) => ({ label: x.r.sym, colour: seriesColour(x.i), points: inRange(x.res!.bars) })),
        });
      } else {
        // One asset alone: its price, with the start of the range as the reference line.
        chart.set(bars, { formatValue: (v) => priceText(main!.r, v), formatTime: tipTime, baseline: bars[0]!.v });
      }
    }

    function paintStats(): void {
      const rows = refs.map((r, i) => {
        const res = results.get(r.key);
        return { r, i, s: res && res.bars.length > 1 ? statsFor(r, res.bars, range) : null };
      });
      const maxRet = Math.max(0, ...rows.map((x) => Math.abs(x.s?.ret ?? 0)));
      const unit = range === '5Y' ? 'week' : 'day';
      render($('[data-period]'), `over ${range === 'YTD' ? 'the year so far' : range}`);
      const cell = (v: number | null, d = 1) => `<td class="r num ${v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v == null ? '—' : pct(v, d)}</td>`;
      render(
        $('[data-stats]'),
        `<table class="table cmp-table">
          <thead><tr><th>Asset</th><th class="r">Return</th><th class="r" title="How much prices swing, scaled to a year. Higher means a bumpier ride.">Volatility</th><th class="r" title="The deepest fall from a high to a later low within the range">Worst drop</th><th class="r col-mid">Best ${unit}</th><th class="r col-mid">Worst ${unit}</th><th class="r col-wide" title="Share of ${unit}s that closed higher">Up ${unit}s</th></tr></thead>
          <tbody>${rows
            .map(
              ({ r, i, s }) => `<tr data-row="${i}" tabindex="0" role="button" style="--c:${seriesColour(i)}">
              <td><div class="cell-asset"><i class="cmp-dot"></i><div class="cell-stack"><strong>${esc(r.sym)}</strong><span class="cell-name">${esc(KIND_LABEL[r.kind])}</span></div></div></td>
              <td class="r num cmp-ret ${s?.ret == null ? '' : s.ret >= 0 ? 'up' : 'down'}">${s?.ret == null ? '—' : pct(s.ret, 1)}${cellBar(s?.ret ?? null, maxRet)}</td>
              <td class="r num">${s?.vol == null ? '—' : `${s.vol.toFixed(0)}%`}</td>
              <td class="r num down" title="${s?.dd ? esc(`${shortDay.format(s.dd.from)} → ${shortDay.format(s.dd.to)}`) : ''}">${s?.dd ? pct(s.dd.pct, 1) : '—'}</td>
              ${cell(s?.best ?? null).replace('<td class="r', '<td class="r col-mid')}
              ${cell(s?.worst ?? null).replace('<td class="r', '<td class="r col-mid')}
              <td class="r num col-wide">${s?.upShare == null ? '—' : `${s.upShare.toFixed(0)}%`}</td>
            </tr>`,
            )
            .join('')}</tbody>
        </table>`,
      );
    }

    function paintCorrelation(): void {
      const box = $('[data-corr]');
      const ready = refs.map((r, i) => ({ r, i, res: results.get(r.key) })).filter((x) => x.res && x.res.bars.length > 5);
      if (ready.length < 2) {
        render(box, `<p class="faint cmp-empty">Add a second asset to see how they move together.</p>`);
        return;
      }
      const n = ready.length;
      const neg = cssVar('--down');
      const mid = cssVar('--card-3');
      const pos = cssVar('--brand');
      const colour = scaleLinear<string>().domain([-1, 0, 1]).range([neg, mid, pos]).clamp(true);
      const size = Math.min(64, Math.floor(Math.max(220, box.getBoundingClientRect().width - 70) / n));
      const lab = 56;
      const w = lab + n * size;
      const h = 22 + n * size;
      let cells = '';
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          const [ra, rb] = pairedDailyReturns(inRange(ready[a]!.res!.bars), inRange(ready[b]!.res!.bars));
          const c = a === b ? 1 : correlation(ra, rb);
          const fill = c == null ? mid : colour(c);
          const x = lab + b * size;
          const y = 22 + a * size;
          const strong = c != null && Math.abs(c) > 0.55;
          cells += `<g class="corr-cell" data-a="${a}" data-b="${b}"><rect x="${x + 1.5}" y="${y + 1.5}" width="${size - 3}" height="${size - 3}" rx="7" fill="${fill}"/><text x="${x + size / 2}" y="${y + size / 2}" dy="0.35em" text-anchor="middle" class="${strong ? 'on' : ''}">${c == null ? '—' : c.toFixed(2)}</text><title>${esc(`${ready[a]!.r.sym} and ${ready[b]!.r.sym}: ${c == null ? 'not enough shared days' : c.toFixed(2)}`)}</title></g>`;
        }
      }
      const heads = ready
        .map((x, k) => `<text x="${lab + k * size + size / 2}" y="12" text-anchor="middle" style="fill:${seriesColour(x.i)}">${esc(x.r.sym)}</text><text x="${lab - 8}" y="${22 + k * size + size / 2}" dy="0.35em" text-anchor="end" style="fill:${seriesColour(x.i)}">${esc(x.r.sym)}</text>`)
        .join('');
      render(
        box,
        `<svg class="corr" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Correlation of daily moves">${heads}${cells}</svg>
        <div class="corr-key"><span>−1 opposite</span><i style="background:linear-gradient(90deg, ${neg}, ${mid}, ${pos})"></i><span>+1 together</span></div>
        <p class="faint corr-note">Worked out from the days both traded. Near 1, they rise and fall on the same days; near 0, one tells you little about the other. That can change quickly in a crisis.</p>`,
      );
    }

    function paintUnderwater(): void {
      const box = $('[data-under]');
      const ready = refs.map((r, i) => ({ r, i, res: results.get(r.key) })).filter((x) => x.res && x.res.bars.length > 1);
      if (!ready.length) {
        render(box, '');
        return;
      }
      const series = ready.map((x) => {
        let peak = -Infinity;
        return {
          i: x.i,
          sym: x.r.sym,
          pts: inRange(x.res!.bars).map((b) => {
            peak = Math.max(peak, b.v);
            return { t: b.t, v: (b.v / peak - 1) * 100 };
          }),
        };
      });
      const w = Math.max(300, Math.floor(box.getBoundingClientRect().width));
      const h = 210;
      const pad = { l: 8, r: 52, t: 10, b: 24 };
      const t0 = Math.min(...series.map((s) => s.pts[0]!.t));
      const t1 = Math.max(...series.map((s) => s.pts[s.pts.length - 1]!.t));
      const lo = Math.min(-1, ...series.flatMap((s) => s.pts.map((p) => p.v)));
      const x = scaleTime().domain([new Date(t0), new Date(t1)]).range([pad.l, w - pad.r]);
      const y = scaleLinear().domain([lo, 0]).nice(4).range([h - pad.b, pad.t]);
      const ln = line<{ t: number; v: number }>()
        .x((p) => x(new Date(p.t)))
        .y((p) => y(p.v));
      const ar = area<{ t: number; v: number }>()
        .x((p) => x(new Date(p.t)))
        .y0(y(0))
        .y1((p) => y(p.v));
      const grid = y
        .ticks(4)
        .map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${w - pad.r + 6}" y="${y(v)}" dy="0.32em">${v === 0 ? 'High' : `${v}%`}</text>`)
        .join('');
      const span = t1 - t0;
      const xt = x
        .ticks(w < 520 ? 4 : 7)
        .map((d) => {
          const lbl = d.getMonth() === 0 && d.getDate() === 1 ? yearFmt.format(d) : span > 400 * 86_400_000 ? yearFmt.format(d) : d.getDate() === 1 ? monthFmt.format(d) : shortDay.format(d);
          return `<text x="${x(d)}" y="${h - 6}" text-anchor="middle">${lbl}</text>`;
        })
        .join('');
      const paths = series
        .map((s) => `<g style="--c:${seriesColour(s.i)}" class="uw-line"><path class="uw-area" d="${ar(s.pts) ?? ''}"/><path class="uw-stroke" d="${ln(s.pts) ?? ''}"/></g>`)
        .join('');
      render(box, `<svg class="uw" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Distance below each asset's high"><g class="uw-grid">${grid}${xt}</g>${paths}</svg>`);
    }

    function paintAll(): void {
      paintPicker();
      paintChart();
      paintStats();
      paintCorrelation();
      paintUnderwater();
    }

    function setRefs(next: string[]): void {
      wanted = next.slice(0, MAX);
      resolve();
      writeUrl();
      void load();
    }

    scope.add(
      on(el, 'click', '[data-range]', (_e, b) => {
        range = b.dataset.range as DailyRange;
        writeUrl();
        void load();
      }),
      on(el, 'click', '[data-preset]', (_e, b) => setRefs(PRESETS[Number(b.dataset.preset)]!.syms)),
      on(el, 'click', '[data-remove]', (_e, b) => setRefs(refs.filter((_, i) => i !== Number(b.dataset.remove)).map(assetQuery))),
      on(el, 'click', '[data-open]', (_e, b) => {
        const r = refs[Number(b.dataset.open)];
        if (r) openAsset(r);
      }),
      on(el, 'click', 'tr[data-row]', (_e, b) => {
        const r = refs[Number(b.dataset.row)];
        if (r) openAsset(r);
      }),
      on(el, 'click', '[data-cmp="add"]', () =>
        openSearch({
          title: 'Add to the comparison',
          pick: (ref) => {
            if (refs.some((r) => r.key === ref.key)) return toast(`${ref.sym} is already in the comparison.`);
            setRefs([...refs.map(assetQuery), assetQuery(ref)]);
          },
        }),
      ),
      on(el, 'click', '[data-cmp="share"]', () => {
        const link = location.href;
        navigator.clipboard?.writeText(link).then(
          () => toast('Link copied.', 'good'),
          () => toast(link),
        );
      }),
      on(el, 'mouseover', '.corr-cell', (_e, g) => {
        el.querySelectorAll('.corr-cell').forEach((c) => c.classList.toggle('is-dim', !(c.getAttribute('data-a') === g.dataset.a || c.getAttribute('data-b') === g.dataset.b)));
      }),
      on(el, 'mouseout', '.corr-cell', () => el.querySelectorAll('.corr-cell').forEach((c) => c.classList.remove('is-dim'))),
    );

    // Names and logos fill in once the feeds arrive; the SVG charts follow the width and the theme.
    let named = false;
    const rename = () => {
      if (named || crypto.get().status === 'loading' || equities.get().status === 'loading') return;
      named = true;
      resolve();
      paintPicker();
      paintStats();
    };
    scope.add(crypto.subscribe(rename), equities.subscribe(rename));
    let lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (Math.abs(w - lastW) < 10 || loading) return;
      lastW = w;
      paintCorrelation();
      paintUnderwater();
    });
    ro.observe(el);
    scope.add(
      () => ro.disconnect(),
      theme.subscribe(() => paintCorrelation()),
    );

    resolve();
    writeUrl();
    paintPicker();
    const feedsReady = () => crypto.get().status !== 'loading';
    if (feedsReady()) void load();
    else {
      let started = false;
      const began = Date.now();
      const go = () => {
        if (started || (!feedsReady() && Date.now() - began < 6000)) return;
        started = true;
        resolve();
        void load();
      };
      scope.add(crypto.subscribe(go));
      const t = setTimeout(go, 6000);
      scope.add(() => clearTimeout(t));
    }
    return () => scope.dispose();
  },
};
