import type {
  Instrument,
  MarketConfig,
  NewsEvent,
  SimulationState,
} from "../types/domain";
import { createRandomSource, streamSeed } from "./rng";
import {
  dateToEpochSec,
  futureTradingDates,
  nextTradingDate,
} from "./time";

const SOURCES = [
  "模拟财经",
  "远见研究所",
  "全球市场观察",
  "群岛商业电讯",
  "盘前参考",
];

const FICTIONAL_TEMPLATES = [
  {
    category: "macro" as const,
    scope: "market" as const,
    sentiment: "positive" as const,
    headline: "模拟景气指标回暖，市场风险偏好小幅提升",
    summary: "本地仿真模型记录到一组改善的景气指标，资金在多个行业间轮动。该信息完全由程序生成。",
  },
  {
    category: "macro" as const,
    scope: "market" as const,
    sentiment: "negative" as const,
    headline: "模拟流动性预期收紧，主要指数短线承压",
    summary: "一段合成宏观情景显示资金成本可能抬升，模拟盘面出现防御性调仓。",
  },
  {
    category: "macro" as const,
    scope: "market" as const,
    sentiment: "neutral" as const,
    headline: "模拟经济数据进入观察窗口，成交保持平稳",
    summary: "多项虚构经济指标接近预期中值，仿真市场等待新的方向信号。",
  },
  {
    category: "policy" as const,
    scope: "market" as const,
    sentiment: "positive" as const,
    headline: "模拟政策清单释放产业支持信号",
    summary: "虚构政策情景强调设备更新与绿色投资，相关模拟行业出现短时买盘。",
  },
  {
    category: "policy" as const,
    scope: "sector" as const,
    sentiment: "neutral" as const,
    headline: "{sector}模拟政策沟通会进入意见征集阶段",
    summary: "程序生成的行业政策情景显示，规则仍在讨论中，短期影响方向尚不明确。",
  },
  {
    category: "overseas" as const,
    scope: "market" as const,
    sentiment: "positive" as const,
    headline: "海外模拟股指走高，风险资产情绪回暖",
    summary: "一段离线生成的海外市场情景显示，模拟指数上涨并带动本地风险偏好。",
  },
  {
    category: "overseas" as const,
    scope: "market" as const,
    sentiment: "negative" as const,
    headline: "海外模拟波动率抬升，资金短线转向防守",
    summary: "虚构海外情景出现波动放大，仿真市场中的高弹性板块承压。",
  },
  {
    category: "sector" as const,
    scope: "sector" as const,
    sentiment: "positive" as const,
    headline: "模拟订单指标改善，{sector}板块活跃度提升",
    summary: "合成渠道数据表明行业订单边际改善，仿真买盘集中在板块龙头。",
  },
  {
    category: "sector" as const,
    scope: "sector" as const,
    sentiment: "negative" as const,
    headline: "模拟成本曲线上行，{sector}板块估值承压",
    summary: "程序化成本情景显示投入价格短期抬升，行业利润率预期被下修。",
  },
  {
    category: "sector" as const,
    scope: "sector" as const,
    sentiment: "neutral" as const,
    headline: "{sector}模拟景气调查落入中性区间",
    summary: "行业问卷结果接近荣枯平衡线，仿真成交更多体现为存量资金轮动。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "positive" as const,
    headline: "{name}模拟新品进入渠道测试阶段",
    summary: "该公司的虚构经营情景显示新品反馈良好，短期关注度有所提升。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "negative" as const,
    headline: "{name}模拟成本压力上升，短期盈利预期承压",
    summary: "程序生成的经营情景显示原材料与渠道费用同步上行，仅为模拟数据。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "neutral" as const,
    headline: "{name}模拟管理层交流会安排公布",
    summary: "公司将在虚构日程中介绍经营近况与行业展望，仿真信息不含真实数据。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "positive" as const,
    headline: "{name}模拟产能利用率环比改善",
    summary: "离线仿真数据显示排产节奏回升，盘面出现温和增量成交。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "negative" as const,
    headline: "{name}模拟渠道库存去化慢于预期",
    summary: "合成经营数据提示库存周转放缓，相关价格路径被程序下调。",
  },
  {
    category: "macro" as const,
    scope: "market" as const,
    sentiment: "positive" as const,
    headline: "模拟消费信心边际回升，内需板块获得关注",
    summary: "程序生成的消费调查显示预期改善，仿真资金转向内需相关行业。",
  },
  {
    category: "macro" as const,
    scope: "market" as const,
    sentiment: "neutral" as const,
    headline: "模拟库存周期进入数据观察期",
    summary: "合成库存指标分化，当前情景不指向单一方向，交易更像结构性轮动。",
  },
  {
    category: "policy" as const,
    scope: "sector" as const,
    sentiment: "positive" as const,
    headline: "{sector}模拟绿色改造项目清单发布",
    summary: "虚构项目清单强调节能与设备升级，相关行业获得短期叙事支持。",
  },
  {
    category: "policy" as const,
    scope: "sector" as const,
    sentiment: "neutral" as const,
    headline: "{sector}模拟行业标准讨论进入下一阶段",
    summary: "程序生成的标准讨论尚未形成明确结果，对价格影响保持中性。",
  },
  {
    category: "overseas" as const,
    scope: "market" as const,
    sentiment: "neutral" as const,
    headline: "海外模拟市场等待新数据，交投节奏放慢",
    summary: "全球市场观察的虚构情景显示波动率回落，本地仿真成交趋于均衡。",
  },
  {
    category: "overseas" as const,
    scope: "sector" as const,
    sentiment: "negative" as const,
    headline: "海外模拟供应链成本抬升，{sector}短线承压",
    summary: "纯虚构运输与库存成本情景上行，行业估值锚定被小幅下调。",
  },
  {
    category: "sector" as const,
    scope: "sector" as const,
    sentiment: "positive" as const,
    headline: "模拟渠道补库启动，{sector}订单能见度改善",
    summary: "合成渠道数据出现连续补库迹象，行业成交强度短时增加。",
  },
  {
    category: "sector" as const,
    scope: "sector" as const,
    sentiment: "negative" as const,
    headline: "模拟价格竞争加剧，{sector}利润率预期下修",
    summary: "程序生成的价格与费用情景压缩行业利润空间，相关股票承压。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "positive" as const,
    headline: "{name}模拟股东回报计划进入讨论",
    summary: "虚构公司情景讨论稳定回报安排，实际内容与真实公司无关。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "neutral" as const,
    headline: "{name}模拟数字化项目完成阶段验收",
    summary: "合成项目进展用于演示公司信息流，不对应真实业务里程碑。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "positive" as const,
    headline: "{name}模拟区域渠道覆盖率提升",
    summary: "离线模型生成渠道扩张情景，短期成交活跃度随之上行。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "negative" as const,
    headline: "{name}模拟费用投放增加，短期利润率承压",
    summary: "虚构费用情景显示市场投入上升，程序同步下调盈利预期。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "neutral" as const,
    headline: "{name}模拟产品线规划更新",
    summary: "该信息仅展示拟真的产品沟通场景，所有产品与规划均为合成内容。",
  },
];

