/** Short background notes on well-known assets: who made it, when, and what it is for. */
import type { AssetRef } from '../../functions/_shared/userData';

export type FounderRef = {
  name: string;
  /** Public X/Twitter handle without @, when known */
  x?: string;
};

export type AssetProfile = {
  name: string;
  /** Plain fallback if `founders` is not set */
  founder?: string;
  /** Structured founders (preferred) — enables X profile links */
  founders?: FounderRef[];
  founded?: string;
  purpose: string;
};

const PROFILES: Record<string, AssetProfile> = {
  // Hero / majors
  btc: {
    name: 'Bitcoin',
    founder: 'Satoshi Nakamoto (pseudonymous)',
    founded: '2009',
    purpose:
      'Peer-to-peer digital cash and scarce settlement asset; often treated as a store of value.',
  },
  eth: {
    name: 'Ethereum',
    founder: 'Vitalik Buterin and co-founders',
    founders: [
      { name: 'Vitalik Buterin', x: 'VitalikButerin' },
      { name: 'Gavin Wood', x: 'gavofyork' },
      { name: 'Joseph Lubin', x: 'josephlubin' },
      { name: 'Charles Hoskinson', x: 'IOHK_Charles' },
      { name: 'Anthony Di Iorio' },
      { name: 'Mihai Alisie' },
      { name: 'Amir Chetrit' },
      { name: 'Jeffrey Wilcke' },
    ],
    founded: '2015',
    purpose:
      'Smart-contract blockchain for DeFi, NFTs, and decentralized apps; ETH is the native gas token.',
  },
  wti: {
    name: 'WTI Crude Oil',
    founded: 'Benchmark (NYMEX)',
    purpose:
      'U.S. light sweet crude futures benchmark used for pricing and hedging energy exposure.',
  },
  gold: {
    name: 'Gold',
    purpose:
      'Precious metal (COMEX spot/futures) used as a long-term store of value and inflation hedge.',
  },
  silver: {
    name: 'Silver',
    purpose:
      'Precious/industrial metal (COMEX) with investment demand and manufacturing uses.',
  },
  spx: {
    name: 'S&P 500',
    founded: '1957 (modern form)',
    purpose:
      'Cap-weighted index of ~500 large U.S. companies; primary large-cap equity benchmark.',
  },
  ndx: {
    name: 'Nasdaq Composite',
    founded: '1971',
    purpose: 'Broad index of Nasdaq-listed equities; tech-heavy market barometer.',
  },
  dxy: {
    name: 'U.S. Dollar Index (DXY)',
    founded: '1973',
    purpose: 'Measures the dollar against a basket of major currencies.',
  },
  tnx: {
    name: '10-Year Treasury Yield',
    purpose: 'Key U.S. government borrowing rate; anchors risk-asset pricing.',
  },
  vix: {
    name: 'Cboe Volatility Index (VIX)',
    founded: '1993',
    purpose: 'Market’s expectation of near-term S&P 500 volatility (“fear gauge”).',
  },
  // Indexes section
  'idx-dji': {
    name: 'Dow Jones Industrial Average',
    founded: '1896',
    purpose: 'Price-weighted index of 30 large U.S. blue-chip stocks.',
  },
  'idx-ndx': {
    name: 'Nasdaq-100',
    founded: '1985',
    purpose:
      'The 100 largest non-financial companies listed on the Nasdaq exchange (modified market-cap weighted). Not every large U.S. company — only Nasdaq-listed names; banks and other financials are excluded.',
  },
  'idx-qqq': {
    name: 'Invesco QQQ',
    founder: 'Invesco',
    founded: '1999',
    purpose: 'ETF tracking the Nasdaq-100 index.',
  },
  'idx-bnd': {
    name: 'Vanguard Total Bond Market ETF (BND)',
    founder: 'Vanguard',
    purpose: 'Broad U.S. investment-grade bond exposure.',
  },
  'idx-vnq': {
    name: 'Vanguard Real Estate ETF (VNQ)',
    founder: 'Vanguard',
    purpose: 'U.S. REIT equity exposure.',
  },
  'idx-smh': {
    name: 'VanEck Semiconductor ETF (SMH)',
    founder: 'VanEck',
    purpose: 'Tracks a basket of semiconductor companies.',
  },
  'idx-usd': {
    name: 'ProShares Ultra Semiconductors (USD)',
    founder: 'ProShares',
    purpose:
      '2× daily leveraged ETF on a semiconductor index (not the U.S. dollar).',
  },
  'idx-gltr': {
    name: 'abrdn Physical Precious Metals Basket (GLTR)',
    founder: 'abrdn',
    purpose: 'Holds physical gold, silver, platinum, and palladium.',
  },
  'idx-cper': {
    name: 'United States Copper Index Fund (CPER)',
    purpose: 'Tracks copper futures for industrial metal exposure.',
  },
  'idx-copx': {
    name: 'Global X Copper Miners ETF (COPX)',
    founder: 'Global X',
    purpose: 'Basket of copper mining equities.',
  },
  // Major stocks
  nvda: {
    name: 'NVIDIA',
    founder: 'Jensen Huang, Chris Malachowsky, Curtis Priem',
    founded: '1993',
    purpose: 'Designs GPUs and AI accelerators for data centers, gaming, and autonomy.',
  },
  msft: {
    name: 'Microsoft',
    founder: 'Bill Gates and Paul Allen',
    founded: '1975',
    purpose: 'Software, cloud (Azure), productivity, and enterprise platforms.',
  },
  aapl: {
    name: 'Apple',
    founder: 'Steve Jobs, Steve Wozniak, Ronald Wayne',
    founded: '1976',
    purpose: 'Consumer electronics, software, and services (iPhone, Mac, App Store).',
  },
  googl: {
    name: 'Alphabet (Google)',
    founder: 'Larry Page and Sergey Brin',
    founded: '1998',
    purpose: 'Search, advertising, YouTube, cloud, and other internet services.',
  },
  amzn: {
    name: 'Amazon',
    founder: 'Jeff Bezos',
    founded: '1994',
    purpose: 'E-commerce, AWS cloud, advertising, and digital media.',
  },
  meta: {
    name: 'Meta Platforms',
    founder: 'Mark Zuckerberg and co-founders',
    founded: '2004',
    purpose: 'Social networks and ads (Facebook, Instagram, WhatsApp); Reality Labs.',
  },
  avgo: {
    name: 'Broadcom',
    founder: 'Henry Samueli and Henry Nicholas (as Broadcom Corp.)',
    founded: '1991',
    purpose: 'Semiconductor and infrastructure software company.',
  },
  tsla: {
    name: 'Tesla',
    founder: 'Martin Eberhard & Marc Tarpenning (Elon Musk early investor/CEO)',
    founded: '2003',
    purpose: 'Electric vehicles, energy storage, and related software/autonomy.',
  },
  brkb: {
    name: 'Berkshire Hathaway',
    founder: 'Warren Buffett (modern form)',
    founded: '1839 (textile origins); Buffett control ~1965',
    purpose: 'Diversified holding company across insurance, railroads, energy, and more.',
  },
  jpm: {
    name: 'JPMorgan Chase',
    founder: 'J.P. Morgan lineage / Chase merger history',
    founded: '1799 / modern JPM 2000',
    purpose: 'Large U.S. bank: consumer, commercial, and investment banking.',
  },
  wmt: {
    name: 'Walmart',
    founder: 'Sam Walton',
    founded: '1962',
    purpose: 'Global retail and e-commerce operator.',
  },
  lly: {
    name: 'Eli Lilly',
    founder: 'Colonel Eli Lilly',
    founded: '1876',
    purpose: 'Pharma focused on diabetes, obesity, oncology, and neuroscience.',
  },
  v: {
    name: 'Visa',
    founded: '1958 (BankAmericard roots)',
    purpose: 'Global electronic payments network connecting merchants and issuers.',
  },
  xom: {
    name: 'Exxon Mobil',
    founded: '1999 (merger; Rockefeller Standard Oil roots 1870)',
    purpose: 'Integrated oil & gas: upstream, refining, and chemicals.',
  },
  ma: {
    name: 'Mastercard',
    founded: '1966',
    purpose: 'Global payment-network and card-processing company.',
  },
  orcl: {
    name: 'Oracle',
    founder: 'Larry Ellison, Bob Miner, Ed Oates',
    founded: '1977',
    purpose: 'Enterprise database, cloud applications, and infrastructure software.',
  },
  unh: {
    name: 'UnitedHealth Group',
    founded: '1977',
    purpose: 'Health insurance and health-care services (Optum).',
  },
  cost: {
    name: 'Costco',
    founder: 'James Sinegal and Jeffrey Brotman',
    founded: '1983',
    purpose: 'Membership warehouse retailer known for high volume and low margins.',
  },
  nflx: {
    name: 'Netflix',
    founder: 'Reed Hastings and Marc Randolph',
    founded: '1997',
    purpose: 'Subscription streaming entertainment service.',
  },
  pg: {
    name: 'Procter & Gamble',
    founder: 'William Procter and James Gamble',
    founded: '1837',
    purpose: 'Consumer staples: household, personal care, and hygiene brands.',
  },
  // Major cryptos (extra)
  sol: {
    name: 'Solana',
    founder: 'Anatoly Yakovenko and Raj Gokal',
    founders: [
      { name: 'Anatoly Yakovenko', x: 'aeyakovenko' },
      { name: 'Raj Gokal', x: 'rajgokal' },
      { name: 'Greg Fitzgerald' },
      { name: 'Stephen Akridge' },
    ],
    founded: '2020',
    purpose: 'High-throughput L1 for DeFi, NFTs, and consumer apps; SOL is the native token.',
  },
  xrp: {
    name: 'XRP',
    founder: 'Ripple (Chris Larsen, Jed McCaleb, et al.)',
    founded: '2012',
    purpose: 'Digital asset used with Ripple’s cross-border payment technology.',
  },
  ada: {
    name: 'Cardano',
    founder: 'Charles Hoskinson / Input Output',
    founders: [{ name: 'Charles Hoskinson', x: 'IOHK_Charles' }],
    founded: '2017',
    purpose: 'Proof-of-stake L1 focused on research-driven smart contracts and governance.',
  },
  doge: {
    name: 'Dogecoin',
    founder: 'Billy Markus and Jackson Palmer',
    founders: [
      { name: 'Billy Markus', x: 'billym2k' },
      { name: 'Jackson Palmer' },
    ],
    founded: '2013',
    purpose: 'Meme-originated cryptocurrency used for tips, payments, and community culture.',
  },
  link: {
    name: 'Chainlink',
    founder: 'Sergey Nazarov and Steve Ellis',
    founders: [
      { name: 'Sergey Nazarov', x: 'SergeyNazarov' },
      { name: 'Steve Ellis' },
    ],
    founded: '2017',
    purpose: 'Decentralized oracle network bridging smart contracts to real-world data.',
  },
  avax: {
    name: 'Avalanche',
    founder: 'Emin Gün Sirer / Ava Labs',
    founded: '2020',
    purpose: 'Fast L1 platform for DeFi and custom subnets; AVAX is the native token.',
  },
  dot: {
    name: 'Polkadot',
    founder: 'Gavin Wood / Web3 Foundation',
    founders: [{ name: 'Gavin Wood', x: 'gavofyork' }],
    founded: '2020',
    purpose: 'Multi-chain protocol connecting specialized parachains; DOT for staking/governance.',
  },
  near: {
    name: 'NEAR Protocol',
    founder: 'Illia Polosukhin and Alexander Skidanov',
    founded: '2020',
    purpose: 'Sharded L1 aimed at usable apps and account abstraction.',
  },
  uni: {
    name: 'Uniswap',
    founder: 'Hayden Adams',
    founders: [{ name: 'Hayden Adams', x: 'haydenzadams' }],
    founded: '2018',
    purpose: 'Leading decentralized exchange protocol on Ethereum and other EVM chains.',
  },
  aave: {
    name: 'Aave',
    founder: 'Stani Kulechov',
    founders: [{ name: 'Stani Kulechov', x: 'StaniKulechov' }],
    founded: '2017 (as ETHLend)',
    purpose: 'Decentralized liquidity protocol for lending and borrowing crypto assets.',
  },
  matic: {
    name: 'Polygon (MATIC/POL)',
    founder: 'Jaynti Kanani, Sandeep Nailwal, Anurag Arjun',
    founded: '2017',
    purpose: 'Ethereum scaling and multi-chain infrastructure for cheaper transactions.',
  },
  atom: {
    name: 'Cosmos',
    founder: 'Jae Kwon / Tendermint',
    founded: '2019',
    purpose: 'Ecosystem of interoperable blockchains (IBC); ATOM secures the Hub.',
  },
  ltc: {
    name: 'Litecoin',
    founder: 'Charlie Lee',
    founders: [{ name: 'Charlie Lee', x: 'SatoshiLite' }],
    founded: '2011',
    purpose: 'Bitcoin-derived payment-focused cryptocurrency with faster block times.',
  },
  bch: {
    name: 'Bitcoin Cash',
    founded: '2017 (Bitcoin fork)',
    purpose: 'Bitcoin fork emphasizing larger blocks for cheaper on-chain payments.',
  },
  trx: {
    name: 'TRON',
    founder: 'Justin Sun',
    founders: [{ name: 'Justin Sun', x: 'justinsuntron' }],
    founded: '2017',
    purpose: 'High-throughput chain popular for stablecoin transfers and entertainment apps.',
  },
  ton: {
    name: 'Toncoin (TON)',
    founder: 'Telegram-originated; now community/TON Foundation',
    founded: '2018 / relaunch ~2021',
    purpose: 'Layer-1 tied to Telegram ecosystem for payments and mini-apps.',
  },
  shib: {
    name: 'Shiba Inu',
    founder: 'Ryoshi (pseudonymous)',
    founded: '2020',
    purpose: 'Meme token ecosystem on Ethereum with DEX and community experiments.',
  },
  pepe: {
    name: 'Pepe',
    founded: '2023',
    purpose: 'Meme coin inspired by the Pepe the Frog internet culture.',
  },
  bonk: {
    name: 'Bonk',
    founded: '2022',
    purpose: 'Solana community meme coin used for tips, NFTs, and on-chain culture.',
  },
  wif: {
    name: 'dogwifhat (WIF)',
    founded: '2023',
    purpose: 'Solana meme coin centered on the “dog with hat” internet meme.',
  },
  render: {
    name: 'Render (RENDER)',
    founder: 'Jules Urbach / OTOY',
    founded: '2017',
    purpose: 'Decentralized GPU rendering network for digital media and AI workloads.',
  },
  rndr: {
    name: 'Render (RENDER)',
    founder: 'Jules Urbach / OTOY',
    founded: '2017',
    purpose: 'Decentralized GPU rendering network for digital media and AI workloads.',
  },
  inj: {
    name: 'Injective',
    founder: 'Eric Chen and Albert Chon',
    founded: '2020',
    purpose: 'Finance-focused L1/app-chain for DEXs, derivatives, and crypto trading apps.',
  },
  sui: {
    name: 'Sui',
    founder: 'Mysten Labs (ex-Meta Move team)',
    founded: '2023',
    purpose: 'Move-based L1 optimized for parallel execution and consumer apps.',
  },
  apt: {
    name: 'Aptos',
    founder: 'Aptos Labs (ex-Meta Move team)',
    founded: '2022',
    purpose: 'Move-based L1 aimed at scalable consumer and DeFi applications.',
  },
  arb: {
    name: 'Arbitrum',
    founder: 'Offchain Labs',
    founded: '2021',
    purpose: 'Ethereum Layer-2 optimistic rollup for cheaper, faster smart-contract txs.',
  },
  op: {
    name: 'Optimism',
    founder: 'Optimism Foundation / OP Labs',
    founded: '2021',
    purpose: 'Ethereum Layer-2 optimistic rollup and Superchain ecosystem token.',
  },
  sei: {
    name: 'Sei',
    founded: '2023',
    purpose: 'Trading-oriented L1 optimized for order-book and exchange workloads.',
  },
  ti: {
    name: 'Jupiter (JUP)',
    founded: '2021',
    purpose: 'Leading Solana DEX aggregator and liquidity routing protocol.',
  },
  jup: {
    name: 'Jupiter',
    founded: '2021',
    purpose: 'Leading Solana DEX aggregator and liquidity routing protocol.',
  },
  jto: {
    name: 'Jito',
    founded: '2022',
    purpose: 'Solana MEV and liquid-staking infrastructure; JTO is the governance token.',
  },
  pyth: {
    name: 'Pyth Network',
    founded: '2021',
    purpose: 'High-frequency oracle network delivering market data on-chain.',
  },
  w: {
    name: 'Wormhole',
    founded: '2020',
    purpose: 'Cross-chain messaging and bridging protocol connecting multiple L1/L2s.',
  },
  ena: {
    name: 'Ethena',
    founded: '2023',
    purpose: 'Synthetic dollar (USDe) and crypto-native yield protocol; ENA is governance.',
  },
  fen: {
    name: 'Fartcoin',
    founded: '2024',
    purpose: 'Solana meme coin; speculative community token (high risk).',
  },
};

