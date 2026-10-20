import { getMarketConfig } from "../data/markets";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
  formatSignedMoney,
} from "../engine/money";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import { EmptyState, Panel, SectionHeading, Term } from "../components/ui";

export function PortfolioPage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          mode: current.mode,
          quotes: current.quotes,
          instruments: current.instruments,
          portfolio: current.portfolio,
          challengeStartCapital: current.challenge.startCapital,
        }
      : null,
  );
  const openStock = useSimulationStore((state) => state.openStock);
  const setPage = useSimulationStore((state) => state.setPage);

  if (!simulation) return null;
  const market = getMarketConfig(simulation.marketId);
  const portfolio = simulation.portfolio;
  const positions = Object.values(portfolio.positions).filter(
    (position) => position.totalQuantity > 0,
  );
  const initialCapital =
    simulation.mode === "challenge"
      ? simulation.challengeStartCapital
      : market.initialCapital;
  const cumulativePnl = portfolio.equity - initialCapital;
  const dailyPnl = portfolio.equity - portfolio.previousCloseEquity;
  const positionValue = positions.reduce(
    (sum, position) => sum + position.marketValue,
    0,
  );

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <div className="page-kicker">{market.label} · {market.settlement}</div>
          <h1>账户与持仓</h1>
          <p>
            当日盈亏按上一交易日收盘总资产计算；累计盈亏按初始资金计算，两个口径独立。
          </p>
        </div>
        <span className="account-generation">
          <Term id="fifo">FIFO</Term> 批次成本 · 账户版本{" "}
          {portfolio.accountVersion}
        </span>
      </div>

      <div className="portfolio-summary">
        <SummaryCard
          label={<Term id="totalAssets">总资产</Term>}
          value={formatMoney(portfolio.equity, market.currencySymbol)}
          note={`${market.currency} · 可用与冻结合并计价`}
          emphasis
        />
        <SummaryCard
          label={<Term id="availableCash">可用资金</Term>}
          value={formatMoney(portfolio.cash, market.currencySymbol)}
          note={`冻结 ${formatMoney(portfolio.frozenCash, market.currencySymbol)}`}
        />
        <SummaryCard
          label={<Term id="positionValue">持仓市值</Term>}
          value={formatMoney(positionValue, market.currencySymbol)}
          note={`${positions.length} 只证券`}
        />
        <SummaryCard
          label={<Term id="dailyPnl">当日盈亏</Term>}
          value={formatSignedMoney(dailyPnl, market.currencySymbol)}
          note={`上日收盘资产 ${formatMoney(
            portfolio.previousCloseEquity,
            market.currencySymbol,
          )}`}
          tone={dailyPnl > 0 ? "up" : dailyPnl < 0 ? "down" : ""}
        />
        <SummaryCard
          label={<Term id="cumulativePnl">累计盈亏</Term>}
          value={formatSignedMoney(cumulativePnl, market.currencySymbol)}
          note={`初始资金 ${formatMoney(initialCapital, market.currencySymbol)}`}
          tone={cumulativePnl > 0 ? "up" : cumulativePnl < 0 ? "down" : ""}
        />
      </div>

      <Panel className="positions-panel">
        <SectionHeading
          title="持仓明细"
          description="可卖数量已扣除卖出委托冻结；点击一行进入个股页"
          action={
            <button
              type="button"
              className="text-button"
              onClick={() => setPage("trade")}
            >
              去交易
            </button>
          }
        />
        {positions.length === 0 ? (
          <EmptyState
            title="当前没有持仓"
            description="在交易页或个股页提交模拟委托，成交后会生成 FIFO 持仓批次。"
            icon="portfolio"
            action={
              <button
                type="button"
                className="button button-primary"
                onClick={() => setPage("trade")}
              >
                去交易
              </button>
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table positions-table">
              <thead>
                <tr>
                  <th>代码</th>
                  <th>名称</th>
                  <th className="numeric">总持仓</th>
                  <th className="numeric">可卖</th>
                  <th className="numeric">
                    <Term id="costBasis">平均成本</Term>
                  </th>
                  <th className="numeric">现价</th>
                  <th className="numeric">市值</th>
                  <th className="numeric">
                    <Term id="floatingPnl">浮动盈亏</Term>
                  </th>
                  <th className="numeric">盈亏率</th>
                  <th className="numeric">仓位占比</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => {
                  const instrument = simulation.instruments.find(
                    (item) => item.symbol === position.symbol,
                  );
                  const quote = simulation.quotes[position.symbol];
                  const pnlPercent =
                    position.averageCost > 0
                      ? (position.unrealizedPnl /
                          (position.averageCost * position.totalQuantity)) *
                        100
                      : 0;
                  return (
                    <tr
                      key={position.symbol}
                      tabIndex={0}
                      onClick={() => openStock(position.symbol)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openStock(position.symbol);
                        }
                      }}
                    >
                      <td className="symbol-cell">{position.symbol}</td>
                      <td>{instrument?.name}</td>
                      <td className="numeric">
                        {formatNumber(position.totalQuantity, 0)}
                      </td>
                      <td className="numeric">
                        {formatNumber(position.sellableQuantity, 0)}
                      </td>
                      <td className="numeric">
                        {position.averageCost.toFixed(3)}
                      </td>
                      <td className="numeric">
                        {quote?.last.toFixed(2) ?? "—"}
                      </td>
                      <td className="numeric">
                        {formatMoney(position.marketValue, market.currencySymbol)}
                      </td>
                      <td
                        className={`numeric ${
                          position.unrealizedPnl > 0
                            ? "up"
                            : position.unrealizedPnl < 0
                              ? "down"
                              : ""
                        }`}
                      >
                        {formatSignedMoney(
                          position.unrealizedPnl,
                          market.currencySymbol,
                        )}
                      </td>
                      <td
                        className={`numeric ${
                          pnlPercent > 0 ? "up" : pnlPercent < 0 ? "down" : ""
                        }`}
                      >
                        {formatPercent(pnlPercent)}
                      </td>
                      <td className="numeric">
                        {formatRate(
                          portfolio.equity > 0
                            ? (position.marketValue / portfolio.equity) * 100
                            : 0,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="portfolio-foot-grid">
        <Panel className="account-note">
          <h3>账户核对</h3>
          <div>
            <span>现金 + 冻结资金 + 持仓市值</span>
            <strong>
              {formatMoney(portfolio.equity, market.currencySymbol)}
            </strong>
          </div>
          <div>
            <span>已实现盈亏</span>
            <strong
              className={
                portfolio.realizedPnl >= 0 ? "up" : "down"
              }
            >
              {formatSignedMoney(portfolio.realizedPnl, market.currencySymbol)}
            </strong>
          </div>
          <div>
            <span>累计费用</span>
            <strong>{formatMoney(portfolio.feesPaid, market.currencySymbol)}</strong>
          </div>
        </Panel>
        <Panel className="allocation-panel">
          <h3><Term id="positionWeight">持仓权重</Term></h3>
          {positions.length === 0 ? (
            <p className="muted-copy">暂无持仓权重。</p>
          ) : (
            positions
              .slice()
              .sort((left, right) => right.marketValue - left.marketValue)
              .map((position) => {
                const instrument = simulation.instruments.find(
                  (item) => item.symbol === position.symbol,
                );
                const weight =
                  portfolio.equity > 0
                    ? (position.marketValue / portfolio.equity) * 100
                    : 0;
                return (
                  <div className="allocation-row" key={position.symbol}>
                    <span>{instrument?.name ?? position.symbol}</span>
                    <i>
                      <b style={{ width: `${Math.min(100, weight)}%` }} />
                    </i>
                    <strong>{weight.toFixed(1)}%</strong>
                  </div>
                );
              })
          )}
        </Panel>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  note,
  tone = "",
  emphasis = false,
}: {
  label: React.ReactNode;
  value: string;
  note: string;
  tone?: string;
  emphasis?: boolean;
}) {
  return (
    <Panel className={`summary-card ${emphasis ? "emphasis" : ""}`}>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <small>{note}</small>
    </Panel>
  );
}
