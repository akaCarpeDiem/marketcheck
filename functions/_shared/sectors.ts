/**
 * Sector for each stock in STOCK_UNIVERSE (GICS sectors) and a group for each
 * ETF in ETF_UNIVERSE. Used to group the heat map and the markets tables.
 */

export type Sector =
  | 'Technology'
  | 'Communication'
  | 'Consumer Discretionary'
  | 'Consumer Staples'
  | 'Health Care'
  | 'Financials'
  | 'Industrials'
  | 'Energy'
  | 'Materials'
  | 'Utilities'
  | 'Real Estate';

const BY_SECTOR: Record<Sector, string> = {
  Technology:
    'NVDA MSFT AAPL AVGO ORCL CRM AMD CSCO ADBE ACN TXN IBM QCOM INTU AMAT NOW PANW LRCX ADI MU INTC PLTR CRWD SHOP MSTR TSM ASML SAP',
  Communication: 'GOOGL META NFLX VZ DIS T CMCSA',
  'Consumer Discretionary': 'AMZN TSLA F HD MCD BKNG LOW TJX SBUX TM BABA',
  'Consumer Staples': 'WMT COST PG KO PEP PM',
  'Health Care': 'LLY UNH JNJ ABBV MRK TMO ABT ISRG PFE SYK BMY MDT GILD VRTX REGN NVO AZN',
  Financials: 'BRK-B JPM V MA BAC WFC GS SPGI AXP MS BLK SCHW C CB MRSH XYZ COIN HSBC',
  Industrials: 'CAT GE UBER RTX HON UNP BA ADP DE ETN',
  Energy: 'XOM CVX',
  Materials: 'LIN',
  Utilities: 'NEE SO',
  'Real Estate': 'PLD AMT',
};

export const STOCK_SECTOR: Record<string, Sector> = {};
for (const [sector, list] of Object.entries(BY_SECTOR) as [Sector, string][]) {
  for (const sym of list.split(' ')) STOCK_SECTOR[sym] = sector;
}

export type EtfGroup = 'US market' | 'Sectors' | 'Themes' | 'Bonds' | 'Commodities' | 'International';

const BY_GROUP: Record<EtfGroup, string> = {
  'US market': 'SPY QQQ IWM DIA VTI VOO IVV',
  Sectors: 'XLF XLE XLK XLV XLI XLY XLP XLU XLB XLRE XLC IYR VNQ',
  Themes: 'SMH USD SOXX IGV XBI ARKK TAN ICLN BITO COPX GDX',
  Bonds: 'TLT IEF HYG LQD AGG BND TIP',
  Commodities: 'GLD GLTR SLV USO CPER UNG DBA',
  International: 'EFA EEM VEA VWO IEFA KWEB',
};

export const ETF_GROUP: Record<string, EtfGroup> = {};
for (const [group, list] of Object.entries(BY_GROUP) as [EtfGroup, string][]) {
  for (const sym of list.split(' ')) ETF_GROUP[sym] = group;
}

/** Sector (stock) or group (ETF) for a universe symbol. */
export function groupOf(symbol: string): string {
  return STOCK_SECTOR[symbol] ?? ETF_GROUP[symbol] ?? 'Other';
}

/**
 * Share counts used to turn a live price into a market cap (for ETFs: units
 * outstanding, so the result is assets under management).
 *
 * Seed values are market cap / price read from the live site on SEED_DATE.
 * They only cover the gap until the Function refreshes each symbol from Yahoo
 * (stocks) or Nasdaq (ETFs), which it does a few symbols at a time and keeps
 * for a week. Format: SYMBOL:price:marketCapInMillions.
 */
export const SEED_DATE = '2026-10-09';

