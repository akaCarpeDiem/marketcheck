/** The daily call leaderboard dialog: this month and all time, and joining under a chosen name. */
import { board, loadBoard, rankOf, type BoardRow } from '../data/board';
import { data, nickErrorText, setNick, user } from '../data/user';
import { html, raw } from '../lib/dom';
import { icon } from '../lib/icons';
import { openAuth } from './auth';
import { openOverlay } from './overlay';
import { toast } from './toast';

const monthName = (key: string): string => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return y && m ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(Date.UTC(y, m - 1, 1)) : 'This month';
};

function table(rows: BoardRow[], mine: string | undefined, empty: string): string {
  if (!rows.length) return `<p class="board-empty">${empty}</p>`;
  return html`<div class="board-scroll"><table class="table board-table">
    <thead><tr><th class="r">#</th><th>Player</th><th class="r">Right</th><th class="r board-rate">Hit rate</th><th class="r">Streak</th></tr></thead>
    <tbody>${raw(
      rows
        .map(
          (r, i) => html`<tr class="${r.name === mine ? 'is-me' : ''}">
            <td class="r num board-rank">${raw(i < 3 ? `<span class="medal medal-${i + 1}">${i + 1}</span>` : String(i + 1))}</td>
            <td class="board-name">${r.name}${raw(r.name === mine ? ' <span class="tag">you</span>' : '')}</td>
            <td class="r num">${r.wins}<span class="faint"> of ${r.total}</span></td>
            <td class="r num board-rate">${r.pct.toFixed(r.pct % 1 ? 1 : 0)}%</td>
            <td class="r num">${raw(r.streak > 0 ? `${icon.flame(12)} ${r.streak}` : '—')}</td>
          </tr>`,
        )
        .join(''),
    )}</tbody></table></div>`;
}

export function openBoard(): void {
  const o = openOverlay({ kind: 'dialog', label: 'Daily call leaderboard', focus: '[data-board-tab]' });
  o.panel.classList.add('board');
  let tab: 'month' | 'all' = 'month';
  let editing = false;
  let busy = false;
  let note = '';
  let draft = '';

  const joinHtml = (): string => {
    const u = user.get();
    const nick = data.get().game.nick;
    if (!u) {
      return `<div class="board-join"><p>Play signed in and your calls count here. You pick the name that is shown.</p><button type="button" class="btn btn-primary btn-sm" data-board="signin">Sign in to join</button></div>`;
    }
    if (nick && !editing) {
      const b = board.get();
      const rm = rankOf(b.monthRows, nick);
      const ra = rankOf(b.allRows, nick);
      const where = rm ? `You are #${rm} this month${ra ? ` and #${ra} all time` : ''}.` : ra ? `You are #${ra} all time.` : 'You appear once your first call has settled.';
      return html`<div class="board-join"><p>You play as <strong>${nick}</strong>. ${where}</p><span class="grow"></span><button type="button" class="btn btn-ghost btn-sm" data-board="edit">Change name</button><button type="button" class="btn btn-ghost btn-sm" data-board="leave">Leave the board</button></div>`;
    }
    return html`<form class="board-join" data-board-form novalidate>
      <label class="board-field"><span>${nick ? 'New name' : 'Choose the name to show on the board'}</span>
        <input class="input" name="nick" maxlength="20" autocomplete="off" spellcheck="false" placeholder="e.g. BullishBadger" value="${draft}" /></label>
      <button type="submit" class="btn btn-primary btn-sm" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : nick ? 'Save' : 'Join the board'}</button>
      ${raw(nick ? '<button type="button" class="btn btn-ghost btn-sm" data-board="cancel">Cancel</button>' : '')}
      ${raw(note ? html`<p class="auth-note is-bad" role="alert">${note}</p>` : `<p class="board-hint">Only this name and your record are public. Calls count from when you place them signed in.</p>`)}
    </form>`;
  };

  const paint = () => {
    if (!o.isOpen()) return;
    const b = board.get();
    const nick = data.get().game.nick;
    const rows = tab === 'month' ? b.monthRows : b.allRows;
    const keepFocus = (document.activeElement as HTMLInputElement | null)?.name === 'nick';
    o.panel.innerHTML = html`<button type="button" class="icon-btn overlay-x" data-close aria-label="Close">${raw(icon.close(16))}</button>
      <h2>${raw(icon.trophy(18))} Daily call leaderboard</h2>
      <p class="muted">Who has called the S&amp;P 500's close right most often. Ranked by calls right, then hit rate.</p>
      <div class="seg board-tabs" role="group" aria-label="Period">
        <button type="button" class="seg-btn${tab === 'month' ? ' is-on' : ''}" data-board-tab="month" aria-pressed="${tab === 'month' ? 'true' : 'false'}">${b.month ? monthName(b.month) : 'This month'}</button>
        <button type="button" class="seg-btn${tab === 'all' ? ' is-on' : ''}" data-board-tab="all" aria-pressed="${tab === 'all' ? 'true' : 'false'}">All time</button>
      </div>
      ${raw(
        b.status === 'loading' || b.status === 'idle'
          ? '<p class="board-empty">Loading…</p>'
          : b.status === 'error'
            ? '<p class="board-empty">The leaderboard is not available right now. Try again in a minute.</p>'
            : table(rows, nick, tab === 'month' ? 'No call has settled yet this month. Place one and you could be first.' : 'Nobody is on the board yet. Place a call and be the first.'),
      )}
      ${raw(joinHtml())}
      <p class="faint form-foot">For fun only: no prizes, nothing staked. Results update a few minutes after each close.</p>`;
    if (keepFocus) {
      const input = o.panel.querySelector<HTMLInputElement>('input[name="nick"]');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  };

  const unsub = [board.subscribe(paint), data.subscribe(paint), user.subscribe(paint)];
  const stop = setInterval(() => {
    if (!o.isOpen()) {
      clearInterval(stop);
      for (const u of unsub) u();
    }
  }, 1000);

  o.panel.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.name === 'nick') draft = t.value;
  });
  o.panel.addEventListener('click', async (ev) => {
    const t = (ev.target as Element).closest<HTMLElement>('[data-board-tab],[data-board]');
    if (!t) return;
    if (t.dataset.boardTab) {
      tab = t.dataset.boardTab as 'month' | 'all';
      paint();
      return;
    }
    const act = t.dataset.board;
    if (act === 'signin') {
      o.close();
      openAuth();
    } else if (act === 'edit') {
      editing = true;
      draft = data.get().game.nick ?? '';
      note = '';
      paint();
    } else if (act === 'cancel') {
      editing = false;
      note = '';
      paint();
    } else if (act === 'leave') {
      const res = await setNick(null);
      if (res.ok) {
        toast('You are off the leaderboard. Your own record is kept.');
        void loadBoard(true);
      } else toast(nickErrorText(res.error), 'bad');
    }
  });
  o.panel.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const value = draft.trim();
    if (value.length < 3) {
      note = nickErrorText('invalid_nick');
      paint();
      return;
    }
    busy = true;
    note = '';
    paint();
    const res = await setNick(value);
    busy = false;
    if (res.ok) {
      editing = false;
      draft = '';
      toast(`You are on the board as ${value}.`, 'good');
      void loadBoard(true);
    } else {
      note = nickErrorText(res.error);
    }
    paint();
  });

  paint();
  void loadBoard();
}
