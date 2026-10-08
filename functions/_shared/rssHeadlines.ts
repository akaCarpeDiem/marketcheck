/**
 * Aggregate public RSS/Atom feeds into headline cards (no API keys).
 * Light regex parse — Workers-safe, no DOM / heavy XML libs.
 * Mixes free YouTube channel Atom feeds (no API key) with a per-category video cap.
 * Prefers “big stories”: major outlets, YT view floors, cross-feed title consensus.
 */

import { makeCache, mapPool } from './cache';

export type HeadlineCategory =
  | 'tradfi'
  | 'crypto'
  | 'politics'
  | 'housing'
  | 'web3nfts'
  | 'health'
  | 'longevity'
  | 'technology'
  | 'ai'
  | 'robotics'
  | 'genart'
  | 'podcasts';

export type HeadlineMediaType = 'article' | 'video';

export type HeadlineItem = {
  id: string;
  title: string;
  link: string;
  summary: string;
  image: string | null;
  source: string;
  publishedAt: string | null;
  publishedMs: number | null;
  mediaType: HeadlineMediaType;
  /** YouTube media:statistics views when present */
  views?: number | null;
};

export type HeadlinesResult = {
  category: HeadlineCategory;
  items: HeadlineItem[];
  feedsUsed: string[];
  feedsFailed: string[];
  thin: boolean;
  note: string | null;
  stale: boolean;
  fetchedAt: string;
};

type FeedDef = {
  name: string;
  url: string;
  /** If set, keep only items whose title/summary match. */
  keywordFilter?: RegExp;
  /** If set, drop items whose title/summary match (routed to another category). */
  excludeFilter?: RegExp;
  /** YouTube Atom channel feeds → video cards. */
  mediaType?: HeadlineMediaType;
  /** Dedicated on-topic channel/pub — skip CATEGORY_TOPIC gate. */
  trustedTopic?: boolean;
  /** YouTube channel id — used for Piped fallback when Atom is down. */
  ytChannelId?: string;
  /** Piped search query (channel display name). Prefer over feed.name. */
  ytSearchQuery?: string;
  /** Override Shorts/micro-clip duration floor for this feed. */
  minDurationSec?: number;
};

