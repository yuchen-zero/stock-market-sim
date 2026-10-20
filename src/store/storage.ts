import type {
  AppSettings,
  ExportEnvelope,
  MarketId,
  SaveResult,
  SimMode,
  SimulationState,
  SlotKey,
} from "../types/domain";
import {
  refreshGeneration,
  serializeSimulation,
  validateAndMigrate,
} from "../engine/engine";

export const STORAGE_PREFIX = "stock-sim:v1";
export const SETTINGS_KEY = `${STORAGE_PREFIX}:settings`;
export const SLOT_LIMIT_BYTES = 1_500_000;

export const DEFAULT_SETTINGS: AppSettings = {
  autoNextDay: false,
  extendedHours: false,
  pauseWhenHidden: true,
  onboardingDone: false,
  onboardingStep: 0,
  lastPage: "market",
  lastMarketId: "cn-fic",
  lastMode: "sandbox",
  lastSymbol: null,
  savedAtBySlot: {},
  bestChallenges: {
    "cn-fic": null,
    "cn-real-demo": null,
    "us-sim": null,
  },
};

export class CorruptSaveError extends Error {
  constructor(
    message: string,
    public readonly slot: SlotKey,
    public readonly backupAvailable: boolean,
  ) {
    super(message);
    this.name = "CorruptSaveError";
  }
}

export function slotKey(marketId: MarketId, mode: SimMode): string {
  return `${STORAGE_PREFIX}:${marketId}:${mode}`;
}

export function slotLabel(slot: SlotKey): string {
  return `${STORAGE_PREFIX}:${slot.replace(":", ":")}`;
}

export function parseSlotKey(value: string): SlotKey | null {
  if (!value.includes(":")) return null;
  const [marketId, mode] = value.split(":") as [MarketId, SimMode];
  if (
    !["cn-fic", "cn-real-demo", "us-sim"].includes(marketId) ||
    !["sandbox", "challenge"].includes(mode)
  ) {
    return null;
  }
  return `${marketId}:${mode}`;
}

function safeStorage(storage?: Storage): Storage {
  if (storage) return storage;
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("当前环境不支持 localStorage。");
  }
  return window.localStorage;
}

function snapshotBytes(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return value.length * 2;
}

export function saveSimulation(
  marketId: MarketId,
  mode: SimMode,
  state: SimulationState,
  storage?: Storage,
): SaveResult {
  const store = safeStorage(storage);
  const key = slotKey(marketId, mode);
  const tempKey = `${key}:tmp`;
  const value = serializeSimulation(state);
  const bytes = snapshotBytes(value);
  const savedAt = new Date().toISOString();
  try {
    const previous = store.getItem(key);
    if (previous) {
      try {
        const parsedPrevious = JSON.parse(previous) as {
          schemaVersion?: number;
          marketId?: string;
          mode?: string;
        };
        if (
          parsedPrevious.schemaVersion === 1 &&
          parsedPrevious.marketId === marketId &&
          parsedPrevious.mode === mode
        ) {
          store.setItem(`${key}:backup`, previous);
        }
      } catch {
        // Never replace a known-good backup with a corrupt source value.
      }
    }
    store.setItem(tempKey, value);
    JSON.parse(store.getItem(tempKey) ?? "");
    store.setItem(key, value);
    store.removeItem(tempKey);
    return { ok: true, savedAt, bytes };
  } catch (error) {
    try {
      store.removeItem(tempKey);
    } catch {
      // A failed cleanup must not hide the original quota or storage error.
    }
    return {
      ok: false,
      savedAt: null,
      bytes,
      error:
        error instanceof Error
          ? `${error.name === "QuotaExceededError" ? "本地存储空间不足" : "保存失败"}：${error.message}`
          : "保存失败。",
    };
  }
}