const EARNINGS_TEMPLATES = [
  {
    category: "earnings" as const,
    scope: "symbol" as const,
    sentiment: "positive" as const,
    headline: "{name}模拟业绩快报高于基准情景",
    summary: "纯虚构财报事件：模拟营收与利润率均高于基线，估值锚定价格随之上调。",
    earningsTier: "beat" as const,
  },
  {
    category: "earnings" as const,
    scope: "symbol" as const,
    sentiment: "neutral" as const,
    headline: "{name}模拟业绩快报接近基准情景",
    summary: "纯虚构财报事件：主要经营指标与程序基线基本一致，盘面反应有限。",
    earningsTier: "inline" as const,
  },
  {
    category: "earnings" as const,
    scope: "symbol" as const,
    sentiment: "negative" as const,
    headline: "{name}模拟业绩快报低于基准情景",
    summary: "纯虚构财报事件：模拟营收与利润率均低于基线，估值锚定价格随之下调。",
    earningsTier: "miss" as const,
  },
];

const REAL_NAME_NEUTRAL_TEMPLATES = [
  {
    category: "sector" as const,
    scope: "sector" as const,
    sentiment: "neutral" as const,
    headline: "{sector}模拟行业景气观察更新",
    summary: "虚构行业观察仅用于界面演示，不包含任何真实公司经营结论。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "neutral" as const,
    headline: "{name}模拟产品与渠道交流会日程",
    summary: "该事件为程序生成的演示信息，不对应真实公告或经营数据。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "neutral" as const,
    headline: "{name}模拟研发进展观察",
    summary: "仅展示虚构研发主题和行业讨论，所有数字与结论均为合成内容。",
  },
  {
    category: "company" as const,
    scope: "symbol" as const,
    sentiment: "neutral" as const,
    headline: "{name}模拟分红计划讨论窗口",
    summary: "演示事件不披露真实方案，也不代表公司真实计划或立场。",
  },
  {
    category: "sector" as const,
    scope: "sector" as const,
    sentiment: "neutral" as const,
    headline: "{sector}模拟成本与需求观察",
    summary: "使用中性模板生成的行业情景，不指向真实事件，亦不构成投资建议。",
  },
];

