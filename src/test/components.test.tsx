import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import { createSimulation, tick } from "../engine/engine";
import { getMarketConfig } from "../data/markets";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import { DEFAULT_SETTINGS } from "../store/storage";
import { AppShell } from "../components/AppShell";
import { CloseDaySummary } from "../components/CloseDaySummary";
import { HelpDrawer } from "../components/HelpDrawer";
import { MarketTable } from "../components/MarketTable";
import { Onboarding } from "../components/Onboarding";
import { OrderBook } from "../components/OrderBook";
import { SettingsPage } from "../pages/SettingsPage";
import {
  TradeTicket,
  type BookPriceInstruction,
} from "../components/TradeTicket";
import type { MarketId, OrderSide, SimulationState } from "../types/domain";

function continuousState(marketId: MarketId = "cn-fic"): SimulationState {
  const start = createSimulation(getMarketConfig(marketId), "sandbox", "UI-TEST");
  return tick({ ...start, paused: false }, marketId === "us-sim" ? 30 : 16);
}

function installStore(simulation: SimulationState) {
  useSimulationStore.setState({
    initialized: true,
    marketId: simulation.marketId,
    mode: simulation.mode,
    page: "stock",
    activeSymbol: simulation.instruments[0].symbol,
    simulations: {
      [`${simulation.marketId}:${simulation.mode}`]: simulation,
    },
    settings: { ...DEFAULT_SETTINGS, onboardingDone: true },
    saveStatus: { state: "saved", at: new Date().toISOString(), message: null },
    loadError: null,
    toast: null,
  });
}

