/** The daily call card: guess the S&P 500's next session, keep a streak. */
import { etParts, marketStatus } from '../../../functions/_shared/marketCalendar';
import { GAME_SYMBOL, currentTarget, pickForDay, picksFor, placeCall, referenceClose, settleCalls, tally } from '../../data/game';
import { quotes, wantQuotes } from '../../data/market';
import { data } from '../../data/user';
import { frame, html, on, raw, render } from '../../lib/dom';
import { dir, etClock, level, pct, until } from '../../lib/format';
import { icon } from '../../lib/icons';
import type { Scope } from '../../lib/store';
import { toast } from '../../ui/toast';

const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

/** "today", "tomorrow", "Monday" or "Tue, Nov 3" for a session date. */
function dayWord(key: string, now = Date.now()): string {
  const today = etParts(now).key;
  if (key === today) return 'today';
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const at = Date.UTC(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const days = Math.round((at - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (Math.abs(days) < 7) return weekday.format(at);
  return shortDate.format(at);
}

function historyDots(): string {
  const settled = picksFor(data.get().game)
    .filter((p) => p.close != null)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-10);
  if (!settled.length) return '';
  return `<div class="call-dots" aria-label="Your last ${settled.length} results">${settled
    .map((p) => `<i class="${p.tie ? 'flat' : p.won ? 'up' : 'down'}" title="${p.day}: called ${p.dir === 'up' ? 'higher' : 'lower'}, ${p.tie ? 'unchanged' : p.won ? 'right' : 'wrong'}"></i>`)
    .join('')}</div>`;
}

function body(): string {
  const now = Date.now();
  const target = currentTarget(now);
  const q = quotes.get().get(GAME_SYMBOL);
  const s = marketStatus(now);
  const today = etParts(now).key;
  const live = pickForDay(today);
  const picks = picksFor(data.get().game);
  const lastSettled = [...picks].filter((p) => p.close != null).sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null;

  let main: string;
  if (s.state === 'open') {
    // The session is running: show how today's call is doing, or when calls reopen.
    if (live && q?.price != null) {
      const move = (q.price / live.ref - 1) * 100;
      const ahead = Math.abs(move) < 0.005 ? null : move > 0 === (live.dir === 'up');
      main = html`<p class="call-q">You called <b class="${live.dir === 'up' ? 'up' : 'down'}">${live.dir === 'up' ? 'higher' : 'lower'}</b> for today. The S&amp;P 500 is at <b class="num">${level(q.price)}</b> (<span class="num ${dir(move)}">${pct(move)}</span>), so your call is <b>${ahead == null ? 'level' : ahead ? 'ahead' : 'behind'}</b>.</p>
        <p class="call-sub">Settles at the close, in ${until(s.closesAt! - now)}.</p>`;
    } else {
      main = html`<p class="call-q">Today's session is under way, so calls are locked.</p>
        <p class="call-sub">Calls for ${dayWord(target.day.key, now)} open after the close, in ${until(s.closesAt! - now)}.</p>`;
    }
  } else {
    const mine = pickForDay(target.day.key);
    const ref = mine?.ref ?? referenceClose(target);
    const when = dayWord(target.day.key, now);
    const prevWhen = dayWord(target.prev.key, now);
    if (mine) {
      main = html`<p class="call-q">You called <b class="${mine.dir === 'up' ? 'up' : 'down'}">${mine.dir === 'up' ? 'higher' : 'lower'}</b> for ${when}: the S&amp;P 500 to close ${mine.dir === 'up' ? 'above' : 'below'} <b class="num">${level(mine.ref)}</b>.</p>
        <p class="call-sub">The session opens ${target.opensAt - now < 20 * 3_600_000 ? `in ${until(target.opensAt - now)}` : `${when} at ${etClock(target.opensAt)} ET`}. You can change your call until then.</p>`;
    } else if (ref != null) {
      main = html`<p class="call-q">Will the S&amp;P 500 close <b>higher or lower</b> ${when === 'today' || when === 'tomorrow' ? when : `on ${when}`} than it did ${prevWhen === 'today' || prevWhen === 'yesterday' ? prevWhen : `on ${prevWhen}`} (<b class="num">${level(ref)}</b>)?</p>
        <p class="call-sub">Calls close when the session opens${target.opensAt - now < 20 * 3_600_000 ? `, in ${until(target.opensAt - now)}` : ''}. For fun only.</p>`;
    } else {
      main = html`<p class="call-q">The next call opens as soon as the latest S&amp;P 500 close is in.</p><p class="call-sub">For fun only.</p>`;
    }
    const canCall = ref != null && target.open;
    main += html`<div class="call-buttons">
      <button type="button" class="btn call-btn call-up${mine?.dir === 'up' ? ' is-on' : ''}" data-call="up" ${canCall ? '' : 'disabled'} aria-pressed="${mine?.dir === 'up' ? 'true' : 'false'}">${raw(icon.arrowUp(15))} Higher</button>
      <button type="button" class="btn call-btn call-down${mine?.dir === 'down' ? ' is-on' : ''}" data-call="down" ${canCall ? '' : 'disabled'} aria-pressed="${mine?.dir === 'down' ? 'true' : 'false'}">${raw(icon.arrowDown(15))} Lower</button>
    </div>`;
  }

  const t = tally(picks);
  const last = lastSettled
    ? html`<p class="call-last">Last result (${dayWord(lastSettled.day, now)}): closed <span class="num">${level(lastSettled.close)}</span>, <span class="num ${dir(lastSettled.close! - lastSettled.ref)}">${pct((lastSettled.close! / lastSettled.ref - 1) * 100)}</span>. You called ${lastSettled.dir === 'up' ? 'higher' : 'lower'}: <b class="${lastSettled.tie ? 'flat' : lastSettled.won ? 'up' : 'down'}">${lastSettled.tie ? 'unchanged, no result' : lastSettled.won ? 'right' : 'wrong'}</b>.</p>`
    : '';
  const stats = html`<div class="call-stats">
      <div><strong class="num">${t.streak}</strong><span>${raw(icon.flame(12))} streak</span></div>
      <div><strong class="num">${Math.max(t.best, data.get().game.best)}</strong><span>best</span></div>
      <div><strong class="num">${t.total ? `${t.wins}/${t.total}` : '—'}</strong><span>right</span></div>
    </div>${raw(historyDots())}`;

  return html`<div class="call-icon">${raw(icon.target(22))}</div>
    <div class="call-main"><h2>Daily call</h2>${raw(main)}${raw(last)}</div>
    <div class="call-side">${raw(stats)}</div>`;
}

export function mountGame(el: HTMLElement, scope: Scope): void {
  const paint = frame(() => render(el, body()));
  wantQuotes('game', [GAME_SYMBOL]);
  scope.add(
    quotes.subscribe(() => {
      void settleCalls();
      paint();
    }),
    data.subscribe(paint),
    () => wantQuotes('game', []),
    on(el, 'click', '[data-call]', (_e, t) => {
      const dirn = t.dataset.call as 'up' | 'down';
      if (placeCall(dirn)) toast(`Called ${dirn === 'up' ? 'higher' : 'lower'}. Come back after the close to see how you did.`, 'good');
      else toast('Calls are locked right now.', 'bad');
    }),
  );
  scope.interval(() => {
    void settleCalls();
    paint();
  }, 30_000);
  void settleCalls();
  paint();
}
