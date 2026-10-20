import { useEffect, useState } from "react";
import { getMarketConfig } from "../data/markets";
import {
  formatMoney,
  formatSignedMoney,
} from "../engine/money";
import { formatDate } from "../engine/time";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import { Button, Modal } from "./ui";

export function CloseDaySummary({ suppressed }: { suppressed: boolean }) {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          mode: current.mode,
          challengeStatus: current.challenge.status,
          lastCloseSummary: current.lastCloseSummary,
          trades: current.trades,
        }
      : null,
  );
  const page = useSimulationStore((state) => state.page);
  const nextTradingDay = useSimulationStore((state) => state.nextTradingDay);
  const setPage = useSimulationStore((state) => state.setPage);
  const [dismissedDate, setDismissedDate] = useState<string | null>(null);
  const summary = simulation?.lastCloseSummary;

  useEffect(() => {
    if (!summary) setDismissedDate(null);
  }, [summary]);

  const challengeComplete =
    simulation?.mode === "challenge" &&
    simulation.challengeStatus === "completed";
  const shouldOpen =
    !suppressed &&
    !challengeComplete &&
    page !== "challenge" &&
    Boolean(summary) &&
    summary?.date !== dismissedDate;

  if (!simulation || !summary) return null;
  const market = getMarketConfig(simulation.marketId);

  return (
    <Modal
      open={shouldOpen}
      title="当日模拟交易已收盘"
      onClose={() => setDismissedDate(summary.date)}
      width="530px"
      footer={
        <>
          <Button onClick={() => setDismissedDate(summary.date)}>
            留在今日
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDismissedDate(summary.date);
              setPage("portfolio");
            }}
          >
            查看持仓
          </Button>
          <Button variant="primary" onClick={nextTradingDay}>
            进入下一交易日
          </Button>
        </>
      }
    >
      <p className="modal-copy">
        {formatDate(summary.date)} 已按收盘价完成结算。未成交委托已过期，
        冻结资金与股份已释放；{market.settlement === "T+1"
          ? "当日买入持仓将在下一交易日变为可卖。"
          : "当日买入持仓已按 T+0 计为可卖。"}
      </p>
      <div className="close-summary-grid">
        <div>
          <span>收盘总资产</span>
          <strong>{formatMoney(summary.equity, market.currencySymbol)}</strong>
        </div>
        <div>
          <span>当日盈亏</span>
          <strong
            className={
              summary.dailyPnl > 0 ? "up" : summary.dailyPnl < 0 ? "down" : ""
            }
          >
            {formatSignedMoney(summary.dailyPnl, market.currencySymbol)}
          </strong>
        </div>
        <div>
          <span>今日成交</span>
          <strong>
            {simulation.trades.filter(
              (trade) =>
                new Date(trade.executedAtSec * 1000)
                  .toISOString()
                  .slice(0, 10) === summary.date,
            ).length}
            {" "}笔
          </strong>
        </div>
        <div>
          <span>市场状态</span>
          <strong>已暂停 · 等待进入下一日</strong>
        </div>
      </div>
      <p className="confirm-fineprint">
        模拟交易日历只跳过周末，不对应真实交易所节假日。全部数据均为虚构。
      </p>
    </Modal>
  );
}
