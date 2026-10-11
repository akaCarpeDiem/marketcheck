/**
 * Free, keyless stock logos via Financial Modeling Prep image CDN.
 * On error the UI swaps to a tiny placeholder circle.
 */
const FMP_BASE = 'https://images.financialmodelingprep.com/symbol';

/** Yahoo ticker → FMP filename when they differ */
const TICKER_OVERRIDE: Record<string, string> = {
  'BRK-B': 'BRK-B',
};

export function stockLogoUrl(yahooTicker: string): string {
  const file = TICKER_OVERRIDE[yahooTicker] ?? yahooTicker;
  return `${FMP_BASE}/${encodeURIComponent(file)}.png`;
}
