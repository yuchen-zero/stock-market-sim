import type {
  BoardType,
  Instrument,
  MarketConfig,
  MarketId,
} from "../types/domain";
import { createRandomSource, streamSeed } from "../engine/rng";

export const MARKET_CONFIGS: Record<MarketId, MarketConfig> = {
  "cn-fic": {
    id: "cn-fic",
    label: "虚构 A 股",
    shortLabel: "A股",
    currency: "CNY",
    currencySymbol: "¥",
    timezone: "Asia/Shanghai",
    settlement: "T+1",
    tickSize: 0.01,
    supportsPriceLimit: true,
    priceLimitByBoard: {
      main: 0.1,
      star: 0.2,
      chinext: 0.2,
      st: 0.05,
      us: null,
    },
    initialCapital: 1_000_000,
    quantityRules: {
      main: { minimum: 100, increment: 100, oddLotSellAll: true },
      star: { minimum: 200, increment: 1, oddLotSellAll: true },
      chinext: { minimum: 100, increment: 100, oddLotSellAll: true },
      st: { minimum: 100, increment: 100, oddLotSellAll: true },
      us: { minimum: 1, increment: 1, oddLotSellAll: true },
    },
    sessions: [
      { startMinute: 555, endMinute: 570, phase: "opening_auction" },
      { startMinute: 570, endMinute: 690, phase: "continuous" },
      { startMinute: 690, endMinute: 780, phase: "break" },
      { startMinute: 780, endMinute: 897, phase: "continuous" },
      { startMinute: 897, endMinute: 900, phase: "closing_auction" },
    ],
    fees: {
      commissionRate: 0.0003,
      commissionMin: 5,
      stampDutySellRate: 0.0005,
      transferFeeRate: 0.00001,
    },
  },
  "cn-real-demo": {
    id: "cn-real-demo",
    label: "真实名称 A 股演示",
    shortLabel: "A股演示",
    currency: "CNY",
    currencySymbol: "¥",
    timezone: "Asia/Shanghai",
    settlement: "T+1",
    tickSize: 0.01,
    supportsPriceLimit: true,
    priceLimitByBoard: {
      main: 0.1,
      star: 0.2,
      chinext: 0.2,
      st: 0.05,
      us: null,
    },
    initialCapital: 1_000_000,
    quantityRules: {
      main: { minimum: 100, increment: 100, oddLotSellAll: true },
      star: { minimum: 200, increment: 1, oddLotSellAll: true },
      chinext: { minimum: 100, increment: 100, oddLotSellAll: true },
      st: { minimum: 100, increment: 100, oddLotSellAll: true },
      us: { minimum: 1, increment: 1, oddLotSellAll: true },
    },
    sessions: [
      { startMinute: 555, endMinute: 570, phase: "opening_auction" },
      { startMinute: 570, endMinute: 690, phase: "continuous" },
      { startMinute: 690, endMinute: 780, phase: "break" },
      { startMinute: 780, endMinute: 897, phase: "continuous" },
      { startMinute: 897, endMinute: 900, phase: "closing_auction" },
    ],
    fees: {
      commissionRate: 0.0003,
      commissionMin: 5,
      stampDutySellRate: 0.0005,
      transferFeeRate: 0.00001,
    },
  },
  "us-sim": {
    id: "us-sim",
    label: "美股风格",
    shortLabel: "美股",
    currency: "USD",
    currencySymbol: "$",
    timezone: "America/New_York",
    settlement: "T+0",
    tickSize: 0.01,
    supportsPriceLimit: false,
    priceLimitByBoard: {
      main: null,
      star: null,
      chinext: null,
      st: null,
      us: null,
    },
    initialCapital: 100_000,
    quantityRules: {
      main: { minimum: 1, increment: 1, oddLotSellAll: true },
      star: { minimum: 1, increment: 1, oddLotSellAll: true },
      chinext: { minimum: 1, increment: 1, oddLotSellAll: true },
      st: { minimum: 1, increment: 1, oddLotSellAll: true },
      us: { minimum: 1, increment: 1, oddLotSellAll: true },
    },
    sessions: [
      { startMinute: 240, endMinute: 570, phase: "extended" },
      { startMinute: 570, endMinute: 960, phase: "continuous" },
      { startMinute: 960, endMinute: 1200, phase: "extended" },
    ],
    fees: {
      commissionRate: 0,
      commissionMin: 0,
      stampDutySellRate: 0,
      transferFeeRate: 0,
    },
  },
};

