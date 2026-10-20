import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import {
  createSimulation,
  serializeSimulation,
  startChallenge,
  submitOrder,
  tick,
} from "../src/engine/engine";
import { getMarketConfig } from "../src/data/markets";
import { dateToEpochSec } from "../src/engine/time";
import type {
  MarketId,
  NavPage,
  SimulationState,
} from "../src/types/domain";

const DEFAULT_ACCOUNT = {
  autoNextDay: false,
  extendedHours: false,
  pauseWhenHidden: true,
  onboardingDone: true,
  onboardingStep: 0,
  lastPage: "market" as NavPage,
  lastMarketId: "cn-fic" as MarketId,
  lastMode: "sandbox" as const,
  lastSymbol: null as string | null,
  savedAtBySlot: {},
  bestChallenges: {
    "cn-fic": null,
    "cn-real-demo": null,
    "us-sim": null,
  },
};

function atMinute(
  marketId: MarketId,
  targetMinute: number,
  seed = `E2E-${marketId}`,
): SimulationState {
  let state = createSimulation(getMarketConfig(marketId), "sandbox", seed);
  let guard = 0;
  while (state.minuteOfDay < targetMinute && !state.paused && guard < 20) {
    state = tick(
      { ...state, paused: false },
      Math.min(32, targetMinute - state.minuteOfDay),
    );
    guard += 1;
  }
  return { ...state, paused: true };
}

function syncQuoteTime(state: SimulationState): void {
  Object.values(state.quotes).forEach((quote) => {
    quote.asOfSec = dateToEpochSec(state.simulatedDate, state.minuteOfDay);
    quote.bookSeq = state.bookSeqCounter;
  });
}

async function seedPage(
  page: Page,
  state: SimulationState,
  options: {
    lastPage: NavPage;
    lastSymbol: string;
    extendedHours?: boolean;
  },
): Promise<void> {
  const snapshot = serializeSimulation(state);
  const slot = `${state.marketId}:${state.mode}`;
  const settings = {
    ...DEFAULT_ACCOUNT,
    extendedHours: options.extendedHours ?? state.extendedHours,
    lastPage: options.lastPage,
    lastMarketId: state.marketId,
    lastMode: state.mode,
    lastSymbol: options.lastSymbol,
    savedAtBySlot: {
      [slot]: new Date().toISOString(),
    },
  };
  await page.addInitScript(
    ({ raw, stateSettings, slotKey }) => {
      if (sessionStorage.getItem("__stockSimE2ESeed") === "1") return;
      localStorage.clear();
      localStorage.setItem("stock-sim:v1:settings", JSON.stringify(stateSettings));
      localStorage.setItem(`stock-sim:v1:${slotKey}`, raw);
      sessionStorage.setItem("__stockSimE2ESeed", "1");
    },
    { raw: snapshot, stateSettings: settings, slotKey: slot },
  );
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.locator(".topbar")).toBeVisible();
}

async function continueSimulation(page: Page): Promise<void> {
  const continueButton = page.getByRole("button", { name: "继续", exact: true });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
}

async function setOrderType(page: Page, type: "限价单" | "市价单") {
  await page
    .getByRole("group", { name: "委托类型" })
    .getByRole("button", { name: type, exact: true })
    .click();
}

async function submitTicket(page: Page, side: "买入" | "卖出") {
  await page
    .getByRole("button", {
      name: new RegExp(`预览并提交${side}委托`),
    })
    .click();
  await page.getByRole("button", { name: "确认委托" }).click();
}

function pendingAuctionState(): SimulationState {
  const state = createSimulation(
    getMarketConfig("cn-fic"),
    "sandbox",
    "E2E-AUCTION-CANCEL",
  );
  const quote = state.quotes["600101"];
  const pending = submitOrder(state, {
    clientOrderId: "e2e-auction-cancel",
    symbol: "600101",
    side: "buy",
    type: "limit",
    limitPrice: quote.last,
    quantity: 100,
  });
  if (!pending.ok) throw new Error(pending.message);
  const prepared = {
    ...pending.state,
    minuteOfDay: 561,
    paused: true,
    lastCloseSummary: null,
  };
  syncQuoteTime(prepared);
  return prepared;
}

