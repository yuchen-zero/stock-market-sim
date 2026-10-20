import type {
  Candle,
  Instrument,
  MarketConfig,
  MarketPhase,
  OrderBookLevel,
  Quote,
} from "../types/domain";
import { clamp, fromCents, roundTick, toCents } from "./money";
import { createRandomSource, streamSeed } from "./rng";
import {
  advanceMarketMinute,
  dateToEpochSec,
  previousTradingDates,
  resolveMarketPhase,
} from "./time";

function nextOpen(previousClose: number, random: ReturnType<typeof createRandomSource>, volatility: number): number {
  return previousClose * (1 + random.normal() * volatility * 0.28);
}

export function generateHistory(
  instruments: Instrument[],
  market: MarketConfig,
  seed: string,
  endDate: string,
): {
  dailyCandles: Record<string, Candle[]>;
  thirtyMinuteCandles: Record<string, Candle[]>;
} {
  const dates = previousTradingDates(endDate, 260);
  const dailyCandles: Record<string, Candle[]> = {};
  const thirtyMinuteCandles: Record<string, Candle[]> = {};
  const marketRandom = createRandomSource(
    streamSeed(seed, market.id, "history-market", endDate),
  );

  for (const instrument of instruments) {
    const random = createRandomSource(
      streamSeed(seed, market.id, "history", instrument.symbol),
    );
    const dailyVol = instrument.annualVolatility / Math.sqrt(252);
    let close = instrument.basePrice / (1 + instrument.annualVolatility * 0.16);
    const raw: Candle[] = [];

    dates.forEach((date, index) => {
      const common = marketRandom.normal() * 0.0045;
      const drift = 0.00025;
      const dailyReturn = clamp(
        drift + common * instrument.beta + random.normal() * dailyVol * 0.62,
        -0.085,
        0.085,
      );
      const open = nextOpen(close, random, dailyVol);
      const nextClose = Math.max(0.05, open * (1 + dailyReturn));
      const range = Math.max(
        Math.abs(nextClose - open),
        open * dailyVol * (0.4 + random.next() * 1.2),
      );
      const high = Math.max(open, nextClose) + range * random.next();
      const low = Math.max(
        0.01,
        Math.min(open, nextClose) - range * random.next(),
      );
      const volume = Math.round(
        instrument.avgDailyVolume *
          (0.45 + random.next() * 1.25) *
          (1 + Math.abs(dailyReturn) * 12),
      );
      raw.push({
        timeSec: dateToEpochSec(date, 0),
        open,
        high,
        low,
        close: nextClose,
        volume: Math.max(1, volume),
      });
      close = nextClose;
      if (index === dates.length - 1) close = nextClose;
    });

    const scale = instrument.basePrice / raw[raw.length - 1].close;
    const scaled = raw.map((candle, index) => {
      const decimals = market.tickSize < 0.1 ? 2 : 2;
      const scaleValue = (value: number) => Number((value * scale).toFixed(decimals));
      const open = scaleValue(candle.open);
      const closeValue = index === raw.length - 1 ? instrument.basePrice : scaleValue(candle.close);
      const high = Math.max(scaleValue(candle.high), open, closeValue);
      const low = Math.min(scaleValue(candle.low), open, closeValue);
      return {
        ...candle,
        open,
        high,
        low,
        close: closeValue,
      };
    });
    dailyCandles[instrument.symbol] = scaled;

    const halfHour: Candle[] = [];
    scaled.slice(-10).forEach((day) => {
      const subRandom = createRandomSource(
        streamSeed(
          seed,
          market.id,
          "history-30m",
          instrument.symbol,
          day.timeSec,
        ),
      );
      const barStarts =
        market.id === "us-sim"
          ? Array.from({ length: 13 }, (_, index) => 570 + index * 30)
          : [570, 600, 630, 660, 780, 810, 840, 870];
      const barCount = barStarts.length;
      let cursor = day.open;
      for (let bar = 0; bar < barCount; bar += 1) {
        const progress = (bar + 1) / barCount;
        const target = day.open + (day.close - day.open) * progress;
        const noise = day.open * (subRandom.next() - 0.5) * 0.006;
        const closeValue = Math.max(0.01, target + noise);
        const high = Math.max(cursor, closeValue) * (1 + subRandom.next() * 0.004);
        const low = Math.min(cursor, closeValue) * (1 - subRandom.next() * 0.004);
        halfHour.push({
          timeSec: day.timeSec + barStarts[bar] * 60,
          open: cursor,
          high,
          low,
          close: closeValue,
          volume: Math.round(
            (day.volume / barCount) * (0.65 + subRandom.next() * 0.7),
          ),
        });
        cursor = closeValue;
      }
    });
    thirtyMinuteCandles[instrument.symbol] = halfHour;
  }

  return { dailyCandles, thirtyMinuteCandles };
}

