import { useState } from "react";
import { getMarketConfig } from "../data/markets";
import { visibleNewsAt } from "../engine/news";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
} from "../engine/money";
import { dateToEpochSec, formatClock } from "../engine/time";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import { MarketTable } from "../components/MarketTable";
import { NewsFeed } from "../components/NewsFeed";
import { Panel, SectionHeading, Term } from "../components/ui";
import { Icon } from "../components/Icons";
import { SECTORS } from "../data/markets";

export function MarketPage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          simulatedDate: current.simulatedDate,
          minuteOfDay: current.minuteOfDay,
          instruments: current.instruments,
          quotes: current.quotes,
          watchlist: current.watchlist,
          news: current.news,
          index: current.index,
          lastCloseSummary: current.lastCloseSummary,
        }
      : null,
  );
  const openStock = useSimulationStore((state) => state.openStock);
  const toggleWatchlist = useSimulationStore((state) => state.toggleWatchlist);
  const setPage = useSimulationStore((state) => state.setPage);
  const [query, setQuery] = useState("");

  if (!simulation) return null;
  const market = getMarketConfig(simulation.marketId);
  const filtered = simulation.instruments.filter((instrument) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return (
      instrument.symbol.toLowerCase().includes(normalized) ||
      instrument.name.toLowerCase().includes(normalized) ||
      instrument.sector.includes(normalized)
    );
  });
  const news = visibleNewsAt(
    simulation.news,
    dateToEpochSec(simulation.simulatedDate, simulation.minuteOfDay),
  );
  const sectorRows = SECTORS.map((sector) => {
    const members = simulation.instruments.filter(
      (instrument) => instrument.sector === sector,
    );
    const totalMarketValue = members.reduce(
      (sum, instrument) =>
        sum +
        (simulation.quotes[instrument.symbol]?.last ?? 0) *
          instrument.sharesOutstanding,
      0,
    );
    const weightedChange =
      totalMarketValue > 0
        ? members.reduce((sum, instrument) => {
            const quote = simulation.quotes[instrument.symbol];
            return (
              sum +
              (quote?.changePercent ?? 0) *
                ((quote?.last ?? 0) * instrument.sharesOutstanding)
            );
          }, 0) / totalMarketValue
        : 0;
    return {
      sector,
      change: weightedChange,
      count: members.filter(
        (instrument) =>
          (simulation.quotes[instrument.symbol]?.changePercent ?? 0) > 0,
      ).length,
    };
  }).sort((left, right) => right.change - left.change);
  const index = simulation.index;
  const flat = Math.max(
    0,
    simulation.instruments.length -
      index.advancing -
      index.declining,
  );

  return (
    <div className="page market-page">
      <div className="page-title-row">
        <div>
          <div className="page-kicker">
            {market.label} · 模拟交易日历
          </div>
          <h1>行情总览</h1>
          <p>
            同一仿真时刻下的指数、行业、个股与资讯，点击行查看完整交易界面。
          </p>
        </div>
        <div className="market-session-chip">
          <span className="live-dot" />
          {formatClock(simulation.minuteOfDay)} ·{" "}
          {simulation.lastCloseSummary ? "今日已收盘" : "本地仿真"}
        </div>
      </div>

      <div className="market-summary-grid">
        <Panel className="index-card">
          <div className="card-label">
            <Term id="index">{market.shortLabel}综合指数</Term>
            <span>基点 1000</span>
          </div>
          <div className="index-number">{index.points.toFixed(2)}</div>
          <div
            className={
              index.change > 0 ? "index-change up" : index.change < 0 ? "index-change down" : "index-change"
            }
          >
            {index.change > 0 ? "↑" : index.change < 0 ? "↓" : "—"}{" "}
            {index.change > 0 ? "+" : ""}
            {index.change.toFixed(2)} · {formatPercent(index.changePercent)}
          </div>
          <div
            className="index-sparkline"
            role="img"
            aria-label="12 只证券当前涨跌幅分布"
          >
            {simulation.instruments.map((instrument) => {
              const change =
                simulation.quotes[instrument.symbol]?.changePercent ?? 0;
              return (
                <i
                  key={instrument.symbol}
                  className={change > 0 ? "up-bg" : change < 0 ? "down-bg" : "flat-bg"}
                  title={`${instrument.name} ${formatPercent(change)}`}
                  style={{
                    height: `${Math.min(44, 7 + Math.abs(change) * 10)}px`,
                  }}
                />
              );
            })}
          </div>
        </Panel>
        <Panel className="index-card">
          <div className="card-label">
            <Term id="turnover">全市场成交额</Term>
            <span>本时段累计</span>
          </div>
          <div className="index-number compact-number">
            {formatMoney(index.turnover, market.currencySymbol, true)}
          </div>
          <div className="index-change">
            12 只模拟证券 · 成交以股为单位
          </div>
          <div className="turnover-breakdown">
            <span>
              <Term id="turnover">最大成交额</Term>
              <strong>
                {formatMoney(
                  Math.max(
                    ...Object.values(simulation.quotes).map(
                      (quote) => quote.turnover,
                    ),
                  ),
                  market.currencySymbol,
                  true,
                )}
              </strong>
            </span>
            <span>
              <Term id="turnoverRate">平均换手率</Term>
              <strong>
                {formatRate(
                  Object.values(simulation.quotes).reduce(
                    (sum, quote) => sum + quote.turnoverRate,
                    0,
                  ) / 12,
                )}
              </strong>
            </span>
          </div>
        </Panel>
        <Panel className="index-card breadth-card">
          <div className="card-label">
            <Term id="marketBreadth">市场宽度</Term>
            <span>上涨 / 下跌 / 平盘</span>
          </div>
          <div className="breadth-numbers">
            <strong className="up">{index.advancing}</strong>
            <span>/</span>
            <strong className="down">{index.declining}</strong>
            <span>/</span>
            <strong>{flat}</strong>
          </div>
          <div className="breadth-bar" aria-label="涨跌家数比例">
            <span
              className="up-bg"
              style={{ width: `${(index.advancing / 12) * 100}%` }}
            />
            <span
              className="flat-bg"
              style={{ width: `${(flat / 12) * 100}%` }}
            />
            <span
              className="down-bg"
              style={{ width: `${(index.declining / 12) * 100}%` }}
            />
          </div>
          <div className="limit-stats">
            <span>
              <Term id="limitUp">涨停</Term> <strong className="up">{index.limitUp}</strong>
            </span>
            <span>
              <Term id="limitDown">跌停</Term>{" "}
              <strong className="down">{index.limitDown}</strong>
            </span>
          </div>
        </Panel>
      </div>

      <Panel className="sector-panel">
        <SectionHeading
          title={<Term id="industryPerformance">行业表现</Term>}
          description="按行业市值加权涨跌幅排序"
        />
        <div className="sector-grid">
          {sectorRows.map((row, indexPosition) => (
            <article className="sector-row" key={row.sector}>
              <span className="sector-rank">0{indexPosition + 1}</span>
              <div>
                <strong>{row.sector}</strong>
                <small>{row.count}/2 只上涨</small>
              </div>
              <span className="sector-track">
                <i
                  className={row.change >= 0 ? "up-bg" : "down-bg"}
                  style={{
                    width: `${Math.min(100, 18 + Math.abs(row.change) * 12)}%`,
                  }}
                />
              </span>
              <b className={row.change > 0 ? "up" : row.change < 0 ? "down" : ""}>
                {formatPercent(row.change)}
              </b>
            </article>
          ))}
        </div>
      </Panel>

      <div className="market-main-grid">
        <Panel className="quote-panel">
          <div className="quote-toolbar">
            <SectionHeading
              title="全部证券"
              description={`${filtered.length} / 12 只 · 点击表头排序`}
            />
            <div className="search-field">
              <Icon name="search" size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索代码、名称或行业"
                aria-label="搜索证券"
              />
            </div>
          </div>
          <MarketTable
            instruments={filtered}
            quotes={simulation.quotes}
            market={market}
            watchlist={simulation.watchlist}
            onOpen={openStock}
            onToggleWatchlist={toggleWatchlist}
            emptyTitle="没有匹配的证券"
            emptyDescription="尝试输入股票代码、名称或行业关键词。"
          />
        </Panel>
        <Panel className="news-panel">
          <SectionHeading
            title="模拟资讯"
            description={`已发布 ${news.length} 条，仅显示模拟时间之前的新闻`}
            action={
              <button
                type="button"
                className="text-button"
                onClick={() => setPage("news")}
              >
                全部资讯
              </button>
            }
          />
          <NewsFeed news={news} limit={6} compact />
        </Panel>
      </div>

      <div className="data-footnote">
        <span>
          <Icon name="info" size={14} />
          报价单位：{market.currencySymbol} · 行情由本地种子引擎生成
        </span>
        <span>
          已成交 {formatNumber(
            Object.values(simulation.quotes).reduce(
              (sum, quote) => sum + quote.volume,
              0,
            ),
            0,
          )}{" "}
          股
        </span>
      </div>
    </div>
  );
}
