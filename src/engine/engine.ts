import {
  createInstrumentList,
  getMarketConfig,
} from "../data/markets";
import type {
  ChallengeReport,
  FeeBreakdown,
  IndexSnapshot,
  Instrument,
  MarketConfig,
  MarketId,
  Order,
  OrderDraft,
  OrderResult,
  Position,
  Quote,
  RiskPreview,
  SimMode,
  SimulationState,
  TapePrint,
  Trade,
} from "../types/domain";
import { calculateChallengeScore } from "./challenge";
import {
  calculateFeeBreakdown,
  calculateFillFees,
  commissionAlreadyPaid,
} from "./fees";
import {
  createBookLevels,
  createQuote,
  generateHistory,
  generateOpeningIntraday,
  getPriceLimits,
} from "./history";
import { clamp, fromCents, roundMoney, roundTick, toCents } from "./money";
import {
  applyNewsImpulse,
  ensureNewsWindow,
  generateNewsSchedule,
} from "./news";
import { createRandomSource, hash32, streamSeed, weightedPick } from "./rng";
import {
  advanceMarketMinute,
  canCancelAt,
  dateToEpochSec,
  isAuctionPhase,
  isDayClosed,
  isTradablePhase,
  marketStartMinute,
  nextTradingDate,
  phaseLabel,
  resolveMarketPhase,
} from "./time";

const INITIAL_DATE = "2026-10-20";
const DEFAULT_SEED = "ALPHA-2026";

function cloneState(state: SimulationState): SimulationState {
  if (typeof structuredClone === "function") return structuredClone(state);
  return JSON.parse(JSON.stringify(state)) as SimulationState;
}

function currentSec(state: SimulationState): number {
  return dateToEpochSec(state.simulatedDate, state.minuteOfDay);
}

function findInstrument(
  state: Pick<SimulationState, "instruments">,
  symbol: string,
): Instrument | undefined {
  return state.instruments.find((item) => item.symbol === symbol);
}

function createGeneration(
  seed: string,
  marketId: MarketId,
  mode: SimMode,
): string {
  return `gen-${hash32(`${seed}|${marketId}|${mode}|${INITIAL_DATE}`).toString(16)}`;
}

function createEmptyPosition(symbol: string): Position {
  return {
    symbol,
    totalQuantity: 0,
    sellableQuantity: 0,
    frozenQuantity: 0,
    averageCost: 0,
    lots: [],
    marketValue: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
  };
}

function createInitialIndex(
  instruments: Instrument[],
  quotes: Record<string, Quote>,
): IndexSnapshot {
  const points = indexPoints(instruments, quotes);
  const advancing = Object.values(quotes).filter(
    (quote) => quote.change > 0,
  ).length;
  const declining = Object.values(quotes).filter(
    (quote) => quote.change < 0,
  ).length;
  return {
    points,
    previousClose: 1000,
    change: points - 1000,
    changePercent: (points / 1000 - 1) * 100,
    turnover: Object.values(quotes).reduce(
      (sum, quote) => sum + quote.turnover,
      0,
    ),
    advancing,
    declining,
    flat: 12 - advancing - declining,
    limitUp: 0,
    limitDown: 0,
  };
}

function indexPoints(
  instruments: Instrument[],
  quotes: Record<string, Quote>,
): number {
  const base = instruments.reduce(
    (sum, item) => sum + item.basePrice * item.sharesOutstanding,
    0,
  );
  const current = instruments.reduce(
    (sum, item) =>
      sum +
      (quotes[item.symbol]?.last ?? item.basePrice) * item.sharesOutstanding,
    0,
  );
  return base > 0 ? (current / base) * 1000 : 1000;
}

function recalculateIndex(state: SimulationState): void {
  const previous =
    state.index?.previousClose && state.index.previousClose > 0
      ? state.index.previousClose
      : 1000;
  const points = indexPoints(state.instruments, state.quotes);
  const quotes = Object.values(state.quotes);
  const advancing = quotes.filter((quote) => quote.change > 0).length;
  const declining = quotes.filter((quote) => quote.change < 0).length;
  const limitUp = quotes.filter(
    (quote) =>
      quote.upperLimit !== null &&
      quote.last >= quote.upperLimit - 0.0001,
  ).length;
  const limitDown = quotes.filter(
    (quote) =>
      quote.lowerLimit !== null &&
      quote.last <= quote.lowerLimit + 0.0001,
  ).length;
  state.index = {
    points,
    previousClose: previous,
    change: points - previous,
    changePercent: previous > 0 ? (points / previous - 1) * 100 : 0,
    turnover: quotes.reduce((sum, quote) => sum + quote.turnover, 0),
    advancing,
    declining,
    flat: Math.max(0, quotes.length - advancing - declining),
    limitUp,
    limitDown,
  };
}

function updatePortfolioValuation(state: SimulationState): void {
  let marketValue = 0;
  Object.values(state.portfolio.positions).forEach((position) => {
    const quote = state.quotes[position.symbol];
    const price = quote?.last ?? 0;
    position.marketValue = roundMoney(price * position.totalQuantity);
    position.unrealizedPnl = roundMoney(
      position.lots.reduce(
        (sum, lot) =>
          sum + lot.remainingQuantity * price - lot.remainingQuantity * lot.unitCost,
        0,
      ),
    );
    position.averageCost =
      position.totalQuantity > 0
        ? position.lots.reduce(
            (sum, lot) => sum + lot.remainingQuantity * lot.unitCost,
            0,
          ) / position.totalQuantity
        : 0;
    marketValue += position.marketValue;
  });
  state.portfolio.equity = roundMoney(
    state.portfolio.cash + state.portfolio.frozenCash + marketValue,
  );
  recalculateIndex(state);
}

function createTape(
  quote: Quote,
  instrument: Instrument,
  seed: string,
  date: string,
  minute: number,
): TapePrint[] {
  const random = createRandomSource(
    streamSeed(seed, instrument.marketId, "tape", instrument.symbol, date, minute),
  );
  const count = 2 + random.integer(0, 6);
  const baseTime = dateToEpochSec(date, minute);
  return Array.from({ length: count }, (_, index) => {
    const side = random.next() > 0.5 ? "buy" : "sell";
    const offset = (random.next() - 0.5) * 4 * 0.01;
    return {
      id: `tape-${instrument.symbol}-${minute}-${index}`,
      timeSec: baseTime + index,
      price: roundTick(Math.max(0.01, quote.last + offset), 0.01),
      quantity: Math.max(
        1,
        Math.round((instrument.avgDailyVolume / 240) * (0.02 + random.next() * 0.12)),
      ),
      side,
    };
  });
}

function updateQuoteBook(
  state: SimulationState,
  instrument: Instrument,
  quote: Quote,
): void {
  const market = getMarketConfig(state.marketId);
  const phase = resolveMarketPhase(
    market,
    state.minuteOfDay,
    state.extendedHours,
  );
  const { upper, lower } = getPriceLimits(
    market,
    instrument,
    quote.previousClose,
  );
  quote.upperLimit = upper;
  quote.lowerLimit = lower;
  quote.phase = quote.haltedUntilMinute !== null && state.minuteOfDay < quote.haltedUntilMinute
    ? "halted"
    : phase;
  quote.change = fromCents(toCents(quote.last) - toCents(quote.previousClose));
  quote.changePercent =
    quote.previousClose > 0 ? (quote.change / quote.previousClose) * 100 : 0;
  quote.turnoverRate =
    instrument.sharesOutstanding > 0
      ? (quote.volume / instrument.sharesOutstanding) * 100
      : 0;
  quote.bidLevels = createBookLevels(
    quote.last,
    market,
    instrument,
    state.seed,
    state.minuteOfDay,
    "bid",
    upper,
    lower,
  );
  quote.askLevels = createBookLevels(
    quote.last,
    market,
    instrument,
    state.seed,
    state.minuteOfDay,
    "ask",
    upper,
    lower,
  );
}