function pendingClosingState(): SimulationState {
  const base = atMinute("cn-fic", 590, "E2E-CLOSE-CANCEL");
  const quote = base.quotes["600101"];
  const pending = submitOrder(
    { ...base, paused: false },
    {
      clientOrderId: "e2e-close-cancel",
      symbol: "600101",
      side: "buy",
      type: "limit",
      limitPrice: Math.max(0.01, quote.last - 1),
      quantity: 100,
    },
  );
  if (!pending.ok) throw new Error(pending.message);
  const prepared = {
    ...pending.state,
    minuteOfDay: 898,
    paused: true,
    lastCloseSummary: null,
  };
  syncQuoteTime(prepared);
  return prepared;
}

test.describe("strict browser acceptance", () => {
  test("opens the market directly, supports watchlist, and shows real-name notices", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:4173/");
    await page.getByRole("button", { name: "跳过引导" }).click();
    await expect(
      page.getByRole("heading", { name: "行情总览" }),
    ).toBeVisible();
    await expect(page.locator(".market-select select")).toHaveValue("cn-fic");
    const firstRow = page.locator(".market-table tbody tr").first();
    const firstName = await firstRow.locator(".stock-name").innerText();
    await firstRow.hover();
    await page
      .getByRole("button", { name: `将 ${firstName} 加入自选` })
      .click();
    await page
      .locator(".side-nav")
      .getByRole("button", { name: "自选", exact: true })
      .click();
    await expect(page.locator(".market-table tbody tr")).toHaveCount(1);

    await page.locator(".market-select select").selectOption("cn-real-demo");
    await expect(page.locator(".real-name-disclaimer")).toContainText(
      "真实公司名称仅用于界面演示",
    );
    await page
      .locator(".side-nav")
      .getByRole("button", { name: "资讯", exact: true })
      .click();
    await expect(
      page.locator(".news-sentiment.positive, .news-sentiment.negative"),
    ).toHaveCount(0);
  });

  test("refuses cancellation during 09:20–09:25", async ({ page }) => {
    await seedPage(page, pendingAuctionState(), {
      lastPage: "orders",
      lastSymbol: "600101",
    });
    await page.getByRole("button", { name: "撤单", exact: true }).click();
    await expect(page.locator(".toast")).toContainText(
      "当前集合竞价禁撤单窗口内，无法撤销委托。",
    );
  });

  test("refuses cancellation during 14:57–15:00", async ({ page }) => {
    await seedPage(page, pendingClosingState(), {
      lastPage: "orders",
      lastSymbol: "600101",
    });
    await page.getByRole("button", { name: "撤单", exact: true }).click();
    await expect(page.locator(".toast")).toContainText(
      "当前集合竞价禁撤单窗口内，无法撤销委托。",
    );
  });

  test("enforces STAR 688981 minimum 200 shares and 1-share increments", async ({
    page,
  }) => {
    const state = atMinute("cn-real-demo", 571, "E2E-STAR");
    await seedPage(page, state, {
      lastPage: "trade",
      lastSymbol: "688981",
    });
    await continueSimulation(page);
    await setOrderType(page, "市价单");
    const quantity = page.getByLabel("委托数量");
    await quantity.fill("199");
    await submitTicket(page, "买入");
    await expect(page.locator(".toast")).toContainText(
      "科创板每笔申报最低 200 股",
    );
    await quantity.fill("201");
    await submitTicket(page, "买入");
    await expect(page.locator(".toast")).toContainText(
      /委托已全部成交|市价委托部分成交/,
    );
  });

  test("reports insufficient cash and T+1 sellable restrictions", async ({
    page,
  }) => {
    const state = atMinute("cn-fic", 571, "E2E-T1");
    await seedPage(page, state, {
      lastPage: "trade",
      lastSymbol: "600101",
    });
    await continueSimulation(page);
    await setOrderType(page, "市价单");
    await page.getByLabel("委托数量").fill("1000000");
    await submitTicket(page, "买入");
    await expect(page.locator(".toast")).toContainText("还差");
    await expect(page.locator(".toast")).toContainText("可用资金");

    await page.getByLabel("委托数量").fill("100");
    await submitTicket(page, "买入");
    await expect(page.locator(".toast")).toContainText("委托已全部成交。");
    await page
      .getByRole("group", { name: "买卖方向" })
      .getByRole("button", { name: "卖出", exact: true })
      .click();
    await submitTicket(page, "卖出");
    await expect(page.locator(".toast")).toContainText("可卖数量不足");
  });

  test("supports US T+0 with a one-share order", async ({
    page,
  }) => {
    const regular = atMinute("us-sim", 571, "E2E-US-T0");
    await seedPage(page, regular, {
      lastPage: "trade",
      lastSymbol: "NVGR",
    });
    await continueSimulation(page);
    await setOrderType(page, "市价单");
    await expect(page.getByLabel("委托数量")).toHaveValue("1");
    await submitTicket(page, "买入");
    await expect(page.locator(".toast")).toContainText("委托已全部成交。");
    await page
      .getByRole("group", { name: "买卖方向" })
      .getByRole("button", { name: "卖出", exact: true })
      .click();
    await submitTicket(page, "卖出");
    await expect(page.locator(".toast")).toContainText("委托已全部成交。");
    await page.getByRole("button", { name: "查看个股详情" }).click();
    await expect(page.locator(".chart-meta")).toContainText(
      "该市场无每日涨跌停",
    );
    await expect(page.locator(".lot-hint")).toContainText("1 股起");
  });

  test("rejects US extended-hours market orders but accepts limit orders", async ({
    page,
  }) => {
    const base = createSimulation(
      getMarketConfig("us-sim"),
      "sandbox",
      "E2E-US-EXTENDED",
    );
    const premarket = {
      ...base,
      minuteOfDay: 480,
      extendedHours: true,
      paused: true,
      lastCloseSummary: null,
    };
    syncQuoteTime(premarket);
    await seedPage(page, premarket, {
      lastPage: "trade",
      lastSymbol: "NVGR",
      extendedHours: true,
    });
    await continueSimulation(page);
    await setOrderType(page, "市价单");
    await submitTicket(page, "买入");
    await expect(page.locator(".toast")).toContainText(
      "盘前盘后仅支持限价委托，请选择限价单。",
    );
    await setOrderType(page, "限价单");
    await submitTicket(page, "买入");
    await expect(page.locator(".toast")).toContainText(
      /限价委托已提交|委托已全部成交/,
    );
  });

  test("refreshes, exports, resets, imports and rejects an old generation", async ({
    page,
  }, testInfo) => {
    const state = {
      ...atMinute("us-sim", 571, "E2E-REFRESH"),
      paused: true,
    };
    await seedPage(page, state, {
      lastPage: "settings",
      lastSymbol: "NVGR",
    });
    await expect(page.getByRole("heading", { name: "设置与存档" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".market-select select")).toHaveValue("us-sim");
    await expect(
      page
        .getByRole("group", { name: "交易模式" })
        .locator('[aria-pressed="true"]'),
    ).toHaveText("自由沙盒");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出当前存档" }).click();
    const download = await downloadPromise;
    const archivePath = testInfo.outputPath("stock-sim-e2e-export.json");
    await download.saveAs(archivePath);
    const envelope = JSON.parse(fs.readFileSync(archivePath, "utf8")) as {
      seed: string;
      simulation: unknown;
    };
    expect(envelope.seed).toBe("E2E-REFRESH");
    expect(envelope.simulation).toBeTruthy();

    await page.getByRole("button", { name: "重置当前槽位" }).click();
    await page.getByRole("button", { name: "确认重置" }).click();
    await expect(page.locator(".toast")).toContainText("已重置");
    await page.locator('input[type="file"]').setInputFiles(archivePath);
    await expect(page.locator(".import-message")).toContainText("导入成功");
    await expect(page.getByText("E2E-REFRESH", { exact: false }).first()).toBeVisible();

    const result = await page.evaluate(async () => {
      const module = await import(
        /* @vite-ignore */ "/src/store/useSimulationStore.ts"
      );
      const store = module.useSimulationStore.getState();
      const simulation = store.currentSimulation();
      const instrument = simulation.instruments[0];
      const quote = simulation.quotes[instrument.symbol];
      const draft = {
        clientOrderId: `stale-${Date.now()}`,
        symbol: instrument.symbol,
        side: "buy",
        type: "limit",
        limitPrice: quote.askLevels[0].price,
        quantity: 100,
        generation: "old-generation",
        accountVersion: simulation.portfolio.accountVersion,
      };
      const orderResult = store.submitDraft(draft);
      return { code: orderResult.code, message: orderResult.message };
    });
    expect(result.code).toBe("GENERATION_CHANGED");
    await expect(page.locator(".toast")).toContainText("旧页面请求已失效");
  });

  test("renders the 30-day challenge report with insights and coverage", async ({
    page,
  }) => {
    const challenge = startChallenge(
      createSimulation(
        getMarketConfig("cn-fic"),
        "challenge",
        "E2E-CHALLENGE",
      ),
      "E2E-CHALLENGE",
    );
    await seedPage(page, { ...challenge, paused: true }, {
      lastPage: "challenge",
      lastSymbol: "600101",
    });
    await page
      .getByRole("button", { name: /测试加速：推进至第 30 日收盘/ })
      .click();
    await page.getByRole("button", { name: "开始测试加速" }).click();
    await expect(page.locator(".report-detail-panel")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".grade-display .grade")).toHaveText(
      /^(S|A|B|C|D)$/,
    );
    const insights = await page.locator(".insight-list li").count();
    expect(insights).toBeGreaterThanOrEqual(2);
    expect(insights).toBeLessThanOrEqual(4);
    await expect(
      page.getByText("交易理由覆盖率", { exact: true }),
    ).toBeVisible();
    expect(
      await page.locator(".challenge-metric-card .term-button").count(),
    ).toBeGreaterThanOrEqual(4);
  });

  test("exposes terminology entries for KPIs and chart indicators", async ({
    page,
  }) => {
    const state = atMinute("cn-fic", 571, "E2E-TERMS");
    await seedPage(page, state, {
      lastPage: "market",
      lastSymbol: "600101",
    });
    expect(await page.locator(".index-card .term-button").count()).toBeGreaterThanOrEqual(3);
    for (const term of [
      "证券代码",
      "证券名称",
      "现价",
      "涨跌幅",
      "涨跌额",
      "成交量",
      "成交额",
      "换手率",
      "市盈率",
      "总市值",
    ]) {
      await expect(
        page.getByRole("button", {
          name: `查看“${term}”术语解释`,
        }).first(),
      ).toBeVisible();
    }
    await page.locator(".market-table tbody tr").first().click();
    await expect(page.locator(".price-chart")).toBeVisible();
    await expect(page.locator(".chart-meta")).toContainText("涨停");
    await expect(page.locator(".stock-quote-main")).toContainText("¥");
    expect(
      await page.locator(".stock-key-stats .term-button").count(),
    ).toBeGreaterThanOrEqual(9);
    for (const term of ["均价线", "成交量", "MACD"]) {
      await expect(
        page
          .locator(".chart-term-row")
          .getByRole("button", { name: `查看“${term}”术语解释` }),
      ).toBeVisible();
    }
    await page
      .locator(".side-nav")
      .getByRole("button", { name: "持仓", exact: true })
      .click();
    expect(
      await page.locator(".summary-card .term-button").count(),
    ).toBeGreaterThanOrEqual(5);
  });

  test("renders independent price and volume charts across three viewports", async ({
    browser,
  }, testInfo) => {
    const state = atMinute("cn-fic", 650, "E2E-CHART");
    const sizes = [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ];
    for (const size of sizes) {
      const viewportContext = await browser.newContext({ viewport: size });
      const page = await viewportContext.newPage();
      await seedPage(page, state, {
        lastPage: "stock",
        lastSymbol: "600101",
      });
      await expect(page.locator(".price-chart")).toBeVisible();
      await expect(page.locator(".price-chart canvas").first()).toBeVisible();
      await expect(page.locator(".volume-chart canvas").first()).toBeVisible();
      const priceBox = await page.locator(".price-chart").boundingBox();
      const volumeBox = await page.locator(".volume-chart").boundingBox();
      expect(priceBox).not.toBeNull();
      expect(volumeBox).not.toBeNull();
      expect(volumeBox!.y).toBeGreaterThan(priceBox!.y + priceBox!.height - 2);
      if (size.width === 1440) {
        const volumeBeforeCrosshair = await page
          .locator(".volume-chart")
          .screenshot();
        await page.locator(".price-chart").hover({
          position: {
            x: Math.max(20, Math.round(priceBox!.width * 0.55)),
            y: Math.max(20, Math.round(priceBox!.height * 0.45)),
          },
        });
        await page.waitForTimeout(150);
        const volumeAfterCrosshair = await page
          .locator(".volume-chart")
          .screenshot();
        expect(
          volumeAfterCrosshair.equals(volumeBeforeCrosshair),
        ).toBe(false);
      }
      const overflow = await page.evaluate(() => ({
        root: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(overflow.root).toBeLessThanOrEqual(overflow.viewport);
      if (size.width === 1440) {
        await page.reload();
        await expect(page.locator(".price-chart canvas").first()).toBeVisible();
        await expect(page.locator(".volume-chart canvas").first()).toBeVisible();
      }
      await page.screenshot({
        path: testInfo.outputPath(`chart-${size.width}.png`),
        fullPage: false,
      });
      await viewportContext.close();
    }
  });
});
