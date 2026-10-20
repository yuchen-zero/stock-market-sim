import { beforeEach, describe, expect, it } from "vitest";
import { createSimulation } from "../engine/engine";
import { getMarketConfig } from "../data/markets";
import type { MarketId, SimMode } from "../types/domain";
import {
  CorruptSaveError,
  exportSimulation,
  importSimulation,
  loadBackupSimulation,
  loadSettings,
  loadSimulation,
  saveSettings,
  saveSimulation,
  SETTINGS_KEY,
  slotKey,
  DEFAULT_SETTINGS,
} from "../store/storage";
import { createSimulation as createCn } from "../engine/engine";

function state(marketId: MarketId, mode: SimMode, seed: string) {
  return createSimulation(getMarketConfig(marketId), mode, seed);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("simulation persistence", () => {
  it("keeps all six market × mode slots independent", () => {
    const markets: MarketId[] = ["cn-fic", "cn-real-demo", "us-sim"];
    const modes: SimMode[] = ["sandbox", "challenge"];
    markets.forEach((marketId, marketIndex) => {
      modes.forEach((mode, modeIndex) => {
        const simulation = state(marketId, mode, `SEED-${marketIndex}-${modeIndex}`);
        simulation.watchlist = [simulation.instruments[modeIndex].symbol];
        const result = saveSimulation(marketId, mode, simulation);
        expect(result.ok).toBe(true);
      });
    });
    markets.forEach((marketId, marketIndex) => {
      modes.forEach((mode, modeIndex) => {
        const loaded = loadSimulation(marketId, mode);
        expect(loaded?.seed).toBe(`SEED-${marketIndex}-${modeIndex}`);
        expect(loaded?.watchlist).toHaveLength(1);
        expect(window.localStorage.getItem(slotKey(marketId, mode))).not.toContain(
          '"dailyCandles"',
        );
      });
    });
    markets.forEach((marketId) => {
      modes.forEach((mode) => {
        const raw = window.localStorage.getItem(slotKey(marketId, mode)) ?? "";
        expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(1_500_000);
      });
    });
  });

  it("preserves a valid backup when the current save is corrupted", () => {
    const first = state("cn-fic", "sandbox", "BACKUP-A");
    const second = createCn(
      getMarketConfig("cn-fic"),
      "sandbox",
      "BACKUP-B",
    );
    saveSimulation("cn-fic", "sandbox", first);
    saveSimulation("cn-fic", "sandbox", second);
    window.localStorage.setItem(
      slotKey("cn-fic", "sandbox"),
      "{ broken-json",
    );
    expect(() => loadSimulation("cn-fic", "sandbox")).toThrow(CorruptSaveError);
    try {
      loadSimulation("cn-fic", "sandbox");
    } catch (error) {
      expect(error).toBeInstanceOf(CorruptSaveError);
      expect((error as CorruptSaveError).backupAvailable).toBe(true);
    }
    const backup = loadBackupSimulation("cn-fic", "sandbox");
    expect(backup?.seed).toBe("BACKUP-A");
  });

  it("exports and imports a complete state with a new account generation", () => {
    const source = state("cn-fic", "sandbox", "EXPORT");
    source.watchlist = ["600101", "600201"];
    const envelope = exportSimulation(source);
    const restored = importSimulation(
      JSON.stringify(envelope),
      { marketId: "cn-fic", mode: "sandbox" },
    );
    expect(restored.seed).toBe(source.seed);
    expect(restored.portfolio.cash).toBe(source.portfolio.cash);
    expect(restored.watchlist).toEqual(source.watchlist);
    expect(restored.portfolio.generation).not.toBe(
      source.portfolio.generation,
    );
    expect(restored.portfolio.accountVersion).toBeGreaterThan(
      source.portfolio.accountVersion,
    );
  });

  it("rejects imports from another market or mode", () => {
    const source = state("us-sim", "sandbox", "WRONG-MARKET");
    const raw = JSON.stringify(exportSimulation(source));
    expect(() =>
      importSimulation(raw, { marketId: "cn-fic", mode: "sandbox" }),
    ).toThrow(/市场或模式/);
  });

  it("loads settings independently from simulation slots", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      autoNextDay: true,
      onboardingDone: true,
      bestChallenges: {
        ...DEFAULT_SETTINGS.bestChallenges,
        "cn-fic": { grade: "A", score: 81 },
      },
    };
    expect(saveSettings(settings)).toBe(true);
    expect(loadSettings()).toMatchObject({
      autoNextDay: true,
      onboardingDone: true,
    });
    expect(loadSettings().bestChallenges["cn-fic"]).toEqual({
      grade: "A",
      score: 81,
    });
    expect(window.localStorage.getItem(SETTINGS_KEY)).not.toBeNull();
  });

  it("returns a concrete error when storage quota is exhausted", () => {
    const fake = {
      length: 0,
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      },
    } satisfies Storage;
    const result = saveSimulation(
      "cn-fic",
      "sandbox",
      state("cn-fic", "sandbox", "QUOTA"),
      fake,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("本地存储空间不足");
  });
});
