/** Compact USD money formatting for the dense dashboard UI */

export function formatMoney(n: number | null | undefined, opts?: { decimals?: number }): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${trim((abs / 1e12).toFixed(2))}T`;
  if (abs >= 1e9) return `${sign}$${trim((abs / 1e9).toFixed(2))}B`;
  if (abs >= 1e6) return `${sign}$${trim((abs / 1e6).toFixed(2))}M`;
  if (opts?.decimals != null) {
    return `${sign}$${abs.toLocaleString('en-US', {
      minimumFractionDigits: opts.decimals,
      maximumFractionDigits: opts.decimals,
    })}`;
  }
  if (abs >= 1000) {
    return `${sign}$${abs.toLocaleString('en-US', {
      minimumFractionDigits: abs >= 10000 ? 0 : 2,
      maximumFractionDigits: abs >= 10000 ? 0 : 2,
    })}`;
  }
  if (abs >= 1) {
    return `${sign}$${abs.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })}`;
}

function trim(s: string): string {
  return s.replace(/\.?0+$/, '') || '0';
}

export function formatOil(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)} / bbl`;
}

export function formatMetal(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} / oz`;
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function formatIndex(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatMktCap(n: number | null | undefined): string {
  return formatMoney(n);
}

export function pctClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'pct-flat';
  if (n > 0) return 'pct-up';
  if (n < 0) return 'pct-down';
  return 'pct-flat';
}
