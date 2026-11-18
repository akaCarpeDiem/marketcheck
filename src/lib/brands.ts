/**
 * Well-known companies and coins named in a headline, for the artwork of a news
 * story that has no picture of its own. Only names that are hard to mistake
 * for ordinary words are listed; case matters where a name is also a word
 * ("Apple", "Intel", "Meta").
 */

export type Brand = {
  name: string;
  /** US-listed symbol (company logo) or CoinGecko id (coin logo). */
  stock?: string;
  coin?: string;
};

type Entry = [RegExp, Brand];

const B = (re: RegExp, name: string, stock: string): Entry => [re, { name, stock }];
const C = (re: RegExp, name: string, coin: string): Entry => [re, { name, coin }];

const BRANDS: Entry[] = [
  // Technology
  B(/\bNvidia\b/i, 'Nvidia', 'NVDA'),
  B(/\bApple\b(?! (?:pie|juice|cider|orchard))/, 'Apple', 'AAPL'),
  B(/\bMicrosoft\b/i, 'Microsoft', 'MSFT'),
  B(/\b(?:Alphabet|Google)\b/, 'Alphabet', 'GOOGL'),
  B(/\bAmazon\b(?! (?:rainforest|river|basin))/, 'Amazon', 'AMZN'),
  B(/\b(?:Meta(?! ?-?analysis)|Facebook|Instagram|WhatsApp)\b/, 'Meta', 'META'),
  B(/\bTesla\b/i, 'Tesla', 'TSLA'),
  B(/\bNetflix\b/i, 'Netflix', 'NFLX'),
  B(/\bIntel\b/, 'Intel', 'INTC'),
  B(/\bAMD\b/, 'AMD', 'AMD'),
  B(/\bBroadcom\b/i, 'Broadcom', 'AVGO'),
  B(/\bOracle\b/, 'Oracle', 'ORCL'),
  B(/\bSalesforce\b/i, 'Salesforce', 'CRM'),
  B(/\bPalantir\b/i, 'Palantir', 'PLTR'),
  B(/\bAdobe\b/, 'Adobe', 'ADBE'),
  B(/\bIBM\b/, 'IBM', 'IBM'),
  B(/\bQualcomm\b/i, 'Qualcomm', 'QCOM'),
  B(/\b(?:TSMC|Taiwan Semiconductor)\b/i, 'TSMC', 'TSM'),
  B(/\bMicron\b/, 'Micron', 'MU'),
  B(/\bSuper ?Micro\b/i, 'Super Micro', 'SMCI'),
  B(/\bUber\b/, 'Uber', 'UBER'),
  B(/\bAirbnb\b/i, 'Airbnb', 'ABNB'),
  B(/\bSpotify\b/i, 'Spotify', 'SPOT'),
  B(/\bShopify\b/i, 'Shopify', 'SHOP'),
  B(/\bMicroStrategy\b/i, 'Strategy', 'MSTR'),
  // Finance
  B(/\bCoinbase\b/i, 'Coinbase', 'COIN'),
  B(/\bRobinhood\b/, 'Robinhood', 'HOOD'),
  B(/\bPayPal\b/i, 'PayPal', 'PYPL'),
  B(/\bMastercard\b/i, 'Mastercard', 'MA'),
  B(/\bJ\.? ?P\.? ?Morgan\b|\bJPMorgan\b/i, 'JPMorgan', 'JPM'),
  B(/\bGoldman(?: Sachs)?\b/, 'Goldman Sachs', 'GS'),
  B(/\bMorgan Stanley\b/i, 'Morgan Stanley', 'MS'),
  B(/\bBank of America\b/i, 'Bank of America', 'BAC'),
  B(/\bCitigroup\b|\bCiti\b/, 'Citi', 'C'),
  B(/\bWells Fargo\b/i, 'Wells Fargo', 'WFC'),
  B(/\bBlackRock\b/i, 'BlackRock', 'BLK'),
  B(/\bBerkshire(?: Hathaway)?\b/, 'Berkshire Hathaway', 'BRK-B'),
  // Consumer and industry
  B(/\bWalmart\b/i, 'Walmart', 'WMT'),
  B(/\bCostco\b/i, 'Costco', 'COST'),
  B(/\bHome Depot\b/i, 'Home Depot', 'HD'),
  B(/\bMcDonald['’]s\b/i, 'McDonald’s', 'MCD'),
  B(/\bStarbucks\b/i, 'Starbucks', 'SBUX'),
  B(/\bNike\b/, 'Nike', 'NKE'),
  B(/\bCoca-Cola\b/i, 'Coca-Cola', 'KO'),
  B(/\bPepsiCo\b/i, 'PepsiCo', 'PEP'),
  B(/\bDisney\b/i, 'Disney', 'DIS'),
  B(/\bBoeing\b/i, 'Boeing', 'BA'),
  B(/\bGeneral Motors\b/i, 'General Motors', 'GM'),
  B(/\bFord\b(?! Foundation)/, 'Ford', 'F'),
  B(/\bAT&T\b/, 'AT&T', 'T'),
  B(/\bVerizon\b/i, 'Verizon', 'VZ'),
  B(/\bComcast\b/i, 'Comcast', 'CMCSA'),
  B(/\bExxon(?:Mobil)?\b/i, 'ExxonMobil', 'XOM'),
  B(/\bChevron\b/, 'Chevron', 'CVX'),
  B(/\bZillow\b/i, 'Zillow', 'Z'),
  // Health
  B(/\bPfizer\b/i, 'Pfizer', 'PFE'),
  B(/\bModerna\b/i, 'Moderna', 'MRNA'),
  B(/\bEli Lilly\b|\bLilly\b/, 'Eli Lilly', 'LLY'),
  B(/\bNovo Nordisk\b|\bNovo\b(?= )/, 'Novo Nordisk', 'NVO'),
  B(/\bUnitedHealth\b/i, 'UnitedHealth', 'UNH'),
  B(/\bJohnson & Johnson\b|\bJ&J\b/, 'Johnson & Johnson', 'JNJ'),
  B(/\bMerck\b/, 'Merck', 'MRK'),
  B(/\bAbbVie\b/i, 'AbbVie', 'ABBV'),
  // Coins
  C(/\bBitcoin\b|\bBTC\b/i, 'Bitcoin', 'bitcoin'),
  C(/\bEther(?:eum)?\b|\bETH\b/, 'Ethereum', 'ethereum'),
  C(/\bSolana\b/i, 'Solana', 'solana'),
  C(/\bXRP\b|\bRipple\b/, 'XRP', 'ripple'),
  C(/\bDogecoin\b/i, 'Dogecoin', 'dogecoin'),
  C(/\bCardano\b/i, 'Cardano', 'cardano'),
  C(/\bBinance\b|\bBNB\b/, 'BNB', 'binancecoin'),
  C(/\bTether\b|\bUSDT\b/, 'Tether', 'tether'),
];

/** The company or coin a headline names first, or null. */
export function brandOf(title: string): Brand | null {
  let best: { at: number; brand: Brand } | null = null;
  for (const [re, brand] of BRANDS) {
    const m = re.exec(title);
    if (m && (!best || m.index < best.at)) best = { at: m.index, brand };
  }
  return best?.brand ?? null;
}