function applyDueNews(
  state: SimulationState,
  market: MarketConfig,
  nowSec: number,
): void {
  const due = state.news.filter(
    (event) => !event.applied && event.publishedAtSec <= nowSec,
  );
  due.forEach((event) => {
    event.applied = true;
    if (event.category !== "earnings" || !event.earningsTier) return;
    const instrument = event.target
      ? state.instruments.find((item) => item.symbol === event.target)
      : undefined;
    if (!instrument) return;
    const factor =
      event.earningsTier === "beat"
        ? 1.055
        : event.earningsTier === "miss"
          ? 0.94
          : 1;
    instrument.fairValue = roundMoney(instrument.fairValue * factor);
    instrument.fundamentals.eps = roundMoney(
      instrument.fundamentals.eps *
        (event.earningsTier === "beat"
          ? 1.09
          : event.earningsTier === "miss"
            ? 0.9
            : 1),
    );
    instrument.fundamentals.pe =
      instrument.fundamentals.eps > 0
        ? state.quotes[instrument.symbol]?.last /
          instrument.fundamentals.eps
        : 0;
    instrument.fundamentals.revenueGrowth = roundMoney(
      instrument.fundamentals.revenueGrowth +
        (event.earningsTier === "beat"
          ? 3.8
          : event.earningsTier === "miss"
            ? -4.1
            : 0.2),
    );
  });

  due
    .filter(
      (event) =>
        market.id !== "cn-real-demo" &&
        event.scope === "symbol" &&
        event.sentiment === "negative" &&
        event.impact === "large",
    )
    .forEach((event) => {
      const random = createRandomSource(
        streamSeed(state.seed, state.marketId, "halt", event.id),
      );
      if (random.next() > 0.12 || !event.target) return;
      const quote = state.quotes[event.target];
      if (!quote) return;
      quote.haltedUntilMinute =
        state.minuteOfDay + 15 + random.integer(0, 30);
    });
}

function generateMinuteVolume(
  state: SimulationState,
  instrument: Instrument,
  quote: Quote,
): number {
  const random = createRandomSource(
    streamSeed(
      state.seed,
      state.marketId,
      "volume",
      instrument.symbol,
      state.simulatedDate,
      state.minuteOfDay,
    ),
  );
  const sessionMinutes = state.marketId === "us-sim" ? 390 : 240;
  const phaseBoost =
    quote.phase === "extended" ? 0.12 : 1;
  const openingBoost =
    state.minuteOfDay < 600 || state.minuteOfDay > 870 ? 1.2 : 0.9;
  const volatilityBoost = 1 + Math.abs(quote.changePercent) * 0.08;
  const now = currentSec(state);
  const newsBoost = state.news.some(
    (event) =>
      event.publishedAtSec <= now &&
      now - event.publishedAtSec < event.durationMinutes * 60 &&
      (event.scope === "market" ||
        (event.scope === "sector" && event.target === instrument.sector) ||
        (event.scope === "symbol" && event.target === instrument.symbol)),
  )
    ? 1.28
    : 1;
  return Math.max(
    1,
    Math.round(
      (instrument.avgDailyVolume / sessionMinutes) *
        (0.35 + random.next() * 0.9) *
        phaseBoost *
        openingBoost *
        volatilityBoost *
        newsBoost,
    ),
  );
}

function updatePricesForMinute(
  state: SimulationState,
  market: MarketConfig,
): void {
  const minuteRandom = createRandomSource(
    streamSeed(
      state.seed,
      market.id,
      "minute-market",
      state.simulatedDate,
      state.minuteOfDay,
    ),
  );
  const regimeVol =
    state.regime === "bull" ? 0.008 : state.regime === "stress" ? 0.02 : 0.011;
  const regimeDrift =
    state.regime === "bull" ? 0.0005 : state.regime === "stress" ? -0.0008 : 0;
  const sessionMinutes = market.id === "us-sim" ? 390 : 240;
  const marketShock =
    regimeDrift / sessionMinutes +
    minuteRandom.normal() * (regimeVol / Math.sqrt(sessionMinutes));
  const now = currentSec(state);

  for (const instrument of state.instruments) {
    const quote = state.quotes[instrument.symbol];
    if (!quote) continue;
    if (
      quote.haltedUntilMinute !== null &&
      state.minuteOfDay < quote.haltedUntilMinute
    ) {
      quote.phase = "halted";
      continue;
    }
    if (quote.haltedUntilMinute !== null) quote.haltedUntilMinute = null;
    const random = createRandomSource(
      streamSeed(
        state.seed,
        market.id,
        "minute-stock",
        instrument.symbol,
        state.simulatedDate,
        state.minuteOfDay,
      ),
    );
    const idioVol =
      (Math.max(0.08, instrument.ewmaVolatility ?? instrument.annualVolatility) /
        Math.sqrt(252)) /
      Math.sqrt(sessionMinutes);
    const sectorRandom = createRandomSource(
      streamSeed(
        state.seed,
        market.id,
        "minute-sector",
        instrument.sector,
        state.simulatedDate,
        state.minuteOfDay,
      ),
    );
    const sectorShock = sectorRandom.normal() * 0.00048;
    const meanRev = clamp(
      0.002 * Math.log(instrument.fairValue / Math.max(0.01, quote.last)),
      -0.003,
      0.003,
    );
    const newsImpulse = applyNewsImpulse(state, instrument, now);
    const minuteReturn =
      instrument.beta * marketShock +
      instrument.sectorBeta *
        sectorShock *
        (1 + (state.sectorFactors[instrument.sector] ?? 0) * 3) +
      random.normal() * idioVol +
      meanRev +
      newsImpulse;
    const annualizedMove =
      Math.abs(minuteReturn) * Math.sqrt(sessionMinutes) * Math.sqrt(252);
    instrument.ewmaVolatility = clamp(
      0.965 * (instrument.ewmaVolatility ?? instrument.annualVolatility) +
        0.035 * Math.max(0.08, annualizedMove),
      0.08,
      0.9,
    );
    const { upper, lower } = getPriceLimits(
      market,
      instrument,
      quote.previousClose,
    );
    const nextLast = roundTick(
      clamp(
        quote.last * (1 + clamp(minuteReturn, -0.03, 0.03)),
        lower ?? market.tickSize,
        upper ?? Number.POSITIVE_INFINITY,
      ),
      market.tickSize,
    );
    const previousLast = quote.last;
    quote.last = nextLast;
    quote.high = roundTick(
      Math.max(quote.high, nextLast),
      market.tickSize,
    );
    quote.low = roundTick(
      Math.max(
        market.tickSize,
        Math.min(quote.low > 0 ? quote.low : nextLast, nextLast),
      ),
      market.tickSize,
    );
    const generatedVolume = generateMinuteVolume(state, instrument, quote);
    quote.volume += generatedVolume;
    quote.turnover = roundMoney(
      quote.turnover + quote.last * generatedVolume,
    );
    updateQuoteBook(state, instrument, quote);
    appendOrUpdateCandle(
      state,
      instrument,
      previousLast,
      quote,
      state.minuteOfDay,
    );
  }
}

function appendOrUpdateCandle(
  state: SimulationState,
  instrument: Instrument,
  previousLast: number,
  quote: Quote,
  minuteOfDay: number,
  extraVolume = 0,
): void {
  const timeSec = dateToEpochSec(state.simulatedDate, minuteOfDay);
  const list = state.intradayCandles[instrument.symbol] ?? [];
  const last = list[list.length - 1];
  const volume = Math.max(0, quote.volume - (last?.volume ?? 0));
  if (last && last.timeSec === timeSec) {
    last.high = Math.max(last.high, quote.last);
    last.low = Math.min(last.low, quote.last);
    last.close = quote.last;
    last.volume += extraVolume;
  } else {
    list.push({
      timeSec,
      open: previousLast,
      high: Math.max(previousLast, quote.last),
      low: Math.min(previousLast, quote.last),
      close: quote.last,
      volume: Math.max(extraVolume, volume),
    });
    if (list.length > 720) list.shift();
  }
  state.intradayCandles[instrument.symbol] = list;
}

function appendTape(
  state: SimulationState,
  instrument: Instrument,
  quote: Quote,
): void {
  const existing = state.tape[instrument.symbol] ?? [];
  const generated = createTape(
    quote,
    instrument,
    state.seed,
    state.simulatedDate,
    state.minuteOfDay,
  );
  state.tape[instrument.symbol] = [...existing, ...generated].slice(-30);
}

