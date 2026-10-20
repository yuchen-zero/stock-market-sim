import { useMemo, useState } from "react";
import type {
  Instrument,
  MarketConfig,
  Quote,
} from "../types/domain";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
} from "../engine/money";
import { Icon } from "./Icons";
import { EmptyState, Term } from "./ui";

type SortKey =
  | "symbol"
  | "name"
  | "last"
  | "changePercent"
  | "change"
  | "volume"
  | "turnover"
  | "turnoverRate"
  | "pe"
  | "marketCap";

const COLUMNS: Array<{
  key: SortKey;
  label: string;
  className?: string;
  numeric?: boolean;
  termId: keyof typeof import("../data/help").TERMS;
}> = [
  { key: "symbol", label: "代码", termId: "securityCode" },
  { key: "name", label: "名称", termId: "securityName" },
  { key: "last", label: "现价", numeric: true, termId: "lastPrice" },
  {
    key: "changePercent",
    label: "涨跌幅",
    numeric: true,
    termId: "changePercent",
  },
  {
    key: "change",
    label: "涨跌额",
    numeric: true,
    className: "hide-1100",
    termId: "changeAmount",
  },
  {
    key: "volume",
    label: "成交量",
    numeric: true,
    className: "hide-900",
    termId: "volume",
  },
  {
    key: "turnover",
    label: "成交额",
    numeric: true,
    className: "hide-1100",
    termId: "turnover",
  },
  {
    key: "turnoverRate",
    label: "换手率",
    numeric: true,
    className: "hide-1100",
    termId: "turnoverRate",
  },
  {
    key: "pe",
    label: "市盈率",
    numeric: true,
    className: "hide-900",
    termId: "pe",
  },
  {
    key: "marketCap",
    label: "总市值",
    numeric: true,
    className: "hide-1100",
    termId: "marketCap",
  },
];

export function MarketTable({
  instruments,
  quotes,
  market,
  watchlist,
  onOpen,
  onToggleWatchlist,
  showWatchAction = true,
  emptyTitle = "没有找到证券",
  emptyDescription = "请尝试修改搜索条件。",
  extraActions,
}: {
  instruments: Instrument[];
  quotes: Record<string, Quote>;
  market: MarketConfig;
  watchlist: string[];
  onOpen: (symbol: string) => void;
  onToggleWatchlist?: (symbol: string) => void;
  showWatchAction?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  extraActions?: (instrument: Instrument) => React.ReactNode;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("changePercent");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    return [...instruments].sort((left, right) => {
      const leftQuote = quotes[left.symbol];
      const rightQuote = quotes[right.symbol];
      let leftValue: string | number;
      let rightValue: string | number;
      switch (sortKey) {
        case "symbol":
          leftValue = left.symbol;
          rightValue = right.symbol;
          break;
        case "name":
          leftValue = left.name;
          rightValue = right.name;
          break;
        case "pe":
          leftValue = left.fundamentals.pe;
          rightValue = right.fundamentals.pe;
          break;
        case "marketCap":
          leftValue = (leftQuote?.last ?? 0) * left.sharesOutstanding;
          rightValue = (rightQuote?.last ?? 0) * right.sharesOutstanding;
          break;
        default:
          leftValue = leftQuote?.[sortKey] ?? 0;
          rightValue = rightQuote?.[sortKey] ?? 0;
      }
      const result =
        typeof leftValue === "string"
          ? leftValue.localeCompare(String(rightValue), "zh-CN")
          : leftValue - Number(rightValue);
      return sortDirection === "asc" ? result : -result;
    });
  }, [instruments, quotes, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "symbol" || key === "name" ? "asc" : "desc");
    }
  };

  if (instruments.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} icon="search" />;
  }

  return (
    <div className="table-scroll">
      <table className="market-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className={`${column.className ?? ""} ${
                  column.numeric ? "numeric" : ""
                }`}
                aria-sort={
                  sortKey === column.key
                    ? sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <div className="th-content">
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => handleSort(column.key)}
                  >
                    {column.label}
                    <span
                      className={
                        sortKey === column.key ? "sort-mark active" : "sort-mark"
                      }
                      aria-hidden="true"
                    >
                      {sortKey === column.key
                        ? sortDirection === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </span>
                  </button>
                  <Term id={column.termId} triggerOnly />
                </div>
              </th>
            ))}
            {showWatchAction || extraActions ? (
              <th className="action-column">
                <span className="sr-only">操作</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((instrument) => {
            const quote = quotes[instrument.symbol];
            if (!quote) return null;
            const isWatched = watchlist.includes(instrument.symbol);
            const direction =
              quote.change > 0 ? "up" : quote.change < 0 ? "down" : "flat";
            return (
              <tr
                key={instrument.symbol}
                tabIndex={0}
                className="stock-row"
                onClick={() => onOpen(instrument.symbol)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(instrument.symbol);
                  }
                }}
              >
                <td className="symbol-cell">{instrument.symbol}</td>
                <td>
                  <span className="stock-name">{instrument.name}</span>
                  <span className="instrument-tag">
                    {instrument.board === "star"
                      ? "科创"
                      : instrument.board === "chinext"
                        ? "创业"
                        : instrument.board === "st"
                          ? "ST"
                          : instrument.board === "us"
                            ? "US"
                            : instrument.sector}
                  </span>
                </td>
                <td className={`numeric price ${direction}`}>
                  {formatMoney(quote.last, market.currencySymbol).replace(
                    market.currencySymbol,
                    "",
                  )}
                </td>
                <td className={`numeric ${direction}`}>
                  {formatPercent(quote.changePercent)}
                </td>
                <td className={`numeric ${direction} hide-1100`}>
                  {quote.change > 0 ? "+" : ""}
                  {quote.change.toFixed(2)}
                </td>
                <td className="numeric hide-900">
                  {formatNumber(quote.volume, 0)}
                </td>
                <td className="numeric hide-1100" title={formatMoney(quote.turnover, market.currencySymbol)}>
                  {formatMoney(quote.turnover, market.currencySymbol, true)}
                </td>
                <td className="numeric hide-1100">
                  {formatRate(quote.turnoverRate)}
                </td>
                <td className="numeric hide-900">
                  {formatNumber(instrument.fundamentals.pe, 1)}
                </td>
                <td className="numeric hide-1100">
                  {formatMoney(
                    quote.last * instrument.sharesOutstanding,
                    market.currencySymbol,
                    true,
                  )}
                </td>
                {showWatchAction || extraActions ? (
                  <td className="action-column">
                    <div className="row-actions">
                      {extraActions?.(instrument)}
                      {showWatchAction && onToggleWatchlist ? (
                        <button
                          type="button"
                          className={`watch-toggle ${isWatched ? "active" : ""}`}
                          aria-label={
                            isWatched
                              ? `将 ${instrument.name} 移出自选`
                              : `将 ${instrument.name} 加入自选`
                          }
                          title={isWatched ? "移出自选" : "加入自选"}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleWatchlist(instrument.symbol);
                          }}
                        >
                          <Icon name="star" size={16} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
