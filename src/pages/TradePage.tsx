import { useEffect, useState } from "react";
import { getMarketConfig } from "../data/markets";
import { formatMoney, formatNumber } from "../engine/money";
import { formatDateTime } from "../engine/time";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import { Icon } from "../components/Icons";
import { OrderBook } from "../components/OrderBook";
import { TradeTicket, type BookPriceInstruction } from "../components/TradeTicket";
import {
  EmptyState,
  Panel,
  SectionHeading,
} from "../components/ui";

export function TradePage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          mode: current.mode,
          instruments: current.instruments,
          quotes: current.quotes,
          trades: current.trades,
          orders: current.orders,
          portfolio: current.portfolio,
          challenge: current.challenge,
        }
      : null,
  );
  const activeSymbol = useSimulationStore((state) => state.activeSymbol);
  const setActiveSymbol = useSimulationStore((state) => state.setActiveSymbol);
  const openStock = useSimulationStore((state) => state.openStock);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(activeSymbol);
  const [bookInstruction, setBookInstruction] =
    useState<BookPriceInstruction | null>(null);

  useEffect(() => {
    if (!simulation) return;
    if (!simulation.instruments.some((item) => item.symbol === selected)) {
      setSelected(simulation.instruments[0]?.symbol ?? "");
    }
    setBookInstruction(null);
  }, [selected, simulation?.marketId, simulation?.mode]);

  if (!simulation) return null;
  const market = getMarketConfig(simulation.marketId);
  const instrument =
    simulation.instruments.find((item) => item.symbol === selected) ??
    simulation.instruments[0];
  const quote = simulation.quotes[instrument.symbol];
  const normalizedQuery = query.trim().toLowerCase();
  const matches = simulation.instruments.filter(
    (item) =>
      !normalizedQuery ||
      item.symbol.toLowerCase().includes(normalizedQuery) ||
      item.name.toLowerCase().includes(normalizedQuery),
  );
  const recentTrades = [...simulation.trades].reverse().slice(0, 5);

  if (!quote) return null;
  return (
    <div className="page trade-page">
      <div className="page-title-row">
        <div>
          <div className="page-kicker">{market.label} · {market.settlement}</div>
          <h1>模拟交易</h1>
          <p>搜索证券、查看盘口并提交委托；所有校验和费用均由同一仿真引擎计算。</p>
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => openStock(instrument.symbol)}
        >
          查看个股详情
          <Icon name="chevron-right" size={14} />
        </button>
      </div>

      <div className="trade-page-grid">
        <div className="trade-selector-column">
          <Panel className="trade-search-panel">
            <SectionHeading title="快速切换证券" />
            <div className="search-field">
              <Icon name="search" size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="代码或名称"
                aria-label="搜索交易证券"
              />
            </div>
            <div className="trade-symbol-list">
              {matches.length === 0 ? (
                <EmptyState
                  title="没有匹配证券"
                  description="更改代码或名称关键词。"
                  icon="search"
                />
              ) : (
                matches.map((item) => {
                  const itemQuote = simulation.quotes[item.symbol];
                  return (
                    <button
                      type="button"
                      key={item.symbol}
                      className={selected === item.symbol ? "active" : ""}
                      onClick={() => {
                        setSelected(item.symbol);
                        setActiveSymbol(item.symbol);
                      }}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <em>{item.symbol}</em>
                      </span>
                      <span
                        className={
                          (itemQuote?.change ?? 0) > 0
                            ? "up"
                            : (itemQuote?.change ?? 0) < 0
                              ? "down"
                              : ""
                        }
                      >
                        <strong>
                          {market.currencySymbol}
                          {itemQuote?.last.toFixed(2)}
                        </strong>
                        <em>
                          {itemQuote && itemQuote.changePercent > 0 ? "+" : ""}
                          {itemQuote?.changePercent.toFixed(2)}%
                        </em>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </Panel>
          <Panel className="recent-trades-panel">
            <SectionHeading title="最近 5 笔成交" />
            {recentTrades.length === 0 ? (
              <EmptyState
                title="尚无成交"
                description="成功撮合后会在这里显示成交价、数量与费用。"
                icon="orders"
              />
            ) : (
              <div className="recent-fill-list">
                {recentTrades.map((trade) => {
                  const order = simulation.orders.find(
                    (item) => item.id === trade.orderId,
                  );
                  return (
                    <article key={trade.id}>
                      <div>
                        <strong className={trade.side === "buy" ? "up" : "down"}>
                          {trade.side === "buy" ? "买入" : "卖出"} ·{" "}
                          {trade.symbol}
                        </strong>
                        <span>{formatDateTime(trade.executedAtSec)}</span>
                      </div>
                      <div>
                        <strong>
                          {formatNumber(trade.quantity, 0)} 股 @{" "}
                          {trade.price.toFixed(2)}
                        </strong>
                        <span>
                          费用 {formatMoney(trade.totalFee, market.currencySymbol)}
                        </span>
                      </div>
                      {order?.note ? <p>{order.note}</p> : null}
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
        <OrderBook
          quote={quote}
          market={market}
          onSelectPrice={(price, side) =>
            setBookInstruction({ price, side, nonce: Date.now() })
          }
        />
        <TradeTicket
          simulation={simulation}
          instrument={instrument}
          bookInstruction={bookInstruction}
          compact
        />
      </div>
    </div>
  );
}
