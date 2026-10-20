import { useState } from "react";
import { getMarketConfig } from "../data/markets";
import { formatMoney, formatNumber } from "../engine/money";
import { formatDateTime } from "../engine/time";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import type { Order, OrderStatus } from "../types/domain";
import { Button, EmptyState, Panel, SegmentedControl } from "../components/ui";

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待成交",
  partially_filled: "部分成交",
  filled: "已成交",
  partially_cancelled: "部成已撤",
  cancelled: "已撤单",
  expired: "已过期",
  rejected: "已拒单",
};

type OrdersTab = "current" | "history" | "trades";

export function OrdersPage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          orders: current.orders,
          trades: current.trades,
          instruments: current.instruments,
          portfolio: current.portfolio,
        }
      : null,
  );
  const cancelOrder = useSimulationStore((state) => state.cancelCurrentOrder);
  const [tab, setTab] = useState<OrdersTab>("current");

  if (!simulation) return null;
  const market = getMarketConfig(simulation.marketId);
  const currentOrders = simulation.orders.filter(
    (order) =>
      order.status === "pending" || order.status === "partially_filled",
  );
  const history = [...simulation.orders].reverse();
  const trades = [...simulation.trades].reverse();

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <div className="page-kicker">{market.label} · 委托与成交账本</div>
          <h1>委托管理</h1>
          <p>
            当前委托可撤单；历史委托保留全部状态；成交记录分别列示佣金、印花税和过户费。
          </p>
        </div>
        <span className="account-generation">
          拒单 {simulation.portfolio.rejectedOrderCount} 次 · 成交{" "}
          {simulation.portfolio.fillCount} 笔
        </span>
      </div>

      <Panel className="orders-panel">
        <div className="orders-head">
          <SegmentedControl<OrdersTab>
            label="委托分类"
            value={tab}
            options={[
              { value: "current", label: `当前委托 ${currentOrders.length}` },
              { value: "history", label: `历史委托 ${history.length}` },
              { value: "trades", label: `成交记录 ${trades.length}` },
            ]}
            onChange={setTab}
          />
          <span>
            当前账户版本 {simulation.portfolio.accountVersion}
          </span>
        </div>

        {tab === "current" ? (
          currentOrders.length === 0 ? (
            <EmptyState
              title="没有当前委托"
              description="未成交或部分成交的限价单会出现在这里，可撤单释放冻结资金或股份。"
              icon="orders"
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table orders-table">
                <thead>
                  <tr>
                    <th>委托编号</th>
                    <th>证券</th>
                    <th>方向</th>
                    <th>类型</th>
                    <th className="numeric">委托价</th>
                    <th className="numeric">数量</th>
                    <th className="numeric">已成交</th>
                    <th>状态</th>
                    <th>时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {currentOrders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      currencySymbol={market.currencySymbol}
                      onCancel={() => cancelOrder(order.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === "history" ? (
          history.length === 0 ? (
            <EmptyState
              title="没有历史委托"
              description="完成、撤销、过期和拒单记录会保存在历史中。"
              icon="orders"
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table orders-table">
                <thead>
                  <tr>
                    <th>委托编号</th>
                    <th>证券</th>
                    <th>方向</th>
                    <th>类型</th>
                    <th className="numeric">委托价</th>
                    <th className="numeric">数量</th>
                    <th className="numeric">已成交</th>
                    <th>状态 / 原因</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      currencySymbol={market.currencySymbol}
                      showReason
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : trades.length === 0 ? (
          <EmptyState
            title="没有成交记录"
            description="每笔真实撮合都会记录费用、成交价和可选的交易理由。"
            icon="trade"
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table trades-table">
              <thead>
                <tr>
                  <th>成交编号</th>
                  <th>时间</th>
                  <th>证券</th>
                  <th>方向</th>
                  <th className="numeric">成交价</th>
                  <th className="numeric">数量</th>
                  <th className="numeric">佣金</th>
                  <th className="numeric">印花税</th>
                  <th className="numeric">过户费</th>
                  <th className="numeric">总费用</th>
                  <th>交易理由</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => {
                  const order = simulation.orders.find(
                    (item) => item.id === trade.orderId,
                  );
                  return (
                    <tr key={trade.id}>
                      <td className="symbol-cell">{trade.id}</td>
                      <td>{formatDateTime(trade.executedAtSec)}</td>
                      <td>
                        {simulation.instruments.find(
                          (item) => item.symbol === trade.symbol,
                        )?.name ?? trade.symbol}
                      </td>
                      <td className={trade.side === "buy" ? "up" : "down"}>
                        {trade.side === "buy" ? "买入" : "卖出"}
                      </td>
                      <td className="numeric">
                        {market.currencySymbol}
                        {trade.price.toFixed(2)}
                      </td>
                      <td className="numeric">
                        {formatNumber(trade.quantity, 0)}
                      </td>
                      <td className="numeric">
                        {formatMoney(trade.commission, market.currencySymbol)}
                      </td>
                      <td className="numeric">
                        {formatMoney(trade.stampDuty, market.currencySymbol)}
                      </td>
                      <td className="numeric">
                        {formatMoney(trade.transferFee, market.currencySymbol)}
                      </td>
                      <td className="numeric">
                        {formatMoney(trade.totalFee, market.currencySymbol)}
                      </td>
                      <td className="note-cell">{order?.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="orders-legend">
        <span className="status-dot pending" /> 待成交
        <span className="status-dot partial" /> 部分成交
        <span className="status-dot filled" /> 已完成
        <span className="status-dot cancelled" /> 已撤 / 过期
        <span className="status-dot rejected" /> 拒单
      </div>
    </div>
  );
}

function OrderRow({
  order,
  currencySymbol,
  onCancel,
  showReason = false,
}: {
  order: Order;
  currencySymbol: "¥" | "$";
  onCancel?: () => void;
  showReason?: boolean;
}) {
  return (
    <tr>
      <td className="symbol-cell">{order.id}</td>
      <td>{order.symbol}</td>
      <td className={order.side === "buy" ? "up" : "down"}>
        {order.side === "buy" ? "买入" : "卖出"}
      </td>
      <td>{order.type === "limit" ? "限价" : "市价"}</td>
      <td className="numeric">
        {order.limitPrice !== null
          ? `${currencySymbol}${order.limitPrice.toFixed(2)}`
          : "五档市价"}
      </td>
      <td className="numeric">{formatNumber(order.quantity, 0)}</td>
      <td className="numeric">{formatNumber(order.filledQuantity, 0)}</td>
      <td>
        <span className={`order-status ${order.status}`}>
          {STATUS_LABELS[order.status]}
        </span>
        {showReason && order.rejectReason ? (
          <small className="reject-reason">{order.rejectReason}</small>
        ) : null}
      </td>
      <td>{formatDateTime(order.createdAtSec)}</td>
      {onCancel ? (
        <td>
          <Button variant="ghost" onClick={onCancel}>
            撤单
          </Button>
        </td>
      ) : null}
    </tr>
  );
}
