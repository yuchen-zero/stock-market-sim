import type { ReactNode } from "react";
import { getMarketConfig, MARKET_ORDER } from "../data/markets";
import { formatDate, formatClock, phaseLabel, resolveMarketPhase } from "../engine/time";
import type { MarketId, NavPage, SimMode } from "../types/domain";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import { Icon, BrandMark, type IconName } from "./Icons";
import { IconButton, SegmentedControl } from "./ui";

const NAV_ITEMS: Array<{
  page: NavPage;
  label: string;
  icon: IconName;
}> = [
  { page: "market", label: "行情", icon: "market" },
  { page: "watchlist", label: "自选", icon: "watchlist" },
  { page: "trade", label: "交易", icon: "trade" },
  { page: "portfolio", label: "持仓", icon: "portfolio" },
  { page: "orders", label: "委托", icon: "orders" },
  { page: "news", label: "资讯", icon: "news" },
  { page: "challenge", label: "挑战", icon: "challenge" },
  { page: "settings", label: "设置", icon: "settings" },
];

export function AppShell({
  children,
  onOpenHelp,
}: {
  children: ReactNode;
  onOpenHelp: () => void;
}) {
  const page = useSimulationStore((state) => state.page);
  const setPage = useSimulationStore((state) => state.setPage);
  const marketId = useSimulationStore((state) => state.marketId);
  const sidebarView = useCurrentSimulationView((simulation) => ({
    pendingCount:
      simulation?.orders.filter(
        (order) =>
          order.status === "pending" ||
          order.status === "partially_filled",
      ).length ?? 0,
    challengeStatus: simulation?.challenge.status,
    challengeDay: simulation?.challenge.day ?? 0,
    simulationMode: simulation?.mode,
  }));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主要导航">
        <button
          type="button"
          className="brand"
          onClick={() => setPage("market")}
          aria-label="模拟证券首页"
        >
          <BrandMark size={34} />
          <span>模拟证券</span>
        </button>
        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.page}
              type="button"
              className={
                page === item.page ||
                (page === "stock" && item.page === "market")
                  ? "nav-item active"
                  : "nav-item"
              }
              aria-current={
                page === item.page ||
                (page === "stock" && item.page === "market")
                  ? "page"
                  : undefined
              }
              onClick={() => setPage(item.page)}
            >
              <Icon name={item.icon} size={21} />
              <span>{item.label}</span>
              {item.page === "orders" && sidebarView.pendingCount > 0 ? (
                <em className="nav-badge">{sidebarView.pendingCount}</em>
              ) : null}
              {item.page === "challenge" &&
              sidebarView.simulationMode === "challenge" &&
              sidebarView.challengeStatus === "running" ? (
                <em className="nav-badge nav-badge-day">
                  {Math.min(sidebarView.challengeDay, 30)}
                </em>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button type="button" onClick={onOpenHelp}>
            <Icon name="help" size={19} />
            <span>帮助</span>
          </button>
        </div>
      </aside>
      <div className="app-main">
        <div className="global-header">
          <TopBar onOpenHelp={onOpenHelp} />
          <div className="simulation-disclaimer">
            <Icon name="info" size={14} />
            模拟交易 · 全部行情与新闻均为虚构 · 不构成投资建议
          </div>
          {marketId === "cn-real-demo" ? (
            <div className="real-name-disclaimer">
              真实公司名称仅用于界面演示，全部行情、财务数据和事件均为虚构。
            </div>
          ) : null}
        </div>
        <main className="page-container">{children}</main>
      </div>
    </div>
  );
}