interface InstrumentSeed {
  symbol: string;
  name: string;
  sector: string;
  board: BoardType;
  price: number;
  shares: number;
  isRealNameDemo?: boolean;
}

export const UNIVERSE: Record<MarketId, InstrumentSeed[]> = {
  "cn-fic": [
    { symbol: "600101", name: "华辰酒业", sector: "消费", board: "main", price: 128.4, shares: 1_250_000_000 },
    { symbol: "600102", name: "云岭食品", sector: "消费", board: "main", price: 36.8, shares: 2_100_000_000 },
    { symbol: "600201", name: "海岳银行", sector: "金融", board: "main", price: 12.6, shares: 18_500_000_000 },
    { symbol: "600202", name: "中安保险", sector: "金融", board: "main", price: 48.3, shares: 5_800_000_000 },
    { symbol: "300301", name: "星河科技", sector: "科技", board: "chinext", price: 74.2, shares: 980_000_000 },
    { symbol: "688302", name: "智联微电", sector: "科技", board: "star", price: 96.5, shares: 620_000_000 },
    { symbol: "600401", name: "康源医药", sector: "医药", board: "main", price: 58.7, shares: 1_480_000_000 },
    { symbol: "300402", name: "瑞生医疗", sector: "医药", board: "chinext", price: 88.1, shares: 730_000_000 },
    { symbol: "600501", name: "绿擎能源", sector: "能源与公用", board: "main", price: 9.85, shares: 6_700_000_000 },
    { symbol: "600502", name: "东岚电力", sector: "能源与公用", board: "main", price: 17.45, shares: 4_100_000_000 },
    { symbol: "600601", name: "远驰汽车", sector: "新能源与汽车", board: "main", price: 23.9, shares: 3_600_000_000 },
    { symbol: "600602", name: "ST 恒川", sector: "新能源与汽车", board: "st", price: 3.68, shares: 1_150_000_000 },
  ],
  "cn-real-demo": [
    { symbol: "600519", name: "贵州茅台", sector: "消费", board: "main", price: 1500, shares: 1_256_000_000, isRealNameDemo: true },
    { symbol: "000858", name: "五粮液", sector: "消费", board: "main", price: 128, shares: 3_880_000_000, isRealNameDemo: true },
    { symbol: "600036", name: "招商银行", sector: "金融", board: "main", price: 36, shares: 25_200_000_000, isRealNameDemo: true },
    { symbol: "601318", name: "中国平安", sector: "金融", board: "main", price: 52, shares: 18_200_000_000, isRealNameDemo: true },
    { symbol: "688981", name: "中芯国际", sector: "科技", board: "star", price: 72, shares: 7_950_000_000, isRealNameDemo: true },
    { symbol: "002475", name: "立讯精密", sector: "科技", board: "main", price: 42, shares: 7_200_000_000, isRealNameDemo: true },
    { symbol: "600276", name: "恒瑞医药", sector: "医药", board: "main", price: 58, shares: 6_370_000_000, isRealNameDemo: true },
    { symbol: "300760", name: "迈瑞医疗", sector: "医药", board: "chinext", price: 260, shares: 1_210_000_000, isRealNameDemo: true },
    { symbol: "601857", name: "中国石油", sector: "能源与公用", board: "main", price: 8.6, shares: 183_000_000_000, isRealNameDemo: true },
    { symbol: "600900", name: "长江电力", sector: "能源与公用", board: "main", price: 28, shares: 24_400_000_000, isRealNameDemo: true },
    { symbol: "300750", name: "宁德时代", sector: "新能源与汽车", board: "chinext", price: 210, shares: 4_400_000_000, isRealNameDemo: true },
    { symbol: "002594", name: "比亚迪", sector: "新能源与汽车", board: "main", price: 280, shares: 2_910_000_000, isRealNameDemo: true },
  ],
  "us-sim": [
    { symbol: "NVGR", name: "NovaGrid Inc.", sector: "科技", board: "us", price: 140, shares: 920_000_000 },
    { symbol: "QHBR", name: "Quantum Harbor", sector: "科技", board: "us", price: 76.5, shares: 480_000_000 },
    { symbol: "MEDX", name: "MedAxis Systems", sector: "医药", board: "us", price: 58.2, shares: 610_000_000 },
    { symbol: "BIOV", name: "BioVista Labs", sector: "医药", board: "us", price: 33.4, shares: 390_000_000 },
    { symbol: "FHBK", name: "First Harbor Bank", sector: "金融", board: "us", price: 42.1, shares: 1_250_000_000 },
    { symbol: "TRST", name: "Trustline Capital", sector: "金融", board: "us", price: 88.7, shares: 720_000_000 },
    { symbol: "AURA", name: "Aura Foods Inc.", sector: "消费", board: "us", price: 52.3, shares: 830_000_000 },
    { symbol: "MART", name: "MainStreet Mart", sector: "消费", board: "us", price: 24.8, shares: 1_480_000_000 },
    { symbol: "GRPE", name: "GridPeak Energy", sector: "能源与公用", board: "us", price: 68.4, shares: 760_000_000 },
    { symbol: "SLRP", name: "Solaris Power", sector: "能源与公用", board: "us", price: 19.9, shares: 1_020_000_000 },
    { symbol: "VLTX", name: "VoltMotion Inc.", sector: "新能源与汽车", board: "us", price: 120.6, shares: 540_000_000 },
    { symbol: "CRGB", name: "CargoBridge Inc.", sector: "新能源与汽车", board: "us", price: 35.7, shares: 690_000_000 },
  ],
};

