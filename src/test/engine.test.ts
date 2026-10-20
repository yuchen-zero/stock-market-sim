import { describe, expect, it } from "vitest";
import {
  advanceTradingDay,
  applyExtendedHoursSetting,
  cancelOrder,
  closeTradingDay,
  createSimulation,
  getRiskPreview,
  refreshGeneration,
  serializeSimulation,
  startChallenge,
  submitOrder,
  tick,
  validateAndMigrate,
} from "../engine/engine";
import { calculateFeeBreakdown, calculateFillFees } from "../engine/fees";
import { calculateChallengeScore } from "../engine/challenge";
import { roundMoney } from "../engine/money";
import { getVisibleNews, NEWS_TEMPLATE_COUNT } from "../engine/news";
import { getMarketConfig } from "../data/markets";
import { dateToEpochSec, epochSecToDateTime } from "../engine/time";
import type { OrderDraft, SimulationState } from "../types/domain";

function sandbox(marketId: "cn-fic" | "cn-real-demo" | "us-sim" = "cn-fic") {
  return createSimulation(getMarketConfig(marketId), "sandbox", "TEST-SEED");
}

function advanceTo(state: SimulationState, minute: number): SimulationState {
  let next = state;
  let guard = 0;
  while (next.minuteOfDay < minute && !next.paused && guard < 20) {
    next = tick({ ...next, paused: false }, Math.min(32, minute - next.minuteOfDay));
    guard += 1;
  }
  return next;
}

function syncQuoteTime(state: SimulationState): void {
  Object.values(state.quotes).forEach((quote) => {
    quote.asOfSec = dateToEpochSec(state.simulatedDate, state.minuteOfDay);
    quote.bookSeq = state.bookSeqCounter;
  });
}

function draft(
  state: SimulationState,
  overrides: Partial<OrderDraft>,
): OrderDraft {
  const symbol = overrides.symbol ?? "600101";
  const quote = state.quotes[symbol];
  return {
    clientOrderId: "client-1",
    symbol,
    side: "buy",
    type: "limit",
    limitPrice: quote.askLevels[0].price,
    quantity: 100,
    ...overrides,
  };
}