function priceEstimateForMarketBuy(quote: Quote, quantity: number): number {
  let remaining = quantity;
  let amount = 0;
  for (const level of quote.askLevels) {
    if (remaining <= 0) break;
    if (level.quantity <= 0) continue;
    const filled = Math.min(remaining, level.quantity);
    amount += filled * level.price;
    remaining -= filled;
  }
  if (remaining > 0) amount += remaining * quote.last * 1.02;
  return roundMoney(amount);
}

function priceEstimateForMarketSell(quote: Quote, quantity: number): number {
  let remaining = quantity;
  let amount = 0;
  for (const level of quote.bidLevels) {
    if (remaining <= 0) break;
    if (level.quantity <= 0) continue;
    const filled = Math.min(remaining, level.quantity);
    amount += filled * level.price;
    remaining -= filled;
  }
  if (remaining > 0) amount += remaining * quote.last * 0.98;
  return roundMoney(amount);
}

function estimatedOrderAmount(draft: OrderDraft, quote: Quote): number {
  if (draft.type === "limit") {
    return roundMoney((draft.limitPrice ?? 0) * draft.quantity);
  }
  return draft.side === "buy"
    ? priceEstimateForMarketBuy(quote, draft.quantity)
    : priceEstimateForMarketSell(quote, draft.quantity);
}

function intentHashFor(draft: OrderDraft): string {
  return hash32(
    JSON.stringify({
      symbol: draft.symbol,
      side: draft.side,
      type: draft.type,
      limitPrice: draft.limitPrice,
      quantity: draft.quantity,
    }),
  ).toString(16);
}

function makeOrder(
  state: SimulationState,
  draft: OrderDraft,
  status: Order["status"],
  intentHash: string,
): Order {
  const seq = state.nextOrderSeq;
  state.nextOrderSeq += 1;
  const quote = state.quotes[draft.symbol];
  return {
    id: `ORD-${state.simulatedDate.replaceAll("-", "")}-${String(seq).padStart(5, "0")}`,
    sequence: seq,
    clientOrderId: draft.clientOrderId,
    intentHash,
    marketId: state.marketId,
    mode: state.mode,
    symbol: draft.symbol,
    side: draft.side,
    type: draft.type,
    limitPrice: draft.limitPrice,
    quantity: draft.quantity,
    filledQuantity: 0,
    avgFillPrice: 0,
    frozenAmount: 0,
    feePaid: 0,
    status,
    createdAtSec: currentSec(state),
    validDate: state.simulatedDate,
    accountVersion: state.portfolio.accountVersion,
    quoteAsOfSec: quote?.asOfSec ?? 0,
    bookSeq: quote?.bookSeq ?? 0,
    note: draft.note?.trim().slice(0, 100) || null,
    rejectCode: null,
    rejectReason: null,
  };
}

function rejection(
  state: SimulationState,
  draft: OrderDraft,
  code: string,
  message: string,
  intentHash: string,
): OrderResult {
  const order = makeOrder(state, draft, "rejected", intentHash);
  order.rejectCode = code;
  order.rejectReason = message;
  state.orders.push(order);
  state.portfolio.rejectedOrderCount += 1;
  return {
    ok: false,
    state,
    order,
    code,
    message,
    duplicate: false,
  };
}

function validateLotSize(
  state: SimulationState,
  draft: OrderDraft,
  instrument: Instrument,
  market: MarketConfig,
): string | null {
  if (!Number.isInteger(draft.quantity) || draft.quantity <= 0) {
    return "数量必须是大于 0 的整数。";
  }
  const rule = market.quantityRules[instrument.board];
  const sellable =
    state.portfolio.positions[draft.symbol]?.sellableQuantity ?? 0;
  const oddLotAll =
    draft.side === "sell" &&
    rule.oddLotSellAll &&
    sellable < rule.minimum &&
    draft.quantity === sellable;
  if (oddLotAll) return null;
  if (instrument.board === "star") {
    if (draft.quantity < rule.minimum) {
      return `科创板每笔申报最低 ${rule.minimum} 股，此后可按 1 股递增。`;
    }
    return null;
  }
  if (draft.quantity % rule.increment !== 0) {
    return `${market.label}${instrument.board === "st" ? " ST" : ""}股票的申报数量必须是 ${rule.increment} 股的整数倍。`;
  }
  return null;
}

function positionLotsCost(position: Position | undefined): number {
  if (!position) return 0;
  return position.lots.reduce(
    (sum, lot) => sum + lot.remainingQuantity * lot.unitCost,
    0,
  );
}

function estimatedFeesForRisk(
  state: Pick<SimulationState, "marketId">,
  draft: OrderDraft,
  amount: number,
): FeeBreakdown {
  const market = getMarketConfig(state.marketId);
  return calculateFeeBreakdown(amount, draft.side, market);
}

export function getRiskPreview(
  state: Pick<
    SimulationState,
    "marketId" | "instruments" | "quotes" | "portfolio"
  >,
  draft: OrderDraft,
): RiskPreview {
  const quote = state.quotes[draft.symbol];
  if (!quote) {
    return {
      estimatedAmount: 0,
      fees: { commission: 0, stampDuty: 0, transferFee: 0, total: 0 },
      cashAfter: state.portfolio.cash,
      positionWeightAfter: 0,
      lowerLimitLoss: 0,
      maxBuyQuantity: 0,
      sellableQuantity: 0,
    };
  }
  const amount = estimatedOrderAmount(draft, quote);
  const fees = estimatedFeesForRisk(state, draft, amount);
  const existing = state.portfolio.positions[draft.symbol];
  const currentQty = existing?.totalQuantity ?? 0;
  const quantityAfter =
    draft.side === "buy"
      ? currentQty + draft.quantity
      : Math.max(0, currentQty - draft.quantity);
  const lower = quote.lowerLimit ?? 0;
  const costAfter =
    positionLotsCost(existing) +
    (draft.side === "buy" ? amount + fees.total : 0);
  const lowerLimitLoss =
    draft.side === "buy"
      ? roundMoney(lower * quantityAfter - costAfter)
      : roundMoney(lower * quantityAfter - positionLotsCost(existing));
  const marketValueAfter = quote.last * quantityAfter;
  const equityAfter =
    draft.side === "buy"
      ? Math.max(1, state.portfolio.equity - fees.total)
      : Math.max(1, state.portfolio.equity - fees.total);
  const instrument = findInstrument(state, draft.symbol);
  const market = getMarketConfig(state.marketId);
  let maxBuyQuantity = 0;
  if (instrument) {
    const rule = market.quantityRules[instrument.board];
    const unitPrice = draft.limitPrice ?? quote.askLevels[0]?.price ?? quote.last;
    let candidate = Math.floor(
      state.portfolio.cash / Math.max(0.01, unitPrice * 1.002),
    );
    if (candidate >= rule.minimum) {
      candidate -= candidate % rule.increment;
      while (candidate >= rule.minimum) {
        const cost = roundMoney(candidate * unitPrice);
        const fee = calculateFeeBreakdown(cost, "buy", market).total;
        if (cost + fee <= state.portfolio.cash) break;
        candidate -= rule.increment;
      }
      maxBuyQuantity = candidate >= rule.minimum ? candidate : 0;
    }
  }
  return {
    estimatedAmount: amount,
    fees,
    cashAfter: roundMoney(state.portfolio.cash - amount - fees.total),
    positionWeightAfter:
      equityAfter > 0 ? (marketValueAfter / equityAfter) * 100 : 0,
    lowerLimitLoss,
    maxBuyQuantity,
    sellableQuantity: existing?.sellableQuantity ?? 0,
  };
}