/** Yahoo symbols whose profile is filed under another key. */
const YAHOO_KEY: Record<string, string> = {
  'BTC-USD': 'btc',
  'ETH-USD': 'eth',
  'SOL-USD': 'sol',
  'GC=F': 'gold',
  'SI=F': 'silver',
  'CL=F': 'wti',
  '^GSPC': 'spx',
  '^IXIC': 'ndx',
  '^DJI': 'idx-dji',
  '^NDX': 'idx-ndx',
  '^VIX': 'vix',
  '^TNX': 'tnx',
  'DX-Y.NYB': 'dxy',
  'BRK-B': 'brkb',
  QQQ: 'idx-qqq',
  BND: 'idx-bnd',
  VNQ: 'idx-vnq',
  SMH: 'idx-smh',
  USD: 'idx-usd',
  GLTR: 'idx-gltr',
  CPER: 'idx-cper',
  COPX: 'idx-copx',
};

/** Tickers that are a different thing as a coin than as a stock. */
const COIN_ONLY = new Set(['sol', 'xrp', 'ada', 'doge', 'link', 'avax', 'dot', 'near', 'uni', 'aave', 'matic', 'atom', 'ltc', 'bch', 'trx', 'ton', 'shib', 'pepe', 'bonk', 'wif', 'render', 'rndr', 'inj', 'sui', 'apt', 'arb', 'op', 'sei', 'jup', 'jto', 'pyth', 'w', 'ena', 'btc', 'eth']);

/** The background note for an asset, if we have one. */
export function profileFor(ref: AssetRef): AssetProfile | null {
  const yahoo = (ref.yahoo ?? '').toUpperCase();
  const mapped = YAHOO_KEY[yahoo];
  if (mapped && PROFILES[mapped]) return PROFILES[mapped]!;
  const sym = ref.sym.toLowerCase();
  const isCoin = ref.kind === 'crypto';
  if (isCoin) return COIN_ONLY.has(sym) ? (PROFILES[sym] ?? null) : null;
  if (COIN_ONLY.has(sym)) return null;
  return PROFILES[sym] ?? null;
}
