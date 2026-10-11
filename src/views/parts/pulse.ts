/** A strip of small cards: market breadth, the Fear & Greed gauge and what is coming up. */
import { upcomingEvents } from '../../data/calendar';
import { crypto, equities, mood, moodMissing } from '../../data/market';
import { frame, html, raw, render } from '../../lib/dom';
import { isMoverCandidate } from '../../../functions/_shared/cryptoUniverse';
import { dayTime, day as fmtDay, pct, until } from '../../lib/format';
import { icon } from '../../lib/icons';
import type { Scope } from '../../lib/store';

function breadthHtml(title: string, sub: string, changes: number[], loading: boolean): string {
  if (!loading && changes.length < 10) {
    return html`<h3 class="pulse-title">${title}</h3><p class="pulse-sub pulse-none">Not available right now. This fills in as soon as prices load again.</p>`;
  }
  if (loading) {
    return html`<h3 class="pulse-title">${title}</h3><div class="pulse-big"><span class="sk">00 up</span></div><div class="breadth"><i style="width:50%"></i></div><p class="pulse-sub"><span class="sk">average change +0.00%</span></p>`;
  }
  const up = changes.filter((c) => c > 0.005).length;
  const down = changes.filter((c) => c < -0.005).length;
  const flat = changes.length - up - down;
  const avg = changes.reduce((s, c) => s + c, 0) / changes.length;
  const sorted = [...changes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return html`<h3 class="pulse-title">${title}</h3>
    <div class="pulse-big num"><span class="up">${up} up</span><span class="faint">·</span><span class="down">${down} down</span></div>
    <div class="breadth" role="img" aria-label="${up} up, ${down} down${flat ? `, ${flat} unchanged` : ''}"><i style="width:${((up / changes.length) * 100).toFixed(1)}%"></i><b style="width:${((flat / changes.length) * 100).toFixed(1)}%"></b></div>
    <p class="pulse-sub">${sub} · typical move <span class="num ${median > 0 ? 'up' : median < 0 ? 'down' : 'flat'}">${pct(median)}</span><span class="sr-only">, average ${pct(avg)}</span></p>`;
}

function gaugeHtml(): string {
  const m = mood.get();
  if (!m && moodMissing.get()) {
    return html`<h3 class="pulse-title">Crypto Fear &amp; Greed</h3><p class="pulse-sub pulse-none">Not available right now. Published daily by alternative.me.</p>`;
  }
  if (!m) {
    return html`<h3 class="pulse-title">Crypto Fear &amp; Greed</h3><div class="gauge-wrap"><span class="sk" style="width:120px;height:60px"></span></div><p class="pulse-sub faint">Published daily by alternative.me</p>`;
  }
  // Half circle from 180° (0) to 0° (100).
  const angle = Math.PI * (1 - m.value / 100);
  const cx = 60;
  const cy = 60;
  const nx = cx + Math.cos(angle) * 40;
  const ny = cy - Math.sin(angle) * 40;
  const tone = m.value < 45 ? 'down' : m.value > 55 ? 'up' : 'flat';
  const delta = (label: string, v: number | null) =>
    v == null ? '' : `<span>${label} <b class="num">${v}</b></span>`;
  return html`<h3 class="pulse-title">Crypto Fear &amp; Greed</h3>
    <div class="gauge-wrap">
      <svg class="gauge" viewBox="0 0 120 70" role="img" aria-label="Fear and Greed index ${m.value} out of 100: ${m.label}">
        <defs><linearGradient id="fng" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="var(--down)"/><stop offset=".5" stop-color="var(--warn)"/><stop offset="1" stop-color="var(--up)"/></linearGradient></defs>
        <path d="M10 60a50 50 0 0 1 100 0" fill="none" stroke="var(--card-3)" stroke-width="9" stroke-linecap="round"/>
        <path d="M10 60a50 50 0 0 1 100 0" fill="none" stroke="url(#fng)" stroke-width="9" stroke-linecap="round" opacity=".9"/>
        <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="var(--text)"/>
      </svg>
      <div class="gauge-read"><strong class="num ${tone}">${m.value}</strong><span>${m.label}</span></div>
    </div>
    <p class="pulse-sub gauge-deltas">${raw(delta('Yesterday', m.yesterday))}${raw(delta('Last week', m.week))}${raw(delta('Last month', m.month))}</p>`;
}

const EVENT_ICON = { open: icon.clock, close: icon.clock, holiday: icon.calendar, early: icon.clock, fed: icon.info, opex: icon.calendar } as const;

function eventsHtml(): string {
  const now = Date.now();
  const list = upcomingEvents(now).slice(0, 4);
  return html`<h3 class="pulse-title">Coming up</h3>
    <ul class="events">${raw(
      list
        .map((e) => {
          const soon = e.at - now < 36 * 3_600_000;
          const when = e.allDay ? fmtDay(e.at) : soon ? `in ${until(e.at - now)}` : fmtDay(e.at);
          return html`<li title="${e.allDay ? fmtDay(e.at) : dayTime(e.at)} · ${e.detail}">${raw(EVENT_ICON[e.kind](14))}<span class="event-title">${e.title}</span><span class="event-when num">${when}</span></li>`;
        })
        .join(''),
    )}</ul>`;
}

export function mountPulse(el: HTMLElement, scope: Scope): void {
  el.innerHTML = `<div class="card pulse-card" data-p="crypto"></div><div class="card pulse-card" data-p="stocks"></div><div class="card pulse-card" data-p="mood"></div><div class="card pulse-card" data-p="events"></div>`;
  const paint = frame(() => {
    const c = crypto.get();
    const coins = c.coins.filter((x) => isMoverCandidate(x) && x.ch['24h'] != null).slice(0, 100);
    render(el.querySelector('[data-p="crypto"]'), breadthHtml('Crypto breadth', `Top ${coins.length || 100} coins, 24h`, coins.map((x) => x.ch['24h']!), c.status === 'loading'));
    const e = equities.get();
    const stocks = e.items.filter((x) => x.kind === 'stock' && x.ok && x.ch['24h'] != null);
    render(el.querySelector('[data-p="stocks"]'), breadthHtml('Stock breadth', `${stocks.length || 100} large stocks`, stocks.map((x) => x.ch['24h']!), e.status === 'loading'));
    render(el.querySelector('[data-p="mood"]'), gaugeHtml());
    render(el.querySelector('[data-p="events"]'), eventsHtml());
  });
  scope.add(crypto.subscribe(paint), equities.subscribe(paint), mood.subscribe(paint), moodMissing.subscribe(paint));
  scope.interval(paint, 60_000);
  paint();
}