export function createSimulation(
  market: MarketConfig,
  mode: SimMode,
  seed = DEFAULT_SEED,
): SimulationState {
  const normalizedSeed = seed.trim() || DEFAULT_SEED;
  const instruments = createInstrumentList(market.id, normalizedSeed);
  const history = generateHistory(
    instruments,
    market,
    normalizedSeed,
    INITIAL_DATE,
  );
  const startMinute = marketStartMinute(market, false);
  const quotes: Record<string, Quote> = {};
  instruments.forEach((instrument) => {
    const candles = history.dailyCandles[instrument.symbol];
    const previousClose = candles[candles.length - 1]?.close ?? instrument.basePrice;
    quotes[instrument.symbol] = createQuote(
      instrument,
      market,
      normalizedSeed,
      INITIAL_DATE,
      resolveMarketPhase(market, startMinute, false),
      startMinute,
      previousClose,
      previousClose,
      previousClose,
      previousClose,
      previousClose,
      0,
      1,
      false,
    );
  });
  const capital = market.initialCapital;
  const equityCurve = [
    {
      date: INITIAL_DATE,
      equity: capital,
      benchmark: 1000,
    },
  ];
  const initialIndex = createInitialIndex(instruments, quotes);
  const news = generateNewsSchedule(
    market,
    instruments,
    normalizedSeed,
    INITIAL_DATE,
    30,
  );
  const challenge = {
    status: mode === "challenge" ? ("not_started" as const) : ("running" as const),
    day: mode === "challenge" ? 0 : 1,
    totalDays: 30,
    startCapital: capital,
    startIndex: initialIndex.points,
    maxDrawdownPercent: 0,
    report: null,
    startedDate: mode === "challenge" ? null : INITIAL_DATE,
    benchmarkName: `${market.label}模拟综合指数`,
  };
  const state: SimulationState = {
    schemaVersion: 1,
    seed: normalizedSeed,
    marketId: market.id,
    mode,
    simulatedDate: INITIAL_DATE,
    minuteOfDay: startMinute,
    speed: 4,
    paused: mode === "challenge",
    extendedHours: false,
    regime: "range",
    sectorFactors: Object.fromEntries(
      Array.from(new Set(instruments.map((item) => item.sector))).map(
        (sector) => [sector, 0],
      ),
    ),
    rngState: {
      history: hash32(`${normalizedSeed}|${market.id}|history`),
      runtime: hash32(`${normalizedSeed}|${market.id}|runtime`),
      news: hash32(`${normalizedSeed}|${market.id}|news`),
    },
    nextOrderSeq: 1,
    bookSeqCounter: 1,
    instruments,
    quotes,
    dailyCandles: history.dailyCandles,
    intradayCandles: {},
    thirtyMinuteCandles: history.thirtyMinuteCandles,
    tape: {},
    news,
    orders: [],
    trades: [],
    portfolio: {
      accountVersion: 1,
      generation: createGeneration(normalizedSeed, market.id, mode),
      cash: capital,
      frozenCash: 0,
      positions: {},
      realizedPnl: 0,
      feesPaid: 0,
      equity: capital,
      previousCloseEquity: capital,
      equityCurve,
      rejectedOrderCount: 0,
      fillCount: 0,
    },
    watchlist: [],
    challenge,
    index: initialIndex,
    lastCloseSummary: null,
  };
  applyDueNews(state, market, currentSec(state));
  updatePortfolioValuation(state);
  return state;
}

export function startChallenge(
  state: SimulationState,
  seed = state.seed,
): SimulationState {
  const market = getMarketConfig(state.marketId);
  const fresh = createSimulation(market, "challenge", seed.trim() || state.seed);
  fresh.challenge = {
    ...fresh.challenge,
    status: "running",
    day: 1,
    startCapital: market.initialCapital,
    startIndex: fresh.index.points,
    startedDate: fresh.simulatedDate,
    report: null,
    maxDrawdownPercent: 0,
  };
  fresh.portfolio.equityCurve = [
    {
      date: fresh.simulatedDate,
      equity: market.initialCapital,
      benchmark: fresh.index.points,
    },
  ];
  fresh.paused = false;
  return fresh;
}

export function submitOrder(
  original: SimulationState,
  draft: OrderDraft,
): OrderResult {
  const state = cloneState(original);
  const market = getMarketConfig(state.marketId);
  const instrument = findInstrument(state, draft.symbol);
  const quote = state.quotes[draft.symbol];
  const computedIntent = intentHashFor(draft);

  const existing = state.orders.find(
    (order) => order.clientOrderId === draft.clientOrderId,
  );
  if (existing) {
    if (existing.intentHash === computedIntent) {
      return {
        ok: existing.status !== "rejected",
        state,
        order: existing,
        code: existing.rejectCode,
        message: "该委托请求已处理，本次未重复冻结或成交。",
        duplicate: true,
      };
    }
    state.portfolio.rejectedOrderCount += 1;
    return {
      ok: false,
      state,
      order: existing,
      code: "ORDER_INTENT_CONFLICT",
      message: "同一委托编号对应不同订单意图，已被拒绝。",
      duplicate: true,
    };
  }

  if (!instrument || !quote) {
    return rejection(
      state,
      draft,
      "UNKNOWN_SYMBOL",
      "未找到该模拟证券。",
      computedIntent,
    );
  }
  if (state.mode === "challenge" && state.challenge.status === "not_started") {
    return rejection(
      state,
      draft,
      "CHALLENGE_NOT_STARTED",
      "请先在挑战页开始新一轮挑战。",
      computedIntent,
    );
  }
  if (state.mode === "challenge" && state.challenge.status === "completed") {
    return rejection(
      state,
      draft,
      "CHALLENGE_COMPLETED",
      "挑战已结束，当前存档仅可查看、导出或开始新一轮挑战。",
      computedIntent,
    );
  }
  if (draft.generation && draft.generation !== state.portfolio.generation) {
    return rejection(
      state,
      draft,
      "GENERATION_CHANGED",
      "账户已重置或恢复，旧页面请求已失效，请刷新后重试。",
      computedIntent,
    );
  }
  if (
    draft.accountVersion !== undefined &&
    draft.accountVersion !== state.portfolio.accountVersion
  ) {
    return rejection(
      state,
      draft,
      "ACCOUNT_VERSION_CONFLICT",
      "账户资金或持仓已变化，请核对最新数据后重新确认。",
      computedIntent,
    );
  }
  if (state.paused) {
    return rejection(
      state,
      draft,
      "SIMULATION_PAUSED",
      "仿真当前已暂停，请继续仿真后再提交委托。",
      computedIntent,
    );
  }

  const phase = resolveMarketPhase(
    market,
    state.minuteOfDay,
    state.extendedHours,
  );
  if (!isTradablePhase(phase)) {
    return rejection(
      state,
      draft,
      "MARKET_CLOSED",
      `当前为${phaseLabel(phase)}，模拟市场暂不接受委托。`,
      computedIntent,
    );
  }
  if (
    quote.haltedUntilMinute !== null &&
    state.minuteOfDay < quote.haltedUntilMinute
  ) {
    return rejection(
      state,
      draft,
      "HALTED",
      `${instrument.name} 当前停牌，复牌时间约为 ${
        quote.haltedUntilMinute / 60 < 24 ? "今日模拟时段内" : "下一时段"
      }。`,
      computedIntent,
    );
  }
  if (phase === "extended" && draft.type === "market") {
    return rejection(
      state,
      draft,
      "EXTENDED_HOURS_LIMIT_ONLY",
      "盘前盘后仅支持限价委托，请选择限价单。",
      computedIntent,
    );
  }
  if (!Number.isInteger(draft.quantity) || draft.quantity <= 0) {
    return rejection(
      state,
      draft,
      "INVALID_QUANTITY",
      "数量必须是大于 0 的整数。",
      computedIntent,
    );
  }
  const lotError = validateLotSize(state, draft, instrument, market);
  if (lotError) {
    return rejection(
      state,
      draft,
      draft.quantity <= 0 ? "INVALID_QUANTITY" : "LOT_SIZE",
      lotError,
      computedIntent,
    );
  }
  if (isAuctionPhase(phase) && draft.type === "market") {
    return rejection(
      state,
      draft,
      "AUCTION_LIMIT_ONLY",
      "集合竞价仅支持限价委托，请设置可接受的成交价格。",
      computedIntent,
    );
  }
  if (
    draft.type === "limit" &&
    (!draft.limitPrice ||
      draft.limitPrice <= 0 ||
      Math.abs(draft.limitPrice * 100 - Math.round(draft.limitPrice * 100)) >
        1e-7)
  ) {
    return rejection(
      state,
      draft,
      "INVALID_PRICE",
      "限价必须大于 0，且最多保留两位小数。",
      computedIntent,
    );
  }
  if (
    draft.type === "limit" &&
    draft.limitPrice !== null &&
    ((quote.upperLimit !== null && draft.limitPrice > quote.upperLimit) ||
      (quote.lowerLimit !== null && draft.limitPrice < quote.lowerLimit))
  ) {
    return rejection(
      state,
      draft,
      "PRICE_LIMIT",
      `委托价必须位于当日跌停价 ${quote.lowerLimit?.toFixed(2)} 与涨停价 ${quote.upperLimit?.toFixed(2)} 之间。`,
      computedIntent,
    );
  }
  const estimatedAmount = estimatedOrderAmount(draft, quote);
  const estimateFees = calculateFeeBreakdown(
    estimatedAmount,
    draft.side,
    market,
  );
  if (draft.side === "buy") {
    const required = roundMoney(estimatedAmount + estimateFees.total);
    if (required > state.portfolio.cash) {
      return rejection(
        state,
        draft,
        "INSUFFICIENT_CASH",
        `买入 ${draft.quantity} 股预计需要 ${market.currencySymbol}${required.toFixed(2)}，当前可用资金 ${market.currencySymbol}${state.portfolio.cash.toFixed(2)}，还差 ${market.currencySymbol}${(required - state.portfolio.cash).toFixed(2)}。`,
        computedIntent,
      );
    }
  }
  if (draft.side === "sell") {
    const available =
      state.portfolio.positions[draft.symbol]?.sellableQuantity ?? 0;
    if (draft.quantity > available) {
      return rejection(
        state,
        draft,
        "INSUFFICIENT_SELLABLE_SHARES",
        `可卖数量不足：需要 ${draft.quantity} 股，当前可卖 ${available} 股${
          market.settlement === "T+1"
            ? "（A 股当日买入部分需下一交易日可卖）"
            : ""
        }。`,
        computedIntent,
      );
    }
  }
  if (
    quote.asOfSec !== currentSec(state) ||
    quote.bookSeq !== state.bookSeqCounter
  ) {
    return rejection(
      state,
      draft,
      "STALE_QUOTE",
      "当前盘口快照与仿真时间不一致，请等待下一次行情更新后重试。",
      computedIntent,
    );
  }

  const order = makeOrder(state, draft, "pending", computedIntent);
  state.orders.push(order);
  state.portfolio.accountVersion += 1;
  order.accountVersion = state.portfolio.accountVersion;
  if (draft.side === "buy") {
    const freeze =
      draft.type === "limit"
        ? roundMoney(estimatedAmount + estimateFees.total)
        : roundMoney(estimatedAmount + estimateFees.total);
    state.portfolio.cash = roundMoney(state.portfolio.cash - freeze);
    state.portfolio.frozenCash = roundMoney(
      state.portfolio.frozenCash + freeze,
    );
    order.frozenAmount = freeze;
  } else {
    const position = state.portfolio.positions[draft.symbol];
    if (position) {
      position.sellableQuantity -= draft.quantity;
      position.frozenQuantity += draft.quantity;
    }
    order.frozenAmount = 0;
  }

  if (phase === "continuous" || phase === "extended") {
    matchOrder(state, order);
    if (draft.type === "market" && order.status !== "filled") {
      cancelRemainder(state, order, order.filledQuantity > 0 ? "partially_cancelled" : "cancelled");
    }
  }
  updatePortfolioValuation(state);
  return {
    ok: true,
    state,
    order: state.orders.find((item) => item.id === order.id) ?? order,
    code: null,
    message:
      order.status === "filled"
        ? "委托已全部成交。"
        : order.status === "partially_filled"
          ? "委托已部分成交，剩余数量继续挂单。"
          : order.status === "partially_cancelled"
            ? "市价委托部分成交，剩余数量已自动撤销。"
            : order.status === "cancelled"
              ? "市价委托未获得可成交盘口，已撤销。"
              : "限价委托已提交，等待触价成交。",
    duplicate: false,
  };
}