function yt(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/** Spread into video FeedDefs: Atom URL + Piped fallback metadata. */
function ytMeta(channelId: string, searchQuery?: string) {
  return {
    url: yt(channelId),
    mediaType: 'video' as const,
    ytChannelId: channelId,
    ...(searchQuery ? { ytSearchQuery: searchQuery } : {}),
  };
}

const TRADFI_FEEDS: FeedDef[] = [
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { name: 'CNBC Markets', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', trustedTopic: true },
  { name: 'CNBC World', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html' },
  { name: 'NYT Business', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml' },
  { name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', trustedTopic: true },
  { name: 'Guardian Business', url: 'https://www.theguardian.com/uk/business/rss' },
  { name: 'YT CNBC', url: yt('UCvJJ_dzjViJCoLf5uKUTwoA'), mediaType: 'video' },
  { name: 'YT Bloomberg Television', url: yt('UCdK2BueKxC9VxXh7e1Ne4oQ'), mediaType: 'video' },
  { name: 'YT WSJ', url: yt('UCK7tptUDHh-RYDsdxO1-5QQ'), mediaType: 'video' },
  { name: 'YT Yahoo Finance', url: yt('UCEAZeUIeJs0IjQiqTCdVSIg'), mediaType: 'video' },
  { name: 'YT Reuters', url: yt('UChqUTb7kYRX8-EiaN3XFrSQ'), mediaType: 'video' },
  { name: 'YT Bloomberg Tech', url: yt('UCrM7B7SL_g1edFOnmj-SDKg'), mediaType: 'video' },
];


/** Crypto *policy / legislation* → Finance in Politics (not Crypto market feed). */
const CRYPTO_POLICY_EXCLUDE =
  /\b(Clarity\s*Act|CLARITY\s*Act|GENIUS\s*Act|FIT\s*21|FIT21|crypto\s+market\s+structure|digital\s+asset\s+market\s+structure|market\s+structure\s+bill|crypto\s+legislation|crypto\s+(bill|bills)\b|House\s+crypto\s+bill|Senate\s+crypto\s+bill|Lummis|Gillibrand\s+crypto|SEC\s+crypto\s+(bill|rules?|regulation)|CFTC\s+crypto\s+(bill|jurisdiction))\b/i;

const CRYPTO_FEEDS_RAW: FeedDef[] = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', trustedTopic: true },
  {
    name: 'BBC Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    keywordFilter:
      /\b(crypto|bitcoin|ethereum|blockchain|stablecoin|web3|token|SEC|ETF|coinbase|binance|kraken)\b/i,
  },
  {
    name: 'NYT Technology',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
    keywordFilter:
      /\b(crypto|bitcoin|ethereum|blockchain|stablecoin|web3|token|SEC|ETF|coinbase|binance|kraken|nft)\b/i,
  },
  {
    name: 'CNBC Crypto/Fintech',
    url: 'https://www.cnbc.com/id/10000113/device/rss/rss.html',
    keywordFilter:
      /\b(crypto|bitcoin|ethereum|blockchain|stablecoin|web3|digital asset|coinbase|binance|kraken|ETF)\b/i,
  },
  {
    name: 'Guardian Technology',
    url: 'https://www.theguardian.com/technology/rss',
    keywordFilter:
      /\b(crypto|bitcoin|ethereum|blockchain|stablecoin|web3|coinbase|binance)\b/i,
  },
  { name: 'YT CoinDesk', url: yt('UC7TghOL755nBk7HelHoi9LQ'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Coin Bureau', url: yt('UCqK_GSMbpiV8spgD3ZGloSw'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Bankless', url: yt('UCAl9Ld79qaZxp9JzEOwd3aA'), mediaType: 'video', trustedTopic: true },
  { name: 'YT The Defiant', url: yt('UCL0J4MLEdLP0-UyLu0hCktg'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Altcoin Daily', url: yt('UCbLhGKVY-bJPcawebgtNfbw'), mediaType: 'video', trustedTopic: true },
  { name: 'YT a16z', url: yt('UC9cn0TuPq4dnbTY-CBsm8XA'), mediaType: 'video', trustedTopic: true },
];

const CRYPTO_FEEDS: FeedDef[] = CRYPTO_FEEDS_RAW.map((f) => ({
  ...f,
  excludeFilter: CRYPTO_POLICY_EXCLUDE,
}));

const POLITICS_KEYWORDS =
  /\b(SEC|CFTC|bill\b|legislation|regulat|hearing|ETF|crypto|bitcoin|ethereum|blockchain|DeFi|stablecoin|tokeniz|Clarity Act|CLARITY Act|GENIUS Act|FIT21|FIT 21|market structure bill|MiCA|banking|Federal Reserve|\bFed\b|treasury|FDIC|OCC|CFPB|IPO|commodit|sanctions|tariff|trade war|financial|markets?\b|DOJ)\b/i;

const POLITICS_FEEDS: FeedDef[] = [
  { name: 'SEC Press', url: 'https://www.sec.gov/news/pressreleases.rss', trustedTopic: true },
  { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', trustedTopic: true },
  {
    name: 'NYT Politics',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml',
    keywordFilter: POLITICS_KEYWORDS,
  },
  {
    name: 'NYT Business',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
    keywordFilter: POLITICS_KEYWORDS,
  },
  {
    name: 'BBC Business',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    keywordFilter: POLITICS_KEYWORDS,
  },
  {
    name: 'Guardian US News',
    url: 'https://www.theguardian.com/us-news/rss',
    keywordFilter: POLITICS_KEYWORDS,
  },
  {
    name: 'CoinDesk Policy',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    keywordFilter: POLITICS_KEYWORDS,
  },
  { name: 'YT BBC News', url: yt('UC16niRr50-MSBwiO3YDb3RA'), mediaType: 'video' },
  { name: 'YT WSJ', url: yt('UCK7tptUDHh-RYDsdxO1-5QQ'), mediaType: 'video' },
  { name: 'YT Reuters', url: yt('UChqUTb7kYRX8-EiaN3XFrSQ'), mediaType: 'video', keywordFilter: POLITICS_KEYWORDS },
  { name: 'YT PBS NewsHour', url: yt('UC6ZFN9Tx6xh-skXCuRHCDpQ'), mediaType: 'video', keywordFilter: POLITICS_KEYWORDS },
  { name: 'YT Sky News', url: yt('UCoMdktPbSTixAyNGwb-UYkQ'), mediaType: 'video', keywordFilter: POLITICS_KEYWORDS },
  { name: 'YT CNBC', url: yt('UCvJJ_dzjViJCoLf5uKUTwoA'), mediaType: 'video', keywordFilter: POLITICS_KEYWORDS },
];

const HOUSING_KEYWORDS =
  /\b(housing|mortgage|home\s?prices?|homebuyers?|homeowners?|real\s?estate|REIT|rents?\b|rental|landlord|apartment|condo|house\s?prices?|property\s?market|construction|homebuilder|builder|housing\s?market|Fannie|Freddie|HUD|mortgage\s?rate|refinanc|foreclos|vacancy|Zillow|Redfin)\b/i;

const HOUSING_FEEDS: FeedDef[] = [
  { name: 'NYT Real Estate', url: 'https://rss.nytimes.com/services/xml/rss/nyt/RealEstate.xml', trustedTopic: true },
  { name: 'Guardian Housing', url: 'https://www.theguardian.com/money/property/rss', trustedTopic: true },
  {
    name: 'Guardian Money',
    url: 'https://www.theguardian.com/uk/money/rss',
    keywordFilter: HOUSING_KEYWORDS,
  },
  {
    name: 'BBC Business',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    keywordFilter: HOUSING_KEYWORDS,
  },
  {
    name: 'CNBC Real Estate',
    url: 'https://www.cnbc.com/id/10000115/device/rss/rss.html',
    keywordFilter: HOUSING_KEYWORDS,
  },
  { name: 'YT CNBC', url: yt('UCvJJ_dzjViJCoLf5uKUTwoA'), mediaType: 'video', keywordFilter: HOUSING_KEYWORDS },
  { name: 'YT Redfin', url: yt('UCMIuo1QSGcmWnevT9jdC_Ow'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Zillow', url: yt('UCzY5ButfegucMnsF2JeyGGQ'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Yahoo Finance', url: yt('UCEAZeUIeJs0IjQiqTCdVSIg'), mediaType: 'video', keywordFilter: HOUSING_KEYWORDS },
  { name: 'YT WSJ', url: yt('UCK7tptUDHh-RYDsdxO1-5QQ'), mediaType: 'video', keywordFilter: HOUSING_KEYWORDS },
];

const WEB3_NFT_KEYWORDS =
  /\b(NFTs?|non-?fungible|Pudgy(\s?Penguins?)?|Claynosaurz|Claynos?|VeeFriends|Bored\s?Ape|BAYC|MAYC|Azuki|Yuga(\s?Labs)?|Doodles|Moonbirds|CryptoPunks?|Otherdeed|OpenSea|Blur|Magic\s?Eden|Web3\s?IPs?|digital\s?(art|collectibles?)|NFT\s?(market|brand|project|collection|drop)|IP\s?(expans|licensing|deal)|brand\s?deal|Lil\s?Pudgys?|collectibles?\s?market|onchain\s?(art|collect|game|gacha)|PFPs?|tokenized\s+(art|collectibles?|NFTs?))\b/i;

const WEB3_NFT_FEEDS: FeedDef[] = [
  { name: 'NFT Now', url: 'https://nftnow.com/feed/', trustedTopic: true },
  {
    name: 'Cointelegraph NFT',
    url: 'https://cointelegraph.com/rss/tag/nft',
    trustedTopic: true,
  },
  {
    name: 'Decrypt',
    url: 'https://decrypt.co/feed',
    keywordFilter: WEB3_NFT_KEYWORDS,
  },
  {
    name: 'CoinDesk NFT/IP',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    keywordFilter: WEB3_NFT_KEYWORDS,
  },
  {
    name: 'NYT Technology',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
    keywordFilter: WEB3_NFT_KEYWORDS,
  },
  {
    name: 'Guardian Technology',
    url: 'https://www.theguardian.com/technology/rss',
    keywordFilter: WEB3_NFT_KEYWORDS,
  },
  {
    name: 'BBC Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    keywordFilter: WEB3_NFT_KEYWORDS,
  },
  {
    name: 'CNBC Tech',
    url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html',
    keywordFilter: WEB3_NFT_KEYWORDS,
  },
  // Dedicated NFT / IP channels — trustedTopic so they skip keyword gate
  { name: 'YT Claynosaurz', ...ytMeta('UCIXKkJanuzJg245XdSaSUyA', 'Claynosaurz'), trustedTopic: true, minDurationSec: 45 },
  { name: 'YT NFT Now', ...ytMeta('UCjR2QcqnpHsIa72H1PzTNYQ', 'NFT Now'), trustedTopic: true, minDurationSec: 45 },
  { name: 'YT Pudgy Penguins', ...ytMeta('UCh884Rm4plIxpdRG00FDfVg', 'Pudgy Penguins'), trustedTopic: true, minDurationSec: 45 },
  { name: 'YT VeeFriends', ...ytMeta('UCySXUdGjzVwFai8U03H-vGw', 'VeeFriends'), trustedTopic: true, minDurationSec: 45 },
  { name: 'YT CoinDesk', ...ytMeta('UC7TghOL755nBk7HelHoi9LQ', 'CoinDesk'), mediaType: 'video', keywordFilter: WEB3_NFT_KEYWORDS },
  { name: 'YT Decrypt', ...ytMeta('UC-dmTM1R31S8uFgPmexxkNg', 'Decrypt'), mediaType: 'video', keywordFilter: WEB3_NFT_KEYWORDS },
  { name: 'YT Bankless', ...ytMeta('UCAl9Ld79qaZxp9JzEOwd3aA', 'Bankless'), mediaType: 'video', keywordFilter: WEB3_NFT_KEYWORDS },
  { name: 'YT The Defiant', ...ytMeta('UCL0J4MLEdLP0-UyLu0hCktg', 'The Defiant'), mediaType: 'video', keywordFilter: WEB3_NFT_KEYWORDS },
];

const HEALTH_FEEDS: FeedDef[] = [
  { name: 'BBC Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml', trustedTopic: true },
  { name: 'NYT Health', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml', trustedTopic: true },
  { name: 'Guardian Society', url: 'https://www.theguardian.com/society/rss' },
  { name: 'Guardian Health', url: 'https://www.theguardian.com/society/health/rss', trustedTopic: true },
  { name: 'NIH News', url: 'https://www.nih.gov/news-releases/feed.xml', trustedTopic: true },
  { name: 'CNBC Health & Science', url: 'https://www.cnbc.com/id/10000108/device/rss/rss.html' },
  { name: 'STAT', url: 'https://www.statnews.com/feed/', trustedTopic: true },
  { name: 'YT NIH', url: yt('UCcTKzTCQAhW4mpGPyO70mWg'), mediaType: 'video', trustedTopic: true },
  { name: 'YT SciShow', url: yt('UCZYTClx2T1of7BRZ86-8fow'), mediaType: 'video' },
  { name: 'YT NEJM', url: yt('UCqO3GxVYutcugyknCWdAcUA'), mediaType: 'video', trustedTopic: true },
  { name: 'YT AsapSCIENCE', url: yt('UCC552Sd-3nyi_tk2BudLUzA'), mediaType: 'video' },
  { name: 'YT MedCram', url: yt('UCG-iSMVtWbbwDDXgXXypARQ'), mediaType: 'video', trustedTopic: true },
];

const LONGEVITY_KEYWORDS =
  /\b(longevity|aging|ageing|lifespan|healthspan|senolytic|senescence|rapamycin|metformin|NAD\+?|NMN|resveratrol|caloric\s?restrict|epigenetic\s?clock|telomere|GLP-?1|semaglutide|tirzepatide|anti-?aging|geroscience|young\s?blood|partial\s?reprogramming|Yamanaka|autophagy|mTOR|sirtuin)\b/i;

const LONGEVITY_FEEDS: FeedDef[] = [
  { name: 'ScienceDaily Healthy Aging', url: 'https://www.sciencedaily.com/rss/health_medicine/healthy_aging.xml', trustedTopic: true },
  {
    name: 'Nature News',
    url: 'https://www.nature.com/nature.rss',
    keywordFilter: LONGEVITY_KEYWORDS,
  },
  {
    name: 'Guardian Science',
    url: 'https://www.theguardian.com/science/rss',
    keywordFilter: LONGEVITY_KEYWORDS,
  },
  {
    name: 'BBC Health',
    url: 'https://feeds.bbci.co.uk/news/health/rss.xml',
    keywordFilter: LONGEVITY_KEYWORDS,
  },
  {
    name: 'NIH News',
    url: 'https://www.nih.gov/news-releases/feed.xml',
    keywordFilter: LONGEVITY_KEYWORDS,
  },
  { name: 'Fight Aging', url: 'https://www.fightaging.org/feed/', trustedTopic: true },
  { name: 'Lifespan.io', url: 'https://www.lifespan.io/feed/', trustedTopic: true },
  {
    name: 'STAT',
    url: 'https://www.statnews.com/feed/',
    keywordFilter: LONGEVITY_KEYWORDS,
  },
  {
    name: 'YT TED',
    url: yt('UCAuUUnT6oDeKwE6v1NGQxug'),
    mediaType: 'video',
    keywordFilter: LONGEVITY_KEYWORDS,
  },
  {
    name: 'YT Veritasium',
    url: yt('UCHnyfMqiRRG1u-2MsSQLbXA'),
    mediaType: 'video',
    keywordFilter: LONGEVITY_KEYWORDS,
  },
  { name: 'YT Kurzgesagt', url: yt('UCsXVk37bltHxD1rDPwtNM8Q'), mediaType: 'video', keywordFilter: LONGEVITY_KEYWORDS },
  { name: 'YT FoundMyFitness', url: yt('UCWF8SqJVNlx-ctXbLswcTcA'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Peter Attia MD', url: yt('UC8kGsMa0LygSX9nkBcBH1Sg'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Andrew Huberman', url: yt('UC2D2CMWXMOVWx7giW1n3LIg'), mediaType: 'video', keywordFilter: LONGEVITY_KEYWORDS },
];

const TECHNOLOGY_FEEDS: FeedDef[] = [
  { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { name: 'NYT Technology', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml' },
  { name: 'Guardian Technology', url: 'https://www.theguardian.com/technology/rss' },
  { name: 'CNBC Tech', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', trustedTopic: true },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', trustedTopic: true },
  { name: 'NVIDIA Blog', url: 'https://blogs.nvidia.com/feed/', trustedTopic: true },
  { name: 'YT Veritasium', url: yt('UCHnyfMqiRRG1u-2MsSQLbXA'), mediaType: 'video' },
  { name: 'YT ColdFusion', url: yt('UC4QZ_LsYcvcq7qOsOhpAX4A'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Fireship', url: yt('UCsBjURrPoezykLs9EqgamOA'), mediaType: 'video', trustedTopic: true },
  { name: 'YT PBS Space Time', url: yt('UC7_gcs09iThXybpVgjHZ_7g'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Real Engineering', url: yt('UCR1IuLEqb6UEA_zQ81kwXfg'), mediaType: 'video', trustedTopic: true },
  { name: 'YT TechLinked', url: yt('UCeeFfhMcJa1kjtfZAGskOCA'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Linus Tech Tips', url: yt('UCXuqSBlHAE6Xw-yeJA0Tunw'), mediaType: 'video' },
];

const AI_KEYWORDS =
  /\b(AI\b|A\.I\.|artificial intelligence|machine learning|\bLLM\b|large language model|\bGPT\b|ChatGPT|Claude|Gemini|DeepMind|OpenAI|Anthropic|Meta AI|Mistral|Grok|foundation model|transformer|diffusion model|agentic|copilot|Sora|o1\b|o3\b)\b/i;

const AI_FEEDS: FeedDef[] = [
  { name: 'OpenAI News', url: 'https://openai.com/blog/rss.xml', trustedTopic: true },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', trustedTopic: true },
  { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', trustedTopic: true },
  { name: 'The Decoder', url: 'https://the-decoder.com/feed/', trustedTopic: true },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', trustedTopic: true },
  {
    name: 'BBC Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    keywordFilter: AI_KEYWORDS,
  },
  {
    name: 'NYT Technology',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
    keywordFilter: AI_KEYWORDS,
  },
  {
    name: 'Guardian Technology',
    url: 'https://www.theguardian.com/technology/rss',
    keywordFilter: AI_KEYWORDS,
  },
  {
    name: 'CNBC Tech',
    url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html',
    keywordFilter: AI_KEYWORDS,
  },
  { name: 'YT OpenAI', url: yt('UCXZCJLdBC09xxGZ6gcdrc6A'), mediaType: 'video', trustedTopic: true },
  { name: 'YT AI Explained', url: yt('UCNJ1Ymd5yFuUPtn21xtRbbw'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Two Minute Papers', url: yt('UCbfYPyITQ-7l4upoX8nvctg'), mediaType: 'video', trustedTopic: true },
  {
    name: 'YT Lex Fridman',
    url: yt('UCSHZKyawb77ixDdsGog4iWA'),
    mediaType: 'video',
    keywordFilter: AI_KEYWORDS,
  },
  {
    name: 'YT Dwarkesh',
    url: yt('UCXl4i9dYBrFOabk0xGmbkRA'),
    mediaType: 'video',
    keywordFilter: AI_KEYWORDS,
  },
];

/** Must be about generative / AI-created art & media — not generic “generative AI” news. */
const GENART_KEYWORDS =
  /\b(generative\s+arts?|gen[\s-]?arts?|AI[\s-]?arts?|neural\s+arts?|procedural\s+arts?|AI[\s-]?generated\s+(art|arts|image|images|film|films|movie|movies|video|videos|animation|animations|music|ad|ads|advert|commercial|spot)|text[\s-]?to[\s-]?(image|video|film)|image[\s-]?generat(or|ion|ive)|video[\s-]?generat(or|ion|ive)|AI\s+(filmmaking|animation|illustrat\w*|design\s+tool)|Midjourney|Stable\s+Diffusion|DALL-?E|DALL·E|Runway(\s*(ML|Gen-?\d))?\b|Pika(\s+Labs)?\b|Luma(\s+(AI|Dream|Dream\s*Machine))?\b|Kling(\s+AI)?\b|\bSora\b|Flux\.(1|Dev|Schnell|Pro)|Ideogram|Leonardo[\s-]?AI|Firefly\b|Adobe\s+Firefly|Gen-?[123]\s+Alpha|AI[\s-]?generated\s+content\s+in\s+(film|movies?|ads?|advertising|fashion|music)|((film|movie|advertising|commercial|ad\s+campaign|fashion\s+campaign|exhibition|museum|gallery|music\s+video|TV\s+show|trailer).{0,48}(generative|AI[\s-]?generated|Midjourney|Runway|Sora|Stable\s+Diffusion|DALL-?E))|((generative|AI[\s-]?generated|Midjourney|Runway|Sora|Stable\s+Diffusion|DALL-?E).{0,48}(film|movie|advertising|commercial|exhibition|museum|gallery|music\s+video|fashion|trailer)))\b/i;

/** Drop generic LLM / chip / chatbot stories that only mention “AI”. */
const GENART_EXCLUDE =
  /\b(semiconductor|data\s+center|cybersecurity|ransomware|interest\s+rate|coding (assistant|agent)|\bLLM\s+benchmark)\b/i;

const GENART_FEEDS: FeedDef[] = [
  {
    name: 'MIT Technology Review',
    url: 'https://www.technologyreview.com/feed/',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'Guardian Technology',
    url: 'https://www.theguardian.com/technology/rss',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'BBC Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'Creative Bloq',
    url: 'https://www.creativebloq.com/feed',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'Dezeen',
    url: 'https://www.dezeen.com/feed/',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'Designboom',
    url: 'https://www.designboom.com/feed/',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'OpenAI News',
    url: 'https://openai.com/blog/rss.xml',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  // Dedicated gen-media channels — channel IS the topic
  { name: 'YT Runway', url: yt('UCUBqu_z5uP0AZhYtuyFZB3g'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Midjourney', url: yt('UCldFPBqAVrok5DPUQeSMEqQ'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Stability AI', url: yt('UCpi_ULPErwrxGTDWZey5azQ'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Pika Labs', url: yt('UC0SclYU4iiQRihtmDnak-gQ'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Luma AI', url: yt('UC2U1evSGm5bAiKbVDTX36bw'), mediaType: 'video', trustedTopic: true },
  {
    name: 'YT Corridor Crew',
    url: yt('UCSpFnDQr88xCZ80N-X7t0nQ'),
    mediaType: 'video',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'YT OpenAI',
    url: yt('UCXZCJLdBC09xxGZ6gcdrc6A'),
    mediaType: 'video',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'YT Matt Wolfe',
    url: yt('UChpleBmo18P08aKCIgti38g'),
    mediaType: 'video',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
  {
    name: 'YT TED',
    url: yt('UCAuUUnT6oDeKwE6v1NGQxug'),
    mediaType: 'video',
    keywordFilter: GENART_KEYWORDS,
    excludeFilter: GENART_EXCLUDE,
  },
];


/** Real robots / humanoids / cobots / named robotics cos — not phones, cars, or “automation”. */
const ROBOTICS_KEYWORDS =
  /\b(robots?|robotics|humanoids?|cobots?|industrial\s+robots?|Boston\s+Dynamics|Figure\s*AI|Tesla\s+Optimus|\bOptimus\b|Agility\s+Robotics|Apptronik|1X\s+(Technologies|Robotics)|Sanctuary\s+AI|Unitree|Atlas\b|Spot\s+robot|robot\s+dog|warehouse\s+robots?|surgical\s+robots?|Intuitive\s+Surgical|da\s+Vinci\s+(surgical|robot)|mechatronics|bipedal\s+robot|quadruped(\s+robot)?|robotic\s+(arm|arms|surgeon|assistant|system|exoskeleton|manipulation)|exoskeleton|end[\s-]?effector|actuator\s+for\s+robots?|Isaac\s+(Lab|Sim|ROS)|ROS\s*2?\b)\b/i;

const ROBOTICS_EXCLUDE =
  /\b(Android\s+(phone|app|OS|15|14|13|update|smartphone)|Galaxy\s+S\d|Pixel\s+\d|iPhone|self[\s-]driving\s+car|autonomous\s+(car|vehicle|driving|taxi)|robotaxi|Waymo|Cruise\b|marketing\s+automation|test\s+automation|home\s+automation|RPA\b|software\s+robot|chatbot|trading\s+bot)\b/i;

const ROBOTICS_FEEDS: FeedDef[] = [
  // Dedicated robotics pubs — trusted on-topic
  { name: 'IEEE Spectrum Robotics', url: 'https://spectrum.ieee.org/feeds/topic/robotics.rss', trustedTopic: true },
  { name: 'The Robot Report', url: 'https://www.therobotreport.com/feed/', trustedTopic: true },
  {
    name: 'MIT Technology Review',
    url: 'https://www.technologyreview.com/feed/',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'BBC Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'NYT Technology',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'Guardian Technology',
    url: 'https://www.theguardian.com/technology/rss',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'CNBC Tech',
    url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'NVIDIA Blog',
    url: 'https://blogs.nvidia.com/feed/',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  // Videos / talks
  {
    name: 'YT Boston Dynamics',
    url: yt('UC7vVhkEfw4nOGp8TyDk7RcQ'),
    mediaType: 'video',
    trustedTopic: true,
  },
  { name: 'YT Figure AI', url: yt('UCYlq-KmwPjc1DtsGmthFqSQ'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Unitree Robotics', url: yt('UCsMbp4V8oxzHCMdOUP-3oWw'), mediaType: 'video', trustedTopic: true },
  { name: 'YT Agility Robotics', url: yt('UCN-StetwWuVYf-MU2_NVj4A'), mediaType: 'video', trustedTopic: true },
  {
    name: 'YT TED',
    url: yt('UCAuUUnT6oDeKwE6v1NGQxug'),
    mediaType: 'video',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'YT Two Minute Papers',
    url: yt('UCbfYPyITQ-7l4upoX8nvctg'),
    mediaType: 'video',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
  {
    name: 'YT Veritasium',
    url: yt('UCHnyfMqiRRG1u-2MsSQLbXA'),
    mediaType: 'video',
    keywordFilter: ROBOTICS_KEYWORDS,
    excludeFilter: ROBOTICS_EXCLUDE,
  },
];


/** Podcasts — recent YouTube episodes only (no article RSS). */
const PODCASTS_FEEDS: FeedDef[] = [
  { name: 'YT Joe Rogan Experience', ...ytMeta('UCzQUP1qoWDoEbmsQxvdjxgQ', 'PowerfulJRE'), trustedTopic: true },
  { name: 'YT The Diary Of A CEO', ...ytMeta('UCGq-a57w-aPwyi3pW7XLiHw', 'The Diary Of A CEO'), trustedTopic: true },
  { name: 'YT Theo Von', ...ytMeta('UC5AQEUAwCh1sGDvkQtkDWUQ', 'Theo Von'), trustedTopic: true },
  { name: 'YT Caleb Hammer', ...ytMeta('UCLe_q9axMaeTbjN0hy1Z9xA', 'Caleb Hammer'), trustedTopic: true },
  { name: 'YT a16z', ...ytMeta('UC9cn0TuPq4dnbTY-CBsm8XA', 'a16z'), trustedTopic: true },
];

const FEEDS_BY_CAT: Record<HeadlineCategory, FeedDef[]> = {
  tradfi: TRADFI_FEEDS,
  crypto: CRYPTO_FEEDS,
  politics: POLITICS_FEEDS,
  housing: HOUSING_FEEDS,
  web3nfts: WEB3_NFT_FEEDS,
  health: HEALTH_FEEDS,
  longevity: LONGEVITY_FEEDS,
  technology: TECHNOLOGY_FEEDS,
  ai: AI_FEEDS,
  robotics: ROBOTICS_FEEDS,
  genart: GENART_FEEDS,
  podcasts: PODCASTS_FEEDS,
};

/** Post-fetch topic gates — applied after parse for non-trusted feeds. */
const TRADFI_TOPIC =
  /\b(markets?|stocks?|bonds?|Fed\b|inflation|earnings|Wall Street|S&P|Nasdaq|Dow|Treasury|IPO|ETF|recession|interest rates?)\b/i;

const CRYPTO_TOPIC =
  /\b(crypto|bitcoin|ethereum|blockchain|stablecoin|web3|token|defi|solana|NFTs?)\b/i;

const POLITICS_TOPIC =
  /\b(election|congress|senate|white house|bill\b|policy|Fed chair|regulation|tariff|president|democrat|republican|Clarity Act|GENIUS|SEC|CFTC|legislation|Federal Reserve|\bFed\b)\b/i;

const HOUSING_TOPIC =
  /\b(housing|mortgage|home prices?|rent|real estate|Zillow|Redfin|Fannie|Freddie|housing market|homebuyers?|REIT)\b/i;

const WEB3_NFT_TOPIC =
  /\b(NFTs?|web3|opensea|blur\b|mint\b|collection|digital arts?|crypto arts?|non-?fungible|Pudgy|Claynosaurz|VeeFriends|BAYC|Azuki|Yuga|CryptoPunks?|collectibles?)\b/i;

const HEALTH_TOPIC =
  /\b(health|hospital|FDA|disease|vaccine|cancer|medical|clinical|WHO\b|CDC|NIH|patient|therapy|drug)\b/i;

const TECHNOLOGY_TOPIC =
  /\b(tech|software|hardware|chips?|semiconductor|startup|Apple|Google|Microsoft|NVIDIA|gadget|cyber|AI\b|robot|cloud|app\b|smartphone|GPU|CPU|quantum)\b/i;

const CATEGORY_TOPIC: Record<HeadlineCategory, RegExp | null> = {
  tradfi: TRADFI_TOPIC,
  crypto: CRYPTO_TOPIC,
  politics: POLITICS_TOPIC,
  housing: HOUSING_TOPIC,
  web3nfts: WEB3_NFT_TOPIC,
  health: HEALTH_TOPIC,
  longevity: LONGEVITY_KEYWORDS,
  technology: TECHNOLOGY_TOPIC,
  ai: AI_KEYWORDS,
  robotics: ROBOTICS_KEYWORDS,
  genart: GENART_KEYWORDS,
  podcasts: null, // all feeds trustedTopic — videos only
};

function matchesCategory(category: HeadlineCategory, item: HeadlineItem, feed: FeedDef): boolean {
  if (feed.trustedTopic) return true;
  const re = CATEGORY_TOPIC[category];
  if (!re) return true;
  const hay = `${item.title} ${item.summary}`;
  return re.test(hay);
}

/** Source reach tiers — prefer household-name outlets for “big story” ranking. */
const SOURCE_TIER: Record<string, number> = {
  'BBC Business': 3,
  'BBC Technology': 3,
  'BBC Health': 3,
  'BBC News': 3,
  'NYT Business': 3,
  'NYT Technology': 3,
  'NYT Politics': 3,
  'NYT Health': 3,
  'NYT Real Estate': 3,
  'WSJ Markets': 3,
  'WSJ': 3,
  'CNBC Markets': 3,
  'CNBC World': 3,
  'CNBC Crypto/Fintech': 3,
  'CNBC Tech': 3,
  'Guardian Business': 2,
  'Guardian Technology': 2,
  'Guardian US News': 2,
  'Guardian Health': 2,
  'Guardian Housing': 2,
  'The Verge': 3,
  'Ars Technica': 3,
  'MIT Technology Review': 3,
  'TechCrunch': 3,
  'TechCrunch AI': 3,
  'CoinDesk': 3,
  'SEC Press': 2,
  'Federal Reserve': 3,
  'STAT': 3,
  'NIH News': 2,
  'IEEE Spectrum Robotics': 3,
  'The Robot Report': 2,
  'OpenAI News': 3,
  'Google DeepMind': 3,
  'NVIDIA Blog': 2,
  'YT CNBC': 3,
  'YT Bloomberg Television': 3,
  'YT WSJ': 3,
  'YT BBC News': 3,
  'YT CoinDesk': 2,
  'YT Veritasium': 3,
  'YT Kurzgesagt': 3,
  'YT Two Minute Papers': 2,
  'YT OpenAI': 3,
  'YT AI Explained': 2,
  'YT Boston Dynamics': 3,
  'YT Figure AI': 2,
  'YT Unitree Robotics': 2,
  'YT Agility Robotics': 2,
  'YT TED': 3,
  'YT Runway': 2,
  'YT Midjourney': 2,
  'YT Stability AI': 2,
  'YT Pika Labs': 2,
  'YT Luma AI': 2,
  'YT ColdFusion': 2,
  'YT Fireship': 2,
  'YT PBS Space Time': 2,
  'YT Lex Fridman': 2,
  'YT Dwarkesh': 2,
  'YT Corridor Crew': 2,
  'YT Matt Wolfe': 1,
  'YT a16z': 2,
  'YT Joe Rogan Experience': 3,
  'YT The Diary Of A CEO': 3,
  'YT Theo Von': 3,
  'YT Caleb Hammer': 2,
  'YT Bloomberg Tech': 3,
  'YT PBS NewsHour': 3,
  'YT Redfin': 2,
  'YT Zillow': 2,
  'YT NIH': 2,
  'YT SciShow': 2,
  'YT NEJM': 2,
  'Creative Bloq': 2,
  'Dezeen': 2,
  'Designboom': 2,
  'The Decoder': 2,
'CNBC Health & Science': 2,
  'CNBC Real Estate': 2,
  'CoinDesk NFT/IP': 2,
  'CoinDesk Policy': 2,
  'Cointelegraph NFT': 2,
  'Cointelegraph': 2,
  'Guardian Money': 2,
  'Guardian Science': 2,
  'Guardian Society': 2,
  'Nature News': 3,
  'YT Verge Science': 2,
  'YT TED-Ed': 2,
  'YT Vsauce': 2,
  'YT Numberphile': 2,
  'YT 3Blue1Brown': 2,
  'YT Mark Rober': 2,
  'YT Stuff Made Here': 2,
  'YT Simone Giertz': 2,
  'YT Adam Savage’s Tested': 2,
  'YT Real Engineering': 2,
  'YT Verge': 2,
  'YT TechLinked': 2,
  'YT Linus Tech Tips': 2,
  'YT Marques Brownlee': 3,
  'YT Bloomberg Technology': 3,
  'YT Reuters': 3,
  'YT Sky News': 2,
  'YT Al Jazeera English': 2,
  'YT The Wall Street Journal': 3,
  'YT Yahoo Finance': 2,
  'YT Investopedia': 1,
  'YT Altcoin Daily': 2,
  'YT Coin Bureau': 2,
  'YT Whiteboard Crypto': 1,
  'YT Bankless': 2,
  'YT The Defiant': 2,
  'YT Decrypt': 2,
  'YT NFT Now': 1,
  'YT Premonition': 1,
  'YT Artnome': 1,
  'YT Art Basel': 2,
  'YT MoMA': 2,
  'YT The Museum of Modern Art': 2,
  'YT Sotheby’s': 2,
  'YT Christie’s': 2,
  'YT Design Milk': 1,
  'YT Freethink': 2,
  'YT SciShow Psych': 2,
  'YT AsapSCIENCE': 2,
  'YT Healthcare Triage': 1,
  'YT MedCram': 2,
  'YT Dr. Mike': 1,
  'YT Longevity Science': 1,
  'YT Lifespan with Dr. David Sinclair': 2,
  'YT Rhonda Patrick': 2,
  'YT FoundMyFitness': 2,
  'YT Peter Attia MD': 2,
  'YT Andrew Huberman': 2,
};

/** Niche / low-reach sources — drop from “big stories” pass. */
const LOW_REACH = new Set([
  'Fight Aging',
  'Lifespan.io',
  'ScienceDaily Healthy Aging',
  'Hugging Face Blog',
]);

const MIN_YT_VIEWS = 25_000;
/** Podcasts / niche web3 often land under the global floor; keep Shorts blocked. */
const MIN_YT_VIEWS_BY_CAT: Partial<Record<HeadlineCategory, number>> = {
  podcasts: 8_000,
  web3nfts: 5_000,
};
/** ~4 weeks so thinner categories (esp. web3/NFTs) still fill TARGET_COUNT. */
const MAX_STORY_AGE_MS = 28 * 24 * 60 * 60 * 1000; // 28 days
const MAX_STORY_AGE_BY_CAT: Partial<Record<HeadlineCategory, number>> = {
  // NFT / web3 IP news is sparse — keep ~3 months so category stays filled
  web3nfts: 90 * 24 * 60 * 60 * 1000,
};

function maxStoryAgeMs(category: HeadlineCategory): number {
  return MAX_STORY_AGE_BY_CAT[category] ?? MAX_STORY_AGE_MS;
}

function sourceTier(name: string): number {
  if (SOURCE_TIER[name] != null) return SOURCE_TIER[name]!;
  if (name.startsWith('YT ')) return 1;
  return 1;
}

function titleFingerprint(title: string): string {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'at', 'by', 'from',
    'is', 'are', 'was', 'be', 'its', 'it', 'this', 'that', 'new', 'how', 'why', 'what',
  ]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 8)
    .join(' ');
}

function parseYtViews(block: string): number | null {
  const m =
    block.match(/<media:statistics\b[^>]*\bviews\s*=\s*["'](\d+)["']/i) ??
    block.match(/\bviews\s*=\s*["'](\d+)["']/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isBigEnough(item: HeadlineItem, category?: HeadlineCategory): boolean {
  // web3nfts: keep niche NFT outlets (was filtering the whole category empty)
  if (category !== 'web3nfts' && LOW_REACH.has(item.source)) return false;
  // Skip YouTube Shorts — rarely “big story” framing
  if (/\/shorts\//i.test(item.link)) return false;
  if (item.mediaType === 'video') {
    const v = item.views;
    if (v == null) {
      // web3: allow trusted / mid-tier channels without stats
      if (category === 'web3nfts') return sourceTier(item.source) >= 1;
      return sourceTier(item.source) >= 3; // major YT channels without stats: allow
    }
    const floor =
      (category != null ? MIN_YT_VIEWS_BY_CAT[category] : undefined) ?? MIN_YT_VIEWS;
    return v >= floor;
  }
  // Articles: mid/high tier; web3nfts allows any known outlet (tier >= 1)
  if (category === 'web3nfts') return sourceTier(item.source) >= 1;
  return sourceTier(item.source) >= 2;
}


/** Soft priority boosts — Optimus (robotics) / Claynosaurz (web3nfts) float to top. */
const OPTIMUS_RE =
  /\b(Optimus|Tesla\s+Optimus|Tesla\s+(?:robot|humanoid|bot)|Optimus\s+(?:robot|humanoid|Gen\s*[0-9]))\b/i;
const CLAYNO_RE = /\b(Claynosaurz|Claynos?)\b/i;

function categoryPriorityBoost(category: HeadlineCategory, item: HeadlineItem): number {
  const text = `${item.title} ${item.summary}`;
  if (category === 'robotics' && OPTIMUS_RE.test(text)) return 1_000_000;
  if (category === 'web3nfts' && CLAYNO_RE.test(text)) return 1_000_000;
  return 0;
}

function storyScore(item: HeadlineItem, consensus: number): number {
  const tier = sourceTier(item.source);
  const ageMs = item.publishedMs != null ? Date.now() - item.publishedMs : MAX_STORY_AGE_MS;
  const freshness = Math.max(0, 1 - ageMs / MAX_STORY_AGE_MS);
  const viewBoost =
    item.views != null && item.views > 0 ? Math.min(3, Math.log10(item.views) - 3) : 0;
  return consensus * 40 + tier * 12 + freshness * 20 + viewBoost * 8;
}

const CACHE_TTL_MS = 7 * 60_000; // ~7 min
const FETCH_TIMEOUT_MS = 10_000;
const TARGET_COUNT = 12;
const THIN_THRESHOLD = 4;
const VIDEO_CAP = 7; // default max YouTube videos mixed into each category
const VIDEO_CAP_BY_CAT: Partial<Record<HeadlineCategory, number>> = {
  robotics: 9,
  genart: 8,
  web3nfts: 9,
  podcasts: TARGET_COUNT, // videos-only category — fill all slots
};

const cache = makeCache<HeadlinesResult>(CACHE_TTL_MS);

const UA = 'Mozilla/5.0 (compatible; MarketCheckDash/1.0; +/market-clock)';

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return Number.isFinite(c) ? String.fromCharCode(c) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const c = parseInt(h, 16);
      return Number.isFinite(c) ? String.fromCharCode(c) : _;
    });
}

function stripHtml(s: string): string {
  return decodeEntities(s)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    'i',
  );
  const m = block.match(re);
  if (!m) return null;
  const raw = decodeEntities(m[1]!.trim());
  return stripHtml(raw) || null;
}

function tagAttr(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'i');
  const m = block.match(re);
  if (!m) return null;
  const attrs = m[1] ?? '';
  const am = attrs.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return am ? decodeEntities(am[1]!.trim()) : null;
}

/** Atom: <link href="..." /> or rel=alternate */
function atomLink(block: string): string | null {
  const links = block.match(/<link\b[^>]*>/gi) ?? [];
  for (const l of links) {
    const rel = l.match(/rel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const href = l.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href && (!rel || rel === 'alternate')) return decodeEntities(href.trim());
  }
  // RSS <link>text</link>
  const text = tagText(block, 'link');
  if (text && /^https?:\/\//i.test(text)) return text;
  return null;
}

function getAttr(attrs: string, name: string): string | null {
  const am = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return am ? decodeEntities(am[1]!.trim()) : null;
}

function getNumAttr(attrs: string, name: string): number | null {
  const v = getAttr(attrs, name);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Obvious tracking / icon junk — never use as card media. */
const IMAGE_JUNK_RE = /favicon|sprite|1x1|pixel\.|\/icon[_-]?\d|emoji|tracking/i;

/**
 * Normalize YouTube thumbs to hq720.
 * Avoid maxresdefault — missing maxres often returns a gray 120×90 placeholder (HTTP 200).
 */
function upgradeYoutubeThumb(url: string): string {
  if (!/i\.ytimg\.com/i.test(url)) return url;
  return url.replace(
    /\/(maxresdefault|hqdefault|mqdefault|sddefault|hq720|default)\.jpg(\?[^#]*)?(#.*)?$/i,
    '/hq720.jpg$2$3',
  );
}

type ImgCandidate = { url: string; score: number };

function scoreImageCandidate(url: string, width: number | null, height: number | null): number | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (IMAGE_JUNK_RE.test(url)) return null;

  let w = width;
  let h = height;
  // Treat hq720 / maxres YouTube as HD-ish when dimensions unknown
  if (/hq720|maxresdefault/i.test(url)) {
    w = Math.max(w ?? 0, 1280) || 1280;
    h = Math.max(h ?? 0, 720) || 720;
  }

  if (w != null && h != null && w < 320 && h < 180) return null;

  let score: number;
  if (w != null && h != null) {
    score = w * h;
  } else if (w != null) {
    score = w * 400;
  } else if (h != null) {
    score = 700 * h;
  } else {
    // Unknown size — acceptable but ranked below known HD
    score = 50_000;
  }

  if ((w != null && w >= 640) || (h != null && h >= 360)) {
    score += 2_000_000;
  }

  if (/hq720/i.test(url)) score += 800_000;
  else if (/maxresdefault|sddefault/i.test(url)) score += 400_000;
  else if (/hqdefault/i.test(url)) score += 200_000;
  else if (/mqdefault|\/default\.jpg/i.test(url)) score += 50_000;

  return score;
}

function pushImageCandidate(
  out: ImgCandidate[],
  url: string | null | undefined,
  width: number | null,
  height: number | null,
): void {
  if (!url) return;
  const upgraded = upgradeYoutubeThumb(url);
  const variants = upgraded !== url ? [upgraded, url] : [url];
  for (const u of variants) {
    const score = scoreImageCandidate(u, width, height);
    if (score == null) continue;
    out.push({ url: u, score });
  }
}

/**
 * Pick the best HD-ish image from media tags, enclosures, and inline <img>.
 * Returns null when no acceptable candidate exists.
 */
function extractImage(block: string): string | null {
  const candidates: ImgCandidate[] = [];

  for (const tag of ['media:content', 'media:thumbnail']) {
    const re = new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      const attrs = m[1] ?? '';
      const medium = (getAttr(attrs, 'medium') ?? '').toLowerCase();
      // Skip non-image media:content (e.g. video file URLs)
      if (tag === 'media:content' && medium && medium !== 'image') continue;
      const url = getAttr(attrs, 'url');
      const w = getNumAttr(attrs, 'width');
      const h = getNumAttr(attrs, 'height');
      pushImageCandidate(candidates, url, w, h);
    }
  }

  const encs = block.match(/<enclosure\b[^>]*>/gi) ?? [];
  for (const e of encs) {
    const type = e.match(/type\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
    const urlRaw = e.match(/url\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = urlRaw ? decodeEntities(urlRaw.trim()) : null;
    if (!url) continue;
    if (!/^image\//i.test(type) && !/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) continue;
    const w = getNumAttr(e, 'width');
    const h = getNumAttr(e, 'height');
    pushImageCandidate(candidates, url, w, h);
  }

  for (const tag of ['description', 'content:encoded', 'summary', 'content', 'media:description']) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = block.match(re);
    if (!m) continue;
    const inner = decodeEntities(m[1]!);
    const imgRe = /<img\b([^>]*)>/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(inner))) {
      const attrs = im[1] ?? '';
      const src = getAttr(attrs, 'src');
      const w = getNumAttr(attrs, 'width');
      const h = getNumAttr(attrs, 'height');
      pushImageCandidate(candidates, src, w, h);
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.url;
}

function parsePublished(raw: string | null): { iso: string | null; ms: number | null } {
  if (!raw) return { iso: null, ms: null };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { iso: null, ms: null };
  return { iso: d.toISOString(), ms: d.getTime() };
}

function snippetFrom(block: string): string {
  for (const tag of ['description', 'summary', 'content:encoded', 'content']) {
    const t = tagText(block, tag);
    if (t && t.length > 20) {
      return t.length > 180 ? `${t.slice(0, 177)}…` : t;
    }
  }
  return '';
}

function parseFeedXml(xml: string, feed: FeedDef): HeadlineItem[] {
  const items: HeadlineItem[] = [];
  const blocks = [
    ...(xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []),
  ];

  for (const block of blocks) {
    const title = tagText(block, 'title');
    const link = atomLink(block);
    if (!title || !link) continue;

    const summary = snippetFrom(block);
    const hay = `${title} ${summary}`;
    if (feed.keywordFilter && !feed.keywordFilter.test(hay)) continue;
    if (feed.excludeFilter && feed.excludeFilter.test(hay)) continue;

    const pubRaw =
      tagText(block, 'pubDate') ??
      tagText(block, 'published') ??
      tagText(block, 'updated') ??
      tagText(block, 'dc:date');
    const { iso, ms } = parsePublished(pubRaw);

    const id = link.replace(/#.*$/, '').toLowerCase();
    const mediaType = feed.mediaType ?? 'article';
    const views = mediaType === 'video' ? parseYtViews(block) : null;
    let image = extractImage(block);
    // YouTube videos: never leave image null — Atom thumbs can be tiny (rejected)
    // or upgraded poorly; canonical i.ytimg.com/vi/{id}/hq720.jpg almost always works.
    if (mediaType === 'video') {
      const ytId =
        tagText(block, 'yt:videoId') ??
        parseWatchId(link) ??
        (image ? image.match(/\/vi\/([A-Za-z0-9_-]+)\//i)?.[1] ?? null : null);
      if (ytId) {
        image = ytThumbForId(ytId);
      } else if (image && /i\.ytimg\.com/i.test(image)) {
        image = upgradeYoutubeThumb(image);
      }
    }
    items.push({
      id,
      title,
      link,
      summary,
      image,
      source: feed.name,
      publishedAt: iso,
      publishedMs: ms,
      mediaType,
      views,
    });
  }
  return items;
}

/** Piped instances — Atom is primary; these fill when YouTube public Atom 404s. */
const PIPED_API_HOSTS = [
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
] as const;

const MIN_VIDEO_DURATION_SEC = 90; // skip Shorts / micro-clips when duration known

type PipedSearchItem = {
  url?: string;
  type?: string;
  title?: string;
  thumbnail?: string;
  uploaderUrl?: string;
  shortDescription?: string;
  duration?: number;
  views?: number;
  uploaded?: number;
  isShort?: boolean;
};

function channelIdOf(feed: FeedDef): string | null {
  if (feed.ytChannelId) return feed.ytChannelId;
  const m = feed.url.match(/[?&]channel_id=([A-Za-z0-9_-]+)/i);
  return m?.[1] ?? null;
}

function pipedSearchQuery(feed: FeedDef): string {
  if (feed.ytSearchQuery?.trim()) return feed.ytSearchQuery.trim();
  return feed.name.replace(/^YT\s+/i, '').trim() || feed.name;
}

function parseWatchId(raw: string): string | null {
  const m =
    raw.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ??
    raw.match(/\/watch\/([A-Za-z0-9_-]{6,})/) ??
    raw.match(/\/videos\/([A-Za-z0-9_-]{6,})/);
  return m?.[1] ?? null;
}

function ytThumbForId(id: string): string {
  // hq720 is widely available; upgradeYoutubeThumb may promote to maxres later
  return `https://i.ytimg.com/vi/${id}/hq720.jpg`;
}

function rewritePipedThumb(thumbnail: string | undefined, videoId: string): string {
  // Always prefer direct i.ytimg.com — Piped proxy URLs embed host=i.ytimg.com in the query
  const viMatch = thumbnail?.match(/\/vi\/([A-Za-z0-9_-]+)\//i);
  const id = viMatch?.[1] ?? videoId;
  if (thumbnail && /^https?:\/\/i\.ytimg\.com\//i.test(thumbnail)) {
    return upgradeYoutubeThumb(thumbnail.split('?')[0]!);
  }
  return ytThumbForId(id);
}

function mapPipedItem(raw: PipedSearchItem, feed: FeedDef): HeadlineItem | null {
  if (!raw || (raw.type && raw.type !== 'stream')) return null;
  const path = raw.url ?? '';
  if (/\/shorts\//i.test(path) || raw.isShort === true) return null;
  const minDur = feed.minDurationSec ?? MIN_VIDEO_DURATION_SEC;
  if (typeof raw.duration === 'number' && raw.duration > 0 && raw.duration < minDur) {
    return null;
  }
  const videoId = parseWatchId(path);
  if (!videoId) return null;

  const title = (raw.title ?? '').trim();
  if (!title) return null;
  const summary = stripHtml(raw.shortDescription ?? '').slice(0, 180);
  const hay = `${title} ${summary}`;
  if (feed.keywordFilter && !feed.keywordFilter.test(hay)) return null;
  if (feed.excludeFilter && feed.excludeFilter.test(hay)) return null;

  const channelId = channelIdOf(feed);
  const uploader = raw.uploaderUrl ?? '';
  // Strict when channel id is known: require uploaderUrl to contain it
  if (channelId && (!uploader || !uploader.includes(channelId))) return null;

  const link = `https://www.youtube.com/watch?v=${videoId}`;
  const uploaded =
    typeof raw.uploaded === 'number' && Number.isFinite(raw.uploaded) && raw.uploaded > 0
      ? raw.uploaded
      : null;
  const views =
    typeof raw.views === 'number' && Number.isFinite(raw.views) ? raw.views : null;

  return {
    id: link.toLowerCase(),
    title,
    link,
    summary,
    image: rewritePipedThumb(raw.thumbnail, videoId),
    source: feed.name,
    publishedAt: uploaded != null ? new Date(uploaded).toISOString() : null,
    publishedMs: uploaded,
    mediaType: 'video',
    views,
  };
}

async function fetchPipedVideos(feed: FeedDef): Promise<HeadlineItem[]> {
  const q = pipedSearchQuery(feed);
  if (!q) return [];
  const channelId = channelIdOf(feed);

  for (const host of PIPED_API_HOSTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const url = `${host}/search?q=${encodeURIComponent(q)}&filter=videos`;
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as { items?: PipedSearchItem[] };
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) continue;

      let mapped = items
        .map((raw) => mapPipedItem(raw, feed))
        .filter((it): it is HeadlineItem => it != null);

      // Some Piped instances omit uploaderUrl — soft-match on uploaderName / query
      if (!mapped.length && channelId) {
        mapped = items
          .map((raw) => {
            const uploader =
              `${raw.uploaderUrl ?? ''} ${(raw as { uploaderName?: string }).uploaderName ?? ''}`.toLowerCase();
            const qTok = q.toLowerCase();
            const ok =
              (raw.uploaderUrl ?? '').includes(channelId) ||
              uploader.includes(qTok) ||
              (qTok === 'powerfuljre' && /joe\s*rogan|powerfuljre/.test(uploader));
            if (!ok) return null;
            // Temporarily clear channel gate inside map by cloning feed without id
            return mapPipedItem(raw, { ...feed, ytChannelId: undefined, url: '' });
          })
          .filter((it): it is HeadlineItem => it != null);
      }

      if (mapped.length) return mapped;
    } catch {
      // try next host
    }
  }
  return [];
}

async function fetchAtomFeed(feed: FeedDef): Promise<{ items: HeadlineItem[]; ok: boolean }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return { items: [], ok: false };
    const xml = await res.text();
    if (!xml || xml.length < 80) return { items: [], ok: false };
    // YouTube often returns 404 HTML that still has status quirks — reject non-feeds
    if (!/<rss[\s>]|<feed[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml)) {
      return { items: [], ok: false };
    }
    return { items: parseFeedXml(xml, feed), ok: true };
  } catch {
    return { items: [], ok: false };
  }
}

async function fetchFeed(feed: FeedDef): Promise<{ items: HeadlineItem[]; ok: boolean }> {
  const atom = await fetchAtomFeed(feed);
  if (atom.ok && atom.items.length) return atom;

  if (feed.mediaType === 'video') {
    const piped = await fetchPipedVideos(feed);
    if (piped.length) return { items: piped, ok: true };
  }

  return { items: [], ok: false };
}

function dedupeSort(items: HeadlineItem[]): HeadlineItem[] {
  const seen = new Set<string>();
  const out: HeadlineItem[] = [];
  for (const it of items) {
    const key = it.link.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0));
  return out;
}


export async function getHeadlines(category: HeadlineCategory): Promise<HeadlinesResult> {
  const cacheKey = `headlines:${category}`;
  const hit = cache.get(cacheKey);
  if (hit) return { ...hit, stale: false };

  const feeds = FEEDS_BY_CAT[category];
  const feedsUsed: string[] = [];
  const feedsFailed: string[] = [];
  const collected: HeadlineItem[] = [];

  // Parallel fetch with modest concurrency (was sequential + sleep — slow tab switches)
  const FEED_CONCURRENCY = 5;
  const results = await mapPool(feeds, FEED_CONCURRENCY, async (feed) => {
    const { items, ok } = await fetchFeed(feed);
    return { feed, items, ok };
  });
  for (const { feed, items, ok } of results) {
    if (ok && items.length) {
      const kept = items.filter(
        (it) => !!it.image && matchesCategory(category, it, feed),
      );
      feedsUsed.push(feed.name);
      collected.push(...kept);
    } else {
      feedsFailed.push(feed.name);
    }
  }

  const now = Date.now();
  const ageLimit = maxStoryAgeMs(category);
  const withImages = dedupeSort(collected).filter((it) => !!it.image);
  // Drop stale + low-reach / low-view items (RSS rarely has article view counts —
  // we approximate “big stories” via outlet tier, YT views, and cross-feed consensus.)
  let big = withImages.filter((it) => {
    if (!isBigEnough(it, category)) return false;
    if (it.publishedMs != null && now - it.publishedMs > ageLimit) return false;
    return true;
  });

  // Soft fill when thin (especially web3nfts): relax popularity gates, keep age + shorts rules
  if (big.length < 5) {
    const softAge =
      category === 'web3nfts' ? Math.max(ageLimit, 120 * 24 * 60 * 60 * 1000) : ageLimit;
    const seen = new Set(big.map((it) => it.link));
    const extras = withImages.filter((it) => {
      if (seen.has(it.link)) return false;
      if (/\/shorts\//i.test(it.link)) return false;
      if (it.publishedMs != null && now - it.publishedMs > softAge) return false;
      return true;
    });
    big = [...big, ...extras];
  }

  const fpCount = new Map<string, number>();
  for (const it of big) {
    const fp = titleFingerprint(it.title);
    if (!fp) continue;
    fpCount.set(fp, (fpCount.get(fp) ?? 0) + 1);
  }

  const ranked = [...big].sort((a, b) => {
    const ca = fpCount.get(titleFingerprint(a.title)) ?? 1;
    const cb = fpCount.get(titleFingerprint(b.title)) ?? 1;
    const boostDiff =
      categoryPriorityBoost(category, b) - categoryPriorityBoost(category, a);
    if (boostDiff !== 0) return boostDiff;
    return storyScore(b, cb) - storyScore(a, ca);
  });

  const videoCap = VIDEO_CAP_BY_CAT[category] ?? VIDEO_CAP;
  const boosted = ranked.filter((it) => categoryPriorityBoost(category, it) > 0);
  const boostedIds = new Set(boosted.map((it) => it.link));
  const videos = ranked
    .filter((it) => it.mediaType === 'video' && !boostedIds.has(it.link))
    .slice(0, videoCap);
  const articles = ranked.filter(
    (it) => it.mediaType !== 'video' && !boostedIds.has(it.link),
  );
  const mixed: HeadlineItem[] = [];
  // Priority boosts (Optimus / Claynosaurz) pin to the front
  mixed.push(...boosted.slice(0, TARGET_COUNT));
  let vi = 0;
  // Videos-only categories (podcasts): fill entirely from video pool
  if (!articles.length && mixed.length < TARGET_COUNT) {
    mixed.push(...videos.slice(0, TARGET_COUNT - mixed.length));
  } else {
    // Interleave a video about every 2–3 cards (after every 2 articles)
    for (const art of articles) {
      if (mixed.length >= TARGET_COUNT) break;
      mixed.push(art);
      if (vi < videos.length && mixed.length % 3 === 2) {
        mixed.push(videos[vi++]!);
      }
      if (mixed.length >= TARGET_COUNT) break;
    }
    while (vi < videos.length && mixed.length < TARGET_COUNT) {
      mixed.push(videos[vi++]!);
    }
  }
  const items = mixed.slice(0, TARGET_COUNT);

  const thin = items.length < THIN_THRESHOLD;
  let note: string | null = null;
  if (!items.length) {
    note = 'No headlines available from public RSS right now. Try again shortly.';
  } else if (thin) {
    note = `Limited coverage for this category (${items.length} stories). Sources may be thin today.`;
  }

  const result: HeadlinesResult = {
    category,
    items,
    feedsUsed,
    feedsFailed,
    thin,
    note,
    stale: false,
    fetchedAt: new Date().toISOString(),
  };

  if (items.length) {
    cache.set(cacheKey, result);
  } else {
    const stale = cache.getStale(cacheKey);
    if (stale?.items?.length) {
      return {
        ...stale,
        stale: true,
        note: stale.note ?? 'Showing cached headlines (live feeds empty/failed).',
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  return result;
}

export function listFeeds(category: HeadlineCategory): FeedDef[] {
  return FEEDS_BY_CAT[category];
}

export const ALL_HEADLINE_CATEGORIES: HeadlineCategory[] = [
  'tradfi',
  'crypto',
  'politics',
  'housing',
  'web3nfts',
  'health',
  'longevity',
  'technology',
  'ai',
  'robotics',
  'genart',
  'podcasts',
];
