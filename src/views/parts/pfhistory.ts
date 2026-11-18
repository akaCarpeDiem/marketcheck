/**
 * Portfolio history: how the holdings in the list today would have done over a past range, against the
 * S&P 500. Uses today's quantities (the site does not know when anything was bought), which the card says.
 * Loads only when the card comes into view, and at most the 15 largest holdings.
 */
import { refFromYahoo } from '../../data/assets';
import { dailyHistory, type Bar, type DailyRange } from '../../data/history';
import { portfolioSummary } from '../../data/portfolio';
import { pref, setPref } from '../../data/user';
import { esc, on, render } from '../../lib/dom';
import { money, pct, signedMoney } from '../../lib/format';
import { sumHoldings } from '../../lib/stats';
import type { Scope } from '../../lib/store';
import { createChart } from '../../ui/chart';

const RANGES: DailyRange[] = ['1M', '3M', '6M', 'YTD', '1Y'];
const MAX_HOLDINGS = 15;
const SPX = refFromYahoo('^GSPC', 'S&P 500', 'S&P 500 index', 'index');
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Returns a function to call when the holdings may have changed. */
export function mountPortfolioHistory(el: HTMLElement, scope: Scope): () => void {
  let range = pref('pf.hist', '3M') as DailyRange;
  if (!RANGES.includes(range)) range = '3M';
  let token = 0;
  let seen = false;
  let lastKey = '';

  el.innerHTML = `<div class="card-head">
      <h2 class="card-title">How your holdings did <span class="card-sub">today’s holdings, priced over the past</span></h2>
      <div class="card-tools"><div class="seg" role="group" aria-label="Range" data-ranges></div></div>
    </div>
    <div class="pfh-sum" data-sum></div>
    <div class="pfh-chart" data-chart></div>
    <p class="faint pfh-note" data-note></p>`;
  const chartEl = el.querySelector<HTMLElement>('[data-chart]')!;
  const chart = createChart(chartEl);
  scope.add(() => chart.destroy());

  const paintRanges = () =>
    render(
      el.querySelector('[data-ranges]'),
      RANGES.map((r) => `<button type="button" class="seg-btn${r === range ? ' is-on' : ''}" data-range="${r}" aria-pressed="${r === range}">${r}</button>`).join(''),
    );

  async function load(): Promise<void> {
    const pf = portfolioSummary();
    const rows = pf.rows.filter((r) => r.weight > 0).slice(0, MAX_HOLDINGS);
    el.hidden = !rows.length;
    if (!rows.length) return;
    const t = (token += 1);
    paintRanges();
    chartEl.classList.add('is-loading');
    const [spx, ...hist] = await Promise.all([dailyHistory(SPX, range).catch(() => null), ...rows.map((r) => dailyHistory(r.holding.ref, range).catch(() => null))]);
    if (t !== token) return;
    chartEl.classList.remove('is-loading');
    const parts: { qty: number; bars: Bar[] }[] = [];
    const missing: string[] = [];
    rows.forEach((r, i) => {
      const h = hist[i];
      if (h && h.bars.length > 1) parts.push({ qty: r.holding.qty, bars: h.bars });
      else missing.push(r.holding.ref.sym);
    });
    const series = sumHoldings(parts);
    if (series.length < 2) {
      chart.clear('No price history is available for these holdings right now.');
      render(el.querySelector('[data-sum]'), '');
      return;
    }
    chart.set(series, {
      formatValue: (v) => money(v),
      formatTime: (ms) => dayFmt.format(ms),
      label: 'Your holdings',
      colour: '#22c7e8',
      compare: spx && spx.bars.length > 1 ? [{ label: 'S&P 500', colour: '#a78bfa', points: spx.bars }] : [],
    });
    const first = series[0]!.v;
    const last = series[series.length - 1]!.v;
    const mine = (last / first - 1) * 100;
    const spxBars = spx?.bars.filter((b) => b.t >= series[0]!.t) ?? [];
    const bench = spxBars.length > 1 ? (spxBars[spxBars.length - 1]!.v / spxBars[0]!.v - 1) * 100 : null;
    const ahead = bench == null ? null : mine - bench;
    render(
      el.querySelector('[data-sum]'),
      `<div><span class="muted">Your holdings</span><strong class="num ${mine >= 0 ? 'up' : 'down'}">${pct(mine)}</strong><small class="num">${signedMoney(last - first, 0)}</small></div>
      ${bench == null ? '' : `<div><span class="muted">S&amp;P 500</span><strong class="num ${bench >= 0 ? 'up' : 'down'}">${pct(bench)}</strong></div>`}
      ${ahead == null ? '' : `<div class="pfh-verdict ${ahead >= 0 ? 'up' : 'down'}">${ahead >= 0 ? 'Ahead of' : 'Behind'} the S&amp;P 500 by <b class="num">${Math.abs(ahead).toFixed(1)} points</b></div>`}`,
    );
    const notes = [`Uses the quantities in your list today for the whole period; buys, sells, dividends and fees are not included.`];
    if (pf.rows.filter((r) => r.weight > 0).length > MAX_HOLDINGS) notes.push(`Your ${MAX_HOLDINGS} largest holdings are included.`);
    if (missing.length) notes.push(`No history for ${esc(missing.join(', '))}, so ${missing.length === 1 ? 'it is' : 'they are'} left out.`);
    render(el.querySelector('[data-note]'), notes.join(' '));
  }

  /** Reload when the holdings themselves change (not on every price tick). */
  const refresh = () => {
    if (!seen) {
      el.hidden = !portfolioSummary().rows.some((r) => r.weight > 0);
      check();
      return;
    }
    // Holdings without a price yet are left out until they have one, so they are part of the key.
    const key = portfolioSummary()
      .rows.filter((r) => r.weight > 0)
      .map((r) => `${r.holding.ref.key}:${r.holding.qty}`)
      .join('|');
    if (!key) {
      el.hidden = true;
      return;
    }
    if (key === lastKey) return;
    lastKey = key;
    void load();
  };

  // Start once the card is near the screen. Intersection callbacks can be held back (background tabs,
  // some embedded browsers), so a scroll check and a timer ask the same question.
  const check = () => {
    if (seen || el.hidden) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 1.5 && r.bottom > -window.innerHeight) {
      seen = true;
      refresh();
    }
  };
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) check();
  });
  io.observe(el);
  scope.listen('scroll', check, { passive: true });
  scope.interval(check, 1500);
  scope.add(
    () => io.disconnect(),
    on(el, 'click', '[data-range]', (_e, b) => {
      range = b.dataset.range as DailyRange;
      setPref('pf.hist', range);
      void load();
    }),
  );
  paintRanges();
  el.hidden = !portfolioSummary().rows.some((r) => r.weight > 0);
  return refresh;
}