export function loadSimulation(
  marketId: MarketId,
  mode: SimMode,
  storage?: Storage,
): SimulationState | null {
  const store = safeStorage(storage);
  const key = slotKey(marketId, mode);
  const raw = store.getItem(key);
  if (!raw) return null;
  try {
    return validateAndMigrate(raw, { marketId, mode });
  } catch (error) {
    let backupAvailable = false;
    const backupRaw = store.getItem(`${key}:backup`);
    if (backupRaw) {
      try {
        validateAndMigrate(backupRaw, { marketId, mode });
        backupAvailable = true;
      } catch {
        backupAvailable = false;
      }
    }
    try {
      store.setItem(`${key}:corrupt`, raw);
    } catch {
      // The application still presents the validation error and a safe reset path.
    }
    throw new CorruptSaveError(
      error instanceof Error ? error.message : "存档损坏。",
      `${marketId}:${mode}`,
      backupAvailable,
    );
  }
}

export function backupSimulation(
  marketId: MarketId,
  mode: SimMode,
  storage?: Storage,
): boolean {
  try {
    const store = safeStorage(storage);
    const raw = store.getItem(slotKey(marketId, mode));
    if (!raw) return false;
    store.setItem(`${slotKey(marketId, mode)}:backup`, raw);
    return true;
  } catch {
    return false;
  }
}

export function loadBackupSimulation(
  marketId: MarketId,
  mode: SimMode,
  storage?: Storage,
): SimulationState | null {
  const store = safeStorage(storage);
  const raw = store.getItem(`${slotKey(marketId, mode)}:backup`);
  if (!raw) return null;
  return validateAndMigrate(raw, { marketId, mode });
}

export function exportSimulation(state: SimulationState): ExportEnvelope {
  return {
    app: "stock-market-sim",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    marketId: state.marketId,
    mode: state.mode,
    seed: state.seed,
    challenge: state.challenge,
    simulation: JSON.parse(serializeSimulation(state)) as unknown,
  };
}

export function exportFilename(state: SimulationState): string {
  return `stock-sim-${state.marketId}-${state.mode}-${state.simulatedDate}.json`;
}

export function importSimulation(
  raw: string,
  expected: { marketId: MarketId; mode: SimMode },
): SimulationState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("导入文件不是有效的 JSON。");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("导入文件根结构无效。");
  }
  const envelope = parsed as Partial<ExportEnvelope>;
  if (envelope.app !== "stock-market-sim" || envelope.schemaVersion !== 1) {
    throw new Error("导入文件不是受支持的模拟证券存档。");
  }
  if (
    envelope.marketId !== expected.marketId ||
    envelope.mode !== expected.mode
  ) {
    throw new Error("导入文件的市场或模式与当前槽位不一致。");
  }
  const state = validateAndMigrate(envelope.simulation, expected);
  if (state.seed !== envelope.seed) {
    throw new Error("导入文件的种子与仿真状态不一致。");
  }
  return refreshGeneration(state);
}

export function loadSettings(storage?: Storage): AppSettings {
  try {
    const raw = safeStorage(storage).getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      bestChallenges: {
        ...DEFAULT_SETTINGS.bestChallenges,
        ...(parsed.bestChallenges ?? {}),
      },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: AppSettings,
  storage?: Storage,
): boolean {
  try {
    safeStorage(storage).setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function listSavedSlots(storage?: Storage): SlotKey[] {
  const store = safeStorage(storage);
  const slots: SlotKey[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(`${STORAGE_PREFIX}:`) || key === SETTINGS_KEY) continue;
    if (key.endsWith(":tmp") || key.endsWith(":backup")) continue;
    const slot = parseSlotKey(
      key.slice(`${STORAGE_PREFIX}:`.length),
    );
    if (slot) slots.push(slot);
  }
  return slots;
}

export function clearAllAppData(storage?: Storage): void {
  const store = safeStorage(storage);
  const keys: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(`${STORAGE_PREFIX}:`)) keys.push(key);
  }
  keys.forEach((key) => store.removeItem(key));
}

export function estimateTotalBytes(storage?: Storage): number {
  const store = safeStorage(storage);
  let total = 0;
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(`${STORAGE_PREFIX}:`)) continue;
    total += key.length + (store.getItem(key)?.length ?? 0);
  }
  return total * 2;
}
