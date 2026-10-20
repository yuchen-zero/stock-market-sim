import type { MarketConfig, MarketPhase } from "../types/domain";

const MINUTES_PER_DAY = 24 * 60;

export function parseDateUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function formatDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateToEpochSec(date: string, minuteOfDay: number): number {
  return Math.floor(parseDateUtc(date).getTime() / 1000) + minuteOfDay * 60;
}

export function epochSecToDateTime(epochSec: number): {
  date: string;
  minuteOfDay: number;
} {
  const daySec = 86_400;
  const dayStart = Math.floor(epochSec / daySec) * daySec;
  return {
    date: new Date(dayStart * 1000).toISOString().slice(0, 10),
    minuteOfDay: Math.floor((epochSec - dayStart) / 60),
  };
}

export function formatClock(minuteOfDay: number): string {
  const normalized = Math.max(0, Math.min(MINUTES_PER_DAY - 1, minuteOfDay));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatDate(date: string): string {
  const parsed = parseDateUtc(date);
  const week = "日一二三四五六";
  return `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(
    date.slice(8, 10),
  )}日 周${week[parsed.getUTCDay()]}`;
}

export function formatDateTime(epochSec: number): string {
  const value = epochSecToDateTime(epochSec);
  return `${value.date.slice(5).replace("-", "/")} ${formatClock(value.minuteOfDay)}`;
}

export function isWeekend(date: string): boolean {
  const day = parseDateUtc(date).getUTCDay();
  return day === 0 || day === 6;
}

export function nextTradingDate(date: string): string {
  const current = parseDateUtc(date);
  do {
    current.setUTCDate(current.getUTCDate() + 1);
  } while (current.getUTCDay() === 0 || current.getUTCDay() === 6);
  return formatDateUtc(current);
}

export function previousTradingDates(endDate: string, count: number): string[] {
  const dates: string[] = [];
  const cursor = parseDateUtc(endDate);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      dates.unshift(formatDateUtc(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

export function futureTradingDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (dates.length < count) {
    dates.push(cursor);
    cursor = nextTradingDate(cursor);
  }
  return dates;
}

export function resolveMarketPhase(
  market: MarketConfig,
  minuteOfDay: number,
  extendedHours: boolean,
): MarketPhase {
  if (market.id === "us-sim") {
    if (extendedHours) {
      if (minuteOfDay >= 240 && minuteOfDay < 570) return "extended";
      if (minuteOfDay >= 570 && minuteOfDay < 960) return "continuous";
      if (minuteOfDay >= 960 && minuteOfDay < 1200) return "extended";
      return "closed";
    }
    return minuteOfDay >= 570 && minuteOfDay < 960 ? "continuous" : "closed";
  }

  if (minuteOfDay >= 555 && minuteOfDay < 565) return "opening_auction";
  if (minuteOfDay >= 565 && minuteOfDay < 570) return "preopen";
  if (minuteOfDay >= 570 && minuteOfDay < 690) return "continuous";
  if (minuteOfDay >= 690 && minuteOfDay < 780) return "break";
  if (minuteOfDay >= 780 && minuteOfDay < 897) return "continuous";
  if (minuteOfDay >= 897 && minuteOfDay < 900) return "closing_auction";
  return "closed";
}

export function marketStartMinute(
  market: MarketConfig,
  extendedHours: boolean,
): number {
  if (market.id === "us-sim") return extendedHours ? 240 : 570;
  return 555;
}

export function marketCloseMinute(
  market: MarketConfig,
  extendedHours: boolean,
): number {
  if (market.id === "us-sim") return extendedHours ? 1200 : 960;
  return 900;
}

export function advanceMarketMinute(
  market: MarketConfig,
  minuteOfDay: number,
  extendedHours: boolean,
): number {
  const close = marketCloseMinute(market, extendedHours);
  if (minuteOfDay >= close) return close;

  if (market.id === "cn-fic" || market.id === "cn-real-demo") {
    if (minuteOfDay < 555) return 555;
    if (minuteOfDay === 690) return 780;
    return Math.min(minuteOfDay + 1, close);
  }

  if (market.id === "us-sim") {
    const start = marketStartMinute(market, extendedHours);
    if (minuteOfDay < start) return start;
    return Math.min(minuteOfDay + 1, close);
  }

  return Math.min(minuteOfDay + 1, close);
}

export function isTradablePhase(phase: MarketPhase): boolean {
  return (
    phase === "continuous" ||
    phase === "extended" ||
    phase === "opening_auction" ||
    phase === "closing_auction"
  );
}

export function isAuctionPhase(phase: MarketPhase): boolean {
  return phase === "opening_auction" || phase === "closing_auction";
}

export function canCancelAt(minuteOfDay: number, phase: MarketPhase): boolean {
  if (phase === "opening_auction") {
    return minuteOfDay >= 555 && minuteOfDay < 560;
  }
  if (phase === "closing_auction") return false;
  return phase !== "closed" && phase !== "break";
}

export function phaseLabel(phase: MarketPhase): string {
  const labels: Record<MarketPhase, string> = {
    preopen: "盘前",
    opening_auction: "开盘集合竞价",
    continuous: "连续交易",
    closing_auction: "收盘集合竞价",
    break: "午间休市",
    extended: "盘前盘后",
    closed: "已收盘",
    halted: "停牌",
  };
  return labels[phase];
}

export function isDayClosed(
  market: MarketConfig,
  minuteOfDay: number,
  extendedHours: boolean,
): boolean {
  return minuteOfDay >= marketCloseMinute(market, extendedHours);
}

export function minutesFromHHMM(hour: number, minute: number): number {
  return hour * 60 + minute;
}
