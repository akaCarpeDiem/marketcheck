/**
 * How news is organised on the site. Shared by the server (which feeds belong
 * where) and the browser (tabs, labels, page text).
 *
 * Every item carries two independent tags:
 * - a topic: one of the ten below;
 * - a type: article, video or podcast.
 * So a podcast episode about bitcoin is both "Crypto & Digital Assets" and
 * "Podcast": it shows under the crypto topic and in the podcast hub.
 *
 * Podcasts are not an eleventh topic. They have their own section
 * (/podcasts/), a directory of shows to browse, each filed under a topic.
 */

export type TopicId =
  | 'markets'
  | 'investing'
  | 'personal-finance'
  | 'crypto'
  | 'real-estate'
  | 'technology'
  | 'policy'
  | 'business'
  | 'commodities'
  | 'healthcare';

export type ContentType = 'article' | 'video' | 'podcast';

export type Topic = {
  id: TopicId;
  /** Full name, as in headings. */
  label: string;
  /** Short name for tabs on narrow screens. */
  short: string;
  /** One line on what belongs here. */
  about: string;
};

export const TOPICS: Topic[] = [
  { id: 'markets', label: 'Markets & Economy', short: 'Markets', about: 'Stocks, bonds, central banks, inflation, jobs and growth.' },
  { id: 'investing', label: 'Investing', short: 'Investing', about: 'Ideas, funds, earnings and strategy for people who invest.' },
  { id: 'personal-finance', label: 'Personal Finance', short: 'Personal finance', about: 'Saving, borrowing, retirement, taxes and everyday money.' },
  { id: 'crypto', label: 'Crypto & Digital Assets', short: 'Crypto', about: 'Bitcoin, Ethereum, tokens, stablecoins, NFTs and the companies around them.' },
  { id: 'real-estate', label: 'Real Estate', short: 'Real estate', about: 'Housing, mortgages, rents, commercial property and REITs.' },
  { id: 'technology', label: 'Technology & Innovation', short: 'Technology', about: 'Big tech, AI, chips, robotics and what comes next.' },
  { id: 'policy', label: 'Policy, Regulation & Politics', short: 'Policy', about: 'Regulators, legislation, the Fed, trade and the politics that move money.' },
  { id: 'business', label: 'Business & Corporate', short: 'Business', about: 'Companies, deals, earnings, leadership and industries.' },
  { id: 'commodities', label: 'Commodities & Energy', short: 'Commodities', about: 'Oil, gas, power, gold, metals and crops.' },
  { id: 'healthcare', label: 'Healthcare & Longevity', short: 'Healthcare', about: 'Medicine, biotech, the business of health and the science of living longer.' },
];

export const TOPIC_IDS: TopicId[] = TOPICS.map((t) => t.id);
export const DEFAULT_TOPIC: TopicId = 'markets';

/** Where each category of the old site went. Old links and saved choices keep working through this. */
export const LEGACY_TOPIC: Record<string, TopicId> = {
  tradfi: 'markets',
  crypto: 'crypto',
  web3nfts: 'crypto',
  politics: 'policy',
  housing: 'real-estate',
  technology: 'technology',
  ai: 'technology',
  robotics: 'technology',
  genart: 'technology',
  health: 'healthcare',
  longevity: 'healthcare',
};

/** A topic id from anything a link, a saved choice or an old client might send. Null if unknown. */
export function topicFrom(raw: unknown): TopicId | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase();
  if ((TOPIC_IDS as string[]).includes(id)) return id as TopicId;
  return LEGACY_TOPIC[id] ?? null;
}

export const topicLabel = (id: string | null | undefined): string => TOPICS.find((t) => t.id === id)?.label ?? '';

export const CONTENT_TYPES: { id: ContentType; label: string; plural: string }[] = [
  { id: 'article', label: 'Article', plural: 'Articles' },
  { id: 'video', label: 'Video', plural: 'Video' },
  { id: 'podcast', label: 'Podcast', plural: 'Podcasts' },
];

/* ── Podcast directory ─────────────────────────────────────────────────── */

export type PodcastShow = {
  /** Stable id, used in links. */
  id: string;
  name: string;
  /** Who makes it and what it is, in a line. */
  about: string;
  /** Topic it is filed under; null for general-interest shows. */
  topic: TopicId | null;
  /** YouTube channel the episodes are read from. */
  channel: string;
};