function TopBar({ onOpenHelp }: { onOpenHelp: () => void }) {
  const marketId = useSimulationStore((state) => state.marketId);
  const mode = useSimulationStore((state) => state.mode);
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          paused: current.paused,
          speed: current.speed,
          minuteOfDay: current.minuteOfDay,
          simulatedDate: current.simulatedDate,
          extendedHours: current.extendedHours,
          challengeStatus: current.challenge.status,
          lastCloseSummary: current.lastCloseSummary,
        }
      : null,
  );
  const setMarket = useSimulationStore((state) => state.setMarket);
  const setMode = useSimulationStore((state) => state.setMode);
  const togglePause = useSimulationStore((state) => state.togglePause);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  const saveStatus = useSimulationStore((state) => state.saveStatus);
  const saveCurrent = useSimulationStore((state) => state.saveCurrent);
  const nextTradingDay = useSimulationStore((state) => state.nextTradingDay);
  const market = getMarketConfig(marketId);
  const phase = simulation
    ? phaseLabel(
        resolveMarketPhase(
          market,
          simulation.minuteOfDay,
          simulation.extendedHours,
        ),
      )
    : "已收盘";
  const isChallengeNotStarted =
    mode === "challenge" &&
    simulation?.challengeStatus === "not_started";
  const isChallengeCompleted =
    mode === "challenge" &&
    simulation?.challengeStatus === "completed";
  const canToggle =
    !isChallengeNotStarted &&
    !isChallengeCompleted &&
    !simulation?.lastCloseSummary;

  return (
    <header className="topbar">
      <div className="topbar-primary">
        <label className="market-select">
          <span className="sr-only">当前市场</span>
          <select
            value={marketId}
            onChange={(event) => setMarket(event.target.value as MarketId)}
            aria-label="当前市场"
          >
            {MARKET_ORDER.map((id) => (
              <option key={id} value={id}>
                {getMarketConfig(id).label}
              </option>
            ))}
          </select>
        </label>
        <SegmentedControl<SimMode>
          label="交易模式"
          value={mode}
          options={[
            { value: "sandbox", label: "自由沙盒" },
            { value: "challenge", label: "30 日挑战" },
          ]}
          onChange={setMode}
        />
      </div>
      <div className="topbar-clock">
        <strong>{simulation ? formatClock(simulation.minuteOfDay) : "--:--"}</strong>
        <span>
          {simulation ? formatDate(simulation.simulatedDate) : "等待仿真"}
          {simulation ? (
            <small className="topbar-zone"> · {market.timezone}</small>
          ) : null}
        </span>
        <em className={simulation?.paused ? "status-paused" : "status-live"}>
          {simulation?.paused ? "已暂停" : "运行中"} · {phase}
        </em>
      </div>
      <div className="topbar-controls">
        <div className="speed-control">
          <label htmlFor="sim-speed">速度</label>
          <select
            id="sim-speed"
            value={simulation?.speed ?? 4}
            onChange={(event) =>
              setSpeed(Number(event.target.value) as 1 | 2 | 4 | 8 | 16)
            }
          >
            {[1, 2, 4, 8, 16].map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="pause-button"
          onClick={togglePause}
          disabled={!canToggle}
          title={
            simulation?.lastCloseSummary
              ? "今日已收盘，请进入下一交易日"
              : undefined
          }
        >
          <Icon
            name={simulation?.paused ? "play" : "pause"}
            size={17}
          />
            {simulation?.lastCloseSummary
              ? "已收盘"
              : simulation?.paused
                ? "继续"
                : "暂停"}
        </button>
        <button
          type="button"
          className={`save-indicator save-${saveStatus.state}`}
          onClick={() => saveCurrent("manual")}
          title={saveStatus.message ?? "立即保存当前存档"}
        >
          <Icon name="save" size={15} />
          <span>
            {saveStatus.state === "error"
              ? "保存失败"
              : saveStatus.state === "saving"
                ? "保存中"
                : saveStatus.at
                  ? `已保存 ${new Date(saveStatus.at).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "本地存档"}
          </span>
        </button>
        {simulation?.lastCloseSummary &&
        !(mode === "challenge" && simulation.challengeStatus === "completed") ? (
          <button
            type="button"
            className="next-day-button"
            onClick={nextTradingDay}
          >
            <Icon name="chevron-right" size={15} />
            下一交易日
          </button>
        ) : null}
        <IconButton
          label="打开帮助中心"
          icon="help"
          onClick={onOpenHelp}
          className="topbar-help"
        />
      </div>
    </header>
  );
}
