import type {
  ChallengeReport,
  SimulationState,
} from "../types/domain";
import { getMarketConfig } from "../data/markets";
import { clamp, formatMoney } from "./money";

function drawdownPercent(values: number[]): number {
  let peak = 0;
  let worst = 0;
  values.forEach((value) => {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, ((value - peak) / peak) * 100);
  });
  return worst;
}

function gradeForScore(score: number): ChallengeReport["grade"] {
  if (score >= 85) return "S";
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

export function calculateChallengeScore(
  state: Pick<
    SimulationState,
    "challenge" | "portfolio" | "index" | "instruments" | "orders" | "marketId"
  >,
): ChallengeReport {
  const startCapital = state.challenge.startCapital || 1;
  const currentEquity = state.portfolio.equity;
  const returnPercent = ((currentEquity - startCapital) / startCapital) * 100;
  const benchmarkCurrent = state.index.points;
  const benchmarkReturnPercent =
    state.challenge.startIndex > 0
      ? (benchmarkCurrent / state.challenge.startIndex - 1) * 100
      : 0;
  const excessReturnPercent = returnPercent - benchmarkReturnPercent;
  const equityValues = state.portfolio.equityCurve.map((point) => point.equity);
  if (equityValues.length === 0) equityValues.push(startCapital);
  const maxDrawdownPercent = drawdownPercent(equityValues);

  const positions = Object.values(state.portfolio.positions).filter(
    (position) => position.totalQuantity > 0,
  );
  const sectors = new Set(
    positions.map(
      (position) =>
        state.instruments.find((item) => item.symbol === position.symbol)
          ?.sector ?? "未知",
    ),
  );
  const maxPositionWeight =
    currentEquity > 0
      ? Math.max(
          0,
          ...positions.map((position) => position.marketValue / currentEquity),
        )
      : 0;

  const returnScore = clamp(50 + 2.5 * excessReturnPercent, 0, 100);
  const drawdownScore = clamp(100 + 4 * maxDrawdownPercent, 0, 100);
  const sectorPart = Math.min(100, (sectors.size / 3) * 100);
  const concentrationPart =
    maxPositionWeight <= 0.4 ? 100 : maxPositionWeight <= 0.6 ? 50 : 0;
  const diversificationScore =
    0.6 * sectorPart + 0.4 * concentrationPart;
  const disciplineScore = clamp(
    100 -
      10 * state.portfolio.rejectedOrderCount -
      2 * Math.max(0, state.portfolio.fillCount - 60),
    0,
    100,
  );
  const finalScore =
    0.55 * returnScore +
    0.2 * drawdownScore +
    0.15 * diversificationScore +
    0.1 * disciplineScore;

  const filledOrders = state.orders.filter(
    (order) => order.filledQuantity > 0,
  );
  const notedOrders = filledOrders.filter((order) => Boolean(order.note?.trim()));
  const coverage =
    filledOrders.length > 0 ? (notedOrders.length / filledOrders.length) * 100 : 0;

  const tags: string[] = [];
  if (excessReturnPercent > 0) tags.push("跑赢基准");
  if (maxDrawdownPercent >= -10) tags.push("回撤控制良好");
  if (sectors.size >= 3 && maxPositionWeight <= 0.4) tags.push("稳健分散");
  if (maxPositionWeight > 0.6) tags.push("集中持仓");
  if (state.portfolio.fillCount > 60) tags.push("高频交易");
  if (state.portfolio.feesPaid > startCapital * 0.02) tags.push("费用敏感度低");

  const insights: string[] = [];
  if (filledOrders.length === 0) {
    insights.push("样本不足：本轮没有产生成交，暂不评价选股与交易纪律。");
    insights.push("最终资产变化主要来自现金与持仓计价，评分中的纪律分不作能力判断。");
  } else {
    insights.push(
      excessReturnPercent >= 0
        ? `相对基准取得 ${excessReturnPercent.toFixed(2)} 个百分点的超额收益。`
        : `相对基准落后 ${Math.abs(excessReturnPercent).toFixed(2)} 个百分点，组合跑输基准。`,
    );
    insights.push(
      maxDrawdownPercent < -10
        ? `最大回撤为 ${maxDrawdownPercent.toFixed(2)}%，回撤控制仍有改善空间。`
        : `最大回撤为 ${maxDrawdownPercent.toFixed(2)}%，处于本次评分规则的稳健区间。`,
    );
    if (maxPositionWeight > 0.6) {
      insights.push(
        `最大单股仓位为 ${(maxPositionWeight * 100).toFixed(1)}%，集中度是主要风险来源。`,
      );
    } else if (sectors.size < 3) {
      insights.push(`期末仅持有 ${sectors.size} 个行业，行业分散度偏低。`);
    } else {
      insights.push(
        `期末覆盖 ${sectors.size} 个行业，最大单股仓位 ${(maxPositionWeight * 100).toFixed(1)}%，结构较分散。`,
      );
    }
    if (state.portfolio.feesPaid > startCapital * 0.02) {
      insights.push(
        `累计费用 ${formatMoney(
          state.portfolio.feesPaid,
          getMarketConfig(state.marketId).currencySymbol,
        )} 超过初始资金 2%，高频交易侵蚀了部分收益。`,
      );
    } else if (coverage < 50) {
      insights.push(
        `交易理由覆盖率为 ${coverage.toFixed(0)}%，复盘记录不足，可读性有限。`,
      );
    }
  }

  return {
    finalScore: Number(finalScore.toFixed(1)),
    grade: gradeForScore(finalScore),
    returnPercent,
    benchmarkReturnPercent,
    excessReturnPercent,
    maxDrawdownPercent,
    sectorsHeld: sectors.size,
    maxPositionWeight,
    feesPaid: state.portfolio.feesPaid,
    fillCount: state.portfolio.fillCount,
    rejectedOrderCount: state.portfolio.rejectedOrderCount,
    tradeNoteCoveragePercent: coverage,
    insights: insights.slice(0, 4),
    tags,
    equityCurve: state.portfolio.equityCurve,
    finalEquity: currentEquity,
    scoreParts: {
      returnScore,
      drawdownScore,
      diversificationScore,
      disciplineScore,
    },
  };
}