function matchOrder(state: SimulationState, order: Order): void {
  const quote = state.quotes[order.symbol];
  const instrument = findInstrument(state, order.symbol);
  if (!quote || !instrument) return;
  if (
    quote.haltedUntilMinute !== null &&
    state.minuteOfDay < quote.haltedUntilMinute
  ) {
    return;
  }
  const levels = order.side === "buy" ? quote.askLevels : quote.bidLevels;
  let remaining = order.quantity - order.filledQuantity;
  for (const level of levels) {
    if (remaining <= 0) break;
    if (level.quantity <= 0) continue;
    const qualifies =
      order.type === "market" ||
      (order.side === "buy"
        ? order.limitPrice !== null && level.price <= order.limitPrice
        : order.limitPrice !== null && level.price >= order.limitPrice);
    if (!qualifies) continue;
    const fillQuantity = Math.min(remaining, level.quantity);
    if (fillQuantity <= 0) continue;
    executeFill(state, order, instrument, level.price, fillQuantity);
    level.quantity -= fillQuantity;
    remaining -= fillQuantity;
  }
  if (order.filledQuantity >= order.quantity) {
    order.status = "filled";
    releaseOrderReservation(state, order);
  } else if (order.filledQuantity > 0) {
    order.status = "partially_filled";
  }
}

function executeFill(
  state: SimulationState,
  order: Order,
  instrument: Instrument,
  price: number,
  quantity: number,
): void {
  const market = getMarketConfig(state.marketId);
  const cumulativeQuantity = order.filledQuantity + quantity;
  const cumulativeAmount = roundMoney(
    (order.avgFillPrice * order.filledQuantity + price * quantity),
  );
  const previousCommission = commissionAlreadyPaid(
    state.trades,
    order.clientOrderId,
  );
  const fees = calculateFillFees(
    roundMoney(price * quantity),
    cumulativeAmount,
    order.side,
    market,
    previousCommission,
  );
  const amount = roundMoney(price * quantity);
  state.portfolio.accountVersion += 1;
  let realizedPnl = 0;

  if (order.side === "buy") {
    const totalCost = roundMoney(amount + fees.total);
    state.portfolio.frozenCash = roundMoney(
      Math.max(0, state.portfolio.frozenCash - totalCost),
    );
    order.frozenAmount = roundMoney(
      Math.max(0, order.frozenAmount - totalCost),
    );
    const existing = state.portfolio.positions[order.symbol] ?? createEmptyPosition(order.symbol);
    const tradeId = `TRD-${state.simulatedDate.replaceAll("-", "")}-${state.trades.length + 1}`;
    existing.lots.push({
      id: `LOT-${tradeId}`,
      buyTradeId: tradeId,
      quantity,
      remainingQuantity: quantity,
      unitCost: totalCost / quantity,
      acquiredDate: state.simulatedDate,
    });
    existing.totalQuantity += quantity;
    if (market.settlement === "T+0") existing.sellableQuantity += quantity;
    order.feePaid = roundMoney(order.feePaid + fees.total);
    state.portfolio.feesPaid = roundMoney(
      state.portfolio.feesPaid + fees.total,
    );
    state.portfolio.positions[order.symbol] = existing;
  } else {
    const existing =
      state.portfolio.positions[order.symbol] ?? createEmptyPosition(order.symbol);
    const lotCost = consumeFifoLots(existing, quantity);
    const netProceeds = roundMoney(amount - fees.total);
    realizedPnl = roundMoney(netProceeds - lotCost);
    state.portfolio.cash = roundMoney(state.portfolio.cash + netProceeds);
    state.portfolio.realizedPnl = roundMoney(
      state.portfolio.realizedPnl + realizedPnl,
    );
    existing.realizedPnl = roundMoney(existing.realizedPnl + realizedPnl);
    existing.totalQuantity -= quantity;
    existing.frozenQuantity = Math.max(
      0,
      existing.frozenQuantity - quantity,
    );
    order.feePaid = roundMoney(order.feePaid + fees.total);
    state.portfolio.feesPaid = roundMoney(
      state.portfolio.feesPaid + fees.total,
    );
    if (existing.totalQuantity <= 0) {
      delete state.portfolio.positions[order.symbol];
    } else {
      state.portfolio.positions[order.symbol] = existing;
    }
  }

  const trade: Trade = {
    id: `TRD-${state.simulatedDate.replaceAll("-", "")}-${state.trades.length + 1}`,
    orderId: order.id,
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    price,
    quantity,
    amount,
    commission: fees.commission,
    stampDuty: fees.stampDuty,
    transferFee: fees.transferFee,
    totalFee: fees.total,
    executedAtSec: currentSec(state),
    accountVersion: state.portfolio.accountVersion,
    realizedPnl,
  };
  state.trades.push(trade);
  order.filledQuantity = cumulativeQuantity;
  order.avgFillPrice = cumulativeAmount / cumulativeQuantity;
  state.portfolio.fillCount += 1;

  const quote = state.quotes[order.symbol];
  quote.last = roundTick(
    clamp(
      price,
      quote.lowerLimit ?? market.tickSize,
      quote.upperLimit ?? Number.POSITIVE_INFINITY,
    ),
    market.tickSize,
  );
  quote.high = Math.max(quote.high, quote.last);
  quote.low = Math.min(quote.low, quote.last);
  quote.volume += quantity;
  quote.turnover = roundMoney(quote.turnover + amount);
  quote.turnoverRate =
    instrument.sharesOutstanding > 0
      ? (quote.volume / instrument.sharesOutstanding) * 100
      : 0;
  const tape = state.tape[order.symbol] ?? [];
  tape.push({
    id: `USER-${trade.id}`,
    timeSec: trade.executedAtSec,
    price,
    quantity,
    side: order.side,
  });
  state.tape[order.symbol] = tape.slice(-30);
  appendOrUpdateCandle(
    state,
    instrument,
    quote.last,
    quote,
    state.minuteOfDay,
  );
}