export const NEWS_TEMPLATE_COUNT =
  FICTIONAL_TEMPLATES.length +
  EARNINGS_TEMPLATES.length +
  REAL_NAME_NEUTRAL_TEMPLATES.length;

function compileTemplate(
  template: { headline: string; summary: string },
  instrument: Instrument | null,
  sector: string,
  random: ReturnType<typeof createRandomSource>,
): { headline: string; summary: string } {
  const name = instrument?.name ?? "模拟样本公司";
  return {
    headline: template.headline.replaceAll("{name}", name).replaceAll("{sector}", sector),
    summary: `${template.summary} 参考编号 ${random.integer(1000, 9999)}。`,
  };
}

export function generateNewsSchedule(
  market: MarketConfig,
  instruments: Instrument[],
  seed: string,
  startDate: string,
  days: number,
): NewsEvent[] {
  const dates = futureTradingDates(startDate, days);
  const events: NewsEvent[] = [];
  const sectors = Array.from(new Set(instruments.map((item) => item.sector)));
  const earningsRandom = createRandomSource(
    streamSeed(seed, market.id, "earnings-schedule", startDate, days),
  );
  const earningsCount = market.id.includes("real")
    ? 0
    : 4 + earningsRandom.integer(0, 4);
  const shuffledInstruments = [...instruments]
    .map((instrument) => ({
      instrument,
      rank: earningsRandom.next(),
    }))
    .sort((left, right) => left.rank - right.rank)
    .map((item) => item.instrument);
  const selectedInstruments: Instrument[] = [];
  const coveredSectors = new Set<string>();
  shuffledInstruments.forEach((instrument) => {
    if (
      selectedInstruments.length < earningsCount &&
      !coveredSectors.has(instrument.sector)
    ) {
      selectedInstruments.push(instrument);
      coveredSectors.add(instrument.sector);
    }
  });
  shuffledInstruments.forEach((instrument) => {
    if (
      selectedInstruments.length < earningsCount &&
      !selectedInstruments.includes(instrument)
    ) {
      selectedInstruments.push(instrument);
    }
  });
  const candidateDays = Array.from(
    { length: Math.max(0, days - 4) },
    (_, index) => index + 2,
  )
    .map((dayIndex) => ({ dayIndex, rank: earningsRandom.next() }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, earningsCount)
    .map((item) => item.dayIndex)
    .sort((left, right) => left - right);
  const earningsSchedule = new Map<
    number,
    { instrument: Instrument; tier: "beat" | "inline" | "miss"; index: number }
  >();
  candidateDays.forEach((dayIndex, index) => {
    earningsSchedule.set(dayIndex, {
      instrument: selectedInstruments[index],
      tier: earningsRandom.pick(["beat", "inline", "miss"] as const),
      index,
    });
  });

  dates.forEach((date, dayIndex) => {
    const random = createRandomSource(
      streamSeed(seed, market.id, "news-day", date),
    );
    const scheduledEarning = earningsSchedule.get(dayIndex);
    const dayNewsTarget = 2 + random.integer(0, 3);
    const normalNewsCount = Math.max(
      0,
      dayNewsTarget - (scheduledEarning ? 1 : 0),
    );
    const usedMinutes = new Set<number>();
    const dayStart = market.id === "us-sim" ? 330 : 480;
    const dayEnd = market.id === "us-sim" ? 950 : 890;

    for (let index = 0; index < normalNewsCount; index += 1) {
      const instrument = random.pick(instruments);
      const sector = random.pick(sectors);
      const realMode = market.id === "cn-real-demo";
      const template = realMode
        ? random.pick(REAL_NAME_NEUTRAL_TEMPLATES)
        : random.pick(FICTIONAL_TEMPLATES);
      let minute = random.integer(dayStart, dayEnd);
      while (usedMinutes.has(minute)) minute = Math.min(dayEnd, minute + 7);
      usedMinutes.add(minute);
      const impact = random.pick(["small", "small", "medium", "large"] as const);
      const impactBase = impact === "small" ? 0.0008 : impact === "medium" ? 0.0018 : 0.0034;
      const sentimentMultiplier =
        template.sentiment === "positive" ? 1 : template.sentiment === "negative" ? -1 : 0.15;
      const compiled = compileTemplate(template, instrument, sector, random);
      events.push({
        id: `news-${market.id}-${date}-${index}-${random.integer(100, 999)}`,
        publishedAtSec: dateToEpochSec(date, minute),
        simulatedDate: date,
        category: template.category,
        scope: template.scope,
        target:
          template.scope === "market"
            ? null
            : template.scope === "sector"
              ? sector
              : instrument.symbol,
        headline: compiled.headline,
        summary: compiled.summary,
        source: random.pick(SOURCES),
        sentiment: template.sentiment,
        impact,
        durationMinutes: 45 + random.integer(0, 8) * 24,
        impulse:
          impactBase *
          sentimentMultiplier *
          (0.75 + random.next() * 0.75),
        applied: false,
      });
    }

    if (scheduledEarning) {
      const { instrument, tier, index } = scheduledEarning;
      const template = EARNINGS_TEMPLATES.find(
        (item) => item.earningsTier === tier,
      )!;
      const compiled = compileTemplate(
        template,
        instrument,
        instrument.sector,
        random,
      );
      events.push({
        id: `earnings-${market.id}-${date}-${index}`,
        publishedAtSec: dateToEpochSec(date, 8 * 60 + 35),
        simulatedDate: date,
        category: "earnings",
        scope: "symbol",
        target: instrument.symbol,
        headline: compiled.headline,
        summary: compiled.summary,
        source: "模拟财报中心",
        sentiment: template.sentiment,
        impact: tier === "inline" ? "small" : "large",
        durationMinutes: 3 * 240,
        impulse: tier === "beat" ? 0.004 : tier === "miss" ? -0.004 : 0.0003,
        applied: false,
        earningsTier: tier,
      });
    }
  });

  return events.sort(
    (left, right) => left.publishedAtSec - right.publishedAtSec,
  );
}

export function getVisibleNews(
  state: SimulationState,
  currentSec?: number,
): NewsEvent[] {
  const boundary =
    currentSec ?? dateToEpochSec(state.simulatedDate, state.minuteOfDay);
  return visibleNewsAt(state.news, boundary);
}

export function visibleNewsAt(
  news: NewsEvent[],
  currentSec: number,
): NewsEvent[] {
  return news
    .filter((event) => event.publishedAtSec <= currentSec)
    .sort((left, right) => right.publishedAtSec - left.publishedAtSec);
}

export function ensureNewsWindow(
  state: SimulationState,
  market: MarketConfig,
): NewsEvent[] {
  const horizon = state.news.length
    ? state.news[state.news.length - 1].simulatedDate
    : state.simulatedDate;
  if (state.simulatedDate <= horizon) return state.news;
  const add = generateNewsSchedule(
    market,
    state.instruments,
    state.seed,
    nextTradingDate(horizon),
    30,
  );
  return [...state.news, ...add].sort(
    (left, right) => left.publishedAtSec - right.publishedAtSec,
  );
}

export function applyNewsImpulse(
  state: SimulationState,
  instrument: Instrument,
  currentSec: number,
): number {
  let impulse = 0;
  for (const event of state.news) {
    if (event.publishedAtSec > currentSec) continue;
    if (currentSec - event.publishedAtSec >= event.durationMinutes * 60) continue;
    const inScope =
      event.scope === "market" ||
      (event.scope === "sector" && event.target === instrument.sector) ||
      (event.scope === "symbol" && event.target === instrument.symbol);
    if (!inScope) continue;
    const minutesSince = Math.floor((currentSec - event.publishedAtSec) / 60);
    const decay = Math.max(0, 1 - minutesSince / event.durationMinutes);
    impulse += event.impulse / Math.max(1, event.durationMinutes * 0.18) * decay;
  }
  return impulse;
}
