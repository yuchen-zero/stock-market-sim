const MONEY_EPSILON = 1e-7;

export function toCents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

export function fromCents(value: number): number {
  return Math.round(value) / 100;
}

export function roundMoney(value: number): number {
  return fromCents(toCents(value));
}

export function roundTick(value: number, tickSize: number): number {
  const tickCents = Math.max(1, Math.round(tickSize * 100));
  const cents = toCents(value);
  return fromCents(Math.round((cents + MONEY_EPSILON) / tickCents) * tickCents);
}

export function multiplyPrice(price: number, quantity: number): number {
  return fromCents(toCents(price) * quantity);
}

export function percentOfAmount(amount: number, rate: number): number {
  return fromCents(Math.round(toCents(amount) * rate));
}

export function formatMoney(
  value: number,
  currencySymbol: "¥" | "$" = "¥",
  compact = false,
): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (compact) {
    const absolute = Math.abs(safe);
    if (absolute >= 100_000_000) {
      return `${currencySymbol}${(safe / 100_000_000).toFixed(2)}亿`;
    }
    if (absolute >= 10_000) {
      return `${currencySymbol}${(safe / 10_000).toFixed(2)}万`;
    }
  }
  return `${currencySymbol}${safe.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(
  value: number,
  maximumFractionDigits = 2,
): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits,
  });
}

export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "0.00%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatRate(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return `${(0).toFixed(digits)}%`;
  return `${value.toFixed(digits)}%`;
}

export function formatSignedMoney(
  value: number,
  currencySymbol: "¥" | "$" = "¥",
): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatMoney(value, currencySymbol)}`;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