function consumeFifoLots(position: Position, quantity: number): number {
  let remaining = quantity;
  let cost = 0;
  for (const lot of position.lots) {
    if (remaining <= 0) break;
    if (lot.remainingQuantity <= 0) continue;
    const consumed = Math.min(remaining, lot.remainingQuantity);
    lot.remainingQuantity -= consumed;
    remaining -= consumed;
    cost += consumed * lot.unitCost;
  }
  position.lots = position.lots.filter((lot) => lot.remainingQuantity > 0);
  return roundMoney(cost);
}

function releaseOrderReservation(state: SimulationState, order: Order): void {
  if (order.frozenAmount > 0) {
    state.portfolio.frozenCash = roundMoney(
      Math.max(0, state.portfolio.frozenCash - order.frozenAmount),
    );
    state.portfolio.cash = roundMoney(
      state.portfolio.cash + order.frozenAmount,
    );
    order.frozenAmount = 0;
    state.portfolio.accountVersion += 1;
  }
}

function cancelRemainder(
  state: SimulationState,
  order: Order,
  status: "cancelled" | "partially_cancelled" | "expired",
): void {
  const remaining = Math.max(0, order.quantity - order.filledQuantity);
  if (remaining <= 0) return;
  if (order.side === "buy") {
    releaseOrderReservation(state, order);
  } else {
    const position = state.portfolio.positions[order.symbol];
    if (position) {
      position.frozenQuantity = Math.max(
        0,
        position.frozenQuantity - remaining,
      );
      position.sellableQuantity += remaining;
      state.portfolio.accountVersion += 1;
    }
  }
  order.status =
    status === "partially_cancelled" && order.filledQuantity === 0
      ? "cancelled"
      : status;
}

export function cancelOrder(
  original: SimulationState,
  orderId: string,
): OrderResult {
  const state = cloneState(original);
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) {
    return {
      ok: false,
      state,
      order: null,
      code: "ORDER_NOT_FOUND",
      message: "未找到该委托。",
      duplicate: false,
    };
  }
  if (order.status !== "pending" && order.status !== "partially_filled") {
    return {
      ok: false,
      state,
      order,
      code: "ORDER_NOT_CANCELLABLE",
      message: "该委托当前状态不可撤销。",
      duplicate: false,
    };
  }
  const market = getMarketConfig(state.marketId);
  const phase = resolveMarketPhase(
    market,
    state.minuteOfDay,
    state.extendedHours,
  );
  if (!canCancelAt(state.minuteOfDay, phase)) {
    return {
      ok: false,
      state,
      order,
      code: "CANCEL_WINDOW_CLOSED",
      message:
        phase === "closing_auction" || (state.minuteOfDay >= 560 && state.minuteOfDay < 565)
          ? "当前集合竞价禁撤单窗口内，无法撤销委托。"
          : "当前时段无法撤单。",
      duplicate: false,
    };
  }
  cancelRemainder(
    state,
    order,
    order.filledQuantity > 0 ? "partially_cancelled" : "cancelled",
  );
  updatePortfolioValuation(state);
  return {
    ok: true,
    state,
    order,
    code: null,
    message: "委托已撤销，冻结资金或股份已释放。",
    duplicate: false,
  };
}

function matchAuctionOrders(state: SimulationState): void {
  const pending = state.orders
    .filter(
      (order) =>
        order.status === "pending" || order.status === "partially_filled",
    )
    .sort(
      (left, right) =>
        left.createdAtSec - right.createdAtSec ||
        left.sequence - right.sequence,
    );
  const capacityBySymbol = new Map<string, number>();
  pending.forEach((order) => {
    if (capacityBySymbol.has(order.symbol)) return;
    const quote = state.quotes[order.symbol];
    if (!quote) {
      capacityBySymbol.set(order.symbol, 0);
      return;
    }
    const buyCapacity = quote.bidLevels.reduce(
      (sum, level) => sum + Math.max(0, level.quantity),
      0,
    );
    const sellCapacity = quote.askLevels.reduce(
      (sum, level) => sum + Math.max(0, level.quantity),
      0,
    );
    capacityBySymbol.set(
      order.symbol,
      Math.max(0, Math.min(buyCapacity, sellCapacity)),
    );
  });

  for (const order of pending) {
    const quote = state.quotes[order.symbol];
    const instrument = findInstrument(state, order.symbol);
    if (!quote || !instrument) continue;
    const available = capacityBySymbol.get(order.symbol) ?? 0;
    if (available <= 0) continue;
    const crosses =
      order.side === "buy"
        ? order.limitPrice !== null && order.limitPrice >= quote.last
        : order.limitPrice !== null && order.limitPrice <= quote.last;
    if (!crosses) continue;
    const remaining = order.quantity - order.filledQuantity;
    const fillQuantity = Math.min(remaining, available);
    if (fillQuantity <= 0) continue;
    executeFill(state, order, instrument, quote.last, fillQuantity);
    capacityBySymbol.set(order.symbol, available - fillQuantity);
    if (order.filledQuantity >= order.quantity) {
      order.status = "filled";
      releaseOrderReservation(state, order);
    } else {
      order.status = "partially_filled";
    }
  }
}

function expireOpenOrders(state: SimulationState): void {
  state.orders.forEach((order) => {
    if (order.status === "pending" || order.status === "partially_filled") {
      cancelRemainder(
        state,
        order,
        order.filledQuantity > 0 ? "partially_cancelled" : "expired",
      );
    }
  });
}

function changeRegime(state: SimulationState): void {
  const random = createRandomSource(
    streamSeed(
      state.seed,
      state.marketId,
      "regime",
      state.simulatedDate,
    ),
  );
  state.regime = weightedPick(random, [
    {
      value: "bull" as const,
      weight:
        state.regime === "bull" ? 0.82 : state.regime === "range" ? 0.12 : 0.08,
    },
    {
      value: "range" as const,
      weight:
        state.regime === "bull" ? 0.13 : state.regime === "range" ? 0.78 : 0.22,
    },
    {
      value: "stress" as const,
      weight:
        state.regime === "bull" ? 0.05 : state.regime === "range" ? 0.1 : 0.7,
    },
  ]);
  const sectors = Object.keys(state.sectorFactors);
  const sectorRandom = createRandomSource(
    streamSeed(state.seed, state.marketId, "sector-daily", state.simulatedDate),
  );
  sectors.forEach((sector) => {
    state.sectorFactors[sector] = clamp(
      (state.sectorFactors[sector] ?? 0) * 0.72 +
        sectorRandom.normal() * 0.015,
      -0.06,
      0.06,
    );
  });
}

