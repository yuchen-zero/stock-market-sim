export type MarketId = "cn-fic" | "cn-real-demo" | "us-sim";
export type SimMode = "sandbox" | "challenge";
export type SlotKey = `${MarketId}:${SimMode}`;
export type BoardType = "main" | "star" | "chinext" | "st" | "us";
export type OrderSide = "buy" | "sell";
export type OrderType = "limit" | "market";
export type MarketPhase =
  | "preopen"
  | "opening_auction"
  | "continuous"
  | "closing_auction"
  | "break"
  | "extended"
  | "closed"
  | "halted";

export type NavPage =
  | "market"
  | "watchlist"
  | "stock"
  | "trade"
  | "portfolio"
  | "orders"
  | "news"
  | "challenge"
  | "settings";

export interface QuantityRule {
  minimum: number;
  increment: number;
  oddLotSellAll: boolean;
}

export interface MarketConfig {
  id: MarketId;
  label: string;
  shortLabel: string;
  currency: "CNY" | "USD";
  currencySymbol: "¥" | "$";
  timezone: string;
  settlement: "T+1" | "T+0";
  tickSize: number;
  supportsPriceLimit: boolean;
  priceLimitByBoard: Record<BoardType, number | null>;
  initialCapital: number;
  quantityRules: Record<BoardType, QuantityRule>;
  sessions: Array<{
    startMinute: number;
    endMinute: number;
    phase: MarketPhase;
  }>;
  fees: {
    commissionRate: number;
    commissionMin: number;
    stampDutySellRate: number;
    transferFeeRate: number;
  };
}

export interface Fundamentals {
  eps: number;
  pe: number;
  pb: number;
  roe: number;
  revenueGrowth: number;
  dividendYield: number;
  high52Week: number;
  low52Week: number;
}

