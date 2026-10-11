/**
 * The top of the overview: "The market in a minute" (a short written summary
 * built from the live numbers) beside "Your day" (portfolio, watchlist and
 * what changed since the last visit).
 */
import { closedReason, etParts, marketStatus } from '../../../functions/_shared/marketCalendar';
import { isMoverCandidate } from '../../../functions/_shared/cryptoUniverse';
import { avatar, lookup, priceText, refFromYahoo, type AssetRef } from '../../data/assets';
import { crypto, equities, mood, quotes, wantQuotes } from '../../data/market';
import { portfolioSummary } from '../../data/portfolio';
import { data, user } from '../../data/user';
import { changesSince, dismissLastVisit, lastVisit } from '../../data/visit';
import { esc, frame, html, on, raw, render } from '../../lib/dom';
import { ago, clock, day as fmtDay, dir, etClock, level, money, pct, price, signedMoney, until } from '../../lib/format';
import { icon } from '../../lib/icons';
import type { Scope } from '../../lib/store';
import { openAuth } from '../../ui/auth';
import { openAsset } from '../../ui/drawer';
import { openSearch } from '../../ui/search';

const SPX = refFromYahoo('^GSPC', 'S&P 500', 'S&P 500', 'index');
const NDQ = refFromYahoo('^IXIC', 'Nasdaq', 'Nasdaq Composite', 'index');
const DOW = refFromYahoo('^DJI', 'Dow', 'Dow Jones Industrial Average', 'index');
const GOLD = refFromYahoo('GC=F', 'Gold', 'Gold futures', 'future');
const SILVER = refFromYahoo('SI=F', 'Silver', 'Silver futures', 'future');
const OIL = refFromYahoo('CL=F', 'WTI oil', 'Crude oil futures', 'future');
const BRIEF_SYMBOLS = [SPX, NDQ, DOW, GOLD, SILVER, OIL].map((r) => r.yahoo!);

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** "up 0.60%", "down 1.11%" or "flat". */
function moved(change: number | null | undefined): string {
  if (change == null) return '';
  if (Math.abs(change) < 0.005) return 'flat';
  return `${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(2)}%`;
}

const num = (text: string, change?: number | null): string =>
  `<b class="num${change == null ? '' : ` ${dir(change)}`}">${esc(text)}</b>`;

function marketSentence(now: number): string {
  const s = marketStatus(now);
  if (s.state === 'open') {
    return `US stock markets are open and close in ${until(s.closesAt! - now)}${s.early ? ' (early close at 1:00 PM ET)' : ''}.`;
  }
  const opens = s.nextOpen!;
  const p = etParts(now);
  const openDay = etParts(opens);
  const sameDay = openDay.key === p.key;
  const when = sameDay ? `at ${etClock(opens)} ET, in ${until(opens - now)}` : `${weekdayFmt.format(opens)} at ${etClock(opens)} ET`;
  if (s.state === 'pre') return `US stock markets open ${when}. Pre-market trading is under way.`;
  if (s.state === 'post') return `US stock markets have closed for the day and reopen ${when}. After-hours trading runs until 8:00 PM ET.`;
  const reason = s.reason ?? closedReason(p.y, p.m, p.d);
  if (reason === 'Weekend') return `US stock markets are closed for the weekend and reopen ${when}.`;
  if (reason) return `US stock markets are closed for ${reason} and reopen ${when}.`;
  return `US stock markets are closed and reopen ${when}.`;
}

/** "today" while the session is on that day, otherwise "on Friday". */
function sessionWord(lastTradeSec: number | null | undefined, now: number): string {
  if (!lastTradeSec) return 'in the latest session';
  const t = lastTradeSec * 1000;
  if (etParts(t).key === etParts(now).key) return 'today';
  return `on ${weekdayFmt.format(t)}`;
}