function appendDailyCandle(state: SimulationState): void {
  if (state.lastCloseSummary?.date === state.simulatedDate) return;
  state.instruments.forEach((instrument) => {
    const intraday = state.intradayCandles[instrument.symbol] ?? [];
    const quote = state.quotes[instrument.symbol];
    if (intraday.length === 0 || !quote) return;
    const daily = state.dailyCandles[instrument.symbol] ?? [];
    daily.push({
      timeSec: dateToEpochSec(state.simulatedDate, 0),
      open: intraday[0].open,
      high: Math.max(...intraday.map((item) => item.high), quote.high),
      low: Math.min(...intraday.map((item) => item.low), quote.low),
      close: quote.last,
      volume: quote.volume,
    });
    if (daily.length > 320) daily.shift();
    state.dailyCandles[instrument.symbol] = daily;
  });
}

function closeTradingDayMutable(state: SimulationState): void {
  if (state.lastCloseSummary?.date === state.simulatedDate) return;
  const market = getMarketConfig(state.marketId);
  const phase = resolveMarketPhase(
    market,
    state.minuteOfDay,
    state.extendedHours,
  );
  if (phase === "closing_auction") matchAuctionOrders(state);
  expireOpenOrders(state);
  updatePortfolioValuation(state);
  const equity = state.portfolio.equity;
  const dailyPnl = roundMoney(equity - state.portfolio.previousCloseEquity);
  state.portfolio.equityCurve.push({
    date: state.simulatedDate,
    equity,
    benchmark: state.index.points,
  });
  const report =
    state.mode === "challenge" && state.challenge.status === "running"
      ? calculateChallengeScore(state)
      : null;
  state.challenge.maxDrawdownPercent = report?.maxDrawdownPercent ?? 0;
  if (state.mode === "challenge" && state.challenge.status === "running") {
    state.challenge.day += 1;
    if (state.challenge.day > state.challenge.totalDays) {
      state.challenge.day = state.challenge.totalDays + 1;
      state.challenge.status = "completed";
      state.challenge.report = calculateChallengeScore(state);
      state.paused = true;
    }
  }
  state.lastCloseSummary = {
    date: state.simulatedDate,
    equity,
    dailyPnl,
    closedAtSec: currentSec(state),
  };
  state.portfolio.previousCloseEquity = equity;
  if (market.settlement === "T+1") {
    Object.values(state.portfolio.positions).forEach((position) => {
      position.sellableQuantity = Math.max(
        0,
        position.totalQuantity - position.frozenQuantity,
      );
    });
  }
  appendDailyCandle(state);
  state.paused = true;
}

export function closeTradingDay(original: SimulationState): SimulationState {
  const state = cloneState(original);
  closeTradingDayMutable(state);
  return state;
}

export function advanceTradingDay(original: SimulationState): SimulationState {
  const state = cloneState(original);
  if (state.challenge.status === "completed") return state;
  const market = getMarketConfig(state.marketId);
  const nextDate = nextTradingDate(state.simulatedDate);
  const previousQuotes = state.quotes;
  changeRegime(state);
  state.simulatedDate = nextDate;
  state.minuteOfDay = marketStartMinute(market, state.extendedHours);
  state.bookSeqCounter += 1;
  Object.values(state.portfolio.positions).forEach((position) => {
    position.sellableQuantity = Math.max(
      0,
      position.totalQuantity - position.frozenQuantity,
    );
  });
  state.instruments.forEach((instrument) => {
    const previous = previousQuotes[instrument.symbol];
    const previousClose = previous?.last ?? instrument.basePrice;
    state.quotes[instrument.symbol] = createQuote(
      instrument,
      market,
      state.seed,
      nextDate,
      resolveMarketPhase(market, state.minuteOfDay, state.extendedHours),
      state.minuteOfDay,
      previousClose,
      previousClose,
      previousClose,
      previousClose,
      previousClose,
      0,
      state.bookSeqCounter,
      state.extendedHours,
    );
  });
  state.intradayCandles = {};
  state.tape = {};
  state.index.previousClose = state.index.points;
  state.index.change = 0;
  state.index.changePercent = 0;
  state.index.turnover = 0;
  state.lastCloseSummary = null;
  state.news = ensureNewsWindow(state, market);
  state.paused = false;
  updatePortfolioValuation(state);
  return state;
}

export function applyExtendedHoursSetting(
  original: SimulationState,
  enabled: boolean,
): SimulationState {
  if (original.marketId !== "us-sim") return original;
  const state = cloneState(original);
  state.extendedHours = enabled;
  const market = getMarketConfig(state.marketId);
  if (
    enabled &&
    !state.lastCloseSummary &&
    state.trades.length === 0 &&
    state.minuteOfDay === 570
  ) {
    state.minuteOfDay = marketStartMinute(market, true);
    state.bookSeqCounter += 1;
    state.instruments.forEach((instrument) => {
      const previous = state.quotes[instrument.symbol];
      const previousClose = previous?.previousClose ?? instrument.basePrice;
      state.quotes[instrument.symbol] = createQuote(
        instrument,
        market,
        state.seed,
        state.simulatedDate,
        "extended",
        state.minuteOfDay,
        previousClose,
        previousClose,
        previousClose,
        previousClose,
        previousClose,
        0,
        state.bookSeqCounter,
        true,
      );
    });
  }
  Object.values(state.quotes).forEach((quote) => {
    quote.phase =
      quote.haltedUntilMinute !== null &&
      state.minuteOfDay < quote.haltedUntilMinute
        ? "halted"
        : resolveMarketPhase(market, state.minuteOfDay, enabled);
    quote.asOfSec = dateToEpochSec(state.simulatedDate, state.minuteOfDay);
    quote.bookSeq = state.bookSeqCounter;
  });
  updatePortfolioValuation(state);
  return state;
}

export function tick(
  original: SimulationState,
  minutes: number,
): SimulationState {
  if (original.paused) return original;
  if (original.mode === "challenge" && original.challenge.status !== "running") {
    return original;
  }
  const state = cloneState(original);
  const market = getMarketConfig(state.marketId);
  const steps = Math.max(1, Math.min(32, Math.floor(minutes)));
  for (let index = 0; index < steps; index += 1) {
    if (isDayClosed(market, state.minuteOfDay, state.extendedHours)) break;
    const previousMinute = state.minuteOfDay;
    state.minuteOfDay = advanceMarketMinute(
      market,
      state.minuteOfDay,
      state.extendedHours,
    );
    state.bookSeqCounter += 1;
    const nowSec = currentSec(state);
    applyDueNews(state, market, nowSec);
    const phase = resolveMarketPhase(
      market,
      state.minuteOfDay,
      state.extendedHours,
    );
    Object.values(state.quotes).forEach((quote) => {
      quote.phase =
        quote.haltedUntilMinute !== null &&
        state.minuteOfDay < quote.haltedUntilMinute
          ? "halted"
          : phase;
      quote.asOfSec = nowSec;
      quote.bookSeq = state.bookSeqCounter;
    });

    const openingAuctionInstant = state.minuteOfDay === 565;
    const closingAuctionInstant =
      market.id !== "us-sim" && state.minuteOfDay === 900;
    if (openingAuctionInstant) {
      Object.values(state.quotes).forEach((quote) => {
        quote.open = quote.last;
      });
    }
    if (openingAuctionInstant || closingAuctionInstant) {
      matchAuctionOrders(state);
    }
    if (phase === "continuous" || phase === "extended") {
      updatePricesForMinute(state, market);
    } else {
      state.instruments.forEach((instrument) => {
        const quote = state.quotes[instrument.symbol];
        updateQuoteBook(state, instrument, quote);
        appendTape(state, instrument, quote);
      });
    }
    if (phase === "continuous" || phase === "extended") {
      state.orders
        .filter(
          (order) =>
            order.status === "pending" || order.status === "partially_filled",
        )
        .forEach((order) => matchOrder(state, order));
    }
    updatePortfolioValuation(state);
    if (
      state.minuteOfDay ===
      (market.id === "us-sim" && state.extendedHours ? 1200 : market.id === "us-sim" ? 960 : 900)
    ) {
      closeTradingDayMutable(state);
      break;
    }
    if (state.minuteOfDay <= previousMinute) break;
  }
  updatePortfolioValuation(state);
  return state;
}

