/** Upcoming dated events: market opens and closes, holidays, Fed decisions, options expiration. */
import {
  FOMC_DECISION_DAYS,
  SESSION,
  etParts,
  etToMs,
  marketEarlyCloses,
  marketHolidays,
  marketStatus,
  thirdFriday,
} from '../../functions/_shared/marketCalendar';

export type CalendarEvent = {
  /** When it happens (ms). */
  at: number;
  title: string;
  detail: string;
  kind: 'open' | 'close' | 'holiday' | 'early' | 'fed' | 'opex';
  /** True for all-day events (a holiday), false for a moment in time. */
  allDay: boolean;
};

const parseKey = (key: string): [number, number, number] => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return [y, m, d];
};

/** Events from now until `days` ahead, soonest first. */
export function upcomingEvents(now = Date.now(), days = 75): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const until = now + days * 86_400_000;
  const status = marketStatus(now);
  if (status.open && status.closesAt) {
    out.push({ at: status.closesAt, title: 'US market closes', detail: status.early ? 'Early close, 1:00 PM ET' : '4:00 PM ET', kind: 'close', allDay: false });
  } else if (status.nextOpen) {
    out.push({ at: status.nextOpen, title: 'US market opens', detail: '9:30 AM ET', kind: 'open', allDay: false });
  }

  const p = etParts(now);
  for (const year of [p.y, p.y + 1]) {
    for (const [key, name] of marketHolidays(year)) {
      const [y, m, d] = parseKey(key);
      const at = etToMs(y, m, d, 0);
      const end = etToMs(y, m, d, SESSION.close);
      if (end > now && at < until) out.push({ at, title: `Market holiday: ${name}`, detail: 'US stock markets closed', kind: 'holiday', allDay: true });
    }
    for (const [key, reason] of marketEarlyCloses(year)) {
      const [y, m, d] = parseKey(key);
      const at = etToMs(y, m, d, SESSION.earlyClose);
      if (at > now && at < until) out.push({ at, title: 'Early close', detail: `1:00 PM ET, ${reason}`, kind: 'early', allDay: false });
    }
  }

  for (const key of FOMC_DECISION_DAYS) {
    const [y, m, d] = parseKey(key);
    const at = etToMs(y, m, d, 14 * 60);
    if (at > now && at < until) out.push({ at, title: 'Fed interest-rate decision', detail: '2:00 PM ET', kind: 'fed', allDay: false });
  }

  for (let i = 0; i < 4; i++) {
    const date = new Date(Date.UTC(p.y, p.m - 1 + i, 1));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const [ky, km, kd] = parseKey(thirdFriday(y, m));
    const at = etToMs(ky, km, kd, SESSION.close);
    const quarterly = m % 3 === 0;
    if (at > now && at < until) {
      out.push({ at, title: quarterly ? 'Quarterly options expiration' : 'Monthly options expiration', detail: quarterly ? 'Stock, index and futures options expire together' : 'Third Friday of the month', kind: 'opex', allDay: false });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}
