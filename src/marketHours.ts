/**
 * NYSE / Nasdaq regular-session estimate from America/New_York local clock.
 * Not an official exchange calendar — holidays are a thin static list + caveat.
 */

export type MarketHoursEstimate = {
  open: boolean;
  /** Short status for the strip, e.g. "OPEN (estimate)" */
  status: string;
  /** Detail line with NY time window */
  detail: string;
  /** NY wall-clock time string */
  nyTime: string;
};

/** Thin US equity holiday set (YYYY-MM-DD in America/New_York). Expand as needed. */
const US_EQUITY_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-01-20',
  '2025-02-17',
  '2025-04-18',
  '2025-05-26',
  '2025-06-19',
  '2025-07-04',
  '2025-09-01',
  '2025-11-27',
  '2025-12-25',
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03', // observed Independence Day (Fri)
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
]);

function nyParts(d: Date): {
  y: number;
  m: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
  dateKey: string;
  timeLabel: string;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const y = Number(parts.year);
  const m = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);
  const minute = Number(parts.minute);
  const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeLabel = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`;
  return {
    y,
    m,
    day,
    weekday: parts.weekday ?? '',
    hour,
    minute,
    dateKey,
    timeLabel,
  };
}

export function nyseHoursEstimate(now = new Date()): MarketHoursEstimate {
  const p = nyParts(now);
  const weekend = p.weekday === 'Sat' || p.weekday === 'Sun';
  const holiday = US_EQUITY_HOLIDAYS.has(p.dateKey);
  const mins = p.hour * 60 + p.minute;
  const openMins = 9 * 60 + 30;
  const closeMins = 16 * 60;
  const inSession = !weekend && !holiday && mins >= openMins && mins < closeMins;
  const status = inSession ? 'OPEN (estimate)' : 'CLOSED (estimate)';
  let reason = 'regular session Mon–Fri 09:30–16:00 ET';
  if (weekend) reason = 'weekend';
  else if (holiday) reason = 'listed US equity holiday (thin calendar)';
  else if (mins < openMins) reason = 'pre-open · regular session 09:30–16:00 ET';
  else if (mins >= closeMins) reason = 'after close · regular session 09:30–16:00 ET';
  return {
    open: inSession,
    status,
    detail: `NYSE / Nasdaq · ${reason} · holidays not fully calendared`,
    nyTime: p.timeLabel,
  };
}
