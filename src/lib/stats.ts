/**
 * Small statistics for price series: moving averages, returns, volatility, drawdown and
 * correlation. Pure functions with no knowledge of the page, checked by scripts/test/stats.test.mjs.
 */
import { bisector, deviation, mean } from 'd3-array';

export type TV = { t: number; v: number };

/** Simple moving average of `values` over `period`; null until there are enough values. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

const byT = bisector<TV, number>((d) => d.t).right;

/**
 * The value of `series` (sorted by time) as it stood at each of `times`: the last value at or
 * before that time, or null before the series starts. Lines up series with different hours.
 */
export function alignTo(times: number[], series: TV[]): (number | null)[] {
  return times.map((t) => {
    const i = byT(series, t) - 1;
    return i >= 0 ? series[i]!.v : null;
  });
}

/** Percent change of each value from the first one that is not null. */
export function rebase(values: (number | null)[]): (number | null)[] {
  const first = values.find((v) => v != null && v > 0);
  if (first == null) return values.map(() => null);
  return values.map((v) => (v == null ? null : (v / first - 1) * 100));
}

/** Simple returns between neighbours (fractions, not percent). */
export function returns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1]!;
    const b = values[i]!;
    if (a > 0 && b > 0) out.push(b / a - 1);
  }
  return out;
}

/** Annualised volatility, percent, from per-period returns. `periodsPerYear` is 252 for stock days, 365 for crypto days, 52 for weeks. */
export function volatility(rets: number[], periodsPerYear: number): number | null {
  if (rets.length < 3) return null;
  const sd = deviation(rets);
  return sd == null ? null : sd * Math.sqrt(periodsPerYear) * 100;
}

/** The deepest fall from a high to a later low, percent (negative or 0), with where it happened. */
export function maxDrawdown(values: number[]): { pct: number; peak: number; trough: number } {
  let peakI = 0;
  let best = { pct: 0, peak: 0, trough: 0 };
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > values[peakI]!) peakI = i;
    const dd = values[peakI]! > 0 ? (values[i]! / values[peakI]! - 1) * 100 : 0;
    if (dd < best.pct) best = { pct: dd, peak: peakI, trough: i };
  }
  return best;
}

/** Pearson correlation of two equal-length lists; null when either does not vary or there are too few. */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const ma = mean(a.slice(0, n))!;
  const mb = mean(b.slice(0, n))!;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return null;
  return sab / Math.sqrt(saa * sbb);
}

/** YYYY-MM-DD of an instant in UTC: the day key daily series are matched on. */
export const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Daily returns of two series on the days both have a close for that day and the day before
 * (stocks skip weekends, coins do not; only shared days count).
 */
export function pairedDailyReturns(a: TV[], b: TV[]): [number[], number[]] {
  const closeByDay = (s: TV[]) => {
    const m = new Map<string, number>();
    for (const p of s) m.set(dayKey(p.t), p.v);
    return m;
  };
  const ma = closeByDay(a);
  const mb = closeByDay(b);
  const days = [...ma.keys()].filter((k) => mb.has(k)).sort();
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < days.length; i++) {
    const a0 = ma.get(days[i - 1]!)!;
    const a1 = ma.get(days[i]!)!;
    const b0 = mb.get(days[i - 1]!)!;
    const b1 = mb.get(days[i]!)!;
    if (a0 > 0 && b0 > 0) {
      ra.push(a1 / a0 - 1);
      rb.push(b1 / b0 - 1);
    }
  }
  return [ra, rb];
}

/** Keep the last value of each UTC day: turns hourly crypto points into daily closes. */
export function dailyLast<T extends TV>(points: T[]): T[] {
  const out: T[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && dayKey(prev.t) === dayKey(p.t)) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * Value of several holdings together, on every day any of them has a close, from the first day all of them
 * do (so no holding appears halfway and makes the total jump). Each part is a quantity and its daily closes.
 */
export function sumHoldings<T extends TV>(parts: { qty: number; bars: T[] }[]): TV[] {
  if (!parts.length) return [];
  const days = new Map<string, number>();
  for (const p of parts) for (const b of p.bars) if (!days.has(dayKey(b.t))) days.set(dayKey(b.t), b.t);
  const times = [...days.values()].sort((a, b) => a - b);
  const cols = parts.map((p) => alignTo(times, p.bars));
  const out: TV[] = [];
  times.forEach((t, i) => {
    let sum = 0;
    for (let k = 0; k < parts.length; k++) {
      const v = cols[k]![i];
      if (v == null) return;
      sum += v * parts[k]!.qty;
    }
    out.push({ t, v: sum });
  });
  return out;
}
