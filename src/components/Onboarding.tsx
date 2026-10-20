import { useEffect, useState } from "react";
import { ONBOARDING_STEPS } from "../data/help";
import { useSimulationStore } from "../store/useSimulationStore";
import { Button, Modal } from "./ui";

export function Onboarding({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const savedStep = useSimulationStore(
    (state) => state.settings.onboardingStep,
  );
  const setSavedStep = useSimulationStore(
    (state) => state.setOnboardingStep,
  );
  const [step, setStep] = useState(() =>
    Math.min(ONBOARDING_STEPS.length - 1, Math.max(0, savedStep)),
  );
  const markDone = useSimulationStore((state) => state.markOnboardingDone);

  useEffect(() => {
    if (!open) return;
    setStep(
      Math.min(ONBOARDING_STEPS.length - 1, Math.max(0, savedStep)),
    );
    const live = useSimulationStore.getState().currentSimulation();
    if (!live.paused) {
      useSimulationStore.getState().togglePause();
    }
  }, [open, savedStep]);

  const finish = () => {
    markDone();
    onClose();
  };
  const data = ONBOARDING_STEPS[step];
  const goToStep = (next: number) => {
    setStep(next);
    setSavedStep(next);
  };

  return (
    <Modal
      open={open}
      title="5 步了解模拟证券"
      onClose={finish}
      width="540px"
      className="onboarding-modal"
      footer={
        <div className="onboarding-actions">
          <button type="button" className="text-button" onClick={finish}>
            跳过引导
          </button>
          <div>
            {step > 0 ? (
              <Button onClick={() => goToStep(step - 1)}>
                上一步
              </Button>
            ) : null}
            {step < ONBOARDING_STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => goToStep(step + 1)}>
                下一步
              </Button>
            ) : (
              <Button variant="primary" onClick={finish}>
                进入行情
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="guide-progress" aria-label={`引导进度 ${step + 1}/5`}>
        {ONBOARDING_STEPS.map((item, index) => (
          <span
            key={item.title}
            className={index <= step ? "active" : ""}
          />
        ))}
      </div>
      <div className="guide-illustration" aria-hidden="true">
        <span>0{step + 1}</span>
        <div className="mini-chart">
          {[34, 58, 42, 75, 62, 88, 70, 82, 66, 92].map((height, index) => (
            <i
              key={index}
              style={{
                height: `${height}%`,
                background:
                  index % 3 === 0 ? "var(--up)" : "var(--accent)",
              }}
            />
          ))}
        </div>
      </div>
      <div className="guide-copy">
        <span className="guide-step">第 {step + 1} / 5 步</span>
        <h3>{data.title}</h3>
        <p>{data.body}</p>
        <div className="guide-tip">{data.target}</div>
      </div>
      <p className="guide-footnote">
        引导打开期间仿真会暂停；关闭后点击“继续”恢复。引导不会自动提交订单。
      </p>
    </Modal>
  );
}
