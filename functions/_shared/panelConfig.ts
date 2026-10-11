/**
 * Customizable left/right movers panels — layout shape + normalization (KV LAYOUTS).
 */

import { findHeroAsset, type HeroAssetDef, type HeroUnit } from './heroCatalog';

export type PanelMode =
  | 'movers_up'
  | 'movers_down'
  | 'curated'
  | 'filter_crypto'
  | 'filter_stocks'
  | 'filter_metals';

export type PanelSort = 'change' | 'mcap' | 'volume_24h' | 'volume_7d' | 'volume_30d';

export type PanelSize = 10 | 25;

export type PanelTf = '1h' | '4h' | '8h' | '12h' | '24h' | '7d' | '30d' | '1y';

export type PanelAssetRef = {
  id: string;
  yahoo: string;
  label: string;
  name?: string;
  unit: HeroUnit;
};

export type PanelConfig = {
  title: string;
  mode: PanelMode;
  size: PanelSize;
  sort: PanelSort;
  /** Change timeframe — meaningful for movers_* (and change-sort filters). */
  tf: PanelTf;
  /** Curated asset picks (mode === 'curated'). Max 40 stored. */
  assets: PanelAssetRef[];
};

export type PanelsLayout = {
  left: PanelConfig;
  right: PanelConfig;
};

const MODES = new Set<PanelMode>([
  'movers_up',
  'movers_down',
  'curated',
  'filter_crypto',
  'filter_stocks',
  'filter_metals',
]);

const SORTS = new Set<PanelSort>([
  'change',
  'mcap',
  'volume_24h',
  'volume_7d',
  'volume_30d',
]);

const TFS = new Set<PanelTf>(['1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y']);

const UNITS = new Set<HeroUnit>(['usd', 'oz', 'oil', 'index']);

/** Default metal / precious-metals universe for filter_metals. */
export const METALS_PRESET: PanelAssetRef[] = [
  { id: 'fut-gc', yahoo: 'GC=F', label: 'Gold', name: 'Gold Futures', unit: 'oz' },
  { id: 'fut-si', yahoo: 'SI=F', label: 'Silver', name: 'Silver Futures', unit: 'oz' },
  { id: 'fut-hg', yahoo: 'HG=F', label: 'Copper', name: 'Copper Futures', unit: 'usd' },
  { id: 'idx-gld', yahoo: 'GLD', label: 'GLD', name: 'SPDR Gold', unit: 'usd' },
  { id: 'idx-slv', yahoo: 'SLV', label: 'SLV', name: 'iShares Silver', unit: 'usd' },
  { id: 'idx-gltr', yahoo: 'GLTR', label: 'GLTR', name: 'abrdn Physical Precious Metals Basket ETF', unit: 'usd' },
  { id: 'idx-cper', yahoo: 'CPER', label: 'CPER', name: 'United States Copper Index Fund', unit: 'usd' },
  { id: 'idx-copx', yahoo: 'COPX', label: 'COPX', name: 'Global X Copper Miners ETF', unit: 'usd' },
];

export const DEFAULT_PANEL_LEFT: PanelConfig = {
  title: 'Top 10 Pumps',
  mode: 'movers_up',
  size: 10,
  sort: 'change',
  tf: '24h',
  assets: [],
};

export const DEFAULT_PANEL_RIGHT: PanelConfig = {
  title: 'Top 10 Dumps',
  mode: 'movers_down',
  size: 10,
  sort: 'change',
  tf: '24h',
  assets: [],
};

export const DEFAULT_PANELS: PanelsLayout = {
  left: { ...DEFAULT_PANEL_LEFT, assets: [] },
  right: { ...DEFAULT_PANEL_RIGHT, assets: [] },
};

function clampTitle(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, 48) : '';
  return s || 'Custom panel';
}

function asMode(raw: unknown, fallback: PanelMode): PanelMode {
  return typeof raw === 'string' && MODES.has(raw as PanelMode) ? (raw as PanelMode) : fallback;
}

function asSort(raw: unknown, fallback: PanelSort): PanelSort {
  return typeof raw === 'string' && SORTS.has(raw as PanelSort) ? (raw as PanelSort) : fallback;
}

function asSize(raw: unknown, fallback: PanelSize): PanelSize {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return n === 25 ? 25 : n === 10 ? 10 : fallback;
}

function asTf(raw: unknown, fallback: PanelTf): PanelTf {
  return typeof raw === 'string' && TFS.has(raw as PanelTf) ? (raw as PanelTf) : fallback;
}

function normalizeAsset(raw: unknown): PanelAssetRef | null {
  if (!raw || typeof raw !== 'object') {
    if (typeof raw === 'string') {
      const found = findHeroAsset(raw);
      if (!found) return null;
      return {
        id: found.id,
        yahoo: found.yahoo,
        label: found.label,
        name: found.name,
        unit: found.unit,
      };
    }
    return null;
  }
  const o = raw as Record<string, unknown>;
  const yahoo = typeof o.yahoo === 'string' ? o.yahoo.trim() : '';
  if (!yahoo) return null;
  const found = findHeroAsset(yahoo) ?? (typeof o.id === 'string' ? findHeroAsset(o.id) : null);
  if (found) {
    return {
      id: found.id,
      yahoo: found.yahoo,
      label: found.label,
      name: found.name,
      unit: found.unit,
    };
  }
  // Accept custom Yahoo tickers previously saved
  const unit: HeroUnit =
    typeof o.unit === 'string' && UNITS.has(o.unit as HeroUnit) ? (o.unit as HeroUnit) : 'usd';
  const id =
    typeof o.id === 'string' && o.id.trim()
      ? o.id.trim().slice(0, 64)
      : `custom-${yahoo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const label =
    typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 32) : yahoo;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : undefined;
  return { id, yahoo, label, name, unit };
}

function normalizeAssets(raw: unknown): PanelAssetRef[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelAssetRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= 40) break;
    const a = normalizeAsset(item);
    if (!a) continue;
    const key = a.yahoo.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function normalizePanelConfig(raw: unknown, fallback: PanelConfig): PanelConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...fallback,
      assets: fallback.assets.map((a) => ({ ...a })),
    };
  }
  const o = raw as Record<string, unknown>;
  return {
    title: clampTitle(o.title ?? fallback.title),
    mode: asMode(o.mode, fallback.mode),
    size: asSize(o.size, fallback.size),
    sort: asSort(o.sort, fallback.sort),
    tf: asTf(o.tf, fallback.tf),
    assets: normalizeAssets(o.assets),
  };
}

export function normalizePanelsLayout(raw: unknown): PanelsLayout {
  if (!raw || typeof raw !== 'object') {
    return {
      left: normalizePanelConfig(null, DEFAULT_PANEL_LEFT),
      right: normalizePanelConfig(null, DEFAULT_PANEL_RIGHT),
    };
  }
  const o = raw as Record<string, unknown>;
  // Support flat { left, right } or legacy panel:left / panel:right style payloads
  return {
    left: normalizePanelConfig(o.left, DEFAULT_PANEL_LEFT),
    right: normalizePanelConfig(o.right, DEFAULT_PANEL_RIGHT),
  };
}

/** Whether the change-TF button bar should show for this config. */
export function panelShowsTfBar(cfg: PanelConfig): boolean {
  return cfg.mode === 'movers_up' || cfg.mode === 'movers_down';
}

export function assetRefFromHero(def: HeroAssetDef): PanelAssetRef {
  return {
    id: def.id,
    yahoo: def.yahoo,
    label: def.label,
    name: def.name,
    unit: def.unit,
  };
}
