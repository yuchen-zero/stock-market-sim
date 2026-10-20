import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  AppSettings,
  MarketId,
  NavPage,
  OrderDraft,
  SimMode,
  SimulationState,
  SlotKey,
} from "../types/domain";
import {
  advanceTradingDay,
  applyExtendedHoursSetting,
  cancelOrder,
  createSimulation,
  ENGINE_DEFAULT_SEED,
  refreshGeneration,
  startChallenge,
  submitOrder,
  tick,
} from "../engine/engine";
import { getMarketConfig } from "../data/markets";
import {
  backupSimulation,
  clearAllAppData,
  CorruptSaveError,
  DEFAULT_SETTINGS,
  importSimulation,
  loadBackupSimulation,
  loadSettings,
  loadSimulation,
  saveSettings,
  saveSimulation,
} from "./storage";

interface SaveStatus {
  state: "idle" | "saved" | "saving" | "error";
  at: string | null;
  message: string | null;
}

interface LoadError {
  slot: SlotKey;
  message: string;
  backupAvailable: boolean;
}

interface SimulationStore {
  initialized: boolean;
  marketId: MarketId;
  mode: SimMode;
  page: NavPage;
  activeSymbol: string;
  simulations: Partial<Record<SlotKey, SimulationState>>;
  settings: AppSettings;
  saveStatus: SaveStatus;
  loadError: LoadError | null;
  toast: { id: number; message: string; tone: "success" | "error" | "info" } | null;
  initialize: () => void;
  currentSimulation: () => SimulationState;
  setMarket: (marketId: MarketId) => void;
  setMode: (mode: SimMode) => void;
  setPage: (page: NavPage) => void;
  setActiveSymbol: (symbol: string) => void;
  openStock: (symbol: string) => void;
  togglePause: () => void;
  setSpeed: (speed: SimulationState["speed"]) => void;
  tickCurrent: () => void;
  submitDraft: (draft: OrderDraft) => ReturnType<typeof submitOrder>;
  cancelCurrentOrder: (orderId: string) => ReturnType<typeof cancelOrder>;
  closeCurrentDay: () => void;
  nextTradingDay: () => void;
  startCurrentChallenge: (seed: string) => void;
  jumpChallengeToEnd: () => void;
  toggleWatchlist: (symbol: string) => void;
  clearWatchlist: () => void;
  moveWatchlist: (symbol: string, direction: -1 | 1) => void;
  saveCurrent: (reason?: "auto" | "manual" | "important") => boolean;
  updateSettings: (settings: Partial<AppSettings>) => void;
  setExtendedHours: (enabled: boolean) => void;
  markOnboardingDone: () => void;
  setOnboardingStep: (step: number) => void;
  replayOnboarding: () => void;
  importCurrent: (raw: string) => Promise<void>;
  restoreCurrentBackup: () => void;
  resetCurrent: (seed?: string) => void;
  clearEverything: () => void;
  dismissLoadError: () => void;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  clearToast: () => void;
}

function slotOf(marketId: MarketId, mode: SimMode): SlotKey {
  return `${marketId}:${mode}`;
}

function withExtended(
  state: SimulationState,
  settings: AppSettings,
): SimulationState {
  return state.marketId === "us-sim" &&
    state.extendedHours !== settings.extendedHours
    ? applyExtendedHoursSetting(state, settings.extendedHours)
    : state;
}

function loadOrCreate(
  marketId: MarketId,
  mode: SimMode,
  settings: AppSettings,
): {
  state: SimulationState;
  error: LoadError | null;
} {
  try {
    const loaded = loadSimulation(marketId, mode);
    if (loaded) {
      const synchronized = withExtended(loaded, settings);
      return {
        state: { ...synchronized, paused: true },
        error: null,
      };
    }
  } catch (error) {
    const corrupt =
      error instanceof CorruptSaveError
        ? error
        : new CorruptSaveError(
            error instanceof Error ? error.message : "存档读取失败。",
            slotOf(marketId, mode),
            false,
          );
    const fallback = createSimulation(
      getMarketConfig(marketId),
      mode,
      ENGINE_DEFAULT_SEED,
    );
    fallback.paused = true;
    return {
      state: withExtended(fallback, settings),
      error: {
        slot: corrupt.slot,
        message: corrupt.message,
        backupAvailable: corrupt.backupAvailable,
      },
    };
  }
  const created = createSimulation(
    getMarketConfig(marketId),
    mode,
    ENGINE_DEFAULT_SEED,
  );
  created.paused = mode === "challenge";
  return { state: withExtended(created, settings), error: null };
}

