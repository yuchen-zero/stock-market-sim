import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSimulationStore } from "../store/useSimulationStore";
import {
  DEFAULT_SETTINGS,
  listSavedSlots,
  saveSettings,
  saveSimulation,
} from "../store/storage";
import { submitOrder, tick } from "../engine/engine";

function resetStore() {
  window.localStorage.clear();
  useSimulationStore.setState({
    initialized: false,
    marketId: "cn-fic",
    mode: "sandbox",
    page: "market",
    activeSymbol: "600101",
    simulations: {},
    settings: { ...DEFAULT_SETTINGS },
    saveStatus: { state: "idle", at: null, message: null },
    loadError: null,
    toast: null,
  });
  useSimulationStore.getState().initialize();
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetStore();
});

describe("simulation store", () => {
  it("pauses and preserves each slot when switching market", () => {
    const cn = {
      ...useSimulationStore.getState().currentSimulation(),
      paused: false,
    };
    const advanced = tick(cn, 30);
    const filled = submitOrder(
      { ...advanced, paused: false },
      {
        clientOrderId: "switch-buy",
        symbol: "600101",
        side: "buy",
        type: "market",
        limitPrice: null,
        quantity: 100,
      },
    );
    const pending = submitOrder(
      { ...filled.state, paused: false },
      {
        clientOrderId: "switch-pending",
        symbol: "600101",
        side: "buy",
        type: "limit",
        limitPrice: filled.state.quotes["600101"].lowerLimit,
        quantity: 100,
      },
    );
    const stateWithRecords = pending.state;
    useSimulationStore.setState((state) => ({
      simulations: {
        ...state.simulations,
        "cn-fic:sandbox": stateWithRecords,
      },
    }));
    const seed = stateWithRecords.seed;
    const minute = stateWithRecords.minuteOfDay;
    useSimulationStore.getState().setMarket("us-sim");
    expect(useSimulationStore.getState().marketId).toBe("us-sim");
    expect(useSimulationStore.getState().currentSimulation().paused).toBe(true);
    useSimulationStore.getState().setMarket("cn-fic");
    const restored = useSimulationStore.getState().currentSimulation();
    expect(restored.seed).toBe(seed);
    expect(restored.minuteOfDay).toBe(minute);
    expect(restored.paused).toBe(true);
    expect(restored.orders).toHaveLength(2);
    expect(restored.portfolio.positions["600101"].totalQuantity).toBe(100);
  });

  it("keeps challenge and sandbox archives separate", () => {
    const sandboxSeed = useSimulationStore.getState().currentSimulation().seed;
    useSimulationStore.getState().setMode("challenge");
    expect(useSimulationStore.getState().mode).toBe("challenge");
    expect(useSimulationStore.getState().currentSimulation().challenge.status).toBe(
      "not_started",
    );
    useSimulationStore.getState().startCurrentChallenge("CH-SEPARATE");
    expect(useSimulationStore.getState().currentSimulation().seed).toBe(
      "CH-SEPARATE",
    );
    useSimulationStore.getState().setMode("sandbox");
    expect(useSimulationStore.getState().currentSimulation().seed).toBe(
      sandboxSeed,
    );
    useSimulationStore.getState().setMode("challenge");
    expect(useSimulationStore.getState().currentSimulation().seed).toBe(
      "CH-SEPARATE",
    );
  });

  it("pauses and reports when localStorage write fails", () => {
    const simulation = useSimulationStore.getState().currentSimulation();
    useSimulationStore.setState((state) => ({
      simulations: {
        ...state.simulations,
        "cn-fic:sandbox": { ...simulation, paused: false },
      },
    }));
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      const error = new Error("quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    });
    const ok = useSimulationStore.getState().saveCurrent("manual");
    expect(ok).toBe(false);
    expect(useSimulationStore.getState().currentSimulation().paused).toBe(true);
    expect(useSimulationStore.getState().saveStatus.state).toBe("error");
    expect(useSimulationStore.getState().toast?.tone).toBe("error");
  });

  it("adds, reorders and clears watchlist per current market", () => {
    useSimulationStore.getState().toggleWatchlist("600101");
    useSimulationStore.getState().toggleWatchlist("600201");
    expect(useSimulationStore.getState().currentSimulation().watchlist).toEqual([
      "600101",
      "600201",
    ]);
    useSimulationStore.getState().moveWatchlist("600201", -1);
    expect(useSimulationStore.getState().currentSimulation().watchlist).toEqual([
      "600201",
      "600101",
    ]);
    useSimulationStore.getState().clearWatchlist();
    expect(useSimulationStore.getState().currentSimulation().watchlist).toEqual(
      [],
    );
  });

  it("restores the last market, mode, page and symbol after reinitialization", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      lastMarketId: "us-sim",
      lastMode: "challenge",
      lastPage: "challenge",
      lastSymbol: "NVGR",
    });
    useSimulationStore.setState({ initialized: false, simulations: {} });
    useSimulationStore.getState().initialize();
    expect(useSimulationStore.getState().marketId).toBe("us-sim");
    expect(useSimulationStore.getState().mode).toBe("challenge");
    expect(useSimulationStore.getState().page).toBe("challenge");
    expect(useSimulationStore.getState().activeSymbol).toBe("NVGR");
  });

  it("restores the visible last-saved timestamp after reinitialization", () => {
    useSimulationStore.getState().saveCurrent("manual");
    const savedAt = useSimulationStore.getState().saveStatus.at;
    expect(savedAt).toBeTruthy();
    useSimulationStore.setState({ initialized: false, simulations: {} });
    useSimulationStore.getState().initialize();
    expect(useSimulationStore.getState().saveStatus.state).toBe("saved");
    expect(useSimulationStore.getState().saveStatus.at).toBe(savedAt);
  });

  it("clears all saved slots and rebuilds only the initial in-memory sandbox", () => {
    const current = useSimulationStore.getState().currentSimulation();
    saveSimulation("cn-fic", "sandbox", current);
    saveSimulation("us-sim", "sandbox", {
      ...current,
      marketId: "us-sim",
      mode: "sandbox",
    });
    expect(listSavedSlots().length).toBeGreaterThanOrEqual(2);
    useSimulationStore.getState().clearEverything();
    expect(listSavedSlots()).toHaveLength(0);
    expect(useSimulationStore.getState().marketId).toBe("cn-fic");
    expect(useSimulationStore.getState().mode).toBe("sandbox");
    expect(
      Object.keys(useSimulationStore.getState().simulations),
    ).toEqual(["cn-fic:sandbox"]);
  });

  it("restores onboardingStep after reinitialization", () => {
    useSimulationStore.getState().setOnboardingStep(2);
    useSimulationStore.setState({ initialized: false, simulations: {} });
    useSimulationStore.getState().initialize();
    expect(useSimulationStore.getState().settings.onboardingStep).toBe(2);
    expect(useSimulationStore.getState().settings.onboardingDone).toBe(false);
    useSimulationStore.getState().replayOnboarding();
    expect(useSimulationStore.getState().settings.onboardingStep).toBe(0);
  });

  it("commits each tick and required UI transitions exactly once", () => {
    const simulation = useSimulationStore.getState().currentSimulation();
    useSimulationStore.setState((state) => ({
      simulations: {
        ...state.simulations,
        "cn-fic:sandbox": { ...simulation, paused: false },
      },
    }));
    const listener = vi.fn();
    const unsubscribe = useSimulationStore.subscribe(listener);
    useSimulationStore.getState().tickCurrent();
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    useSimulationStore.getState().setPage("watchlist");
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    useSimulationStore.getState().updateSettings({ autoNextDay: true });
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    useSimulationStore.getState().setOnboardingStep(3);
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    useSimulationStore.getState().setMarket("us-sim");
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    useSimulationStore.getState().setMode("challenge");
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    useSimulationStore.getState().setExtendedHours(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("creates a new generation on reset and backup restore", () => {
    expect(useSimulationStore.getState().saveCurrent("manual")).toBe(true);
    const initial = useSimulationStore.getState().currentSimulation();
    useSimulationStore.getState().resetCurrent("RESET-GENERATION");
    const reset = useSimulationStore.getState().currentSimulation();
    expect(reset.seed).toBe("RESET-GENERATION");
    expect(reset.portfolio.generation).not.toBe(
      initial.portfolio.generation,
    );
    useSimulationStore.getState().restoreCurrentBackup();
    const restored = useSimulationStore.getState().currentSimulation();
    expect(restored.seed).toBe(initial.seed);
    expect(restored.portfolio.generation).not.toBe(
      reset.portfolio.generation,
    );
  });
});
