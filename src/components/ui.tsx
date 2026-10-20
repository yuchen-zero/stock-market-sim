import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { TERMS } from "../data/help";
import { Icon, type IconName } from "./Icons";

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`segmented ${className}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({
  label,
  icon,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: IconName;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

export function Panel({
  children,
  className = "",
  as: Component = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Component className={`panel ${className}`}>{children}</Component>;
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = "info",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  width = "560px",
  className = "",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: string;
  className?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        )
        ?.focus();
    }, 20);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`modal ${className}`}
        style={{ width }}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="关闭弹窗" icon="close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Term({
  id,
  children,
  triggerOnly = false,
}: {
  id: keyof typeof TERMS;
  children?: ReactNode;
  triggerOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const term = TERMS[id];
  if (!term) return <>{children ?? id}</>;
  return (
    <span className="term-wrap">
      {triggerOnly ? null : <span>{children ?? term.title}</span>}
      <button
        type="button"
        className="term-button"
        aria-expanded={open}
        aria-label={`查看“${term.title}”术语解释`}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
      >
        ?
      </button>
      {open ? (
        <span className="term-popover" role="tooltip">
          <strong>{term.title}</strong>
          <span>{term.body}</span>
        </span>
      ) : null}
    </span>
  );
}

export function Toast({
  message,
  tone,
  onClose,
}: {
  message: string;
  tone: "success" | "error" | "info";
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  return (
    <div className={`toast toast-${tone}`} role="status">
      <Icon
        name={tone === "success" ? "check" : tone === "error" ? "info" : "info"}
        size={18}
      />
      <span>{message}</span>
      <button type="button" aria-label="关闭提示" onClick={onClose}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

export function ChangeValue({
  value,
  percent,
  compact = false,
}: {
  value: number;
  percent?: number;
  compact?: boolean;
}) {
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const sign = value > 0 ? "+" : "";
  const text =
    percent === undefined
      ? `${sign}${value.toFixed(2)}`
      : `${sign}${percent.toFixed(2)}%`;
  return (
    <span className={`change-value ${direction}`}>
      {value > 0 ? "↑" : value < 0 ? "↓" : "—"}{" "}
      {compact ? text : `${sign}${value.toFixed(2)}  ${text}`}
    </span>
  );
}

export function DataRow({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="data-row">
      <span className="data-label">{label}</span>
      <strong title={hint}>{value}</strong>
    </div>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "buy" | "sell";
}) {
  return (
    <button
      type="button"
      className={`button button-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