export interface Instrument {
  id: string;
  marketId: MarketId;
  symbol: string;
  name: string;
  sector: string;
  board: BoardType;
  basePrice: number;
  sharesOutstanding: number;
  beta: number;
  sectorBeta: number;
  annualVolatility: number;
  ewmaVolatility: number;
  liquidity: number;
  avgDailyVolume: number;
  fairValue: number;
  fundamentals: Fundamentals;
  isRealNameDemo: boolean;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface Quote {
  symbol: string;
  last: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number;
  turnover: number;
  turnoverRate: number;
  upperLimit: number | null;
  lowerLimit: number | null;
  bidLevels: OrderBookLevel[];
  askLevels: OrderBookLevel[];
  phase: MarketPhase;
  asOfSec: number;
  bookSeq: number;
  haltedUntilMinute: number | null;
}

export interface Candle {
  timeSec: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsEvent {
  id: string;
  publishedAtSec: number;
  simulatedDate: string;
  category: "macro" | "sector" | "company" | "policy" | "overseas" | "earnings";
  scope: "market" | "sector" | "symbol";
  target: string | null;
  headline: string;
  summary: string;
  source: string;
  sentiment: "positive" | "neutral" | "negative";
  impact: "small" | "medium" | "large";
  durationMinutes: number;
  impulse: number;
  applied?: boolean;
  earningsTier?: "beat" | "inline" | "miss";
}

export type OrderStatus =
  | "pending"
  | "partially_filled"
  | "filled"
  | "partially_cancelled"
  | "cancelled"
  | "expired"
  | "rejected";

export interface Order {
  id: string;
  sequence: number;
  clientOrderId: string;
  intentHash: string;
  marketId: MarketId;
  mode: SimMode;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  limitPrice: number | null;
  quantity: number;
  filledQuantity: number;
  avgFillPrice: number;
  frozenAmount: number;
  feePaid: number;
  status: OrderStatus;
  createdAtSec: number;
  validDate: string;
  accountVersion: number;
  quoteAsOfSec: number;
  bookSeq: number;
  note: string | null;
  rejectCode: string | null;
  rejectReason: string | null;
}

export interface Trade {
  id: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  amount: number;
  commission: number;
  stampDuty: number;
  transferFee: number;
  totalFee: number;
  executedAtSec: number;
  accountVersion: number;
  realizedPnl: number;
}

export interface PositionLot {
  id: string;
  buyTradeId: string;
  quantity: number;
  remainingQuantity: number;
  unitCost: number;
  acquiredDate: string;
}

export interface Position {
  symbol: string;
  totalQuantity: number;
  sellableQuantity: number;
  frozenQuantity: number;
  averageCost: number;
  lots: PositionLot[];
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface Portfolio {
  accountVersion: number;
  generation: string;
  cash: number;
  frozenCash: number;
  positions: Record<string, Position>;
  realizedPnl: number;
  feesPaid: number;
  equity: number;
  previousCloseEquity: number;
  equityCurve: Array<{ date: string; equity: number; benchmark: number }>;
  rejectedOrderCount: number;
  fillCount: number;
}

export interface OrderDraft {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  limitPrice: number | null;
  quantity: number;
  note?: string | null;
  accountVersion?: number;
  generation?: string;
}

export interface FeeBreakdown {
  commission: number;
  stampDuty: number;
  transferFee: number;
  total: number;
}

export interface RiskPreview {
  estimatedAmount: number;
  fees: FeeBreakdown;
  cashAfter: number;
  positionWeightAfter: number;
  lowerLimitLoss: number;
  maxBuyQuantity: number;
  sellableQuantity: number;
}

export interface OrderResult {
  ok: boolean;
  state: SimulationState;
  order: Order | null;
  code: string | null;
  message: string;
  duplicate: boolean;
}

export interface ChallengeState {
  status: "not_started" | "running" | "completed";
  day: number;
  totalDays: number;
  startCapital: number;
  startIndex: number;
  maxDrawdownPercent: number;
  report: ChallengeReport | null;
  startedDate: string | null;
  benchmarkName: string;
}

export interface ChallengeReport {
  finalScore: number;
  grade: "S" | "A" | "B" | "C" | "D";
  returnPercent: number;
  benchmarkReturnPercent: number;
  excessReturnPercent: number;
  maxDrawdownPercent: number;
  sectorsHeld: number;
  maxPositionWeight: number;
  feesPaid: number;
  fillCount: number;
  rejectedOrderCount: number;
  tradeNoteCoveragePercent: number;
  insights: string[];
  tags: string[];
  equityCurve: Array<{ date: string; equity: number; benchmark: number }>;
  finalEquity: number;
  scoreParts: {
    returnScore: number;
    drawdownScore: number;
    diversificationScore: number;
    disciplineScore: number;
  };
}

export interface TapePrint {
  id: string;
  timeSec: number;
  price: number;
  quantity: number;
  side: OrderSide;
}

export interface IndexSnapshot {
  points: number;
  previousClose: number;
  change: number;
  changePercent: number;
  turnover: number;
  advancing: number;
  declining: number;
  flat: number;
  limitUp: number;
  limitDown: number;
}

export interface SimulationState {
  schemaVersion: 1;
  seed: string;
  marketId: MarketId;
  mode: SimMode;
  simulatedDate: string;
  minuteOfDay: number;
  speed: 1 | 2 | 4 | 8 | 16;
  paused: boolean;
  extendedHours: boolean;
  regime: "bull" | "range" | "stress";
  sectorFactors: Record<string, number>;
  rngState: {
    history: number;
    runtime: number;
    news: number;
  };
  nextOrderSeq: number;
  bookSeqCounter: number;
  instruments: Instrument[];
  quotes: Record<string, Quote>;
  dailyCandles: Record<string, Candle[]>;
  intradayCandles: Record<string, Candle[]>;
  thirtyMinuteCandles: Record<string, Candle[]>;
  tape: Record<string, TapePrint[]>;
  news: NewsEvent[];
  orders: Order[];
  trades: Trade[];
  portfolio: Portfolio;
  watchlist: string[];
  challenge: ChallengeState;
  index: IndexSnapshot;
  lastCloseSummary: {
    date: string;
    equity: number;
    dailyPnl: number;
    closedAtSec: number;
  } | null;
  completedOnboarding?: boolean;
}

export type TradeContext = Pick<
  SimulationState,
  | "marketId"
  | "mode"
  | "instruments"
  | "quotes"
  | "portfolio"
  | "challenge"
>;

export interface AppSettings {
  autoNextDay: boolean;
  extendedHours: boolean;
  pauseWhenHidden: boolean;
  onboardingDone: boolean;
  onboardingStep: number;
  lastPage: NavPage;
  lastMarketId: MarketId;
  lastMode: SimMode;
  lastSymbol: string | null;
  savedAtBySlot: Partial<Record<SlotKey, string>>;
  bestChallenges: Record<MarketId, { grade: string; score: number } | null>;
}

export interface ExportEnvelope {
  app: "stock-market-sim";
  schemaVersion: 1;
  exportedAt: string;
  marketId: MarketId;
  mode: SimMode;
  seed: string;
  simulation: unknown;
  challenge: ChallengeState;
}

export interface SaveResult {
  ok: boolean;
  savedAt: string | null;
  bytes: number;
  error?: string;
}