function stocksParagraph(now: number): string {
  const spx = lookup(SPX);
  if (spx.price == null) return '';
  const q = quotes.get().get(SPX.yahoo!);
  const open = marketStatus(now).open;
  const word = sessionWord(q?.time, now);
  const verb = open ? 'is at' : 'closed at';
  let text = `The S&P 500 ${verb} ${num(level(spx.price))}, ${num(moved(spx.change), spx.change)} ${word}.`;
  const ndq = lookup(NDQ);
  const dow = lookup(DOW);
  if (ndq.change != null && dow.change != null) {
    const v = (c: number) => (Math.abs(c) < 0.005 ? 'was flat' : c > 0 ? `${open ? 'is up' : 'rose'} ${num(`${Math.abs(c).toFixed(2)}%`, c)}` : `${open ? 'is down' : 'fell'} ${num(`${Math.abs(c).toFixed(2)}%`, c)}`);
    text += ` The Nasdaq ${v(ndq.change)} and the Dow ${v(dow.change)}.`;
  }
  const stocks = equities.get().items.filter((e) => e.kind === 'stock' && e.ok && e.ch['24h'] != null);
  if (stocks.length >= 20) {
    const up = stocks.filter((e) => e.ch['24h']! > 0).length;
    const best = stocks.reduce((a, b) => (b.ch['24h']! > a.ch['24h']! ? b : a));
    const worst = stocks.reduce((a, b) => (b.ch['24h']! < a.ch['24h']! ? b : a));
    text += ` ${num(String(up))} of the ${stocks.length} large stocks we track ${open ? 'are' : 'finished'} higher.`;
    if (best.ch['24h']! > 0) text += ` ${esc(best.name)} gained the most (${num(pct(best.ch['24h']), best.ch['24h'])})`;
    if (worst.ch['24h']! < 0) text += `${best.ch['24h']! > 0 ? ' and' : ''} ${esc(worst.name)} fell the most (${num(pct(worst.ch['24h']), worst.ch['24h'])})`;
    text += '.';
  }
  return text;
}

function cryptoParagraph(): string {
  const s = crypto.get();
  const btc = s.byId.get('bitcoin');
  if (!btc || btc.price == null) return '';
  let text = `Bitcoin is at ${num(price(btc.price))}, ${num(moved(btc.ch['24h']), btc.ch['24h'])} in 24 hours`;
  if (btc.ch['7d'] != null) text += ` and ${num(moved(btc.ch['7d']), btc.ch['7d'])} over seven days`;
  text += '.';
  const eth = s.byId.get('ethereum');
  if (eth?.price != null) text += ` Ether is at ${num(price(eth.price))} (${num(pct(eth.ch['24h']), eth.ch['24h'])}).`;
  const top = s.coins.filter((c) => !c.stable && !c.wrapped && c.ch['24h'] != null).slice(0, 100);
  if (top.length >= 50) {
    const up = top.filter((c) => c.ch['24h']! > 0).length;
    text += ` ${num(String(up))} of the ${top.length} largest coins are up on the day.`;
  }
  const movers = s.coins.filter((c) => isMoverCandidate(c) && c.ch['24h'] != null);
  if (movers.length) {
    const big = movers.reduce((a, b) => (Math.abs(b.ch['24h']!) > Math.abs(a.ch['24h']!) ? b : a));
    if (Math.abs(big.ch['24h']!) >= 5) text += ` The biggest move among liquid coins is ${esc(big.name)} (${num(pct(big.ch['24h']), big.ch['24h'])}).`;
  }
  return text;
}