export function serializeSimulation(state: SimulationState): string {
  const {
    dailyCandles: _dailyCandles,
    thirtyMinuteCandles: _thirtyMinuteCandles,
    intradayCandles: _intradayCandles,
    tape: _tape,
    ...snapshot
  } = state;
  void _dailyCandles;
  void _thirtyMinuteCandles;
  void _intradayCandles;
  void _tape;
  return JSON.stringify(snapshot);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAndMigrate(
  raw: unknown,
  expected?: { marketId?: MarketId; mode?: SimMode },
): SimulationState {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("存档不是有效的 JSON。");
    }
  }
  if (!isObject(parsed)) throw new Error("存档根结构无效。");
  if (parsed.schemaVersion !== 1) {
    throw new Error("存档版本不兼容，当前仅支持 schemaVersion 1。");
  }
  const marketId = parsed.marketId;
  const mode = parsed.mode;
  if (
    marketId !== "cn-fic" &&
    marketId !== "cn-real-demo" &&
    marketId !== "us-sim"
  ) {
    throw new Error("存档中的市场标识无效。");
  }
  if (mode !== "sandbox" && mode !== "challenge") {
    throw new Error("存档中的模式标识无效。");
  }
  if (expected?.marketId && marketId !== expected.marketId) {
    throw new Error("导入文件的市场与当前存档槽位不一致。");
  }
  if (expected?.mode && mode !== expected.mode) {
    throw new Error("导入文件的模式与当前存档槽位不一致。");
  }
  if (
    typeof parsed.simulatedDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(parsed.simulatedDate) ||
    typeof parsed.minuteOfDay !== "number" ||
    !Number.isFinite(parsed.minuteOfDay)
  ) {
    throw new Error("存档中的模拟时间无效。");
  }
  if (
    !Array.isArray(parsed.instruments) ||
    parsed.instruments.length !== 12 ||
    !isObject(parsed.quotes) ||
    !isObject(parsed.portfolio)
  ) {
    throw new Error("存档中的市场数据结构不完整。");
  }
  if (
    !Array.isArray(parsed.orders) ||
    !Array.isArray(parsed.trades) ||
    !Array.isArray(parsed.news)
  ) {
    throw new Error("存档中的订单、成交或新闻结构无效。");
  }
  const portfolio = parsed.portfolio as Record<string, unknown>;
  if (
    typeof portfolio.cash !== "number" ||
    !Number.isFinite(portfolio.cash) ||
    portfolio.cash < 0 ||
    typeof portfolio.frozenCash !== "number" ||
    !Number.isFinite(portfolio.frozenCash) ||
    portfolio.frozenCash < 0 ||
    !isObject(portfolio.positions)
  ) {
    throw new Error("存档中的账户金额或持仓结构无效。");
  }
  if (
    !isObject(parsed.challenge) ||
    (parsed.challenge.status !== "not_started" &&
      parsed.challenge.status !== "running" &&
      parsed.challenge.status !== "completed")
  ) {
    throw new Error("存档中的挑战状态无效。");
  }
  const state = parsed as unknown as SimulationState;
  const market = getMarketConfig(state.marketId);
  state.orders.forEach((order, index) => {
    if (!Number.isInteger(order.sequence)) {
      order.sequence = index + 1;
    }
  });
  state.instruments.forEach((instrument) => {
    if (!Number.isFinite(instrument.ewmaVolatility)) {
      instrument.ewmaVolatility = instrument.annualVolatility;
    }
  });
  const previousDate = state.simulatedDate;
  const history = generateHistory(
    state.instruments,
    market,
    state.seed,
    previousDate,
  );
  state.instruments.forEach((instrument) => {
    const quote = state.quotes[instrument.symbol];
    const daily = history.dailyCandles[instrument.symbol] ?? [];
    const lastClose = daily[daily.length - 1]?.close;
    if (!quote || !lastClose || lastClose <= 0) return;
    const ratio = quote.previousClose / lastClose;
    history.dailyCandles[instrument.symbol] = daily.map((candle) => ({
      ...candle,
      open: roundTick(candle.open * ratio, market.tickSize),
      high: roundTick(candle.high * ratio, market.tickSize),
      low: roundTick(candle.low * ratio, market.tickSize),
      close: roundTick(candle.close * ratio, market.tickSize),
    }));
    const halfHour = history.thirtyMinuteCandles[instrument.symbol] ?? [];
    history.thirtyMinuteCandles[instrument.symbol] = halfHour.map((candle) => ({
      ...candle,
      open: roundTick(candle.open * ratio, market.tickSize),
      high: roundTick(candle.high * ratio, market.tickSize),
      low: roundTick(candle.low * ratio, market.tickSize),
      close: roundTick(candle.close * ratio, market.tickSize),
    }));
  });
  state.dailyCandles = history.dailyCandles;
  state.thirtyMinuteCandles = history.thirtyMinuteCandles;
  state.intradayCandles = {};
  state.tape = {};
  state.instruments.forEach((instrument) => {
    const quote = state.quotes[instrument.symbol];
    if (!quote) throw new Error(`存档缺少 ${instrument.symbol} 的行情。`);
    const intraday = generateOpeningIntraday(
      instrument,
      market,
      state.seed,
      state.simulatedDate,
      state.minuteOfDay,
      quote.previousClose,
      state.extendedHours,
    );
    const lastBar = intraday[intraday.length - 1];
    if (lastBar) {
      lastBar.close = quote.last;
      lastBar.high = Math.max(lastBar.high, quote.last);
      lastBar.low = Math.min(lastBar.low, quote.last);
    }
    state.intradayCandles[instrument.symbol] = intraday;
    const phase = resolveMarketPhase(
      market,
      state.minuteOfDay,
      state.extendedHours,
    );
    quote.phase =
      quote.haltedUntilMinute !== null &&
      state.minuteOfDay < quote.haltedUntilMinute
        ? "halted"
        : phase;
    state.tape[instrument.symbol] = createTape(
      quote,
      instrument,
      state.seed,
      state.simulatedDate,
      state.minuteOfDay,
    );
  });
  updatePortfolioValuation(state);
  return state;
}

export function refreshGeneration(state: SimulationState): SimulationState {
  const next = cloneState(state);
  const entropic = hash32(
    `${state.portfolio.generation}|${state.seed}|${state.simulatedDate}|${
      state.portfolio.accountVersion
    }|${state.nextOrderSeq}|${state.portfolio.equity}`,
  );
  next.portfolio.generation = `gen-${entropic.toString(16)}-${(
    (state.portfolio.accountVersion + 1) *
    2654435761
  ).toString(16)}`;
  next.portfolio.accountVersion += 1;
  return next;
}

export function getOrderPreviewMessage(
  state: SimulationState,
  draft: OrderDraft,
): string {
  const quote = state.quotes[draft.symbol];
  if (!quote) return "请选择证券。";
  const market = getMarketConfig(state.marketId);
  const risk = getRiskPreview(state, draft);
  return `预计金额 ${market.currencySymbol}${risk.estimatedAmount.toFixed(
    2,
  )}，费用 ${market.currencySymbol}${risk.fees.total.toFixed(2)}。`;
}

export function getChallengeReport(
  state: Pick<
    SimulationState,
    "challenge" | "portfolio" | "index" | "instruments" | "orders" | "marketId"
  >,
): ChallengeReport {
  return calculateChallengeScore(state);
}

export function getMarketPhase(state: SimulationState): string {
  const market = getMarketConfig(state.marketId);
  const phase = resolveMarketPhase(
    market,
    state.minuteOfDay,
    state.extendedHours,
  );
  return phaseLabel(phase);
}

export function currentTimestamp(state: SimulationState): number {
  return currentSec(state);
}

export const ENGINE_DEFAULT_SEED = DEFAULT_SEED;
export const ENGINE_INITIAL_DATE = INITIAL_DATE;
