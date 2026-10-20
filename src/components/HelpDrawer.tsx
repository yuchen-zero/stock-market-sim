import { useEffect, useState } from "react";
import { TERMS, TUTORIALS } from "../data/help";
import { Icon } from "./Icons";
import { IconButton, Term } from "./ui";

export function HelpDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(TUTORIALS[0].id);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside
        className="help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <div className="drawer-head">
          <div>
            <span className="eyebrow-label">离线学习资料</span>
            <h2 id="help-title">帮助中心</h2>
          </div>
          <IconButton label="关闭帮助" icon="close" onClick={onClose} />
        </div>
        <div className="drawer-intro">
          术语与教程均为本地静态内容，不联网、不调用 AI，也不构成投资建议。
        </div>
        <div className="tutorial-list">
          {TUTORIALS.map((tutorial, index) => {
            const isOpen = expanded === tutorial.id;
            return (
              <article
                key={tutorial.id}
                className={`tutorial ${isOpen ? "open" : ""}`}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setExpanded(isOpen ? null : tutorial.id)
                  }
                >
                  <span className="tutorial-number">0{index + 1}</span>
                  <span>
                    <strong>{tutorial.title}</strong>
                    <em>{tutorial.minutes} 分钟阅读</em>
                  </span>
                  <Icon
                    name={isOpen ? "arrow-up" : "arrow-down"}
                    size={16}
                  />
                </button>
                {isOpen ? (
                  <div className="tutorial-content">
                    {tutorial.content.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        <div className="glossary-section">
          <h3>术语索引</h3>
          <p>点击任一术语查看本地解释，覆盖交易、费用、盘口与复盘指标。</p>
          <div className="glossary-grid">
            {(Object.keys(TERMS) as Array<keyof typeof TERMS>).map((id) => (
              <Term key={id} id={id}>
                {TERMS[id].title}
              </Term>
            ))}
          </div>
        </div>
        <div className="drawer-notice">
          <Icon name="info" size={16} />
          本应用的费率、价格和新闻均为用于交互演练的模拟参数。
        </div>
      </aside>
    </div>
  );
}