function TicketHarness() {
  const simulation = useSimulationStore(
    (state) => state.simulations[`${state.marketId}:${state.mode}`],
  );
  const [instruction, setInstruction] =
    useState<BookPriceInstruction | null>(null);
  if (!simulation) return null;
  const instrument = simulation.instruments[0];
  const quote = simulation.quotes[instrument.symbol];
  const market = getMarketConfig(simulation.marketId);
  return (
    <>
      <OrderBook
        quote={quote}
        market={market}
        onSelectPrice={(price, side: OrderSide) =>
          setInstruction({ price, side, nonce: Date.now() })
        }
      />
      <TradeTicket
        simulation={simulation}
        instrument={instrument}
        bookInstruction={instruction}
      />
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("broker interface components", () => {
  it("fills the limit price and side when a quote level is clicked", async () => {
    const simulation = continuousState();
    installStore(simulation);
    render(<TicketHarness />);
    const sellOne = screen.getAllByRole("button", { name: /卖1/ }).at(-1)!;
    const expected = simulation.quotes[simulation.instruments[0].symbol]
      .askLevels[0].price.toFixed(2);
    await userEvent.click(sellOne);
    expect(await screen.findByLabelText("委托价格")).toHaveValue(Number(expected));
    expect(
      screen
        .getByRole("group", { name: "买卖方向" })
        .querySelector('[aria-pressed="true"]'),
    ).toHaveTextContent("买入");
  });

  it("shows a selected-market simulation declaration in every page shell", () => {
    const simulation = continuousState("cn-real-demo");
    installStore(simulation);
    render(
      <AppShell onOpenHelp={() => undefined}>
        <div>页面内容</div>
      </AppShell>,
    );
    expect(
      screen.getByText("模拟交易 · 全部行情与新闻均为虚构 · 不构成投资建议"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "真实公司名称仅用于界面演示，全部行情、财务数据和事件均为虚构。",
      ),
    ).toBeInTheDocument();
  });

  it("repeats the fictional-account warning in a real-name order confirmation", async () => {
    const simulation = continuousState("cn-real-demo");
    installStore(simulation);
    render(<TicketHarness />);
    await userEvent.click(
      screen.getByRole("button", { name: /预览并提交买入委托/ }),
    );
    expect(
      screen.getAllByText(/该订单仅作用于虚构模拟账户/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/真实公司名称仅用于界面演示/),
    ).toBeInTheDocument();
  });

  it("creates only one order when the confirmation is double-clicked", async () => {
    const simulation = continuousState();
    installStore(simulation);
    render(<TicketHarness />);
    await userEvent.click(
      screen.getByRole("button", { name: /预览并提交买入委托/ }),
    );
    const confirm = screen.getByRole("button", { name: "确认委托" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(
        useSimulationStore.getState().currentSimulation().orders,
      ).toHaveLength(1);
    });
  });

  it("surfaces a concrete lot-size rejection instead of a generic failure", async () => {
    const simulation = continuousState();
    installStore(simulation);
    render(<TicketHarness />);
    const quantity = screen.getByLabelText("委托数量");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "50");
    await userEvent.click(
      screen.getByRole("button", { name: /预览并提交买入委托/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "确认委托" }));
    expect(
      await screen.findByText(/申报数量必须是 100 股的整数倍/),
    ).toBeInTheDocument();
    expect(
      useSimulationStore.getState().currentSimulation().orders[0].status,
    ).toBe("rejected");
  });

  it("pauses simulation when the five-step guide opens and does not advance time", async () => {
    const simulation = { ...continuousState(), paused: false };
    installStore(simulation);
    render(
      <StrictMode>
        <Onboarding open onClose={() => undefined} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(useSimulationStore.getState().currentSimulation().paused).toBe(
        true,
      );
    });
    expect(
      useSimulationStore.getState().currentSimulation().minuteOfDay,
    ).toBe(simulation.minuteOfDay);
    expect(screen.getByText("这是模拟市场")).toBeInTheDocument();
  });

  it("persists the onboarding step, supports skip and replay", async () => {
    installStore(continuousState());
    const onClose = vi.fn();
    const view = render(<Onboarding open onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(useSimulationStore.getState().settings.onboardingStep).toBe(1);
    expect(screen.getByText("先看整体行情")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "跳过引导" }));
    expect(onClose).toHaveBeenCalled();
    expect(useSimulationStore.getState().settings.onboardingDone).toBe(true);
    expect(useSimulationStore.getState().settings.onboardingStep).toBe(0);
    useSimulationStore.getState().replayOnboarding();
    expect(useSimulationStore.getState().settings.onboardingDone).toBe(false);
    view.rerender(
      <Onboarding open={false} onClose={onClose} />,
    );
    view.rerender(<Onboarding open onClose={onClose} />);
    expect(screen.getByText("这是模拟市场")).toBeInTheDocument();
  });

  it("opens a glossary term from the local help drawer", async () => {
    installStore(continuousState());
    render(<HelpDrawer open onClose={() => undefined} />);
    await userEvent.click(
      screen.getByRole("button", { name: "查看“最大回撤”术语解释" }),
    );
    expect(
      screen.getByText(/净值从历史高点到后续低点的最大跌幅/),
    ).toBeInTheDocument();
  });

  it("closes the help drawer with the close button, Escape and backdrop", async () => {
    installStore(continuousState());
    const onClose = vi.fn();
    const view = render(<HelpDrawer open onClose={onClose} />);
    await userEvent.click(
      screen.getByRole("button", { name: "关闭帮助" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    fireEvent.mouseDown(view.container.querySelector(".drawer-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives every market table header a terminology entry", () => {
    const simulation = continuousState();
    installStore(simulation);
    render(
      <MarketTable
        instruments={simulation.instruments}
        quotes={simulation.quotes}
        market={getMarketConfig("cn-fic")}
        watchlist={[]}
        onOpen={() => undefined}
        onToggleWatchlist={() => undefined}
      />,
    );
    const headers = screen
      .getAllByRole("columnheader")
      .filter(
        (header) => within(header).queryAllByRole("button").length > 0,
      );
    headers.forEach((header) => {
      expect(
        within(header).getByRole("button", {
          name: /查看.+术语解释/,
        }),
      ).toBeInTheDocument();
    });
  });

  it("shows US currency, one-share lot size and T+0 in the order ticket", () => {
    const simulation = continuousState("us-sim");
    installStore(simulation);
    render(<TicketHarness />);
    expect(screen.getByText(/1 股起，T\+0 当日可卖/)).toBeInTheDocument();
    expect(screen.getAllByText("$").length).toBeGreaterThan(0);
  });

  it("shows the close summary and advances to the next simulated day", async () => {
    const base = continuousState();
    const closed = {
      ...base,
      minuteOfDay: 900,
      paused: true,
      lastCloseSummary: {
        date: base.simulatedDate,
        equity: base.portfolio.equity,
        dailyPnl: 0,
        closedAtSec: 900 * 60,
      },
    };
    installStore(closed);
    render(<CloseDaySummary suppressed={false} />);
    expect(screen.getByText("当日模拟交易已收盘")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "进入下一交易日" }),
    );
    await waitFor(() => {
      expect(
        useSimulationStore.getState().currentSimulation().simulatedDate,
      ).not.toBe(closed.simulatedDate);
    });
  });

  it("shows a recoverable corrupt-save state instead of a blank page", () => {
    installStore(continuousState());
    useSimulationStore.setState({
      loadError: {
        slot: "cn-fic:sandbox",
        message: "存档字段不完整",
        backupAvailable: true,
      },
    });
    render(<SettingsPage />);
    expect(
      screen.getByText("发现损坏或不兼容的本地存档"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "从备份恢复" }),
    ).toBeInTheDocument();
  });

  it("keeps unrelated page slices from subscribing to the whole simulation", () => {
    const simulation = continuousState();
    installStore(simulation);
    const renders = vi.fn();
    function SliceProbe() {
      const last = useCurrentSimulationView(
        (current) => current?.quotes["600101"]?.last,
      );
      renders(last);
      return null;
    }
    render(<SliceProbe />);
    expect(renders).toHaveBeenCalledTimes(1);
    act(() => {
      useSimulationStore.getState().updateSettings({ autoNextDay: true });
    });
    expect(renders).toHaveBeenCalledTimes(1);
    act(() => {
      useSimulationStore.setState((state) => {
        const key = "cn-fic:sandbox";
        const current = state.simulations[key]!;
        return {
          simulations: {
            ...state.simulations,
            [key]: {
              ...current,
              quotes: {
                ...current.quotes,
                "600101": {
                  ...current.quotes["600101"],
                  last: current.quotes["600101"].last + 1,
                },
              },
            },
          },
        };
      });
    });
    expect(renders).toHaveBeenCalledTimes(2);
  });
});