export function generateOpeningIntraday(
  instrument: Instrument,
  market: MarketConfig,
  seed: string,
  date: string,
  currentMinute: number,
  previousClose: number,
  extendedHours: boolean,
): Candle[] {
  const start = market.id === "us-sim" ? (extendedHours ? 240 : 570) : 555;
  if (currentMinute < start) return [];
  const random = createRandomSource(
    streamSeed(seed, market.id, "intraday-restore", instrument.symbol, date),
  );
  const limit =
    market.priceLimitByBoard[instrument.board] === null
      ? null
      : market.priceLimitByBoard[instrument.board];
  const upper =
    limit === null ? Number.POSITIVE_INFINITY : roundTick(previousClose * (1 + limit), market.tickSize);
  const lower =
    limit === null ? 0.01 : Math.max(market.tickSize, roundTick(previousClose * (1 - limit), market.tickSize));
  const minuteVol =
    (instrument.annualVolatility / Math.sqrt(252)) /
    Math.sqrt(market.id === "us-sim" ? (extendedHours ? 960 : 390) : 240);
  let minute = start;
  let open = previousClose;
  let last = previousClose;
  const candles: Candle[] = [];

  while (minute <= currentMinute) {
    const phase = resolveMarketPhase(market, minute, extendedHours);
    if (phase === "break") {
      minute = 780;
      continue;
    }
    const change = random.normal() * minuteVol * instrument.beta;
    const close = roundTick(clamp(last * (1 + change), lower, upper), market.tickSize);
    if (minute === start) open = close;
    const high = Math.max(open, close) + Math.abs(random.normal()) * last * minuteVol * 0.4;
    const low = Math.max(0.01, Math.min(open, close) - Math.abs(random.normal()) * last * minuteVol * 0.4);
    candles.push({
      timeSec: dateToEpochSec(date, minute),
      open: roundTick(Math.max(lower, open), market.tickSize),
      high: roundTick(Math.min(upper, high), market.tickSize),
      low: roundTick(Math.max(lower, low), market.tickSize),
      close,
      volume: Math.max(1, Math.round(instrument.avgDailyVolume / 240 * (0.35 + random.next()))),
    });
    last = close;
    open = close;
    if (minute >= (market.id === "us-sim" ? (extendedHours ? 1200 : 960) : 900)) break;
    minute = advanceMarketMinute(market, minute, extendedHours);
  }
  return candles;
}

export function getPriceLimits(
  market: MarketConfig,
  instrument: Instrument,
  previousClose: number,
): { upper: number | null; lower: number | null } {
  if (!market.supportsPriceLimit) return { upper: null, lower: null };
  const ratio = market.priceLimitByBoard[instrument.board];
  if (ratio === null) return { upper: null, lower: null };
  return {
    upper: roundTick(previousClose * (1 + ratio), market.tickSize),
    lower: roundTick(previousClose * (1 - ratio), market.tickSize),
  };
}

export function createBookLevels(
  mid: number,
  market: MarketConfig,
  instrument: Instrument,
  seed: string,
  minuteOfDay: number,
  side: "bid" | "ask",
  upper: number | null,
  lower: number | null,
): OrderBookLevel[] {
  const random = createRandomSource(
    streamSeed(seed, market.id, "book", instrument.symbol, minuteOfDay, side),
  );
  const tickCents = toCents(market.tickSize);
  const middleCents = toCents(mid);
  const spreadTicks = market.id === "us-sim" ? 1 + random.integer(0, 2) : 1 + random.integer(0, 2);
  const baseVolume = Math.max(
    100,
    Math.round(
      (instrument.avgDailyVolume / 240) *
        instrument.liquidity *
        (market.id === "us-sim" ? 0.18 : 0.6),
    ),
  );

  return Array.from({ length: 5 }, (_, index) => {
    const offset =
      side === "bid"
        ? middleCents - (spreadTicks + index) * tickCents
        : middleCents + (spreadTicks + index) * tickCents;
    let price = fromCents(offset);
    if (upper !== null) price = Math.min(upper, price);
    if (lower !== null) price = Math.max(lower, price);
    price = roundTick(price, market.tickSize);
    const atCeiling = upper !== null && side === "ask" && mid >= upper;
    const atFloor = lower !== null && side === "bid" && mid <= lower;
    return {
      price,
      quantity:
        atCeiling || atFloor
          ? 0
          : Math.max(
              1,
              Math.round(baseVolume * (1.4 - index * 0.17) * (0.6 + random.next() * 1.1)),
            ),
    };
  });
}

export function createQuote(
  instrument: Instrument,
  market: MarketConfig,
  seed: string,
  date: string,
  phase: MarketPhase,
  minuteOfDay: number,
  last: number,
  previousClose: number,
  open: number,
  high: number,
  low: number,
  volume: number,
  bookSeq: number,
  _extendedHours: boolean,
): Quote {
  const { upper, lower } = getPriceLimits(market, instrument, previousClose);
  const limitedLast = roundTick(
    clamp(last, lower ?? market.tickSize, upper ?? Number.POSITIVE_INFINITY),
    market.tickSize,
  );
  const change = fromCents(toCents(limitedLast) - toCents(previousClose));
  const changePercent =
    previousClose > 0 ? (change / previousClose) * 100 : 0;
  const bidLevels = createBookLevels(
    limitedLast,
    market,
    instrument,
    seed,
    minuteOfDay,
    "bid",
    upper,
    lower,
  );
  const askLevels = createBookLevels(
    limitedLast,
    market,
    instrument,
    seed,
    minuteOfDay,
    "ask",
    upper,
    lower,
  );
  return {
    symbol: instrument.symbol,
    last: limitedLast,
    previousClose,
    open: roundTick(Math.max(0.01, open), market.tickSize),
    high: roundTick(Math.max(high, limitedLast), market.tickSize),
    low: roundTick(Math.max(0.01, Math.min(low, limitedLast)), market.tickSize),
    change,
    changePercent,
    volume,
    turnover: fromCents(toCents(limitedLast) * volume),
    turnoverRate:
      instrument.sharesOutstanding > 0
        ? (volume / instrument.sharesOutstanding) * 100
        : 0,
    upperLimit: upper,
    lowerLimit: lower,
    bidLevels,
    askLevels,
    phase,
    asOfSec: dateToEpochSec(date, minuteOfDay),
    bookSeq,
    haltedUntilMinute: null,
  };
}
