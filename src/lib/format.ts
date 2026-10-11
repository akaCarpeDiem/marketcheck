/** Number, money and time formatting. */

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const group = (n: number, min: number, max: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });

/**
 * A price in dollars with digits that suit its size:
 * 82,961 · 2,501.60 · 12.17 · 0.4123 · 0.00000820
 */
export function price(n: number | null | undefined): string {
  if (!fin(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 10_000) return `${sign}$${group(a, 0, 0)}`;
  if (a >= 1) return `${sign}$${group(a, 2, 2)}`;
  if (a >= 0.01) return `${sign}$${group(a, 4, 4)}`;
  if (a === 0) return '$0.00';
  // Small coins: four significant digits.
  const digits = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(a))));
  return `${sign}$${a.toFixed(digits)}`;
}

/** A plain number with two decimals (index levels, yields). */
export function level(n: number | null | undefined, decimals = 2): string {
  if (!fin(n)) return '—';
  return (n < 0 ? '−' : '') + group(Math.abs(n), decimals, decimals);
}

/** A big dollar amount: $1.67T · $305.5B · $44.9M · $738K */
export function compact(n: number | null | undefined): string {
  if (!fin(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const unit = (v: number, s: string) => `${sign}$${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)}${s}`;
  if (a >= 1e12) return unit(a / 1e12, 'T');
  if (a >= 1e9) return unit(a / 1e9, 'B');
  if (a >= 1e6) return unit(a / 1e6, 'M');
  if (a >= 1e3) return unit(a / 1e3, 'K');
  return `${sign}$${group(a, 0, 2)}`;
}

/** A dollar amount in full: $12,480.55 (portfolio values). */
export function money(n: number | null | undefined, decimals = 2): string {
  if (!fin(n)) return '—';
  return `${n < 0 ? '−' : ''}$${group(Math.abs(n), decimals, decimals)}`;
}

/** A signed dollar amount: +$120.40 / −$31.02 */
export function signedMoney(n: number | null | undefined, decimals = 2): string {
  if (!fin(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${group(Math.abs(n), decimals, decimals)}`;
}

/** A signed percent: +2.76% / −0.52% / 0.00% */
export function pct(n: number | null | undefined, decimals = 2): string {
  if (!fin(n)) return '—';
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : a >= 100 ? 1 : decimals;
  const shown = a.toFixed(d);
  const zero = Number(shown) === 0;
  const sign = zero ? '' : n > 0 ? '+' : '−';
  return `${sign}${shown}%`;
}

/** 'up' | 'down' | 'flat' for colouring a change. */
export function dir(n: number | null | undefined): 'up' | 'down' | 'flat' {
  if (!fin(n) || Math.abs(n) < 0.005) return 'flat';
  return n > 0 ? 'up' : 'down';
}

/** A quantity of units: 0.5 · 12 · 1,250.75 · 0.00042 */
export function quantity(n: number | null | undefined): string {
  if (!fin(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1000) return group(n, 0, 2);
  if (a >= 1) return group(n, 0, 4);
  return String(Number(n.toPrecision(6)));
}

/** "just now", "5m ago", "3h ago", "2d ago" */
export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!fin(ms)) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** A duration until something: "4h 12m", "12m", "3d 2h", "under a minute" */
export function until(ms: number): string {
  if (!(ms > 0)) return 'now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'under a minute';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d >= 1) return h ? `${d}d ${h}h` : `${d}d`;
  if (h >= 1) return min ? `${h}h ${min}m` : `${h}h`;
  return `${min}m`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Local clock time: 9:30 AM */
export const clock = (ms: number): string => timeFmt.format(ms);
/** Local date: Mon, Oct 12 */
export const day = (ms: number): string => dayFmt.format(ms);
/** Local date and time: Mon, Oct 12, 9:30 AM */
export const dayTime = (ms: number): string => dayTimeFmt.format(ms);

const etTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});
/** New York clock time: 9:30 AM */
export const etClock = (ms: number): string => etTimeFmt.format(ms);

/** "1 coin" / "3 coins" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
