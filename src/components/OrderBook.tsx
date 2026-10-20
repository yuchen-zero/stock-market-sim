import type {
  MarketConfig,
  OrderSide,
  Quote,
  TapePrint,
} from "../types/domain";
import { formatMoney, formatNumber } from "../engine/money";
import { formatClock, epochSecToDateTime } from "../engine/time";
import { EmptyState, Term } from "./ui";

export function OrderBook({
  quote,
  market,
  onSelectPrice,
}: {
  quote: Quote;
  market: MarketConfig;
  onSelectPrice: (price: number, side: OrderSide) => void;
}) {
  const maxVolume = Math.max(
    1,
    ...quote.askLevels.map((level) => level.quantity),
    ...quote.bidLevels.map((level) => level.quantity),
  );
  const spread =
    quote.askLevels[0] && quote.bidLevels[0]
      ? quote.askLevels[0].price - quote.bidLevels[0].price
      : 0;
  return (
    <section className="order-book panel" aria-label="五档盘口">
      <div className="order-book-head">
        <h2>
          <Term id="orderBook">五档盘口</Term>
        </h2>
        <span>
          价差 {spread.toFixed(2)}
          {quote.phase === "halted"
            ? " · 停牌"
            : quote.phase === "opening_auction" ||
                quote.phase === "closing_auction"
              ? " · 有限深度简化撮合"
              : ""}
        </span>
      </div>
      <div className="book-columns" aria-hidden="true">
        <span>档位</span>
        <span>价格</span>
        <span>数量</span>
        <span>金额</span>
      </div>
      <div className="book-levels asks">
        {[...quote.askLevels].reverse().map((level, index) => (
          <button
            type="button"
            key={`ask-${level.price}-${index}`}
            onClick={() => onSelectPrice(level.price, "buy")}
            aria-label={`卖${5 - index} ${level.price.toFixed(2)}，数量 ${level.quantity}`}
            className={level.quantity === 0 ? "sealed" : ""}
          >
            <span className="book-label">卖{5 - index}</span>
            <strong className="down">
              {market.currencySymbol}
              {level.price.toFixed(2)}
            </strong>
            <span className="book-qty">
              {level.quantity === 0 ? "封板" : formatNumber(level.quantity, 0)}
              <i style={{ width: `${(level.quantity / maxVolume) * 100}%` }} />
            </span>
            <span
              className="book-amount"
              title={formatMoney(
                level.price * level.quantity,
                market.currencySymbol,
              )}
            >
              {level.quantity === 0
                ? "—"
                : formatMoney(
                    level.price * level.quantity,
                    market.currencySymbol,
                    true,
                  )}
            </span>
          </button>
        ))}
      </div>
      <div className="book-mid">
        <strong className={quote.change > 0 ? "up" : quote.change < 0 ? "down" : ""}>
          {market.currencySymbol}
          {quote.last.toFixed(2)}
        </strong>
        <span>{quote.changePercent.toFixed(2)}%</span>
      </div>
      <div className="book-levels bids">
        {quote.bidLevels.map((level, index) => (
          <button
            type="button"
            key={`bid-${level.price}-${index}`}
            onClick={() => onSelectPrice(level.price, "sell")}
            aria-label={`买${index + 1} ${level.price.toFixed(2)}，数量 ${level.quantity}`}
            className={level.quantity === 0 ? "sealed" : ""}
          >
            <span className="book-label">买{index + 1}</span>
            <strong className="up">
              {market.currencySymbol}
              {level.price.toFixed(2)}
            </strong>
            <span className="book-qty">
              {level.quantity === 0 ? "封板" : formatNumber(level.quantity, 0)}
              <i style={{ width: `${(level.quantity / maxVolume) * 100}%` }} />
            </span>
            <span
              className="book-amount"
              title={formatMoney(
                level.price * level.quantity,
                market.currencySymbol,
              )}
            >
              {level.quantity === 0
                ? "—"
                : formatMoney(
                    level.price * level.quantity,
                    market.currencySymbol,
                    true,
                  )}
            </span>
          </button>
        ))}
      </div>
      <p className="book-hint">点击卖盘带入买入价，点击买盘带入卖出价</p>
    </section>
  );
}

export function TapeList({
  prints,
  market,
}: {
  prints: TapePrint[];
  market: MarketConfig;
}) {
  if (prints.length === 0) {
    return (
      <EmptyState
        title="暂无逐笔成交"
        description="当前模拟时刻还没有生成逐笔撮合记录。"
        icon="orders"
      />
    );
  }
  return (
    <div className="tape-scroll">
      <table className="data-table tape-table">
        <thead>
          <tr>
            <th>模拟时间</th>
            <th>方向</th>
            <th className="numeric">价格</th>
            <th className="numeric">数量</th>
          </tr>
        </thead>
        <tbody>
          {prints
            .slice(-30)
            .reverse()
            .map((print) => {
              const time = epochSecToDateTime(print.timeSec);
              return (
                <tr key={print.id}>
                  <td>{formatClock(time.minuteOfDay)}</td>
                  <td className={print.side === "buy" ? "up" : "down"}>
                    {print.side === "buy" ? "主动买" : "主动卖"}
                  </td>
                  <td className="numeric">
                    {market.currencySymbol}
                    {print.price.toFixed(2)}
                  </td>
                  <td className="numeric">{formatNumber(print.quantity, 0)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
