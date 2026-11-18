/**
 * How news is organised on the site. Shared by the server (which feeds belong
 * where) and the browser (tabs, labels, page text).
 *
 * Every item carries two independent tags:
 * - a topic: one of the ten below;
 * - a type: article or video.
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

export type ContentType = 'article' | 'video';

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
];