function initialSimulation(settings: AppSettings): SimulationState {
  const state = createSimulation(
    getMarketConfig("cn-fic"),
    "sandbox",
    ENGINE_DEFAULT_SEED,
  );
  state.paused = false;
  return withExtended(state, settings);
}

function updateBestChallenge(
  settings: AppSettings,
  state: SimulationState,
): AppSettings {
  if (
    state.mode !== "challenge" ||
    state.challenge.status !== "completed" ||
    !state.challenge.report
  ) {
    return settings;
  }
  const previous = settings.bestChallenges[state.marketId];
  if (
    previous &&
    (previous.score > state.challenge.report.finalScore ||
      (previous.score === state.challenge.report.finalScore &&
        previous.grade <= state.challenge.report.grade))
  ) {
    return settings;
  }
  return {
    ...settings,
    bestChallenges: {
      ...settings.bestChallenges,
      [state.marketId]: {
        grade: state.challenge.report.grade,
        score: state.challenge.report.finalScore,
      },
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误。";
}

export const useSimulationStore = create<SimulationStore>((set, get) => {
  const replaceCurrent = (
    state: SimulationState,
    options: {
      save?: boolean;
      paused?: boolean;
      notify?: {
        message: string;
        tone: "success" | "error" | "info";
      };
      settingsPatch?: Partial<AppSettings>;
    } = {},
  ) => {
    const before = get();
    let nextState = options.paused ? { ...state, paused: true } : state;
    const key = slotOf(nextState.marketId, nextState.mode);
    let settings = updateBestChallenge(
      { ...before.settings, ...(options.settingsPatch ?? {}) },
      nextState,
    );
    let saveStatus = before.saveStatus;
    let toast = options.notify
      ? { id: Date.now(), ...options.notify }
      : undefined;
    if (options.save !== false) {
      const result = saveSimulation(
        nextState.marketId,
        nextState.mode,
        nextState,
      );
      if (!result.ok) {
        nextState = { ...nextState, paused: true };
        saveStatus = {
          state: "error",
          at: null,
          message: result.error ?? "保存失败。",
        };
        toast = {
          id: Date.now(),
          message: `${result.error ?? "保存失败。"} 仿真已暂停，请导出后清理存储空间。`,
          tone: "error",
        };
      } else {
        const savedAt = result.savedAt ?? new Date().toISOString();
        settings = {
          ...settings,
          savedAtBySlot: {
            ...settings.savedAtBySlot,
            [key]: savedAt,
          },
        };
        if (result.bytes > 1_400_000) {
          nextState = { ...nextState, paused: true };
          saveStatus = {
            state: "saved",
            at: savedAt,
            message: "存档接近单槽位 1.5 MB 上限，自动保存已暂停。",
          };
          toast = {
            id: Date.now(),
            message: "存档接近容量上限，请先导出并清理旧记录。",
            tone: "error",
          };
        } else {
          saveStatus = { state: "saved", at: savedAt, message: null };
        }
      }
    }
    set({
      simulations: { ...before.simulations, [key]: nextState },
      settings,
      saveStatus,
      ...(toast ? { toast } : {}),
    });
    if (settings !== before.settings) saveSettings(settings);
  };

  return {
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

    initialize() {
      if (get().initialized) return;
      const settings = loadSettings();
      const initialMarket = settings.lastMarketId ?? "cn-fic";
      const initialMode = settings.lastMode ?? "sandbox";
      const { state, error } = loadOrCreate(
        initialMarket,
        initialMode,
        settings,
      );
      const selectedSymbol =
        state.instruments.find((item) => item.symbol === settings.lastSymbol)
          ?.symbol ??
        state.instruments[0]?.symbol ??
        "";
      set({
        initialized: true,
        settings,
        simulations: { [`${initialMarket}:${initialMode}`]: state },
        marketId: initialMarket,
        mode: initialMode,
        page: settings.lastPage,
        activeSymbol: selectedSymbol,
        loadError: error,
        saveStatus: {
          state: settings.savedAtBySlot[`${initialMarket}:${initialMode}`]
            ? "saved"
            : "idle",
          at:
            settings.savedAtBySlot[`${initialMarket}:${initialMode}`] ?? null,
          message: null,
        },
      });
    },

    currentSimulation() {
      const { marketId, mode, simulations } = get();
      return (
        simulations[slotOf(marketId, mode)] ??
        createSimulation(getMarketConfig(marketId), mode)
      );
    },

    setMarket(marketId) {
      const before = get();
      if (marketId === before.marketId) return;
      const current = before.currentSimulation();
      const paused = { ...current, paused: true };
      const targetMode = before.mode;
      const oldKey = slotOf(current.marketId, current.mode);
      let settings = updateBestChallenge(before.settings, paused);
      let saveStatus = before.saveStatus;
      let toast: SimulationStore["toast"] = null;
      const saveResult = saveSimulation(current.marketId, current.mode, paused);
      if (!saveResult.ok) {
        saveStatus = {
          state: "error",
          at: null,
          message: saveResult.error ?? "保存失败。",
        };
        toast = {
          id: Date.now(),
          message: `${saveResult.error ?? "保存失败。"} 原市场仿真已暂停。`,
          tone: "error",
        };
      } else {
        settings = {
          ...settings,
          savedAtBySlot: {
            ...settings.savedAtBySlot,
            [oldKey]: saveResult.savedAt ?? new Date().toISOString(),
          },
        };
      }
      const { state: loaded, error } = loadOrCreate(
        marketId,
        targetMode,
        settings,
      );
      const nextPage =
        before.page === "stock" || before.page === "trade"
          ? "market"
          : before.page;
      settings = {
        ...settings,
        lastMarketId: marketId,
        lastMode: targetMode,
        lastPage: nextPage,
        lastSymbol: null,
      };
      const targetKey = slotOf(marketId, targetMode);
      if (saveStatus.state !== "error") {
        saveStatus = {
          state: settings.savedAtBySlot[targetKey] ? "saved" : "idle",
          at: settings.savedAtBySlot[targetKey] ?? null,
          message: null,
        };
      }
      set({
        marketId,
        simulations: {
          ...before.simulations,
          [oldKey]: paused,
          [targetKey]: { ...loaded, paused: true },
        },
        activeSymbol: loaded.instruments[0]?.symbol ?? "",
        loadError: error,
        page: nextPage,
        saveStatus,
        settings,
        ...(toast ? { toast } : {}),
      });
      saveSettings(settings);
    },

    setMode(mode) {
      const before = get();
      if (mode === before.mode) return;
      const current = before.currentSimulation();
      const paused = { ...current, paused: true };
      const oldKey = slotOf(current.marketId, current.mode);
      let settings = updateBestChallenge(before.settings, paused);
      let saveStatus = before.saveStatus;
      let toast: SimulationStore["toast"] = null;
      const saveResult = saveSimulation(current.marketId, current.mode, paused);
      if (!saveResult.ok) {
        saveStatus = {
          state: "error",
          at: null,
          message: saveResult.error ?? "保存失败。",
        };
        toast = {
          id: Date.now(),
          message: `${saveResult.error ?? "保存失败。"} 原模式仿真已暂停。`,
          tone: "error",
        };
      } else {
        settings = {
          ...settings,
          savedAtBySlot: {
            ...settings.savedAtBySlot,
            [oldKey]: saveResult.savedAt ?? new Date().toISOString(),
          },
        };
      }
      const { state: loaded, error } = loadOrCreate(
        before.marketId,
        mode,
        settings,
      );
      const nextPage = mode === "challenge" ? "challenge" : "market";
      settings = {
        ...settings,
        lastMarketId: before.marketId,
        lastMode: mode,
        lastPage: nextPage as NavPage,
        lastSymbol: null,
      };
      const targetKey = slotOf(before.marketId, mode);
      if (saveStatus.state !== "error") {
        saveStatus = {
          state: settings.savedAtBySlot[targetKey] ? "saved" : "idle",
          at: settings.savedAtBySlot[targetKey] ?? null,
          message: null,
        };
      }
      set({
        mode,
        simulations: {
          ...before.simulations,
          [oldKey]: paused,
          [targetKey]: { ...loaded, paused: true },
        },
        activeSymbol: loaded.instruments[0]?.symbol ?? "",
        loadError: error,
        page: nextPage,
        saveStatus,
        settings,
        ...(toast ? { toast } : {}),
      });
      saveSettings(settings);
    },

    setPage(page) {
      const current = get();
      const settings = {
        ...current.settings,
        lastPage: page,
        lastMarketId: current.marketId,
        lastMode: current.mode,
        lastSymbol:
          page === "stock" ? current.activeSymbol : current.settings.lastSymbol,
      };
      set({ page, settings });
      saveSettings(settings);
    },

    setActiveSymbol(symbol) {
      const current = get();
      const settings = {
        ...current.settings,
        lastMarketId: current.marketId,
        lastMode: current.mode,
        lastSymbol: symbol,
      };
      set({ activeSymbol: symbol, settings });
      saveSettings(settings);
    },

    openStock(symbol) {
      const current = get();
      const settings = {
        ...current.settings,
        lastPage: "stock" as NavPage,
        lastMarketId: current.marketId,
        lastMode: current.mode,
        lastSymbol: symbol,
      };
      set({ activeSymbol: symbol, page: "stock", settings });
      saveSettings(settings);
    },

    togglePause() {
      const state = get().currentSimulation();
      if (
        state.mode === "challenge" &&
        state.challenge.status === "not_started"
      ) {
        get().notify("请先在挑战页开始挑战。", "info");
        return;
      }
      if (
        state.mode === "challenge" &&
        state.challenge.status === "completed"
      ) {
        get().notify("挑战已结束，存档处于只读复盘状态。", "info");
        return;
      }
      if (state.paused && state.lastCloseSummary) {
        get().notify("当日已收盘，请点击“进入下一交易日”。", "info");
        return;
      }
      const next = { ...state, paused: !state.paused };
      replaceCurrent(next);
    },

    setSpeed(speed) {
      const state = get().currentSimulation();
      if (state.speed === speed) return;
      replaceCurrent({ ...state, speed }, { save: true });
    },

    tickCurrent() {
      const before = get();
      const current = before.currentSimulation();
      if (current.paused) return;
      let next = tick(current, current.speed);
      if (
        next.paused &&
        next.lastCloseSummary &&
        get().settings.autoNextDay &&
        !(next.mode === "challenge" && next.challenge.status === "completed")
      ) {
        next = advanceTradingDay(next);
      }
      const previousSavedAt = before.saveStatus.at
        ? Date.parse(before.saveStatus.at)
        : 0;
      const shouldAutoSave =
        !Number.isFinite(previousSavedAt) ||
        Date.now() - previousSavedAt >= 5000;
      replaceCurrent(next, {
        save: Boolean(shouldAutoSave || next.lastCloseSummary || next.paused),
      });
    },

    submitDraft(draft) {
      const state = get().currentSimulation();
      const result = submitOrder(state, draft);
      replaceCurrent(result.state, {
        save: true,
        notify: {
          message: result.message,
          tone: !result.ok
            ? "error"
            : result.duplicate
              ? "info"
              : "success",
        },
      });
      return result;
    },

    cancelCurrentOrder(orderId) {
      const state = get().currentSimulation();
      const result = cancelOrder(state, orderId);
      replaceCurrent(result.state, {
        save: true,
        notify: {
          message: result.message,
          tone: result.ok ? "success" : "error",
        },
      });
      return result;
    },

    closeCurrentDay() {
      const state = get().currentSimulation();
      if (!state.lastCloseSummary) {
        get().notify("尚未到达收盘时间，无法结算交易日。", "info");
        return;
      }
      replaceCurrent(state, { save: true });
    },

    nextTradingDay() {
      const state = get().currentSimulation();
      if (!state.lastCloseSummary) {
        get().notify("当日尚未收盘，不能进入下一交易日。", "error");
        return;
      }
      if (state.mode === "challenge" && state.challenge.status === "completed") {
        get().notify("挑战已结束，请开始新一轮挑战。", "info");
        return;
      }
      const next = advanceTradingDay(state);
      replaceCurrent(next, {
        save: true,
        notify: { message: "已进入下一模拟交易日。", tone: "success" },
      });
    },

    startCurrentChallenge(seed) {
      const state = get().currentSimulation();
      if (state.mode !== "challenge") return;
      backupSimulation(state.marketId, "challenge");
      const next = startChallenge(state, seed);
      replaceCurrent(next, {
        save: true,
        notify: { message: "新的 30 交易日挑战已开始。", tone: "success" },
      });
    },

    jumpChallengeToEnd() {
      let state = get().currentSimulation();
      if (state.mode !== "challenge" || state.challenge.status === "not_started") {
        get().notify("请先开始挑战。", "info");
        return;
      }
      if (state.challenge.status === "completed") return;
      backupSimulation(state.marketId, "challenge");
      let guard = 0;
      while (state.challenge.status === "running" && guard < 500) {
        state = tick({ ...state, paused: false }, 32);
        if (state.lastCloseSummary) {
          state = advanceTradingDay(state);
        }
        guard += 1;
      }
      state = { ...state, paused: true };
      replaceCurrent(state, {
        save: true,
        notify: {
          message: "挑战已快速推进至第 30 个交易日收盘。",
          tone: "success",
        },
      });
    },

    toggleWatchlist(symbol) {
      const state = get().currentSimulation();
      const exists = state.watchlist.includes(symbol);
      const watchlist = exists
        ? state.watchlist.filter((item) => item !== symbol)
        : [...state.watchlist, symbol];
      replaceCurrent(
        { ...state, watchlist },
        {
          save: true,
          notify: {
            message: exists ? "已移出自选。" : "已加入自选。",
            tone: "success",
          },
        },
      );
    },

    clearWatchlist() {
      const state = get().currentSimulation();
      replaceCurrent(
        { ...state, watchlist: [] },
        {
          save: true,
          notify: { message: "自选列表已清空。", tone: "success" },
        },
      );
    },

    moveWatchlist(symbol, direction) {
      const state = get().currentSimulation();
      const watchlist = [...state.watchlist];
      const index = watchlist.indexOf(symbol);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= watchlist.length) return;
      [watchlist[index], watchlist[target]] = [
        watchlist[target],
        watchlist[index],
      ];
      replaceCurrent({ ...state, watchlist }, { save: true });
    },

    saveCurrent() {
      const before = get();
      const state = before.currentSimulation();
      const result = saveSimulation(state.marketId, state.mode, state);
      if (!result.ok) {
        const key = slotOf(state.marketId, state.mode);
        set({
          simulations: {
            ...before.simulations,
            [key]: { ...state, paused: true },
          },
          saveStatus: {
            state: "error",
            at: null,
            message: result.error ?? "保存失败。",
          },
          toast: {
            id: Date.now(),
            message: `${result.error ?? "保存失败。"} 仿真已暂停。`,
            tone: "error",
          },
        });
        return false;
      }
      const latestSettings = {
        ...before.settings,
        savedAtBySlot: {
          ...before.settings.savedAtBySlot,
          [slotOf(state.marketId, state.mode)]:
            result.savedAt ?? new Date().toISOString(),
        },
      };
      if (result.bytes > 1_400_000) {
        const key = slotOf(state.marketId, state.mode);
        set({
          simulations: {
            ...before.simulations,
            [key]: { ...state, paused: true },
          },
          saveStatus: {
            state: "saved",
            at: result.savedAt,
            message: "存档接近单槽位 1.5 MB 上限，自动保存已暂停。",
          },
          toast: {
            id: Date.now(),
            message: "存档接近容量上限，请先导出并清理旧记录。",
            tone: "error",
          },
          settings: latestSettings,
        });
        saveSettings(latestSettings);
        return false;
      }
      set({
        saveStatus: { state: "saved", at: result.savedAt, message: null },
        settings: latestSettings,
      });
      saveSettings(latestSettings);
      return true;
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      saveSettings(settings);
    },

    setExtendedHours(enabled) {
      const state = get().currentSimulation();
      if (state.marketId === "us-sim") {
        const adjusted = applyExtendedHoursSetting(state, enabled);
        replaceCurrent(
          { ...adjusted, paused: true },
          {
            save: true,
            settingsPatch: { extendedHours: enabled },
            notify: {
              message: enabled
                ? "美股盘前盘后已启用，仿真已暂停。"
                : "美股盘前盘后已关闭，仿真已暂停。",
              tone: "info",
            },
          },
        );
        return;
      }
      const settings = { ...get().settings, extendedHours: enabled };
      set({ settings });
      saveSettings(settings);
    },

    markOnboardingDone() {
      const settings = {
        ...get().settings,
        onboardingDone: true,
        onboardingStep: 0,
      };
      set({ settings });
      saveSettings(settings);
    },

    setOnboardingStep(step) {
      const settings = {
        ...get().settings,
        onboardingStep: Math.min(4, Math.max(0, Math.floor(step))),
      };
      set({ settings });
      saveSettings(settings);
    },

    replayOnboarding() {
      const settings = {
        ...get().settings,
        onboardingDone: false,
        onboardingStep: 0,
      };
      set({ settings });
      saveSettings(settings);
    },

    async importCurrent(raw) {
      const state = get().currentSimulation();
      backupSimulation(state.marketId, state.mode);
      const imported = importSimulation(raw, {
        marketId: state.marketId,
        mode: state.mode,
      });
      imported.paused = true;
      replaceCurrent(imported, {
        save: true,
        notify: { message: "存档导入成功，账户世代已更新。", tone: "success" },
      });
    },

    restoreCurrentBackup() {
      const state = get().currentSimulation();
      try {
        const backup = loadBackupSimulation(state.marketId, state.mode);
        if (!backup) throw new Error("当前槽位没有可用备份。");
        const next = refreshGeneration(backup);
        next.paused = true;
        replaceCurrent(next, {
          save: true,
          notify: { message: "已从最近备份恢复账户。", tone: "success" },
        });
        set({ loadError: null });
      } catch (error) {
        get().notify(errorMessage(error), "error");
      }
    },

    resetCurrent(seed = ENGINE_DEFAULT_SEED) {
      const state = get().currentSimulation();
      backupSimulation(state.marketId, state.mode);
      const next = createSimulation(
        getMarketConfig(state.marketId),
        state.mode,
        seed,
      );
      next.extendedHours =
        state.marketId === "us-sim" ? get().settings.extendedHours : false;
      next.paused = state.mode === "challenge";
      replaceCurrent(refreshGeneration(next), {
        save: true,
        notify: {
          message: "当前市场与模式已重置，原存档已备份。",
          tone: "success",
        },
      });
    },

    clearEverything() {
      clearAllAppData();
      const settings = { ...DEFAULT_SETTINGS };
      const fresh = initialSimulation(settings);
      saveSettings(settings);
      set({
        settings,
        simulations: { "cn-fic:sandbox": fresh },
        marketId: "cn-fic",
        mode: "sandbox",
        page: "market",
        activeSymbol: "600101",
        loadError: null,
        saveStatus: {
          state: "idle",
          at: null,
          message: "全部数据已清除",
        },
        toast: {
          id: Date.now(),
          message: "全部本地数据已清除并重建为初始状态。",
          tone: "success",
        },
      });
    },

    dismissLoadError() {
      set({ loadError: null });
    },

    notify(message, tone = "info") {
      set({ toast: { id: Date.now(), message, tone } });
    },

    clearToast() {
      set({ toast: null });
    },
  };
});

export function useCurrentSimulationView<T>(
  selector: (simulation: SimulationState | undefined) => T,
): T {
  const marketId = useSimulationStore((state) => state.marketId);
  const mode = useSimulationStore((state) => state.mode);
  return useSimulationStore(
    useShallow((state) => selector(state.simulations[`${marketId}:${mode}`])),
  );
}