describe("deterministic simulation engine", () => {
  it("is reproducible for the same seed, market and tick sequence", () => {
    const first = sandbox();
    const second = sandbox();
    expect(serializeSimulation(first)).toBe(serializeSimulation(second));
    const firstTicked = tick(first, 10);
    const secondTicked = tick(second, 10);
    expect(serializeSimulation(firstTicked)).toBe(
      serializeSimulation(secondTicked),
    );
    expect(firstTicked.quotes["600101"].last).toBe(
      secondTicked.quotes["600101"].last,
    );
  });

  it("builds valid 260-day, 30-minute and intraday OHLC histories", () => {
    const state = advanceTo(sandbox(), 610);
    for (const instrument of state.instruments) {
      const daily = state.dailyCandles[instrument.symbol];
      const halfHour = state.thirtyMinuteCandles[instrument.symbol];
      const intraday = state.intradayCandles[instrument.symbol];
      expect(daily).toHaveLength(260);
      expect(halfHour.length).toBeGreaterThanOrEqual(80);
      expect(intraday.length).toBeGreaterThan(0);
      for (const candle of [...daily, ...halfHour, ...intraday]) {
        expect(candle.low).toBeLessThanOrEqual(
          Math.min(candle.open, candle.close),
        );
        expect(candle.high).toBeGreaterThanOrEqual(
          Math.max(candle.open, candle.close),
        );
        expect(candle.volume).toBeGreaterThanOrEqual(0);
        expect(candle.close).toBeGreaterThan(0);
      }
    }
  });

  it("keeps A-share prices inside board limits and lets US prices move without limits", () => {
    let cn = sandbox("cn-fic");
    cn = advanceTo(cn, 640);
    for (const instrument of cn.instruments) {
      const quote = cn.quotes[instrument.symbol];
      expect(quote.last).toBeGreaterThan(0);
      expect(quote.upperLimit).not.toBeNull();
      expect(quote.lowerLimit).not.toBeNull();
      expect(quote.last).toBeLessThanOrEqual(quote.upperLimit! + 0.001);
      expect(quote.last).toBeGreaterThanOrEqual(quote.lowerLimit! - 0.001);
    }

    let us = sandbox("us-sim");
    us = advanceTo(us, 610);
    for (const quote of Object.values(us.quotes)) {
      expect(quote.upperLimit).toBeNull();
      expect(quote.lowerLimit).toBeNull();
      expect(quote.last).toBeGreaterThan(0);
    }
  });

  it("uses the correct board price limits and quantity rules", () => {
    const state = advanceTo(sandbox(), 590);
    const boardRatios = getMarketConfig("cn-fic").priceLimitByBoard;
    expect(boardRatios.main).toBe(0.1);
    expect(boardRatios.st).toBe(0.05);
    expect(boardRatios.chinext).toBe(0.2);
    expect(boardRatios.star).toBe(0.2);

    const invalidMain = submitOrder(
      state,
      draft(state, { symbol: "600101", quantity: 50 }),
    );
    expect(invalidMain.code).toBe("LOT_SIZE");

    const invalidStar = submitOrder(
      state,
      draft(state, { symbol: "688302", quantity: 199 }),
    );
    expect(invalidStar.code).toBe("LOT_SIZE");

    const validStar = submitOrder(
      state,
      draft(state, {
        symbol: "688302",
        quantity: 200,
        clientOrderId: "star-200",
      }),
    );
    expect(validStar.ok).toBe(true);
    expect(validStar.order?.quantity).toBe(200);

    const validChinext = submitOrder(
      state,
      draft(state, {
        symbol: "300301",
        quantity: 100,
        clientOrderId: "chinext-100",
      }),
    );
    expect(validChinext.ok).toBe(true);
    const invalidSt = submitOrder(
      state,
      draft(state, {
        symbol: "600602",
        quantity: 50,
        clientOrderId: "st-50",
      }),
    );
    expect(invalidSt.code).toBe("LOT_SIZE");
  });

  it("enforces A-share T+1 and US T+0", () => {
    const cn = advanceTo(sandbox(), 590);
    const bought = submitOrder(
      cn,
      draft(cn, { symbol: "600101", quantity: 100, clientOrderId: "cn-buy" }),
    );
    expect(bought.ok).toBe(true);
    expect(bought.state.portfolio.positions["600101"].totalQuantity).toBe(100);
    expect(bought.state.portfolio.positions["600101"].sellableQuantity).toBe(0);
    const sameDaySell = submitOrder(
      bought.state,
      draft(bought.state, {
        symbol: "600101",
        side: "sell",
        quantity: 100,
        limitPrice: bought.state.quotes["600101"].bidLevels[0].price,
        clientOrderId: "cn-sell",
      }),
    );
    expect(sameDaySell.code).toBe("INSUFFICIENT_SELLABLE_SHARES");
    const closed = closeTradingDay({
      ...bought.state,
      minuteOfDay: 900,
      lastCloseSummary: null,
    });
    expect(closed.portfolio.positions["600101"].sellableQuantity).toBe(100);
    const nextDay = advanceTradingDay(closed);
    expect(nextDay.portfolio.positions["600101"].sellableQuantity).toBe(100);

    const us = advanceTo(sandbox("us-sim"), 600);
    const usBought = submitOrder(
      us,
      draft(us, {
        symbol: "NVGR",
        quantity: 1,
        limitPrice: us.quotes.NVGR.askLevels[0].price,
      }),
    );
    expect(usBought.state.portfolio.positions.NVGR.sellableQuantity).toBe(1);
    const usSold = submitOrder(
      usBought.state,
      draft(usBought.state, {
        symbol: "NVGR",
        side: "sell",
        quantity: 1,
        limitPrice: usBought.state.quotes.NVGR.bidLevels[0].price,
        clientOrderId: "us-sell",
      }),
    );
    expect(usSold.ok).toBe(true);
    expect(usSold.state.portfolio.positions.NVGR).toBeUndefined();
  });

  it("allows one odd-lot sell-all but rejects splitting a sub-lot balance", () => {
    const base = advanceTo(sandbox(), 590);
    const state = structuredClone(base);
    const quote = state.quotes["600101"];
    state.portfolio.positions["600101"] = {
      symbol: "600101",
      totalQuantity: 50,
      sellableQuantity: 50,
      frozenQuantity: 0,
      averageCost: 100,
      lots: [
        {
          id: "odd-lot",
          buyTradeId: "odd-lot-trade",
          quantity: 50,
          remainingQuantity: 50,
          unitCost: 100,
          acquiredDate: state.simulatedDate,
        },
      ],
      marketValue: 50 * quote.last,
      unrealizedPnl: 0,
      realizedPnl: 0,
    };
    const split = submitOrder(
      state,
      draft(state, {
        symbol: "600101",
        side: "sell",
        quantity: 30,
        limitPrice: quote.bidLevels[0].price,
        clientOrderId: "odd-split",
      }),
    );
    expect(split.code).toBe("LOT_SIZE");
    const all = submitOrder(
      state,
      draft(state, {
        symbol: "600101",
        side: "sell",
        quantity: 50,
        limitPrice: quote.bidLevels[0].price,
        clientOrderId: "odd-all",
      }),
    );
    expect(all.ok).toBe(true);
    expect(all.order?.status).toBe("filled");
  });

  it("calculates per-component fees, half-cent boundaries and one minimum commission", () => {
    const cn = getMarketConfig("cn-fic");
    const buy = calculateFeeBreakdown(10_000, "buy", cn);
    expect(buy).toEqual({
      commission: 5,
      stampDuty: 0,
      transferFee: 0.1,
      total: 5.1,
    });
    const sell = calculateFeeBreakdown(20_000, "sell", cn);
    expect(sell.commission).toBe(6);
    expect(sell.stampDuty).toBe(10);
    expect(sell.transferFee).toBe(0.2);
    expect(calculateFeeBreakdown(500, "buy", cn).transferFee).toBe(0.01);

    const first = calculateFillFees(1_000, 1_000, "buy", cn, 0);
    const second = calculateFillFees(9_000, 10_000, "buy", cn, first.commission);
    expect(first.commission).toBe(5);
    expect(second.commission).toBe(0);
    expect(first.commission + second.commission).toBe(5);
  });

  it("matches a market order across finite five-level depth and cancels the remainder", () => {
    const base = advanceTo(sandbox(), 590);
    const state = structuredClone(base);
    const quote = state.quotes["600101"];
    quote.askLevels = quote.askLevels.map((level) => ({ ...level, quantity: 10 }));
    quote.asOfSec = dateToEpochSec(state.simulatedDate, state.minuteOfDay);
    quote.bookSeq = state.bookSeqCounter;
    const result = submitOrder(state, {
      clientOrderId: "market-depth",
      symbol: "600101",
      side: "buy",
      type: "market",
      limitPrice: null,
      quantity: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.state.trades.length).toBeGreaterThan(0);
    expect(result.order?.filledQuantity).toBeLessThanOrEqual(50);
    expect(result.order?.status).toBe("partially_cancelled");
    expect(result.state.portfolio.frozenCash).toBe(0);
  });

  it("lets a limit order continue filling across simulator minutes", () => {
    const base = advanceTo(sandbox(), 590);
    const state = structuredClone(base);
    const quote = state.quotes["600101"];
    quote.askLevels = quote.askLevels.map((level) => ({ ...level, quantity: 10 }));
    quote.asOfSec = dateToEpochSec(state.simulatedDate, state.minuteOfDay);
    quote.bookSeq = state.bookSeqCounter;
    const pending = submitOrder(
      state,
      draft(state, {
        clientOrderId: "multi-minute",
        quantity: 100,
        limitPrice: quote.upperLimit ?? quote.last + 5,
      }),
    );
    expect(pending.order?.filledQuantity).toBe(50);
    expect(pending.order?.status).toBe("partially_filled");
    const later = tick({ ...pending.state, paused: false }, 1);
    const order = later.orders.find(
      (item) => item.clientOrderId === "multi-minute",
    );
    expect(order?.filledQuantity).toBeGreaterThan(50);
    expect(later.trades.length).toBeGreaterThan(
      pending.state.trades.length,
    );
  });

  it("keeps non-crossing limit orders pending and cancels their reservations", () => {
    const state = advanceTo(sandbox(), 590);
    const quote = state.quotes["600101"];
    const result = submitOrder(
      state,
      draft(state, {
        clientOrderId: "pending-limit",
        limitPrice: Math.max(0.01, quote.last - 1),
        quantity: 100,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.order?.status).toBe("pending");
    expect(result.state.portfolio.frozenCash).toBeGreaterThan(0);
    const cancelled = cancelOrder(result.state, result.order!.id);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.portfolio.frozenCash).toBe(0);
    expect(cancelled.state.orders[0].status).toBe("cancelled");
  });

  it("rejects market orders in auctions and blocks cancellation during the 09:20–09:25 window", () => {
    const state = sandbox();
    const marketRejected = submitOrder(state, {
      clientOrderId: "auction-market",
      symbol: "600101",
      side: "buy",
      type: "market",
      limitPrice: null,
      quantity: 100,
    });
    expect(marketRejected.code).toBe("AUCTION_LIMIT_ONLY");
    expect(marketRejected.message).toContain("集合竞价仅支持限价委托");

    const pending = submitOrder(
      state,
      draft(state, {
        clientOrderId: "auction-limit",
        limitPrice: state.quotes["600101"].last,
      }),
    );
    expect(pending.order?.status).toBe("pending");
    const locked = { ...pending.state, minuteOfDay: 561 };
    Object.values(locked.quotes).forEach((quote) => {
      quote.asOfSec = dateToEpochSec(locked.simulatedDate, 561);
      quote.bookSeq = locked.bookSeqCounter;
    });
    const cancelRejected = cancelOrder(locked, pending.order!.id);
    expect(cancelRejected.code).toBe("CANCEL_WINDOW_CLOSED");
  });

  it("returns specific errors for cash, shares, closed market and halted stock", () => {
    const continuous = advanceTo(sandbox(), 590);
    const quote = continuous.quotes["600101"];
    const insufficientCash = submitOrder(
      continuous,
      draft(continuous, {
        symbol: "600101",
        quantity: 1_000_000,
        clientOrderId: "no-cash",
      }),
    );
    expect(insufficientCash.code).toBe("INSUFFICIENT_CASH");
    expect(insufficientCash.message).toContain("可用资金");
    expect(insufficientCash.message).toContain("还差");

    const insufficientShares = submitOrder(
      continuous,
      draft(continuous, {
        symbol: "600101",
        side: "sell",
        quantity: 100,
        clientOrderId: "no-shares",
      }),
    );
    expect(insufficientShares.code).toBe("INSUFFICIENT_SELLABLE_SHARES");
    expect(insufficientShares.message).toContain("可卖数量不足");

    const closedState = {
      ...continuous,
      minuteOfDay: 940,
      paused: false,
    };
    Object.values(closedState.quotes).forEach((item) => {
      item.asOfSec = dateToEpochSec(closedState.simulatedDate, 940);
      item.bookSeq = closedState.bookSeqCounter;
    });
    const closed = submitOrder(
      closedState,
      draft(closedState, {
        symbol: "600101",
        limitPrice: quote.last,
        clientOrderId: "closed",
      }),
    );
    expect(closed.code).toBe("MARKET_CLOSED");
    expect(closed.message).toContain("暂不接受委托");

    const haltedState = structuredClone(continuous);
    haltedState.quotes["600101"].haltedUntilMinute = 600;
    haltedState.quotes["600101"].asOfSec = dateToEpochSec(
      haltedState.simulatedDate,
      haltedState.minuteOfDay,
    );
    haltedState.quotes["600101"].bookSeq = haltedState.bookSeqCounter;
    const halted = submitOrder(
      haltedState,
      draft(haltedState, {
        symbol: "600101",
        limitPrice: quote.last,
        clientOrderId: "halted",
      }),
    );
    expect(halted.code).toBe("HALTED");
  });

  it("rejects extended-hours market orders and stale quotes with actionable codes", () => {
    const base = advanceTo(sandbox("us-sim"), 600);
    const premarket = {
      ...base,
      minuteOfDay: 480,
      extendedHours: true,
      paused: false,
    };
    Object.values(premarket.quotes).forEach((quote) => {
      quote.asOfSec = dateToEpochSec(premarket.simulatedDate, 480);
      quote.bookSeq = premarket.bookSeqCounter;
      quote.phase = "extended";
    });
    const market = submitOrder(premarket, {
      clientOrderId: "extended-market",
      symbol: "NVGR",
      side: "buy",
      type: "market",
      limitPrice: null,
      quantity: 1,
    });
    expect(market.code).toBe("EXTENDED_HOURS_LIMIT_ONLY");

    const stale = structuredClone(premarket);
    stale.quotes.NVGR.asOfSec -= 60;
    const staleResult = submitOrder(
      stale,
      draft(stale, {
        symbol: "NVGR",
        quantity: 1,
        clientOrderId: "stale",
      }),
    );
    expect(staleResult.code).toBe("STALE_QUOTE");

    const freshUs = applyExtendedHoursSetting(sandbox("us-sim"), true);
    expect(freshUs.minuteOfDay).toBe(240);
    expect(freshUs.quotes.NVGR.phase).toBe("extended");
    const limitInPremarket = submitOrder(
      freshUs,
      draft(freshUs, {
        symbol: "NVGR",
        quantity: 1,
        clientOrderId: "extended-limit",
      }),
    );
    expect(limitInPremarket.ok).toBe(true);
  });

  it("fills opening-auction limit orders at the single reference price", () => {
    const state = sandbox();
    const pending = submitOrder(
      state,
      draft(state, {
        clientOrderId: "auction-fill",
        limitPrice: state.quotes["600101"].last + 1,
      }),
    );
    expect(pending.order?.status).toBe("pending");
    const afterAuction = tick(pending.state, 10);
    expect(afterAuction.minuteOfDay).toBe(565);
    const order = afterAuction.orders.find(
      (item) => item.clientOrderId === "auction-fill",
    );
    expect(order?.status).toBe("filled");
    expect(afterAuction.trades.length).toBeGreaterThan(0);
  });

  it("caps auction fills at the smaller visible side capacity", () => {
    const state = sandbox();
    const pending = submitOrder(
      state,
      draft(state, {
        clientOrderId: "auction-capacity",
        limitPrice: state.quotes["600101"].last + 1,
        quantity: 100,
      }),
    );
    const prepared = structuredClone(pending.state);
    prepared.minuteOfDay = 564;
    prepared.paused = false;
    const quote = prepared.quotes["600101"];
    quote.bidLevels = quote.bidLevels.map((level) => ({ ...level, quantity: 2 }));
    quote.askLevels = quote.askLevels.map((level) => ({ ...level, quantity: 2 }));
    quote.asOfSec = dateToEpochSec(prepared.simulatedDate, 564);
    quote.bookSeq = prepared.bookSeqCounter;
    const afterAuction = tick(prepared, 1);
    const order = afterAuction.orders.find(
      (item) => item.clientOrderId === "auction-capacity",
    );
    expect(order?.filledQuantity).toBe(10);
    expect(order?.status).toBe("partially_filled");
  });

  it("shares auction capacity by creation time and order sequence", () => {
    const state = sandbox();
    const first = submitOrder(
      state,
      draft(state, {
        clientOrderId: "auction-first",
        limitPrice: state.quotes["600101"].last + 1,
        quantity: 100,
      }),
    );
    const second = submitOrder(
      first.state,
      draft(first.state, {
        clientOrderId: "auction-second",
        limitPrice: first.state.quotes["600101"].last + 1,
        quantity: 100,
      }),
    );
    const prepared = structuredClone(second.state);
    prepared.minuteOfDay = 564;
    prepared.paused = false;
    const quote = prepared.quotes["600101"];
    quote.bidLevels = quote.bidLevels.map((level) => ({ ...level, quantity: 2 }));
    quote.askLevels = quote.askLevels.map((level) => ({ ...level, quantity: 2 }));
    quote.asOfSec = dateToEpochSec(prepared.simulatedDate, 564);
    quote.bookSeq = prepared.bookSeqCounter;
    const afterAuction = tick(prepared, 1);
    const firstOrder = afterAuction.orders.find(
      (item) => item.clientOrderId === "auction-first",
    );
    const secondOrder = afterAuction.orders.find(
      (item) => item.clientOrderId === "auction-second",
    );
    expect(firstOrder?.sequence).toBeLessThan(secondOrder!.sequence);
    expect(firstOrder?.filledQuantity).toBe(10);
    expect(secondOrder?.filledQuantity).toBe(0);
  });

  it("prioritizes an earlier createdAtSec before order sequence", () => {
    const state = sandbox();
    const first = submitOrder(
      state,
      draft(state, {
        clientOrderId: "auction-seq-first",
        limitPrice: state.quotes["600101"].last + 1,
        quantity: 100,
      }),
    );
    const second = submitOrder(
      first.state,
      draft(first.state, {
        clientOrderId: "auction-time-first",
        limitPrice: first.state.quotes["600101"].last + 1,
        quantity: 100,
      }),
    );
    const prepared = structuredClone(second.state);
    prepared.minuteOfDay = 564;
    prepared.paused = false;
    const laterCreated = prepared.orders.find(
      (item) => item.clientOrderId === "auction-time-first",
    )!;
    laterCreated.createdAtSec -= 1;
    const quote = prepared.quotes["600101"];
    quote.bidLevels = quote.bidLevels.map((level) => ({ ...level, quantity: 2 }));
    quote.askLevels = quote.askLevels.map((level) => ({ ...level, quantity: 2 }));
    quote.asOfSec = dateToEpochSec(prepared.simulatedDate, 564);
    quote.bookSeq = prepared.bookSeqCounter;
    const afterAuction = tick(prepared, 1);
    expect(
      afterAuction.orders.find(
        (item) => item.clientOrderId === "auction-seq-first",
      )?.filledQuantity,
    ).toBe(0);
    expect(
      afterAuction.orders.find(
        (item) => item.clientOrderId === "auction-time-first",
      )?.filledQuantity,
    ).toBe(10);
  });

  it("blocks closing-auction cancellation and expires leftovers at close", () => {
    const base = advanceTo(sandbox(), 890);
    const state = {
      ...base,
      minuteOfDay: 898,
      lastCloseSummary: null,
      paused: false,
    };
    Object.values(state.quotes).forEach((quote) => {
      quote.asOfSec = dateToEpochSec(state.simulatedDate, 898);
      quote.bookSeq = state.bookSeqCounter;
      quote.phase = "closing_auction";
    });
    const pending = submitOrder(
      state,
      draft(state, {
        clientOrderId: "closing-limit",
        limitPrice: Math.max(0.01, state.quotes["600101"].last - 5),
      }),
    );
    expect(pending.order?.status).toBe("pending");
    const cancelRejected = cancelOrder(pending.state, pending.order!.id);
    expect(cancelRejected.code).toBe("CANCEL_WINDOW_CLOSED");
    const closed = tick(pending.state, 2);
    expect(closed.paused).toBe(true);
    expect(closed.orders[0].status).toBe("expired");
    expect(closed.portfolio.frozenCash).toBe(0);
  });

  it("carries a continuous-session limit order into the closing auction", () => {
    const base = advanceTo(sandbox(), 590);
    const pending = submitOrder(
      base,
      draft(base, {
        clientOrderId: "continuous-to-close",
        limitPrice: base.quotes["600101"].last - 1,
        quantity: 100,
      }),
    );
    expect(pending.order?.status).toBe("pending");
    const prepared = {
      ...pending.state,
      minuteOfDay: 899,
      paused: false,
      lastCloseSummary: null,
    };
    const quote = prepared.quotes["600101"];
    const order = prepared.orders.find(
      (item) => item.clientOrderId === "continuous-to-close",
    )!;
    quote.last = order.limitPrice! - 0.01;
    quote.bidLevels = quote.bidLevels.map((level) => ({ ...level, quantity: 5 }));
    quote.askLevels = quote.askLevels.map((level) => ({ ...level, quantity: 5 }));
    syncQuoteTime(prepared);
    const closed = closeTradingDay(prepared);
    expect(
      closed.orders.find(
        (item) => item.clientOrderId === "continuous-to-close",
      )?.filledQuantity,
    ).toBe(25);
  });

  it("releases frozen sellable shares when a sell order is cancelled", () => {
    const base = advanceTo(sandbox(), 590);
    const bought = submitOrder(
      base,
      draft(base, {
        clientOrderId: "release-buy",
        quantity: 100,
      }),
    ).state;
    bought.portfolio.positions["600101"].sellableQuantity = 100;
    const quote = bought.quotes["600101"];
    const sell = submitOrder(
      bought,
      draft(bought, {
        clientOrderId: "release-sell",
        side: "sell",
        quantity: 100,
        limitPrice: Math.min(
          quote.upperLimit ?? quote.last + 1,
          quote.last + 1,
        ),
      }),
    );
    expect(sell.order?.status).toBe("pending");
    expect(sell.state.portfolio.positions["600101"].sellableQuantity).toBe(0);
    const cancelled = cancelOrder(sell.state, sell.order!.id);
    expect(cancelled.ok).toBe(true);
    expect(
      cancelled.state.portfolio.positions["600101"].sellableQuantity,
    ).toBe(100);
    expect(
      cancelled.state.portfolio.positions["600101"].frozenQuantity,
    ).toBe(0);
  });

  it("is idempotent for the same request and rejects a conflicting intent", () => {
    const state = advanceTo(sandbox(), 590);
    const request = draft(state, {
      clientOrderId: "idempotent",
      quantity: 100,
    });
    const first = submitOrder(state, request);
    const second = submitOrder(first.state, request);
    expect(second.duplicate).toBe(true);
    expect(second.order?.id).toBe(first.order?.id);
    expect(second.state.orders).toHaveLength(first.state.orders.length);
    expect(second.state.trades).toHaveLength(first.state.trades.length);
    expect(second.state.portfolio.accountVersion).toBe(
      first.state.portfolio.accountVersion,
    );
    const conflict = submitOrder(first.state, {
      ...request,
      quantity: 200,
    });
    expect(conflict.code).toBe("ORDER_INTENT_CONFLICT");
  });

  it("changes account generation on recovery and supports a fresh generation", () => {
    const state = advanceTo(sandbox(), 590);
    const refreshed = refreshGeneration(state);
    expect(refreshed.portfolio.generation).not.toBe(
      state.portfolio.generation,
    );
    expect(refreshed.portfolio.accountVersion).toBeGreaterThan(
      state.portfolio.accountVersion,
    );
    const staleGeneration = submitOrder(
      state,
      draft(state, {
        clientOrderId: "stale-generation",
        generation: "gen-old",
      }),
    );
    expect(staleGeneration.code).toBe("GENERATION_CHANGED");
    const staleVersion = submitOrder(
      state,
      draft(state, {
        clientOrderId: "stale-version",
        accountVersion: state.portfolio.accountVersion - 1,
      }),
    );
    expect(staleVersion.code).toBe("ACCOUNT_VERSION_CONFLICT");
  });

  it("does not expose future news and applies earnings deterministically", () => {
    const state = sandbox();
    const current = dateToEpochSec(state.simulatedDate, state.minuteOfDay);
    const visible = getVisibleNews(state);
    expect(visible.every((event) => event.publishedAtSec <= current)).toBe(true);
    expect(
      state.news.some(
        (event) => event.publishedAtSec > current && event.category === "earnings",
      ),
    ).toBe(true);
    const other = sandbox();
    expect(
      other.news.map((event) => event.id).slice(0, 20),
    ).toEqual(state.news.map((event) => event.id).slice(0, 20));
    expect(NEWS_TEMPLATE_COUNT).toBeGreaterThanOrEqual(30);
    const perDay = new Map<string, number>();
    state.news.forEach((event) => {
      perDay.set(event.simulatedDate, (perDay.get(event.simulatedDate) ?? 0) + 1);
    });
    expect([...perDay.values()].every((count) => count >= 2 && count <= 5)).toBe(
      true,
    );

    const real = sandbox("cn-real-demo");
    expect(
      real.news.every(
        (event) =>
          event.sentiment === "neutral" && event.category !== "earnings",
      ),
    ).toBe(true);

    const challenges = (["cn-fic", "us-sim"] as const).map((marketId) =>
      startChallenge(
        createSimulation(
          getMarketConfig(marketId),
          "challenge",
          "EARNINGS-WINDOW",
        ),
        "EARNINGS-WINDOW",
      ),
    );
    challenges.forEach((challenge) => {
      const earnings = challenge.news.filter(
        (event) => event.category === "earnings",
      );
      expect(earnings.length).toBeGreaterThanOrEqual(4);
      expect(earnings.length).toBeLessThanOrEqual(8);
      expect(
        challenge.news
          .filter((event) => event.id.startsWith("news-"))
          .every((event) => event.category !== "earnings"),
      ).toBe(true);
      expect(
        earnings.every((event) => event.id.startsWith("earnings-")),
      ).toBe(true);
    });
    const challenge = challenges[0];
    const earnings = challenge.news.filter(
      (event) => event.category === "earnings",
    );

    const updateEvent = earnings.find(
      (event) => event.earningsTier === "beat" || event.earningsTier === "miss",
    )!;
    const instrumentBefore = challenge.instruments.find(
      (item) => item.symbol === updateEvent.target,
    )!;
    const before = {
      fairValue: instrumentBefore.fairValue,
      eps: instrumentBefore.fundamentals.eps,
      pe: instrumentBefore.fundamentals.pe,
      growth: instrumentBefore.fundamentals.revenueGrowth,
    };
    const eventTime = epochSecToDateTime(updateEvent.publishedAtSec);
    const prepared = structuredClone(challenge);
    prepared.simulatedDate = eventTime.date;
    prepared.minuteOfDay = Math.max(0, eventTime.minuteOfDay - 1);
    prepared.paused = false;
    Object.values(prepared.quotes).forEach((quote) => {
      quote.asOfSec = dateToEpochSec(
        prepared.simulatedDate,
        prepared.minuteOfDay,
      );
      quote.bookSeq = prepared.bookSeqCounter;
    });
    const afterPublication = tick(prepared, 1);
    const instrumentAfter = afterPublication.instruments.find(
      (item) => item.symbol === updateEvent.target,
    )!;
    expect(instrumentAfter.fairValue).not.toBe(before.fairValue);
    expect(instrumentAfter.fundamentals.eps).not.toBe(before.eps);
    expect(instrumentAfter.fundamentals.pe).not.toBe(before.pe);
    expect(instrumentAfter.fundamentals.revenueGrowth).not.toBe(before.growth);
  });

  it("computes challenge scores and keeps a consistent risk preview", () => {
    const challenge = startChallenge(
      createSimulation(getMarketConfig("cn-fic"), "challenge", "CHALLENGE"),
      "CHALLENGE",
    );
    const state = advanceTo(challenge, 590);
    const preview = getRiskPreview(
      state,
      draft(state, { symbol: "600101", quantity: 100 }),
    );
    expect(preview.estimatedAmount).toBeGreaterThan(0);
    expect(preview.fees.total).toBeGreaterThanOrEqual(5);
    expect(preview.maxBuyQuantity).toBeGreaterThanOrEqual(100);
    expect(Number.isFinite(preview.lowerLimitLoss)).toBe(true);
    const report = calculateChallengeScore(state);
    expect(report.finalScore).toBeGreaterThanOrEqual(0);
    expect(["S", "A", "B", "C", "D"]).toContain(report.grade);
    expect(report.insights.length).toBeGreaterThanOrEqual(2);
  });

  it("matches every risk-preview field to the fee and FIFO calculation", () => {
    const state = advanceTo(sandbox(), 590);
    const quote = state.quotes["600101"];
    const request = draft(state, {
      symbol: "600101",
      quantity: 100,
      limitPrice: quote.askLevels[0].price,
      clientOrderId: "risk-formula",
    });
    const preview = getRiskPreview(state, request);
    const amount = roundMoney(request.limitPrice! * request.quantity);
    const fees = calculateFeeBreakdown(amount, "buy", getMarketConfig("cn-fic"));
    expect(preview.estimatedAmount).toBe(amount);
    expect(preview.fees).toEqual(fees);
    expect(preview.cashAfter).toBe(
      roundMoney(state.portfolio.cash - amount - fees.total),
    );
    expect(preview.positionWeightAfter).toBeCloseTo(
      (quote.last * request.quantity) /
        (state.portfolio.equity - fees.total) *
        100,
      6,
    );
    expect(preview.lowerLimitLoss).toBe(
      roundMoney(
        quote.lowerLimit! * request.quantity - amount - fees.total,
      ),
    );
    expect(preview.sellableQuantity).toBe(0);
    expect(preview.maxBuyQuantity).toBeGreaterThanOrEqual(100);
  });

  it("applies the published challenge score formula and grade thresholds", () => {
    const state = startChallenge(
      createSimulation(getMarketConfig("cn-fic"), "challenge", "SCORE"),
      "SCORE",
    );
    state.challenge.startCapital = 100_000;
    state.index.points = 1050;
    state.portfolio.equity = 110_000;
    state.portfolio.equityCurve = [
      { date: "2026-10-20", equity: 100_000, benchmark: 1000 },
      { date: "2026-10-21", equity: 120_000, benchmark: 1020 },
      { date: "2026-10-22", equity: 90_000, benchmark: 1030 },
      { date: "2026-10-23", equity: 110_000, benchmark: 1050 },
    ];
    state.portfolio.positions = {};
    const report = calculateChallengeScore(state);
    expect(report.returnPercent).toBeCloseTo(10, 6);
    expect(report.benchmarkReturnPercent).toBeCloseTo(5, 6);
    expect(report.excessReturnPercent).toBeCloseTo(5, 6);
    expect(report.maxDrawdownPercent).toBeCloseTo(-25, 6);
    expect(report.scoreParts.returnScore).toBeCloseTo(62.5, 6);
    expect(report.scoreParts.drawdownScore).toBeCloseTo(0, 6);
    expect(report.finalScore).toBeCloseTo(50.4, 1);
    expect(report.grade).toBe("C");
  });

  it("scores diversification, discipline and trade-note coverage from real metrics", () => {
    let state = startChallenge(
      createSimulation(
        getMarketConfig("cn-fic"),
        "challenge",
        "SCORE-PARTS",
      ),
      "SCORE-PARTS",
    );
    state = advanceTo(state, 590);
    for (const [index, symbol] of ["600101", "600201", "300301"].entries()) {
      const result = submitOrder(
        state,
        draft(state, {
          symbol,
          quantity: 100,
          note: index < 2 ? `计划-${index + 1}` : "",
          clientOrderId: `scored-order-${index}`,
        }),
      );
      expect(result.ok).toBe(true);
      state = result.state;
    }
    state.challenge.startCapital = 100_000;
    state.challenge.startIndex = 1000;
    state.index.points = 1000;
    state.portfolio.equity = 100_000;
    state.portfolio.positions["600101"].marketValue = 25_000;
    state.portfolio.positions["600201"].marketValue = 25_000;
    state.portfolio.positions["300301"].marketValue = 25_000;
    state.portfolio.fillCount = 61;
    state.portfolio.rejectedOrderCount = 2;
    const report = calculateChallengeScore(state);
    expect(report.tradeNoteCoveragePercent).toBeCloseTo((2 / 3) * 100, 5);
    expect(report.sectorsHeld).toBe(3);
    expect(report.maxPositionWeight).toBeCloseTo(0.25, 5);
    expect(report.scoreParts.diversificationScore).toBeCloseTo(100, 5);
    expect(report.scoreParts.disciplineScore).toBeCloseTo(78, 5);
    expect(report.insights.length).toBeGreaterThanOrEqual(2);
    expect(report.insights.length).toBeLessThanOrEqual(4);
  });

  it("completes exactly 30 close cycles and freezes a final challenge report", () => {
    let challenge = startChallenge(
      createSimulation(getMarketConfig("cn-fic"), "challenge", "THIRTY-DAYS"),
      "THIRTY-DAYS",
    );
    challenge = { ...challenge, paused: false };
    let guard = 0;
    while (challenge.challenge.status === "running" && guard < 400) {
      challenge = tick(challenge, 32);
      if (challenge.lastCloseSummary) {
        challenge = advanceTradingDay(challenge);
      }
      guard += 1;
    }
    expect(challenge.challenge.status).toBe("completed");
    expect(challenge.challenge.report).not.toBeNull();
    expect(challenge.challenge.report?.grade).toMatch(/[SABCD]/);
    expect(challenge.paused).toBe(true);
    const blocked = submitOrder(
      challenge,
      draft(challenge, {
        symbol: "600101",
        quantity: 100,
        clientOrderId: "after-finish",
      }),
    );
    expect(blocked.code).toBe("CHALLENGE_COMPLETED");
  });

  it("reconciles cash, frozen cash, positions and FIFO lots after a fill", () => {
    const state = advanceTo(sandbox(), 590);
    const result = submitOrder(
      state,
      draft(state, {
        clientOrderId: "reconcile",
        quantity: 100,
      }),
    );
    const position = result.state.portfolio.positions["600101"];
    const marketValue = Object.values(
      result.state.portfolio.positions,
    ).reduce((sum, item) => sum + item.marketValue, 0);
    expect(
      result.state.portfolio.cash +
        result.state.portfolio.frozenCash +
        marketValue,
    ).toBeCloseTo(result.state.portfolio.equity, 2);
    expect(position.lots[0].remainingQuantity).toBe(position.totalQuantity);
    expect(position.averageCost).toBeGreaterThan(0);
    expect(result.state.portfolio.feesPaid).toBeGreaterThan(0);
  });

  it("replays a completed day through FIFO and reconciles the next-day sale", () => {
    const first = advanceTo(sandbox(), 590);
    const bought = submitOrder(
      first,
      draft(first, {
        clientOrderId: "fifo-buy",
        quantity: 100,
      }),
    );
    expect(bought.state.portfolio.positions["600101"].lots).toHaveLength(1);
    const closed = closeTradingDay({
      ...bought.state,
      minuteOfDay: 900,
      lastCloseSummary: null,
    });
    const nextDay = advanceTo(advanceTradingDay(closed), 590);
    const quote = nextDay.quotes["600101"];
    const sold = submitOrder(
      nextDay,
      draft(nextDay, {
        clientOrderId: "fifo-sell",
        side: "sell",
        quantity: 100,
        limitPrice: quote.bidLevels[0].price,
      }),
    );
    expect(sold.ok).toBe(true);
    expect(sold.state.portfolio.positions["600101"]).toBeUndefined();
    const saleTrade = sold.state.trades.at(-1)!;
    expect(saleTrade.realizedPnl).toBe(
      roundMoney(
        saleTrade.amount -
          saleTrade.totalFee -
          bought.order!.avgFillPrice * 100 -
          bought.state.trades[0].totalFee,
      ),
    );
    expect(
      sold.state.portfolio.cash + sold.state.portfolio.frozenCash,
    ).toBeCloseTo(sold.state.portfolio.equity, 2);
  });

  it("serializes without derived chart blocks and deterministically rebuilds them", () => {
    const state = advanceTo(sandbox(), 620);
    const serialized = serializeSimulation(state);
    expect(serialized).not.toContain('"dailyCandles"');
    expect(serialized).not.toContain('"thirtyMinuteCandles"');
    expect(serialized).not.toContain('"intradayCandles"');
    expect(serialized).not.toContain('"tape"');
    const restored = validateAndMigrate(serialized, {
      marketId: "cn-fic",
      mode: "sandbox",
    });
    expect(restored.dailyCandles["600101"]).toHaveLength(260);
    expect(
      restored.dailyCandles["600101"].at(-1)?.close,
    ).toBeCloseTo(restored.quotes["600101"].previousClose, 2);
    expect(restored.thirtyMinuteCandles["600101"].length).toBeGreaterThan(0);
    expect(restored.intradayCandles["600101"].length).toBeGreaterThan(0);
    expect(restored.intradayCandles["600101"].at(-1)?.close).toBe(
      restored.quotes["600101"].last,
    );
    expect(restored.portfolio.equity).toBeCloseTo(state.portfolio.equity, 2);
  });

  it("skips A-share lunch break and closes after 15:00", () => {
    let state = advanceTo(sandbox(), 688);
    state = tick(state, 4);
    expect(state.minuteOfDay).toBe(781);
    const closed = tick({ ...state, minuteOfDay: 899, paused: false }, 5);
    expect(closed.minuteOfDay).toBe(900);
    expect(closed.paused).toBe(true);
    expect(closed.lastCloseSummary).not.toBeNull();
  });
});
