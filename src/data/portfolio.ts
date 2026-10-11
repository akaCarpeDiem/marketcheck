/** Portfolio sums: value, today's change and profit or loss, from holdings and live prices. */
import { lookup, type Priced } from './assets';
import { data, type Holding } from './user';

export type PositionRow = {
  holding: Holding;
  priced: Priced;
  /** Units × price. Null while the price is unknown. */
  value: number | null;
  /** Value change since the previous close (24h for coins). */
  dayChange: number | null;
  /** Total cost (units × average price paid), when a cost was entered. */
  cost: number | null;
  gain: number | null;
  gainPct: number | null;
  /** Share of the portfolio's priced value, 0..1. */
  weight: number;
};

export type PortfolioSummary = {
  rows: PositionRow[];
  /** Total value of holdings that have a price. */
  value: number;
  dayChange: number;
  dayPct: number | null;
  /** Totals over holdings with a cost entered. */
  cost: number;
  gain: number;
  gainPct: number | null;
  /** How many holdings have no price right now. */
  unpriced: number;
  /** How many holdings count toward the gain figure. */
  withCost: number;
};

export function portfolioSummary(): PortfolioSummary {
  const rows: PositionRow[] = [];
  let value = 0;
  let prevValue = 0;
  let dayChange = 0;
  let cost = 0;
  let gain = 0;
  let unpriced = 0;
  let withCost = 0;
  for (const holding of data.get().holdings) {
    const priced = lookup(holding.ref);
    const v = priced.price != null ? holding.qty * priced.price : null;
    const dc = priced.price != null && priced.prevClose != null ? holding.qty * (priced.price - priced.prevClose) : null;
    const c = holding.cost != null ? holding.qty * holding.cost : null;
    const g = v != null && c != null ? v - c : null;
    if (v == null) unpriced += 1;
    else {
      value += v;
      if (dc != null) {
        dayChange += dc;
        prevValue += v - dc;
      } else {
        prevValue += v;
      }
    }
    if (g != null && c != null) {
      cost += c;
      gain += g;
      withCost += 1;
    }
    rows.push({ holding, priced, value: v, dayChange: dc, cost: c, gain: g, gainPct: g != null && c ? (g / c) * 100 : null, weight: 0 });
  }
  for (const r of rows) r.weight = r.value != null && value > 0 ? r.value / value : 0;
  rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return {
    rows,
    value,
    dayChange,
    dayPct: prevValue > 0 ? (dayChange / prevValue) * 100 : null,
    cost,
    gain,
    gainPct: cost > 0 ? (gain / cost) * 100 : null,
    unpriced,
    withCost,
  };
}
