import { useMemo, useState } from "react";
import { getMarketConfig } from "../data/markets";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
} from "../engine/money";
import { visibleNewsAt } from "../engine/news";
import {
  formatDateTime,
  phaseLabel,
  resolveMarketPhase,
  dateToEpochSec,
} from "../engine/time";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import { Icon } from "../components/Icons";
import { NewsFeed } from "../components/NewsFeed";
import { OrderBook, TapeList } from "../components/OrderBook";
import {
  PriceChart,
  type ChartPeriod,
} from "../components/PriceChart";
import {
  TradeTicket,
  type BookPriceInstruction,
} from "../components/TradeTicket";
import {
  Button,
  DataRow,
  EmptyState,
  Panel,
  SectionHeading,
  SegmentedControl,
  Term,
} from "../components/ui";

export function StockPage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          mode: current.mode,
          simulatedDate: current.simulatedDate,
          minuteOfDay: current.minuteOfDay,
          extendedHours: current.extendedHours,
          instruments: current.instruments,
          quotes: current.quotes,
          watchlist: current.watchlist,
          intradayCandles: current.intradayCandles,
          thirtyMinuteCandles: current.thirtyMinuteCandles,
          dailyCandles: current.dailyCandles,
          tape: current.tape,
          news: current.news,
          portfolio: current.portfolio,
          challenge: current.challenge,
        }
      : null,
  );
  const activeSymbol = useSimulationStore((state) => state.activeSymbol);
  const toggleWatchlist = useSimulationStore((state) => state.toggleWatchlist);
  const setActiveSymbol = useSimulationStore((state) => state.setActiveSymbol);
  const [period, setPeriod] = useState<ChartPeriod>("1D");
  const [showAverage, setShowAverage] = useState(true);
  const [showMA5, setShowMA5] = useState(true);
  const [showMA10, setShowMA10] = useState(true);
  const [showMA20, setShowMA20] = useState(true);
  const [showMACD, setShowMACD] = useState(false);
  const [tab, setTab] = useState<"basic" | "news">("basic");
  const [bookInstruction, setBookInstruction] =
    useState<BookPriceInstruction | null>(null);

  const candles = useMemo(() => {
    if (!simulation) return [];
    const symbol =
      simulation.instruments.find((item) => item.symbol === activeSymbol)
        ?.symbol ?? simulation.instruments[0]?.symbol;
    if (!symbol) return [];
    if (period === "1D") return simulation.intradayCandles[symbol] ?? [];
    if (period === "5D") {
      const source = simulation.thirtyMinuteCandles[symbol] ?? [];
      const dates = Array.from(
        new Set(
          source.map((candle) =>
            new Date(candle.timeSec * 1000).toISOString().slice(0, 10),
          ),
        ),
      ).slice(-5);
      return source.filter((candle) =>
        dates.includes(
          new Date(candle.timeSec * 1000).toISOString().slice(0, 10),
        ),
      );
    }
    return simulation.dailyCandles[symbol] ?? [];
  }, [period, activeSymbol, simulation]);

  if (!simulation) return null;
  const instrument =
    simulation.instruments.find((item) => item.symbol === activeSymbol) ??
    simulation.instruments[0];
  const quote = simulation.quotes[instrument.symbol];
  const market = getMarketConfig(simulation.marketId);
  const watched = simulation.watchlist.includes(instrument.symbol);
  const phase = resolveMarketPhase(
    market,
    simulation.minuteOfDay,
    simulation.extendedHours,
  );
  const displayedPhase = quote?.phase === "halted" ? "halted" : phase;

  const companyNews = visibleNewsAt(
    simulation.news,
    dateToEpochSec(simulation.simulatedDate, simulation.minuteOfDay),
  ).filter(
    (item) =>
      item.target === instrument.symbol || item.target === instrument.sector,
  );

  if (!quote) {
    return (
      <EmptyState
        title="未找到该证券"
        description="请返回行情页重新选择。"
        icon="search"
      />
    );
  }

  return (
    <div className="page stock-page">
      <div className="stock-breadcrumb">
        <button
          type="button"
          onClick={() => useSimulationStore.getState().setPage("market")}
        >
          行情
        </button>
        <Icon name="chevron-right" size={14} />
        <span>{instrument.name}</span>
      </div>

      <header className="stock-header">
        <div className="stock-identity">
          <div className="stock-code-line">
            <span>{instrument.symbol}</span>
            <span className="board-badge">
              {instrument.board === "star"
                ? "科创板"
                : instrument.board === "chinext"
                  ? "创业板"
                  : instrument.board === "st"
                    ? "ST"
                    : instrument.board === "us"
                      ? "US"
                      : "主板"}
            </span>
            <span className="sector-tag">{instrument.sector}</span>
            <span className={`phase-tag phase-${displayedPhase}`}>
              {displayedPhase === "halted"
                ? "停牌"
                : phaseLabel(displayedPhase)}
            </span>
          </div>
          <div className="stock-name-row">
            <h1>{instrument.name}</h1>
            <button
              type="button"
              className={`watch-toggle header-watch ${watched ? "active" : ""}`}
              onClick={() => toggleWatchlist(instrument.symbol)}
              aria-label={watched ? "移出自选" : "加入自选"}
            >
              <Icon name="star" size={19} />
              {watched ? "已自选" : "加自选"}
            </button>
          </div>
        </div>
        <div className="stock-quote-main">
          <strong
            className={
              quote.change > 0 ? "up" : quote.change < 0 ? "down" : ""
            }
          >
            {market.currencySymbol}
            {quote.last.toFixed(2)}
          </strong>
          <span
            className={
              quote.change > 0 ? "up" : quote.change < 0 ? "down" : ""
            }
          >
            {quote.change > 0 ? "↑ +" : quote.change < 0 ? "↓ " : "— "}
            {quote.change.toFixed(2)} · {formatPercent(quote.changePercent)}
          </span>
        </div>
        <div className="stock-key-stats">
          <DataRow
            label={<Term id="openPrice">今开</Term>}
            value={quote.open.toFixed(2)}
          />
          <DataRow
            label={<Term id="highPrice">最高</Term>}
            value={quote.high.toFixed(2)}
          />
          <DataRow
            label={<Term id="lowPrice">最低</Term>}
            value={quote.low.toFixed(2)}
          />
          <DataRow
            label={<Term id="previousClose">昨收</Term>}
            value={quote.previousClose.toFixed(2)}
          />
          <DataRow
            label={<Term id="volume">成交量</Term>}
            value={`${formatNumber(quote.volume, 0)} 股`}
          />
          <DataRow
            label={<Term id="turnover">成交额</Term>}
            value={formatMoney(quote.turnover, market.currencySymbol, true)}
            hint={formatMoney(quote.turnover, market.currencySymbol)}
          />
          <DataRow
            label={<Term id="turnoverRate">换手率</Term>}
            value={formatRate(quote.turnoverRate)}
          />
          <DataRow
            label={<Term id="pe">市盈率</Term>}
            value={formatNumber(instrument.fundamentals.pe, 1)}
          />
          <DataRow
            label={<Term id="marketCap">总市值</Term>}
            value={formatMoney(
              quote.last * instrument.sharesOutstanding,
              market.currencySymbol,
              true,
            )}
          />
        </div>
      </header>

      <div className="stock-layout">
        <div className="stock-chart-column">
          <Panel className="chart-panel">
            <div className="chart-toolbar">
              <SegmentedControl<ChartPeriod>
                label="图表周期"
                value={period}
                options={[
                  { value: "1D", label: "1D" },
                  { value: "5D", label: "5D" },
                  { value: "1M", label: "1M" },
                  { value: "3M", label: "3M" },
                  { value: "1Y", label: "1Y" },
                ]}
                onChange={setPeriod}
              />
              <div className="indicator-toggles">
                {period === "1D" ? (
                  <button
                    type="button"
                    aria-pressed={showAverage}
                    className={showAverage ? "active" : ""}
                    onClick={() => setShowAverage((value) => !value)}
                  >
                    均价线
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-pressed={showMA5}
                      className={showMA5 ? "active" : ""}
                      onClick={() => setShowMA5((value) => !value)}
                    >
                      MA5
                    </button>
                    <button
                      type="button"
                      aria-pressed={showMA10}
                      className={showMA10 ? "active" : ""}
                      onClick={() => setShowMA10((value) => !value)}
                    >
                      MA10
                    </button>
                    <button
                      type="button"
                      aria-pressed={showMA20}
                      className={showMA20 ? "active" : ""}
                      onClick={() => setShowMA20((value) => !value)}
                    >
                      MA20
                    </button>
                  </>
                )}
                <button
                  type="button"
                  aria-pressed={showMACD}
                  className={showMACD ? "active" : ""}
                  onClick={() => setShowMACD((value) => !value)}
                >
                  MACD
                </button>
              </div>
            </div>
            <div className="chart-term-row">
              <Term id={period === "1D" ? "averagePrice" : "movingAverage"}>
                {period === "1D" ? "均价线" : "MA 均线"}
              </Term>
              <Term id="volume">成交量</Term>
              <Term id="macd">MACD</Term>
            </div>
            <PriceChart
              candles={candles}
              period={period}
              previousClose={quote.previousClose}
              showAverage={showAverage}
              showMA5={showMA5}
              showMA10={showMA10}
              showMA20={showMA20}
              showMACD={showMACD}
            />
            <div className="chart-meta">
              <span>
                {period === "1D"
                  ? <><Term id="intraday">分时线</Term> · 成交量</>
                  : period === "5D"
                    ? <><Term id="candle">30 分钟 K 线</Term> · 成交量</>
                    : <><Term id="candle">日 K 线</Term> · 成交量</>}
              </span>
              <span>
                {market.supportsPriceLimit
                  ? `涨停 ${quote.upperLimit?.toFixed(2)} / 跌停 ${quote.lowerLimit?.toFixed(2)}`
                  : "该市场无每日涨跌停"}
              </span>
            </div>
          </Panel>

          <Panel className="stock-lower-panel">
            <div className="stock-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "basic"}
                className={tab === "basic" ? "active" : ""}
                onClick={() => setTab("basic")}
              >
                基本信息
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "news"}
                className={tab === "news" ? "active" : ""}
                onClick={() => setTab("news")}
              >
                相关资讯 · {companyNews.length}
              </button>
            </div>
            {tab === "basic" ? (
              <div className="stock-info-grid">
                <div>
                  <h3>证券信息</h3>
                  <DataRow label="所属行业" value={instrument.sector} />
                  <DataRow
                    label="交易单位"
                    value={`${market.quantityRules[instrument.board].minimum} 股起`}
                  />
                  <DataRow
                    label="交收规则"
                    value={
                      market.settlement === "T+1" ? (
                        <Term id="t1">T+1</Term>
                      ) : (
                        <Term id="t0">T+0</Term>
                      )
                    }
                  />
                  <DataRow
                    label="币种"
                    value={`${market.currency} ${market.currencySymbol}`}
                  />
                  <DataRow
                    label="52 周高 / 低"
                    value={`${instrument.fundamentals.high52Week.toFixed(
                      2,
                    )} / ${instrument.fundamentals.low52Week.toFixed(2)}`}
                  />
                </div>
                <div>
                  <h3>模拟基本面</h3>
                  <DataRow
                    label="EPS"
                    value={instrument.fundamentals.eps.toFixed(2)}
                  />
                  <DataRow
                    label={<Term id="pe">市盈率</Term>}
                    value={formatNumber(instrument.fundamentals.pe, 1)}
                  />
                  <DataRow
                    label={<Term id="pb">市净率</Term>}
                    value={instrument.fundamentals.pb.toFixed(2)}
                  />
                  <DataRow
                    label="ROE"
                    value={formatRate(instrument.fundamentals.roe)}
                  />
                  <DataRow
                    label="营收增速"
                    value={formatRate(instrument.fundamentals.revenueGrowth)}
                  />
                  <DataRow
                    label="股息率"
                    value={formatRate(instrument.fundamentals.dividendYield)}
                  />
                </div>
                <div>
                  <h3>规模与流动性</h3>
                  <DataRow
                    label="总股本"
                    value={`${formatNumber(
                      instrument.sharesOutstanding / 100_000_000,
                      2,
                    )} 亿股`}
                  />
                  <DataRow
                    label="总市值"
                    value={formatMoney(
                      quote.last * instrument.sharesOutstanding,
                      market.currencySymbol,
                      true,
                    )}
                  />
                  <DataRow
                    label="平均日成交量"
                    value={`${formatNumber(instrument.avgDailyVolume, 0)} 股`}
                  />
                  <DataRow
                    label="盘口快照"
                    value={formatDateTime(quote.asOfSec)}
                  />
                  <DataRow
                    label="基本面说明"
                    value={instrument.isRealNameDemo ? "虚构演示快照" : "合成快照"}
                  />
                </div>
              </div>
            ) : (
              <NewsFeed news={companyNews} compact />
            )}
          </Panel>
        </div>

        <aside className="stock-trade-column">
          <OrderBook
            quote={quote}
            market={market}
            onSelectPrice={(price, side) =>
              setBookInstruction({
                price,
                side,
                nonce: Date.now(),
              })
            }
          />
          <TradeTicket
            simulation={simulation}
            instrument={instrument}
            bookInstruction={bookInstruction}
          />
        </aside>
      </div>

      <Panel className="tape-panel">
        <SectionHeading
          title="逐笔成交"
          description="最近 30 笔模拟撮合，主动买卖方向由价格路径生成"
        />
        <TapeList
          prints={simulation.tape[instrument.symbol] ?? []}
          market={market}
        />
      </Panel>
      <div className="instrument-switcher" aria-label="快速切换证券">
        <span>快速切换</span>
        {simulation.instruments.map((item) => (
          <Button
            key={item.symbol}
            variant={item.symbol === instrument.symbol ? "primary" : "ghost"}
            onClick={() => {
              setActiveSymbol(item.symbol);
              setPeriod("1D");
            }}
          >
            {item.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