export function createInstrumentList(
  marketId: MarketId,
  seed: string,
  count = 12,
): Instrument[] {
  return UNIVERSE[marketId].slice(0, count).map((item, index) => {
    const random = createRandomSource(
      streamSeed(seed, marketId, "instrument", item.symbol, index),
    );
    const beta = 0.7 + random.next() * 0.7;
    const sectorBeta = 0.7 + random.next() * 0.6;
    const annualVolatility = 0.18 + random.next() * 0.42;
    const liquidity = 0.2 + random.next() * 0.8;
    const eps = Math.max(0.02, item.price / (12 + random.next() * 22));
    const pe = item.price / eps;
    const bookValue = Math.max(0.4, item.price / (1.2 + random.next() * 5));
    const pb = item.price / bookValue;
    const roe = 4 + random.next() * 22;
    const revenueGrowth = -4 + random.next() * 28;
    const dividendYield = random.next() * 4.5;
    const high52Week = item.price * (1.08 + random.next() * 0.34);
    const low52Week = item.price * (0.55 + random.next() * 0.2);
    const baseDailyShares = Math.max(
      80_000,
      Math.round(item.shares * (0.002 + random.next() * 0.014)),
    );

    return {
      id: `${marketId}:${item.symbol}`,
      marketId,
      symbol: item.symbol,
      name: item.name,
      sector: item.sector,
      board: item.board,
      basePrice: item.price,
      sharesOutstanding: item.shares,
      beta,
      sectorBeta,
      annualVolatility,
      ewmaVolatility: annualVolatility,
      liquidity,
      avgDailyVolume: baseDailyShares,
      fairValue: item.price * (0.93 + random.next() * 0.15),
      fundamentals: {
        eps,
        pe,
        pb,
        roe,
        revenueGrowth,
        dividendYield,
        high52Week,
        low52Week,
      },
      isRealNameDemo: Boolean(item.isRealNameDemo),
    };
  });
}

export const SECTORS = [
  "消费",
  "金融",
  "科技",
  "医药",
  "能源与公用",
  "新能源与汽车",
] as const;

export const MARKET_ORDER: MarketId[] = [
  "cn-fic",
  "cn-real-demo",
  "us-sim",
];

export function getMarketConfig(marketId: MarketId): MarketConfig {
  return MARKET_CONFIGS[marketId];
}

export function getCurrencySymbol(marketId: MarketId): "¥" | "$" {
  return MARKET_CONFIGS[marketId].currencySymbol;
}