const SEED =
  'NVDA:229.28:5445390 MSFT:535.07:3717154 AAPL:336.64:4918531 GOOGL:351.66:4115887 AMZN:262.43:2688704 ' +
  'META:718.67:1895599 AVGO:361.54:1740179 TSLA:382.7:1501302 F:12.17:51599 BRK-B:515.62:1087787 ' +
  'JPM:332.99:946926 WMT:111.35:876917 LLY:1179.27:1025943 V:385.45:678701 XOM:168.94:662964 ' +
  'MA:589.14:490495 ORCL:141.4:437111 UNH:379.3:334758 COST:946.92:401215 NFLX:70.3:297139 ' +
  'PG:151.23:344266 JNJ:261.44:648721 HD:290.74:308027 ABBV:276.47:468427 BAC:54.32:391594 ' +
  'CRM:229.13:195528 KO:88.05:379012 MRK:145.6:359220 CVX:211.98:403129 AMD:608.1:1003335 ' +
  'PEP:125.97:183360 TMO:658.02:245993 CSCO:118.39:419610 LIN:483.73:214314 ADBE:242.27:95674 ' +
  'WFC:83.55:247666 MCD:235.23:166459 ABT:99.6:179077 ACN:209.06:112304 TXN:283.74:248970 ' +
  'IBM:227.13:217991 QCOM:175.5:210664 CAT:800.47:373265 GE:308.2:331211 PM:201.19:297446 ' +
  'INTU:302.75:78126 VZ:41.65:193280 AMAT:507.03:376467 ISRG:423.96:142050 NOW:140.86:145547 ' +
  'DIS:108.05:178643 UBER:71.51:141795 GS:895.32:276464 BKNG:160.34:123392 SPGI:407.82:120225 ' +
  'AXP:308.17:203917 MS:190.02:314396 PFE:28.28:160617 T:22.18:173365 NEE:77.38:160662 ' +
  'RTX:185.97:257408 LOW:186:108951 BLK:1082.39:164299 HON:207.73:64136 UNP:278.34:163020 ' +
  'SYK:277.33:105517 TJX:138.76:144746 PLD:129.49:127307 BA:190.37:158019 SCHW:96.7:172069 ' +
  'BMY:59.12:124912 C:129.64:221304 MDT:88.48:109303 GILD:151.17:189304 ADP:270.88:104750 ' +
  'VRTX:510.08:130872 PANW:418.78:321719 SBUX:90.75:107320 DE:620.93:191294 LRCX:318.84:384506 ' +
  'ADI:406.19:186669 MU:1029:1210574 INTC:104.7:648077 CMCSA:20.66:80022 REGN:746.54:82551 ' +
  'AMT:182.24:79577 CB:341.2:129324 ETN:429.65:170414 SO:86.17:96021 PLTR:209.05:460883 ' +
  'CRWD:275.04:268773 SHOP:170.85:183141 XYZ:77.24:44867 COIN:179.39:52274 MSTR:154.34:66477 ' +
  'TSM:453.31:2008084 NVO:38.64:170595 ASML:1780.34:666489 SAP:214.78:263858 AZN:159.2:262740 ' +
  'TM:185.3:227485 BABA:111.37:278460 HSBC:92.98:345775 ' +
  'SPY:778.57:813617 QQQ:751.27:502822 IWM:278.94:77539 DIA:516.11:44943 SMH:603.33:74749 ' +
  'USD:94.84:2947 XLF:54.73:51190 XLE:65.08:41910 XLK:198.78:130003 XLV:170.81:43389 ' +
  'XLI:169.25:30932 XLY:112.85:21863 XLP:83.43:13708 XLU:41.41:23231 XLB:49.43:7782 ' +
  'XLRE:41.61:7621 XLC:110.38:22997 GLD:384.58:140695 GLTR:187.45:2518 SLV:54.78:28767 ' +
  'USO:148.2:1936 CPER:40.31:738 COPX:85.75:7045 TLT:77.98:47952 IEF:89.4:41397 ' +
  'HYG:77.23:18244 LQD:102.41:27872 EFA:103.4:76224 EEM:66.8:30637 VTI:381.94:699070 ' +
  'VOO:715.59:1047929 VEA:70.35:229058 VWO:59.76:124850 ARKK:89.62:9014 SOXX:559.4:46442 ' +
  'IGV:112.67:14565 XBI:153.77:9970 KWEB:24.93:4375 BITO:11:1660 IYR:96.1:4085 ' +
  'VNQ:90.65:35841 AGG:94.59:136655 BND:70.22:161627 TIP:104.42:14215 UNG:11.01:519 ' +
  'DBA:28.33:1224 GDX:89.28:25938 TAN:43.75:888 ICLN:17.28:2236 IVV:781.97:893588 IEFA:96.52:188768';

/** symbol -> shares (or ETF units) outstanding on SEED_DATE. */
export const SEED_SHARES: Record<string, number> = {};
/** symbol -> closing price on SEED_DATE (used by the local mock data only). */
export const SEED_PRICES: Record<string, number> = {};
for (const part of SEED.split(' ')) {
  const [sym, price, capM] = part.split(':');
  const p = Number(price);
  const cap = Number(capM) * 1e6;
  if (sym && p > 0 && cap > 0) {
    SEED_SHARES[sym] = cap / p;
    SEED_PRICES[sym] = p;
  }
}
