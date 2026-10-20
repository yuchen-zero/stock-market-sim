import { useState } from "react";
import { getMarketConfig } from "../data/markets";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import { MarketTable } from "../components/MarketTable";
import { Button, EmptyState, Modal, Panel, SectionHeading } from "../components/ui";
import { Icon } from "../components/Icons";

export function WatchlistPage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          instruments: current.instruments,
          quotes: current.quotes,
          watchlist: current.watchlist,
        }
      : null,
  );
  const openStock = useSimulationStore((state) => state.openStock);
  const setPage = useSimulationStore((state) => state.setPage);
  const toggleWatchlist = useSimulationStore((state) => state.toggleWatchlist);
  const clearWatchlist = useSimulationStore((state) => state.clearWatchlist);
  const moveWatchlist = useSimulationStore((state) => state.moveWatchlist);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!simulation) return null;
  const market = getMarketConfig(simulation.marketId);
  const instruments = simulation.watchlist
    .map((symbol) =>
      simulation.instruments.find((instrument) => instrument.symbol === symbol),
    )
    .filter(
      (instrument): instrument is NonNullable<typeof instrument> =>
        Boolean(instrument),
    );

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <div className="page-kicker">{market.label} · 按市场独立保存</div>
          <h1>我的自选</h1>
          <p>自选顺序只影响观察列表，不会改变行情引擎或账户状态。</p>
        </div>
        {instruments.length > 0 ? (
          <Button variant="ghost" onClick={() => setConfirmClear(true)}>
            <Icon name="trash" size={16} />
            清空自选
          </Button>
        ) : null}
      </div>

      <Panel className="quote-panel watchlist-panel">
        <SectionHeading
          title={`自选证券 · ${instruments.length}`}
          description="使用行尾箭头调整顺序，实时价格由当前仿真状态驱动"
          action={
            <button
              type="button"
              className="text-button"
              onClick={() => setPage("market")}
            >
              去行情添加
            </button>
          }
        />
        {instruments.length === 0 ? (
          <EmptyState
            title="还没有自选证券"
            description="在行情表行尾点击星标，或进入个股页加入自选。自选会按市场分别保存。"
            icon="watchlist"
            action={
              <Button variant="primary" onClick={() => setPage("market")}>
                去行情添加
              </Button>
            }
          />
        ) : (
          <MarketTable
            instruments={instruments}
            quotes={simulation.quotes}
            market={market}
            watchlist={simulation.watchlist}
            onOpen={openStock}
            onToggleWatchlist={toggleWatchlist}
            extraActions={(instrument) => {
              const index = simulation.watchlist.indexOf(instrument.symbol);
              return (
                <span className="reorder-actions">
                  <button
                    type="button"
                    title="上移"
                    aria-label={`将 ${instrument.name} 上移`}
                    disabled={index <= 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveWatchlist(instrument.symbol, -1);
                    }}
                  >
                    <Icon name="arrow-up" size={13} />
                  </button>
                  <button
                    type="button"
                    title="下移"
                    aria-label={`将 ${instrument.name} 下移`}
                    disabled={index >= simulation.watchlist.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveWatchlist(instrument.symbol, 1);
                    }}
                  >
                    <Icon name="arrow-down" size={13} />
                  </button>
                </span>
              );
            }}
          />
        )}
      </Panel>

      <Modal
        open={confirmClear}
        title="清空当前自选？"
        onClose={() => setConfirmClear(false)}
        footer={
          <>
            <Button onClick={() => setConfirmClear(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                clearWatchlist();
                setConfirmClear(false);
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        <p className="modal-copy">
          当前市场的自选标记将被移除，不会影响其他市场、账户、订单或持仓。
        </p>
      </Modal>
    </div>
  );
}
