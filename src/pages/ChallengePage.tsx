import { useMemo, useState } from "react";
import { getMarketConfig } from "../data/markets";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
} from "../engine/money";
import { getChallengeReport } from "../engine/engine";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import type { ChallengeReport, SimulationState } from "../types/domain";
import { Icon } from "../components/Icons";
import {
  Button,
  DataRow,
  EmptyState,
  Modal,
  Panel,
  SectionHeading,
  Term,
} from "../components/ui";

function randomSeed(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `CH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }
  return `CH-${Math.floor(Math.random() * 99999999)
    .toString(16)
    .toUpperCase()}`;
}

export function ChallengePage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          mode: current.mode,
          seed: current.seed,
          challenge: current.challenge,
          portfolio: current.portfolio,
          index: current.index,
          instruments: current.instruments,
          orders: current.orders,
          lastCloseSummary: current.lastCloseSummary,
        }
      : null,
  );
  const settings = useSimulationStore((state) => state.settings);
  const startChallenge = useSimulationStore(
    (state) => state.startCurrentChallenge,
  );
  const jumpToEnd = useSimulationStore((state) => state.jumpChallengeToEnd);
  const setPage = useSimulationStore((state) => state.setPage);
  const nextTradingDay = useSimulationStore((state) => state.nextTradingDay);
  const [seed, setSeed] = useState(simulation?.seed ?? "ALPHA-2026");
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmFast, setConfirmFast] = useState(false);

  if (!simulation) return null;
  const market = getMarketConfig(simulation.marketId);
  const challenge = simulation.challenge;
  const best = settings.bestChallenges[market.id];

  if (simulation.mode !== "challenge") {
    return (
      <div className="page">
        <EmptyState
          title="挑战使用独立账户"
          description="请在顶部模式选择器切换到“30 日挑战”，不会影响自由沙盒。"
          icon="challenge"
          action={
            <Button variant="primary" onClick={() => useSimulationStore.getState().setMode("challenge")}>
              切换到挑战模式
            </Button>
          }
        />
      </div>
    );
  }

  if (challenge.status === "not_started") {
    return (
      <div className="page challenge-page">
        <ChallengeHero market={market.label} best={best} />
        <div className="challenge-intro-grid">
          <Panel className="challenge-setup">
            <SectionHeading
              title="开始前设置"
              description="种子会锁定所有行情、新闻与部分基本面事件"
            />
            <label className="seed-field">
              <span>随机种子</span>
              <div>
                <input
                  value={seed}
                  maxLength={40}
                  onChange={(event) => setSeed(event.target.value)}
                  aria-label="挑战随机种子"
                />
                <Button variant="ghost" onClick={() => setSeed(randomSeed())}>
                  <Icon name="reset" size={15} />
                  重新生成
                </Button>
              </div>
            </label>
            <div className="challenge-rules">
              <DataRow label="市场" value={market.label} />
              <DataRow
                label="初始资金"
                value={formatMoney(market.initialCapital, market.currencySymbol)}
              />
              <DataRow label="挑战长度" value="30 个已收盘交易日" />
              <DataRow label="基准" value={`${market.label}模拟综合指数`} />
              <DataRow label="交收规则" value={market.settlement} />
              <DataRow label="挑战存档" value="与自由沙盒完全独立" />
            </div>
            <Button
              variant="primary"
              className="challenge-start-button"
              onClick={() => setConfirmStart(true)}
              disabled={!seed.trim()}
            >
              开始新一轮挑战
            </Button>
            <p className="muted-copy">
              开始后种子只读；重置或重新开始会先备份当前挑战账户。
            </p>
          </Panel>
          <Panel className="scoring-panel">
            <SectionHeading
              title="评分构成"
              description="所有分项先限制在 0–100 分"
            />
            {[
              ["55%", "超额收益", "相对模拟综合指数的表现"],
              ["20%", "最大回撤", "从净值高点到后续低点"],
              ["15%", "行业分散", "持有行业数与最大单股权重"],
              ["10%", "交易纪律", "拒绝委托与过度交易扣分"],
            ].map(([weight, title, description]) => (
              <div className="score-rule-row" key={title}>
                <strong>{weight}</strong>
                <span>
                  <b>{title}</b>
                  <small>{description}</small>
                </span>
              </div>
            ))}
            <div className="rating-scale">
              <span>S ≥ 85</span>
              <span>A 75+</span>
              <span>B 65+</span>
              <span>C 50+</span>
              <span>D &lt; 50</span>
            </div>
          </Panel>
        </div>

        <Modal
          open={confirmStart}
          title="开始新一轮 30 日挑战？"
          onClose={() => setConfirmStart(false)}
          footer={
            <>
              <Button onClick={() => setConfirmStart(false)}>取消</Button>
              <Button
                variant="primary"
                onClick={() => {
                  startChallenge(seed.trim());
                  setConfirmStart(false);
                }}
              >
                确认并重置挑战
              </Button>
            </>
          }
        >
          <p className="modal-copy">
            这会重置当前市场的挑战账户、订单、成交和净值曲线。开始前会备份现有挑战存档；自由沙盒不受影响。
          </p>
          <div className="seed-summary">
            种子：<strong>{seed}</strong>
          </div>
        </Modal>
      </div>
    );
  }

  const report =
    challenge.status === "completed" && challenge.report
      ? challenge.report
      : getChallengeReport(simulation);

  return (
    <div className="page challenge-page">
      <div className="page-title-row">
        <div>
          <div className="page-kicker">
            {market.label} · 30 日挑战 · 种子 {simulation.seed}
          </div>
          <h1>
            {challenge.status === "completed" ? "挑战结算报告" : "挑战进行中"}
          </h1>
          <p>
            {challenge.status === "completed"
              ? "挑战已结束，持仓按最后收盘价计价，未强制卖出。"
              : "剩余交易日只会在每日收盘结算后减少；当前指标随净值实时更新。"}
          </p>
        </div>
        <div className="challenge-day-chip">
          <span>第</span>
          <strong>
            {challenge.status === "completed"
              ? 30
              : Math.min(30, challenge.day)}
          </strong>
          <span>/ 30 天</span>
        </div>
      </div>

      <div className="challenge-metrics">
        <MetricCard
          label={<Term id="totalAssets">当前净值</Term>}
          value={formatMoney(simulation.portfolio.equity, market.currencySymbol)}
          note={`初始 ${formatMoney(
            challenge.startCapital,
            market.currencySymbol,
          )}`}
        />
        <MetricCard
          label={<Term id="totalReturn">累计收益率</Term>}
          value={formatPercent(report.returnPercent)}
          tone={report.returnPercent >= 0 ? "up" : "down"}
        />
        <MetricCard
          label={<Term id="excessReturn">相对基准</Term>}
          value={formatPercent(report.excessReturnPercent)}
          tone={report.excessReturnPercent >= 0 ? "up" : "down"}
        />
        <MetricCard
          label={<Term id="drawdown">最大回撤</Term>}
          value={formatPercent(report.maxDrawdownPercent)}
          tone={report.maxDrawdownPercent < 0 ? "down" : ""}
        />
        <MetricCard
          label={<Term id="remainingDays">剩余交易日</Term>}
          value={`${Math.max(
            0,
            30 - Math.min(30, challenge.day) + (challenge.status === "completed" ? 0 : 1),
          )} 天`}
          note={
            challenge.status === "completed"
              ? "挑战已结束"
              : simulation.lastCloseSummary
                ? "已收盘，可进入下一日"
                : "等待今日收盘"
          }
        />
      </div>

      <div className="challenge-report-grid">
        <Panel className="challenge-curve-panel">
          <SectionHeading
            title={
              <>
                <Term id="totalAssets">净值</Term> 与{" "}
                <Term id="benchmark">基准</Term>
              </>
            }
            description="蓝线为策略净值，灰线为模拟综合指数；均以初始值归一化"
          />
          <EquityCurve report={report} />
        </Panel>
        <Panel className="challenge-score-panel">
          <div className="grade-display">
            <span><Term id="rating">当前评级</Term></span>
            <strong className={`grade grade-${report.grade}`}>
              {report.grade}
            </strong>
            <em>{report.finalScore.toFixed(1)} 分</em>
            {best ? (
              <small>
                历史最佳 {best.grade} · {best.score.toFixed(1)} 分
              </small>
            ) : null}
          </div>
          <div className="score-breakdown">
            <ScoreBar
              label={<Term id="excessReturn">超额收益</Term>}
              value={report.scoreParts.returnScore}
            />
            <ScoreBar
              label={<Term id="drawdown">回撤控制</Term>}
              value={report.scoreParts.drawdownScore}
            />
            <ScoreBar
              label={<Term id="diversification">行业分散</Term>}
              value={report.scoreParts.diversificationScore}
            />
            <ScoreBar
              label={<Term id="discipline">交易纪律</Term>}
              value={report.scoreParts.disciplineScore}
            />
          </div>
        </Panel>
      </div>

      {challenge.status === "completed" ? (
        <>
          <Panel className="report-detail-panel">
            <SectionHeading
              title={`结算报告 · ${report.grade} 评级`}
              description={`最终资产 ${formatMoney(
                report.finalEquity,
                market.currencySymbol,
              )} · 已保留本地历史最佳成绩`}
            />
            <div className="report-metric-grid">
              <ReportItem
                label={<Term id="totalReturn">总收益</Term>}
                value={formatPercent(report.returnPercent)}
              />
              <ReportItem
                label={<Term id="benchmarkReturn">基准收益</Term>}
                value={formatPercent(report.benchmarkReturnPercent)}
              />
              <ReportItem
                label={<Term id="excessReturn">超额收益</Term>}
                value={formatPercent(report.excessReturnPercent)}
              />
              <ReportItem
                label={<Term id="drawdown">最大回撤</Term>}
                value={formatPercent(report.maxDrawdownPercent)}
              />
              <ReportItem
                label={<Term id="feesTotal">累计费用</Term>}
                value={formatMoney(report.feesPaid, market.currencySymbol)}
              />
              <ReportItem
                label={<Term id="tradeCount">成交次数</Term>}
                value={`${report.fillCount}`}
              />
              <ReportItem
                label={<Term id="rejectedCount">拒单次数</Term>}
                value={`${report.rejectedOrderCount}`}
              />
              <ReportItem
                label={<Term id="sectorCount">持有行业</Term>}
                value={`${report.sectorsHeld} 个`}
              />
              <ReportItem
                label={<Term id="maxPositionWeight">最大单股仓位</Term>}
                value={formatRate(report.maxPositionWeight * 100)}
              />
              <ReportItem
                label={<Term id="reasonCoverage">交易理由覆盖率</Term>}
                value={formatRate(report.tradeNoteCoveragePercent)}
              />
            </div>
            <div className="behavior-tags">
              {report.tags.length > 0 ? (
                report.tags.map((tag) => <span key={tag}>{tag}</span>)
              ) : (
                <span className="muted-tag">暂无行为标签</span>
              )}
            </div>
          </Panel>
          <div className="challenge-bottom-grid">
            <Panel className="insights-panel">
              <SectionHeading title="规则化复盘洞察" description="只引用可计算指标" />
              <ol className="insight-list">
                {report.insights.map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
              </ol>
            </Panel>
            <Panel className="final-positions-panel">
              <SectionHeading title="期末持仓快照" description="收盘价计价，不强制平仓" />
              <PositionSnapshot
                report={report}
                positions={simulation.portfolio.positions}
                instruments={simulation.instruments}
                marketId={simulation.marketId}
              />
            </Panel>
          </div>
          <div className="challenge-actions">
            <Button
              variant="primary"
              onClick={() => {
                setSeed(randomSeed());
                setConfirmStart(true);
              }}
            >
              开始新一轮挑战
            </Button>
            <Button variant="ghost" onClick={() => setPage("portfolio")}>
              查看持仓
            </Button>
          </div>
        </>
      ) : (
        <Panel className="challenge-live-panel">
          <SectionHeading
            title="挑战控制"
            description="行情仍按模拟时钟运行；可使用测试加速快速验证结算流程"
          />
          <div className="challenge-live-actions">
            {simulation.lastCloseSummary ? (
              <Button variant="primary" onClick={nextTradingDay}>
                进入下一交易日
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setPage("trade")}>
                去交易
              </Button>
            )}
            <Button variant="ghost" onClick={() => setConfirmFast(true)}>
              测试加速：推进至第 30 日收盘
            </Button>
          </div>
          <p className="muted-copy">
            测试加速会在本地连续运行确定性撮合与收盘结算，不访问网络；操作前自动备份当前挑战账户。
          </p>
        </Panel>
      )}

      <Modal
        open={confirmStart}
        title="开始新一轮 30 日挑战？"
        onClose={() => setConfirmStart(false)}
        footer={
          <>
            <Button onClick={() => setConfirmStart(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                startChallenge(seed.trim() || randomSeed());
                setConfirmStart(false);
              }}
            >
              确认并重置挑战
            </Button>
          </>
        }
      >
        <p className="modal-copy">
          当前挑战存档会先备份，然后用新账户和新种子重新开始。此操作不影响自由沙盒或其他市场。
        </p>
        <div className="seed-summary">
          种子：<strong>{seed}</strong>
        </div>
      </Modal>

      <Modal
        open={confirmFast}
        title="快速推进至挑战结束？"
        onClose={() => setConfirmFast(false)}
        footer={
          <>
            <Button onClick={() => setConfirmFast(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                jumpToEnd();
                setConfirmFast(false);
              }}
            >
              开始测试加速
            </Button>
          </>
        }
      >
        <p className="modal-copy">
          程序会使用当前种子连续推进剩余交易日，并执行收盘结算。测试加速不会连接真实行情，也不会执行新的玩家委托。
        </p>
      </Modal>
    </div>
  );
}

function ChallengeHero({
  market,
  best,
}: {
  market: string;
  best: { grade: string; score: number } | null;
}) {
  return (
    <div className="challenge-hero-panel">
      <div>
        <span className="eyebrow-label">30 个已收盘交易日</span>
        <h2>用一套独立账户，检验你的交易计划。</h2>
        <p>
          市场：{market}。行情、新闻与财报事件完全离线，评分只使用可计算的净值、回撤、分散度和纪律指标。
        </p>
      </div>
      <div className="hero-grade">
        <span>本地最佳</span>
        <strong>{best?.grade ?? "—"}</strong>
        <small>{best ? `${best.score.toFixed(1)} 分` : "尚无记录"}</small>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone = "",
}: {
  label: React.ReactNode;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <Panel className="challenge-metric-card">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      {note ? <small>{note}</small> : null}
    </Panel>
  );
}

function ScoreBar({
  label,
  value,
}: {
  label: React.ReactNode;
  value: number;
}) {
  return (
    <div className="score-bar-row">
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </i>
      <strong>{value.toFixed(0)}</strong>
    </div>
  );
}

function ReportItem({
  label,
  value,
}: {
  label: React.ReactNode;
  value: string;
}) {
  return (
    <div className="report-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EquityCurve({ report }: { report: ChallengeReport }) {
  const data = useMemo(() => {
    const curve =
      report.equityCurve.length > 0
        ? report.equityCurve
        : [
            {
              date: "start",
              equity: report.finalEquity,
              benchmark: report.finalEquity,
            },
          ];
    const baseEquity = curve[0].equity || 1;
    const baseBenchmark = curve[0].benchmark || 1;
    return curve.map((point, index) => ({
      index,
      equity: (point.equity / baseEquity - 1) * 100,
      benchmark: (point.benchmark / baseBenchmark - 1) * 100,
      label: point.date,
    }));
  }, [report]);
  const width = 720;
  const height = 250;
  const padding = 28;
  const allValues = data.flatMap((point) => [point.equity, point.benchmark]);
  const minimum = Math.min(-1, ...allValues);
  const maximum = Math.max(1, ...allValues);
  const x = (index: number) =>
    padding +
    (index / Math.max(1, data.length - 1)) * (width - padding * 2);
  const y = (value: number) =>
    padding +
    ((maximum - value) / Math.max(0.01, maximum - minimum)) *
      (height - padding * 2);
  const line = (key: "equity" | "benchmark") =>
    data
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(
            point[key],
          ).toFixed(1)}`,
      )
      .join(" ");
  const area = `${line("equity")} L ${x(data.length - 1)} ${
    height - padding
  } L ${x(0)} ${height - padding} Z`;
  return (
    <div className="equity-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="策略净值曲线与基准曲线"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1={padding}
            x2={width - padding}
            y1={padding + fraction * (height - padding * 2)}
            y2={padding + fraction * (height - padding * 2)}
            className="grid-line"
          />
        ))}
        <line
          x1={padding}
          x2={width - padding}
          y1={y(0)}
          y2={y(0)}
          className="zero-line"
        />
        <path d={area} className="equity-area" />
        <path d={line("benchmark")} className="benchmark-line" />
        <path d={line("equity")} className="equity-line" />
        <circle
          cx={x(data.length - 1)}
          cy={y(data[data.length - 1].equity)}
          r="4"
          className="equity-dot"
        />
      </svg>
      <div className="curve-legend">
        <span><i className="equity-swatch" />策略净值</span>
        <span><i className="benchmark-swatch" />模拟综合指数</span>
        <strong>
          期末策略收益 {formatPercent(data[data.length - 1].equity)}
        </strong>
      </div>
    </div>
  );
}

function PositionSnapshot({
  report,
  positions,
  instruments,
  marketId,
}: {
  report: ChallengeReport;
  positions: SimulationState["portfolio"]["positions"];
  instruments: SimulationState["instruments"];
  marketId: SimulationState["marketId"];
}) {
  const openPositions = Object.values(positions);
  if (openPositions.length === 0) {
    return (
      <p className="muted-copy">
        期末无持仓，全部资产为可用或冻结现金；行业分散度按 0 个行业计算。
      </p>
    );
  }
  return (
    <div className="final-position-list">
      {openPositions.map((position) => {
        const instrument = instruments.find(
          (item) => item.symbol === position.symbol,
        );
        return (
          <div key={position.symbol}>
            <span>
              {instrument?.name ?? position.symbol}
              <em>{formatNumber(position.totalQuantity, 0)} 股</em>
            </span>
            <strong>
              {formatMoney(
                position.marketValue,
                getMarketConfig(marketId).currencySymbol,
              )}
            </strong>
          </div>
        );
      })}
      <small>
        最大单股权重 {formatRate(report.maxPositionWeight * 100)} · 覆盖{" "}
        {report.sectorsHeld} 个行业
      </small>
    </div>
  );
}
