import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { HelpDrawer } from "../components/HelpDrawer";
import { Onboarding } from "../components/Onboarding";
import { Toast } from "../components/ui";
import { CloseDaySummary } from "../components/CloseDaySummary";
import { useSimulationStore } from "../store/useSimulationStore";
import { MarketPage } from "../pages/MarketPage";
import { WatchlistPage } from "../pages/WatchlistPage";
import { StockPage } from "../pages/StockPage";
import { TradePage } from "../pages/TradePage";
import { PortfolioPage } from "../pages/PortfolioPage";
import { OrdersPage } from "../pages/OrdersPage";
import { NewsPage } from "../pages/NewsPage";
import { ChallengePage } from "../pages/ChallengePage";
import { SettingsPage } from "../pages/SettingsPage";

export function App() {
  const initialized = useSimulationStore((state) => state.initialized);
  const page = useSimulationStore((state) => state.page);
  const settings = useSimulationStore((state) => state.settings);
  const toast = useSimulationStore((state) => state.toast);
  const initialize = useSimulationStore((state) => state.initialize);
  const clearToast = useSimulationStore((state) => state.clearToast);
  const [helpOpen, setHelpOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!initialized || settings.onboardingDone) return;
    setGuideOpen(true);
  }, [initialized, settings.onboardingDone]);

  useEffect(() => {
    const onReplay = () => setGuideOpen(true);
    window.addEventListener("stock-sim:replay-onboarding", onReplay);
    return () =>
      window.removeEventListener("stock-sim:replay-onboarding", onReplay);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const timer = window.setInterval(() => {
      const store = useSimulationStore.getState();
      const current = store.currentSimulation();
      if (guideOpen || current.paused) return;
      store.tickCurrent();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [initialized, guideOpen]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const store = useSimulationStore.getState();
      const current = store.currentSimulation();
      if (document.hidden && store.settings.pauseWhenHidden) {
        if (!current.paused) store.togglePause();
        store.saveCurrent("auto");
      } else if (!document.hidden) {
        store.notify("返回页面：仿真保持在暂停状态，可点击“继续”。", "info");
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  if (!initialized) {
    return (
      <div className="boot-screen">
        <div className="boot-mark" />
        <strong>正在载入本地模拟市场</strong>
        <span>检查确定性行情与存档…</span>
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <AppShell onOpenHelp={() => setHelpOpen(true)}>
        {page === "market" && <MarketPage />}
        {page === "watchlist" && <WatchlistPage />}
        {page === "stock" && <StockPage />}
        {page === "trade" && <TradePage />}
        {page === "portfolio" && <PortfolioPage />}
        {page === "orders" && <OrdersPage />}
        {page === "news" && <NewsPage />}
        {page === "challenge" && <ChallengePage />}
        {page === "settings" && <SettingsPage />}
      </AppShell>
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Onboarding open={guideOpen} onClose={() => setGuideOpen(false)} />
      <CloseDaySummary suppressed={guideOpen || helpOpen} />
      {toast ? (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onClose={clearToast}
        />
      ) : null}
    </AppErrorBoundary>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("模拟证券界面错误", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal-error">
          <h1>界面遇到错误</h1>
          <p>{this.state.error.message}</p>
          <p>
            本地账户数据仍保存在浏览器中。可先导出最近存档，或重新载入页面。
          </p>
          <div>
            <button type="button" onClick={() => window.location.reload()}>
              重新载入
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                useSimulationStore.getState().resetCurrent();
              }}
            >
              重置当前槽位后继续
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