export const PODCAST_SHOWS: PodcastShow[] = [
  { id: 'the-compound', name: 'The Compound and Friends', about: 'Josh Brown, Michael Batnick and guests on markets and investing, plus Animal Spirits.', topic: 'investing', channel: 'UCBRpqrzuuqE8TZcWw75JSdw' },
  { id: 'real-vision', name: 'Real Vision', about: 'Long-form interviews with investors and macro thinkers.', topic: 'investing', channel: 'UCGXWKlq1Oxr3ddEtmKhAkPg' },
  { id: 'forward-guidance', name: 'Forward Guidance', about: 'Macro, the Fed and liquidity, from Blockworks.', topic: 'markets', channel: 'UCkrwgzhIBKccuDsi_SvZtnQ' },
  { id: 'marketplace', name: 'Marketplace', about: 'The daily economy explained, from American Public Media.', topic: 'markets', channel: 'UCORB0siyf3n_FS22MSLrjZA' },
  { id: 'planet-money', name: 'Planet Money', about: "NPR's stories about how the economy really works.", topic: 'markets', channel: 'UCwlvY6_2iza-QkE5CIWpIFA' },
  { id: 'ramsey-show', name: 'The Ramsey Show', about: 'Callers, debt and plain advice on getting out of it.', topic: 'personal-finance', channel: 'UC7eBNeDW1GQf2NJQ6G6gAxw' },
  { id: 'money-guy', name: 'The Money Guy Show', about: 'Two financial planners on saving, investing and retiring well.', topic: 'personal-finance', channel: 'UC9vUu4vlIlMC0dHQCTvQPbg' },
  { id: 'caleb-hammer', name: 'Financial Audit', about: "Caleb Hammer goes through real people's budgets, line by line.", topic: 'personal-finance', channel: 'UCLe_q9axMaeTbjN0hy1Z9xA' },
  { id: 'bankless', name: 'Bankless', about: 'Ethereum, DeFi and the crypto economy.', topic: 'crypto', channel: 'UCAl9Ld79qaZxp9JzEOwd3aA' },
  { id: 'unchained', name: 'Unchained', about: 'Laura Shin interviews the people building and regulating crypto.', topic: 'crypto', channel: 'UCWiiMnsnw5Isc2PP1to9nNw' },
  { id: 'the-defiant', name: 'The Defiant', about: 'DeFi news and interviews.', topic: 'crypto', channel: 'UCL0J4MLEdLP0-UyLu0hCktg' },
  { id: 'coin-bureau', name: 'Coin Bureau', about: 'Research-heavy explainers on coins, markets and regulation.', topic: 'crypto', channel: 'UCqK_GSMbpiV8spgD3ZGloSw' },
  { id: 'biggerpockets', name: 'BiggerPockets', about: 'Real estate investing: rentals, financing and the housing market.', topic: 'real-estate', channel: 'UCVWDbXqQ8cupuVpotWNt2eg' },
  { id: 'a16z', name: 'a16z', about: 'Andreessen Horowitz on technology, startups and where they are going.', topic: 'technology', channel: 'UC9cn0TuPq4dnbTY-CBsm8XA' },
  { id: 'lex-fridman', name: 'Lex Fridman Podcast', about: 'Long conversations on AI, science and technology.', topic: 'technology', channel: 'UCSHZKyawb77ixDdsGog4iWA' },
  { id: 'dwarkesh', name: 'Dwarkesh Podcast', about: 'Deep interviews on AI and progress.', topic: 'technology', channel: 'UCXl4i9dYBrFOabk0xGmbkRA' },
  { id: 'all-in', name: 'All-In', about: 'Four investors on markets, technology and politics.', topic: 'business', channel: 'UCESLZhusAkFfsNsApnjF_Cg' },
  { id: 'acquired', name: 'Acquired', about: 'The stories and strategies behind great companies.', topic: 'business', channel: 'UCyFqFYfTW2VoIQKylJ04Rtw' },
  { id: 'diary-of-a-ceo', name: 'The Diary Of A CEO', about: 'Steven Bartlett interviews founders, executives and experts.', topic: 'business', channel: 'UCGq-a57w-aPwyi3pW7XLiHw' },
  { id: 'prof-g', name: 'The Prof G Pod', about: 'Scott Galloway on business, markets and tech.', topic: 'business', channel: 'UC1E1SVcVyU3ntWMSQEp38Yw' },
  { id: 'kitco', name: 'Kitco News', about: 'Gold, silver, mining and commodity markets.', topic: 'commodities', channel: 'UC9ijza42jVR3T6b8bColgvg' },
  { id: 'peter-attia', name: 'The Peter Attia Drive', about: 'A physician on longevity, health and performance.', topic: 'healthcare', channel: 'UC8kGsMa0LygSX9nkBcBH1Sg' },
  { id: 'huberman-lab', name: 'Huberman Lab', about: 'A Stanford neuroscientist on health and the science behind it.', topic: 'healthcare', channel: 'UC2D2CMWXMOVWx7giW1n3LIg' },
  { id: 'joe-rogan', name: 'The Joe Rogan Experience', about: 'Long-form conversations with guests from every field.', topic: null, channel: 'UCzQUP1qoWDoEbmsQxvdjxgQ' },
  { id: 'theo-von', name: 'This Past Weekend', about: 'Theo Von in conversation.', topic: null, channel: 'UC5AQEUAwCh1sGDvkQtkDWUQ' },
];
