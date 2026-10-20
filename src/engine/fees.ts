import type {
  FeeBreakdown,
  MarketConfig,
  OrderSide,
  Trade,
} from "../types/domain";
import { fromCents, percentOfAmount, roundMoney, toCents } from "./money";

function roundFee(amount: number, rate: number): number {
  return fromCents(Math.round(toCents(amount) * rate));
}

export function calculateFeeBreakdown(
  amount: number,
  side: OrderSide,
  market: MarketConfig,
): FeeBreakdown {
  if (amount <= 0) {
    return { commission: 0, stampDuty: 0, transferFee: 0, total: 0 };
  }
  const variableCommission = roundFee(amount, market.fees.commissionRate);
  const commission = roundMoney(
    Math.max(market.fees.commissionMin, variableCommission),
  );
  const stampDuty =
    side === "sell" ? roundFee(amount, market.fees.stampDutySellRate) : 0;
  const transferFee = roundFee(amount, market.fees.transferFeeRate);
  return {
    commission,
    stampDuty,
    transferFee,
    total: roundMoney(commission + stampDuty + transferFee),
  };
}

export function commissionAlreadyPaid(
  trades: Trade[],
  clientOrderId: string,
): number {
  return roundMoney(
    trades
      .filter((trade) => trade.clientOrderId === clientOrderId)
      .reduce((sum, trade) => sum + trade.commission, 0),
  );
}

export function calculateFillFees(
  fillAmount: number,
  cumulativeAmount: number,
  side: OrderSide,
  market: MarketConfig,
  previousCommission: number,
): FeeBreakdown {
  const totalCommission = roundMoney(
    Math.max(
      market.fees.commissionMin,
      percentOfAmount(cumulativeAmount, market.fees.commissionRate),
    ),
  );
  const commission = roundMoney(
    Math.max(0, totalCommission - previousCommission),
  );
  const stampDuty =
    side === "sell"
      ? fromCents(Math.round(toCents(fillAmount) * market.fees.stampDutySellRate))
      : 0;
  const transferFee = fromCents(
    Math.round(toCents(fillAmount) * market.fees.transferFeeRate),
  );
  return {
    commission,
    stampDuty,
    transferFee,
    total: roundMoney(commission + stampDuty + transferFee),
  };
}
