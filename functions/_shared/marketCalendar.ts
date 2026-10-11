/**
 * US stock market calendar (NYSE and Nasdaq share it). Pure functions, used by
 * both the Functions and the browser.
 *
 * Holidays and 1:00 pm early closes are computed from the exchanges' published
 * rules, so the calendar does not run out at the end of a year. The rules are
 * checked against the NYSE's published 2026, 2027 and 2028 calendars in
 * scripts/test/calendar.test.mjs.
 *
 * All times are America/New_York. Regular session 9:30–16:00, pre-market from
 * 4:00, after-hours until 20:00.
 */

const TZ = 'America/New_York';

export type EtParts = {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
  /** 0 = Sunday */
  dow: number;
  /** Minutes after midnight, New York time */
  minutes: number;
  /** YYYY-MM-DD */
  key: string;
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let etFormat: Intl.DateTimeFormat | null = null;

/** Wall-clock date and time in New York for an instant. */
export function etParts(at: Date | number = Date.now()): EtParts {
  etFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of etFormat.formatToParts(typeof at === 'number' ? new Date(at) : at)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  return {
    y,
    m,
    d,
    dow: WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
    key: dateKey(y, m, d),
  };
}

export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The instant (ms) of a New York wall-clock time. Handles daylight saving. */
export function etToMs(y: number, m: number, d: number, minutes: number): number {
  // New York is UTC-5 or UTC-4. Try both and keep the one that round-trips.
  for (const offsetHours of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, 0, minutes + offsetHours * 60);
    const p = etParts(ms);
    if (p.y === y && p.m === m && p.d === d && p.minutes === ((minutes % 1440) + 1440) % 1440) {
      return ms;
    }
  }
  return Date.UTC(y, m - 1, d, 0, minutes + 5 * 60);
}

/** Day of week (0 = Sunday) for a calendar date. */
function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The n-th given weekday of a month (n = 1..5), or the last one when n = -1. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = dow(y, m, 1);
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = dow(y, m, lastDay);
  return lastDay - ((last - weekday + 7) % 7);
}

/** Easter Sunday (Gregorian), as [month, day]. */
function easter(y: number): [number, number] {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return [month, day];
}