function commoditiesParagraph(): string {
  const gold = lookup(GOLD);
  const silver = lookup(SILVER);
  const oil = lookup(OIL);
  const parts: string[] = [];
  if (gold.price != null) parts.push(`Gold is at ${num(priceText(GOLD, gold.price))} an ounce (${num(pct(gold.change), gold.change)})`);
  if (silver.price != null) parts.push(`silver at ${num(priceText(SILVER, silver.price))} (${num(pct(silver.change), silver.change)})`);
  if (oil.price != null) parts.push(`US crude oil at ${num(priceText(OIL, oil.price))} a barrel (${num(pct(oil.change), oil.change)})`);
  if (!parts.length) return '';
  const joined = parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ');
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

function moodParagraph(): string {
  const m = mood.get();
  if (!m) return '';
  let text = `The crypto Fear &amp; Greed Index reads ${num(String(m.value))} (${esc(m.label.toLowerCase())})`;
  if (m.week != null && m.week !== m.value) text += `, ${m.value > m.week ? 'up from' : 'down from'} ${num(String(m.week))} a week ago`;
  return `${text}.`;
}

function briefHtml(): string {
  const now = Date.now();
  const paras: [string, string][] = [
    ['Stocks', stocksParagraph(now)],
    ['Crypto', cryptoParagraph()],
    ['Commodities', commoditiesParagraph()],
    ['Mood', moodParagraph()],
  ];
  const ready = paras.filter(([, t]) => t);
  const body = ready.length
    ? ready.map(([label, text]) => `<p><span class="brief-label">${label}</span>${text}</p>`).join('')
    : `<p><span class="sk">The S&amp;P 500 closed at 0,000.00, up 0.00% on Friday. The Nasdaq rose 0.00%.</span></p><p><span class="sk">Bitcoin is at $00,000, up 0.00% in 24 hours and down 0.0% over seven days.</span></p>`;
  return html`<div class="card-head">
      <h2 class="card-title">${raw(icon.bolt(16))} The market in a minute</h2>
      <span class="card-sub">${dateFmt.format(now)} · ${clock(now)}</span>
    </div>
    <div class="card-body brief-body">
      <p class="brief-lede">${marketSentence(now)}</p>
      ${raw(body)}
    </div>`;
}

/* ── Your day ──────────────────────────────────────────────────────────── */

function visitHtml(): string {
  const snap = lastVisit.get();
  if (!snap) return '';
  const changes = changesSince(snap).filter((c) => Math.abs(c.change) >= 0.01).slice(0, 6);
  if (!changes.length) return '';
  const pf = portfolioSummary();
  let portfolioLine = '';
  if (pf.rows.length) {
    let delta = 0;
    let base = 0;
    for (const r of pf.rows) {
      const from = snap.prices[r.holding.ref.key];
      if (!from || r.priced.price == null) continue;
      delta += r.holding.qty * (r.priced.price - from);
      base += r.holding.qty * from;
    }
    if (base > 0) portfolioLine = `<p class="visit-pf">Your portfolio: <b class="num ${dir(delta)}">${signedMoney(delta)} (${pct((delta / base) * 100)})</b></p>`;
  }
  return html`<div class="visit">
    <div class="visit-head"><span>${raw(icon.clock(13))} Since your last visit, ${ago(snap.at)} <em>(${fmtDay(snap.at)}, ${clock(snap.at)})</em></span><button type="button" class="icon-btn icon-btn-sm" data-day="dismiss-visit" aria-label="Hide this">${raw(icon.close(12))}</button></div>
    ${raw(portfolioLine)}
    <div class="visit-chips">${raw(changes.map((c) => `<button type="button" class="chg-chip ${dir(c.change)}" data-day-open="${esc(c.ref.key)}"><em>${esc(c.ref.sym)}</em><b class="num">${pct(c.change)}</b></button>`).join(''))}</div>
  </div>`;
}

let dayRefs = new Map<string, AssetRef>();

function dayHtml(): string {
  const d = data.get();
  dayRefs = new Map();
  const pf = portfolioSummary();
  const visit = visitHtml();
  for (const w of d.watchlist) dayRefs.set(w.key, w);
  for (const h of d.holdings) dayRefs.set(h.ref.key, h.ref);
  const snap = lastVisit.get();
  if (snap) for (const c of changesSince(snap)) dayRefs.set(c.ref.key, c.ref);

  const watchRows = d.watchlist
    .slice(0, pf.rows.length ? 4 : 6)
    .map((ref) => {
      const p = lookup(ref);
      return html`<li class="day-row" data-day-open="${ref.key}" tabindex="0" role="button">${raw(avatar(ref, p.image, 22))}<strong>${ref.sym}</strong><span class="day-name">${ref.name}</span><span class="num">${priceText(ref, p.price)}</span><span class="num ${dir(p.change)}">${pct(p.change)}</span></li>`;
    })
    .join('');

  if (!pf.rows.length && !d.watchlist.length) {
    return html`<div class="card-head"><h2 class="card-title">${raw(icon.target(16))} Your day</h2></div>
      <div class="card-body day-empty">
        ${raw(visit)}
        <p>Follow what matters to you and this panel becomes your own summary each time you come back.</p>
        <ul class="day-steps">
          <li>${raw(icon.star(15))}<span><b>Watch</b> any stock, fund or coin to see it here.</span></li>
          <li>${raw(icon.wallet(15))}<span><b>Add what you hold</b> to see its value and today's change.</span></li>
          <li>${raw(icon.edit(15))}<span>${raw(user.get() ? '<b>Make it yours:</b> point at any tile or panel and select the pencil to change what it shows.' : '<b>Sign in</b> to choose your own tiles and keep your lists on every device.')}</span></li>
        </ul>
        <div class="day-actions">
          <button type="button" class="btn btn-primary btn-sm" data-day="search">${raw(icon.search(14))} Find something to watch</button>
          ${raw(user.get() ? '' : '<button type="button" class="btn btn-outline btn-sm" data-day="signin">Sign in</button>')}
        </div>
      </div>`;
  }

  const pfBlock = pf.rows.length
    ? html`<a class="day-pf" href="/portfolio/">
        <span class="muted">Portfolio value</span>
        <strong class="num">${money(pf.value)}</strong>
        <span class="num ${dir(pf.dayChange)}">${signedMoney(pf.dayChange)} ${pf.dayPct != null ? `(${pct(pf.dayPct)})` : ''} <em>today</em></span>
        ${raw(pf.withCost ? `<span class="num ${dir(pf.gain)}">${signedMoney(pf.gain)} ${pf.gainPct != null ? `(${pct(pf.gainPct)})` : ''} <em>all time</em></span>` : '')}
      </a>`
    : '';
  return html`<div class="card-head">
      <h2 class="card-title">${raw(icon.target(16))} Your day</h2>
      <div class="card-tools"><a class="btn btn-ghost btn-sm" href="/portfolio/">Manage ${raw(icon.chevronRight(13))}</a></div>
    </div>
    <div class="card-body day-body">
      ${raw(visit)}
      ${raw(pfBlock)}
      ${raw(watchRows ? `<ul class="day-list">${watchRows}</ul>` : `<p class="muted day-hint">Star anything from search to add it to your watchlist.</p>`)}
    </div>`;
}

export function mountBrief(briefEl: HTMLElement, dayEl: HTMLElement, scope: Scope): void {
  const paint = frame(() => {
    render(briefEl, briefHtml());
    render(dayEl, dayHtml());
  });
  const want = () => {
    const refs = [...data.get().watchlist, ...data.get().holdings.map((h) => h.ref)];
    wantQuotes('brief', [...BRIEF_SYMBOLS, ...refs.filter((r) => !r.cg && r.yahoo).map((r) => r.yahoo!)]);
  };
  scope.add(
    crypto.subscribe(paint),
    equities.subscribe(paint),
    quotes.subscribe(paint),
    mood.subscribe(paint),
    lastVisit.subscribe(paint),
    user.subscribe(paint),
    data.subscribe(() => {
      want();
      paint();
    }),
    () => wantQuotes('brief', []),
    on(dayEl, 'click', '[data-day]', (_ev, el) => {
      const act = el.dataset.day;
      if (act === 'search') openSearch();
      else if (act === 'signin') openAuth();
      else if (act === 'dismiss-visit') dismissLastVisit();
    }),
    on(dayEl, 'click', '[data-day-open]', (_ev, el) => {
      const ref = dayRefs.get(el.dataset.dayOpen!);
      if (ref) openAsset(ref);
    }),
    on(dayEl, 'keydown', '[data-day-open]', (ev, el) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      const ref = dayRefs.get(el.dataset.dayOpen!);
      if (ref) openAsset(ref);
    }),
  );
  scope.interval(paint, 30_000);
  want();
  paint();
}
