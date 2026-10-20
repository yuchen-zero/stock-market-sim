import { useRef, useState } from "react";
import { getMarketConfig } from "../data/markets";
import { ENGINE_INITIAL_DATE } from "../engine/engine";
import {
  useCurrentSimulationView,
  useSimulationStore,
} from "../store/useSimulationStore";
import type { MarketId, SimMode, SlotKey } from "../types/domain";
import {
  estimateTotalBytes,
  exportFilename,
  exportSimulation,
  listSavedSlots,
  SLOT_LIMIT_BYTES,
  slotKey,
} from "../store/storage";
import { Icon } from "../components/Icons";
import {
  Button,
  DataRow,
  Modal,
  Panel,
  SectionHeading,
} from "../components/ui";

export function SettingsPage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          marketId: current.marketId,
          mode: current.mode,
          seed: current.seed,
          simulatedDate: current.simulatedDate,
          speed: current.speed,
          schemaVersion: current.schemaVersion,
          generation: current.portfolio.generation,
          challengeStartedDate: current.challenge.startedDate,
        }
      : null,
  );
  const settings = useSimulationStore((state) => state.settings);
  const saveStatus = useSimulationStore((state) => state.saveStatus);
  const loadError = useSimulationStore((state) => state.loadError);
  const updateSettings = useSimulationStore((state) => state.updateSettings);
  const setExtendedHours = useSimulationStore(
    (state) => state.setExtendedHours,
  );
  const resetCurrent = useSimulationStore((state) => state.resetCurrent);
  const clearEverything = useSimulationStore((state) => state.clearEverything);
  const importCurrent = useSimulationStore((state) => state.importCurrent);
  const restoreBackup = useSimulationStore(
    (state) => state.restoreCurrentBackup,
  );
  const dismissLoadError = useSimulationStore(
    (state) => state.dismissLoadError,
  );
  const saveCurrent = useSimulationStore((state) => state.saveCurrent);
  const replayOnboarding = useSimulationStore(
    (state) => state.replayOnboarding,
  );
  const [resetOpen, setResetOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [resetSeed, setResetSeed] = useState(simulation?.seed ?? "ALPHA-2026");
  const [importMessage, setImportMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!simulation) return null;
  const market = getMarketConfig(simulation.marketId);
  const totalBytes = estimateTotalBytes();
  const savedSlots = listSavedSlots();

  const download = () => {
    const current = useSimulationStore.getState().currentSimulation();
    const envelope = exportSimulation(current);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFilename(current);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    useSimulationStore.getState().notify("当前存档已导出为本地 JSON。", "success");
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setImportMessage(null);
    try {
      const text = await file.text();
      await importCurrent(text);
      setImportMessage({
        tone: "success",
        text: "导入成功，旧请求世代已失效。",
      });
    } catch (error) {
      setImportMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "导入失败。",
      });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="page settings-page">
      <div className="page-title-row">
        <div>
          <div className="page-kicker">本地优先 · 无远程账户</div>
          <h1>设置与存档</h1>
          <p>
            仿真状态保存在浏览器 localStorage；导入导出仅使用本地 JSON，不读取真实账户。
          </p>
        </div>
        <button
          type="button"
          className="save-indicator"
          onClick={() => saveCurrent("manual")}
        >
          <Icon name="save" size={16} />
          {saveStatus.state === "error" ? "保存失败" : "立即保存"}
        </button>
      </div>

      {loadError ? (
        <div className="load-error-banner" role="alert">
          <div>
            <strong>发现损坏或不兼容的本地存档</strong>
            <p>
              槽位 {loadError.slot}：{loadError.message}
              {loadError.backupAvailable
                ? "。原始内容已复制到备份键，当前以安全初始状态运行。"
                : "。当前以安全初始状态运行。"}
            </p>
          </div>
          <div>
            {loadError.backupAvailable ? (
              <Button
                variant="primary"
                onClick={() => {
                  restoreBackup();
                  dismissLoadError();
                }}
              >
                从备份恢复
              </Button>
            ) : null}
            <Button onClick={dismissLoadError}>保留初始状态</Button>
          </div>
        </div>
      ) : null}

      <div className="settings-grid">
        <Panel className="settings-section">
          <SectionHeading
            title="仿真偏好"
            description="部分设置会同步到当前模拟状态"
          />
          <SettingToggle
            label="收盘后自动进入下一交易日"
            description="默认关闭。开启后会跳过“进入下一日”步骤，但挑战结算仍会暂停。"
            checked={settings.autoNextDay}
            onChange={(checked) => updateSettings({ autoNextDay: checked })}
          />
          <SettingToggle
            label="美股启用盘前盘后"
            description="仅影响美股风格市场。扩展时段只接受限价单，盘口深度显著降低。"
            checked={settings.extendedHours}
            onChange={setExtendedHours}
          />
          <SettingToggle
            label="页面隐藏时自动暂停"
            description="切换到其他标签页后停止推进仿真并尝试保存当前状态。"
            checked={settings.pauseWhenHidden}
            onChange={(checked) => updateSettings({ pauseWhenHidden: checked })}
          />
          <div className="settings-row">
            <div>
              <strong>仿真速度</strong>
              <p>1 倍速为真实世界每 3 秒推进 1 个模拟分钟。</p>
            </div>
            <select
              value={simulation.speed}
              onChange={(event) =>
                useSimulationStore
                  .getState()
                  .setSpeed(Number(event.target.value) as 1 | 2 | 4 | 8 | 16)
              }
              aria-label="仿真速度设置"
            >
              {[1, 2, 4, 8, 16].map((speed) => (
                <option key={speed} value={speed}>
                  {speed} 倍速
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <div>
              <strong>新手引导</strong>
              <p>重新播放 5 步引导；打开引导时仿真会暂停。</p>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                replayOnboarding();
                window.dispatchEvent(
                  new CustomEvent("stock-sim:replay-onboarding"),
                );
              }}
            >
              重新播放
            </Button>
          </div>
        </Panel>

        <Panel className="settings-section">
          <SectionHeading
            title="当前存档"
            description={`${market.label} · ${
              simulation.mode === "sandbox" ? "自由沙盒" : "30 日挑战"
            }`}
          />
          <div className="settings-data">
            <DataRow label="模拟种子" value={simulation.seed} />
            <DataRow label="模拟日期" value={simulation.simulatedDate} />
            <DataRow
              label="起始日期"
              value={
                simulation.mode === "challenge"
                  ? simulation.challengeStartedDate ?? ENGINE_INITIAL_DATE
                  : ENGINE_INITIAL_DATE
              }
            />
            <DataRow label="Schema 版本" value={`v${simulation.schemaVersion}`} />
            <DataRow
              label="账户世代"
              value={simulation.generation}
            />
            <DataRow
              label="最后保存"
              value={
                saveStatus.at
                  ? new Date(saveStatus.at).toLocaleString("zh-CN")
                  : "尚未保存"
              }
            />
          </div>
          <div className="save-note">
            <Icon name="lock" size={15} />
            仿真或挑战开始后种子为只读。更换种子需要明确重置当前市场与模式，重置前自动备份。
          </div>
          <div className="settings-actions">
            <Button variant="primary" onClick={download}>
              <Icon name="export" size={16} />
              导出当前存档
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <Icon name="import" size={16} />
              导入 JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => handleImport(event.target.files?.[0])}
              aria-label="选择 JSON 存档"
            />
            <Button
              variant="ghost"
              onClick={() => {
                setResetSeed(simulation.seed);
                setResetOpen(true);
              }}
            >
              <Icon name="reset" size={16} />
              重置当前槽位
            </Button>
          </div>
          {importMessage ? (
            <div
              className={`import-message ${importMessage.tone}`}
              role="status"
            >
              {importMessage.text}
            </div>
          ) : null}
        </Panel>

        <Panel className="settings-section storage-section">
          <SectionHeading
            title="本地存储"
            description="六个市场 × 模式槽位独立保存"
          />
          <div className="storage-meter">
            <div>
              <strong>
                {Math.round(totalBytes / 1024).toLocaleString("zh-CN")} KB
              </strong>
              <span>总占用估算 / 6 槽目标 4.5 MB</span>
            </div>
            <i>
              <b
                style={{
                  width: `${Math.min(
                    100,
                    (totalBytes / (4_500_000)) * 100,
                  )}%`,
                }}
              />
            </i>
          </div>
          <div className="slot-list">
            {[
              "cn-fic:sandbox",
              "cn-fic:challenge",
              "cn-real-demo:sandbox",
              "cn-real-demo:challenge",
              "us-sim:sandbox",
              "us-sim:challenge",
            ].map((slot) => (
              <div key={slot}>
                <code>
                  {slotKey(
                    ...(slot.split(":") as [MarketId, SimMode]),
                  )}
                </code>
                <span>
                  {savedSlots.includes(slot as SlotKey) ? "已保存" : "未创建"}
                </span>
              </div>
            ))}
          </div>
          <div className="storage-notes">
            <span>
              单槽目标上限：{Math.round(SLOT_LIMIT_BYTES / 1_000_000 * 10) / 10} MB
            </span>
            <span>K 线与盘口历史会在载入时确定性重建。</span>
          </div>
          <Button variant="danger" onClick={() => setClearOpen(true)}>
            <Icon name="trash" size={16} />
            清除全部本地数据
          </Button>
        </Panel>

        <Panel className="settings-section">
          <SectionHeading
            title="历史最佳挑战"
            description="仅保存在本地，无排行榜与服务器"
          />
          <div className="best-list">
            {(["cn-fic", "cn-real-demo", "us-sim"] as const).map((marketId) => {
              const best = settings.bestChallenges[marketId];
              return (
                <div key={marketId}>
                  <span>{getMarketConfig(marketId).label}</span>
                  <strong className={best ? `grade-${best.grade}` : ""}>
                    {best ? `${best.grade} · ${best.score.toFixed(1)}` : "暂无"}
                  </strong>
                </div>
              );
            })}
          </div>
          <div className="settings-help">
            <Icon name="info" size={16} />
            <p>
              术语与 5 篇教程位于右上角帮助中心；本应用不读取系统日期来生成行情，所有交易时间均来自模拟时钟。
            </p>
          </div>
        </Panel>
      </div>

      <Modal
        open={resetOpen}
        title="重置当前市场与模式？"
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                resetCurrent(resetSeed.trim() || "ALPHA-2026");
                setResetOpen(false);
              }}
            >
              确认重置
            </Button>
          </>
        }
      >
        <p className="modal-copy">
          这会把 {market.label} 的当前{" "}
          {simulation.mode === "sandbox" ? "沙盒" : "挑战"} 账户、时间、订单和持仓重置为新种子。原存档会先备份。
        </p>
        <label className="seed-field compact-seed">
          <span>新种子</span>
          <input
            value={resetSeed}
            maxLength={40}
            onChange={(event) => setResetSeed(event.target.value)}
            aria-label="重置使用的新种子"
          />
        </label>
      </Modal>

      <Modal
        open={clearOpen}
        title="清除全部本地数据？"
        onClose={() => setClearOpen(false)}
        footer={
          <>
            <Button onClick={() => setClearOpen(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                clearEverything();
                setClearOpen(false);
              }}
            >
              我已导出，确认全部清除
            </Button>
          </>
        }
      >
        <div className="danger-copy">
          <Icon name="trash" size={24} />
          <p>
            这将删除六个市场 × 模式槽位、自选、设置、备份和历史最佳评级，并重建初始沙盒。此操作不可从应用内恢复。
          </p>
        </div>
      </Modal>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-row toggle-row">
      <span>
        <strong>{label}</strong>
        <p>{description}</p>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i className="toggle-track" aria-hidden="true">
        <b />
      </i>
    </label>
  );
}
