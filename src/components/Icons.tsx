import type { SVGProps } from "react";

export type IconName =
  | "market"
  | "watchlist"
  | "trade"
  | "portfolio"
  | "orders"
  | "news"
  | "challenge"
  | "settings"
  | "search"
  | "plus"
  | "star"
  | "close"
  | "pause"
  | "play"
  | "chevron-left"
  | "chevron-right"
  | "arrow-up"
  | "arrow-down"
  | "help"
  | "save"
  | "import"
  | "export"
  | "reset"
  | "trash"
  | "info"
  | "lock"
  | "check"
  | "chart"
  | "menu";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, React.ReactNode> = {
  market: (
    <>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 14 3-4 3 2 4-6" />
      <path d="M17 6h2v2" />
    </>
  ),
  watchlist: (
    <>
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
    </>
  ),
  trade: (
    <>
      <path d="M7 7h11l-3-3" />
      <path d="M17 17H6l3 3" />
      <path d="M18 7v4" />
      <path d="M6 17v-4" />
    </>
  ),
  portfolio: (
    <>
      <path d="M5 8h14v11H5z" />
      <path d="M9 8V5h6v3" />
      <path d="M5 13h14" />
      <path d="M10 13v2h4v-2" />
    </>
  ),
  orders: (
    <>
      <path d="M7 4h10v16H7z" />
      <path d="M10 8h4M10 12h4M10 16h2" />
    </>
  ),
  news: (
    <>
      <path d="M5 5h14v14H5z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  challenge: (
    <>
      <path d="M8 4h8v3a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4" />
      <path d="M12 11v5M8 20h8M9 20v-4h6v4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  star: (
    <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "arrow-up": <path d="M12 19V5m-6 6 6-6 6 6" />,
  "arrow-down": <path d="M12 5v14m6-6-6 6-6-6" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.9.5-1.3 1.1-1.3 2.1M12 17h.01" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h12l2 2v14H5z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </>
  ),
  import: (
    <>
      <path d="M12 4v11m-4-4 4 4 4-4" />
      <path d="M5 18h14" />
    </>
  ),
  export: (
    <>
      <path d="M12 16V5m-4 4 4-4 4 4" />
      <path d="M5 19h14" />
    </>
  ),
  reset: (
    <>
      <path d="M4 11a8 8 0 1 1 2.3 5.7" />
      <path d="M4 4v7h7" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 4h6l1 3M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="1" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M7 16v-4M12 16V8M17 16v-6" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

export function Icon({ name, size = 20, className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="40" height="40" rx="8" fill="#1677ff" />
      <path
        d="M9 27V13h4v14H9Zm6-5V9h4v13h-4Zm6 3V15h4v10h-4Zm6-7v11h-4V18h4Z"
        fill="#fff"
      />
      <path d="M7 31h26" stroke="#fff" strokeWidth="1.4" opacity=".55" />
    </svg>
  );
}