function shift(y: number, m: number, d: number, days: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

/**
 * A fixed-date holiday moves to Friday when it falls on Saturday and to Monday
 * when it falls on Sunday. Returns null when the Friday would be in the
 * previous year (New Year's Day on a Saturday is not observed).
 */
function observed(y: number, m: number, d: number): [number, number, number] | null {
  const wd = dow(y, m, d);
  if (wd === 6) {
    const moved = shift(y, m, d, -1);
    return moved[0] === y ? moved : null;
  }
  if (wd === 0) return shift(y, m, d, 1);
  return [y, m, d];
}

const holidayCache = new Map<number, Map<string, string>>();
const earlyCache = new Map<number, Map<string, string>>();

/** Full-day market holidays for a year: date key -> name. */
export function marketHolidays(year: number): Map<string, string> {
  const hit = holidayCache.get(year);
  if (hit) return hit;
  const out = new Map<string, string>();
  const add = (date: [number, number, number] | null, name: string) => {
    if (date && date[0] === year) out.set(dateKey(...date), name);
  };
  add(observed(year, 1, 1), "New Year's Day");
  // New Year's Day of next year falling on Saturday is not moved into this year.
  add([year, 1, nthWeekday(year, 1, 1, 3)], 'Martin Luther King Jr. Day');
  add([year, 2, nthWeekday(year, 2, 1, 3)], "Washington's Birthday");
  const [em, ed] = easter(year);
  add(shift(year, em, ed, -2), 'Good Friday');
  add([year, 5, nthWeekday(year, 5, 1, -1)], 'Memorial Day');
  add(observed(year, 6, 19), 'Juneteenth');
  add(observed(year, 7, 4), 'Independence Day');
  add([year, 9, nthWeekday(year, 9, 1, 1)], 'Labor Day');
  add([year, 11, nthWeekday(year, 11, 4, 4)], 'Thanksgiving Day');
  add(observed(year, 12, 25), 'Christmas Day');
  holidayCache.set(year, out);
  return out;
}

/** Days that close at 1:00 pm: date key -> reason. */
export function marketEarlyCloses(year: number): Map<string, string> {
  const hit = earlyCache.get(year);
  if (hit) return hit;
  const holidays = marketHolidays(year);
  const out = new Map<string, string>();
  const addIfTradingDay = (y: number, m: number, d: number, reason: string) => {
    const wd = dow(y, m, d);
    const key = dateKey(y, m, d);
    if (wd === 0 || wd === 6 || holidays.has(key)) return;
    out.set(key, reason);
  };
  // The day after Thanksgiving.
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  addIfTradingDay(year, 11, thanksgiving + 1, 'day after Thanksgiving');
  // Christmas Eve and July 3, when they are trading days next to the holiday itself.
  if (dow(year, 12, 25) >= 2 && dow(year, 12, 25) <= 5) addIfTradingDay(year, 12, 24, 'Christmas Eve');
  if (dow(year, 7, 4) >= 2 && dow(year, 7, 4) <= 5) addIfTradingDay(year, 7, 3, 'day before Independence Day');
  earlyCache.set(year, out);
  return out;
}

export const SESSION = { pre: 4 * 60, open: 9 * 60 + 30, close: 16 * 60, earlyClose: 13 * 60, post: 20 * 60 };

export type TradingDay = {
  key: string;
  y: number;
  m: number;
  d: number;
  /** Minutes after midnight ET */
  open: number;
  close: number;
  early: string | null;
};

/** Trading-day details, or null on weekends and holidays. */
export function tradingDay(y: number, m: number, d: number): TradingDay | null {
  const wd = dow(y, m, d);
  if (wd === 0 || wd === 6) return null;
  const key = dateKey(y, m, d);
  if (marketHolidays(y).has(key)) return null;
  const early = marketEarlyCloses(y).get(key) ?? null;
  return { key, y, m, d, open: SESSION.open, close: early ? SESSION.earlyClose : SESSION.close, early };
}

/** Why the market is shut all day, or null if it trades. */
export function closedReason(y: number, m: number, d: number): string | null {
  const wd = dow(y, m, d);
  if (wd === 0 || wd === 6) return 'Weekend';
  return marketHolidays(y).get(dateKey(y, m, d)) ?? null;
}

/** The first trading day on or after a date. */
export function nextTradingDay(y: number, m: number, d: number, includeSelf = true): TradingDay {
  let cur: [number, number, number] = includeSelf ? [y, m, d] : shift(y, m, d, 1);
  for (let i = 0; i < 14; i++) {
    const day = tradingDay(...cur);
    if (day) return day;
    cur = shift(...cur, 1);
  }
  // Unreachable: there is never a 14-day gap.
  return { key: dateKey(...cur), y: cur[0], m: cur[1], d: cur[2], open: SESSION.open, close: SESSION.close, early: null };
}

/** The last trading day on or before a date. */
export function prevTradingDay(y: number, m: number, d: number, includeSelf = true): TradingDay {
  let cur: [number, number, number] = includeSelf ? [y, m, d] : shift(y, m, d, -1);
  for (let i = 0; i < 14; i++) {
    const day = tradingDay(...cur);
    if (day) return day;
    cur = shift(...cur, -1);
  }
  return { key: dateKey(...cur), y: cur[0], m: cur[1], d: cur[2], open: SESSION.open, close: SESSION.close, early: null };
}

export type MarketState = 'open' | 'pre' | 'post' | 'closed';

export type MarketStatus = {
  state: MarketState;
  /** True during the regular session only. */
  open: boolean;
  /** Holiday name or "Weekend" when shut all day. */
  reason: string | null;
  /** Set when today closes at 1:00 pm. */
  early: string | null;
  /** When the regular session next opens (ms). Null while it is open. */
  nextOpen: number | null;
  /** When the current regular session closes (ms). Null unless open. */
  closesAt: number | null;
  /** When `state` will next change (ms). */
  nextChange: number;
  /** Today's date in New York. */
  today: string;
};

/** Where the US stock market is in its day at a given instant. */
export function marketStatus(at: number = Date.now()): MarketStatus {
  const p = etParts(at);
  const today = tradingDay(p.y, p.m, p.d);
  const at0 = (day: TradingDay, minutes: number) => etToMs(day.y, day.m, day.d, minutes);

  if (today && p.minutes >= today.open && p.minutes < today.close) {
    const closesAt = at0(today, today.close);
    return {
      state: 'open',
      open: true,
      reason: null,
      early: today.early,
      nextOpen: null,
      closesAt,
      nextChange: closesAt,
      today: p.key,
    };
  }

  if (today && p.minutes < today.open) {
    const nextOpen = at0(today, today.open);
    const pre = p.minutes >= SESSION.pre;
    return {
      state: pre ? 'pre' : 'closed',
      open: false,
      reason: null,
      early: today.early,
      nextOpen,
      closesAt: null,
      nextChange: pre ? nextOpen : at0(today, SESSION.pre),
      today: p.key,
    };
  }

  const next = nextTradingDay(p.y, p.m, p.d, false);
  const nextOpen = at0(next, next.open);
  // After-hours trading follows a full session, and also the 1:00 pm early closes.
  if (today && p.minutes < SESSION.post) {
    return {
      state: 'post',
      open: false,
      reason: null,
      early: today.early,
      nextOpen,
      closesAt: null,
      nextChange: at0(today, SESSION.post),
      today: p.key,
    };
  }
  return {
    state: 'closed',
    open: false,
    reason: today ? null : closedReason(p.y, p.m, p.d),
    early: null,
    nextOpen,
    closesAt: null,
    nextChange: at0(next, SESSION.pre),
    today: p.key,
  };
}

/**
 * Federal Reserve rate decisions: the second day of each scheduled FOMC
 * meeting, announced at 2:00 pm ET. Source: the Federal Reserve's published
 * calendars for 2026 and 2027, plus the first meeting of 2028. Update yearly.
 */
export const FOMC_DECISION_DAYS: string[] = [
  '2026-01-28',
  '2026-03-18',
  '2026-04-29',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-10-28',
  '2026-12-09',
  '2027-01-27',
  '2027-03-17',
  '2027-04-28',
  '2027-06-09',
  '2027-07-28',
  '2027-09-15',
  '2027-10-27',
  '2027-12-08',
  '2028-01-26',
];

/** Third Friday of a month: monthly options expiration. */
export function thirdFriday(y: number, m: number): string {
  let d = nthWeekday(y, m, 5, 3);
  // If that Friday is a market holiday (Good Friday can be), expiration moves to Thursday.
  if (marketHolidays(y).has(dateKey(y, m, d))) d -= 1;
  return dateKey(y, m, d);
}
