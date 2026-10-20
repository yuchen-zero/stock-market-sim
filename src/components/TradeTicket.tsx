import { useEffect, useMemo, useRef, useState } from "react";
import { getMarketConfig } from "../data/markets";
import {
  getRiskPreview,
} from "../engine/engine";
import {
  formatMoney,
  formatNumber,
  formatRate,
} from "../engine/money";
import { useSimulationStore } from "../store/useSimulationStore";
import type {
  Instrument,
  OrderSide,
  OrderType,
  TradeContext,
} from "../types/domain";
import { Button, Modal, SegmentedControl, Term } from "./ui";
import { Icon } from "./Icons";

export interface BookPriceInstruction {
  price: number;
  side: OrderSide;
  nonce: number;
}

function initialQuantity(instrument: Instrument, marketId: TradeContext["marketId"]): number {
  const market = getMarketConfig(marketId);
  return market.quantityRules[instrument.board].minimum;
}

function makeClientOrderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now()}-${Math.floor(performance.now() * 1000)}`;
}

export function TradeTicket({
  simulation,
  instrument,
  bookInstruction,
  compact = false,
  onSubmitted,
}: {
  simulation: TradeContext;
  instrument: Instrument;
  bookInstruction?: BookPriceInstruction | null;
  compact?: boolean;
  onSubmitted?: () => void;
}) {
  const market = getMarketConfig(simulation.marketId);
  const quote = simulation.quotes[instrument.symbol];
  const submitDraft = useSimulationStore((state) => state.submitDraft);
  const [side, setSide] = useState<OrderSide>("buy");
  const [type, setType] = useState<OrderType>("limit");
  const [price, setPrice] = useState(quote?.last.toFixed(2) ?? "0.00");
  const [quantity, setQuantity] = useState(
    String(initialQuantity(instrument, simulation.marketId)),
  );
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    setSide("buy");
    setType("limit");
    setPrice(quote?.last.toFixed(2) ?? "0.00");
    setQuantity(String(initialQuantity(instrument, simulation.marketId)));
    setNote("");
    setMessage(null);
    setConfirmOpen(false);
  }, [instrument.symbol]);

  useEffect(() => {
    if (!bookInstruction) return;
    setSide(bookInstruction.side);
    setType("limit");
    setPrice(bookInstruction.price.toFixed(2));
    setMessage(null);
  }, [bookInstruction?.nonce]);

  const parsedQuantity = Number(quantity);
  const parsedPrice = type === "limit" ? Number(price) : null;
  const draft = useMemo(
    () => ({
      clientOrderId: "",
      symbol: instrument.symbol,
      side,
      type,
      limitPrice: parsedPrice,
      quantity:
        Number.isFinite(parsedQuantity) && parsedQuantity > 0
          ? Math.floor(parsedQuantity)
          : 0,
      note,
    }),
    [instrument.symbol, side, type, parsedPrice, parsedQuantity, note],
  );
  const risk = useMemo(
    () => getRiskPreview(simulation, draft),
    [simulation, draft],
  );
  const rule = market.quantityRules[instrument.board];
  const position = simulation.portfolio.positions[instrument.symbol];
  const challengeReadOnly =
    simulation.mode === "challenge" &&
    simulation.challenge.status === "completed";
  const canSubmit =
    !challengeReadOnly &&
    parsedQuantity > 0 &&
    (type === "market" || (parsedPrice !== null && parsedPrice > 0));

  useEffect(() => {
    const latest = simulation.quotes[instrument.symbol];
    if (!latest) return;
    if (!price || price === "0.00") setPrice(latest.last.toFixed(2));
  }, [instrument.symbol]);

  const setPositionPercent = (percent: number) => {
    const available =
      side === "buy" ? risk.maxBuyQuantity : position?.sellableQuantity ?? 0;
    if (available <= 0) {
      setQuantity("0");
      return;
    }
    let candidate = Math.floor((available * percent) / 100);
    if (side === "buy" || instrument.board !== "star") {
      candidate =
        Math.floor(candidate / rule.increment) * rule.increment;
    }
    if (candidate < rule.minimum && percent === 100) candidate = available;
    if (percent === 100 && side === "sell") candidate = available;
    setQuantity(String(Math.max(0, candidate)));
  };

  const openConfirmation = () => {
    if (!canSubmit || submitLock.current) return;
    setMessage(null);
    setConfirmOpen(true);
  };

  const confirmOrder = () => {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    const latest = useSimulationStore.getState().currentSimulation();
    const result = submitDraft({
      ...draft,
      clientOrderId: makeClientOrderId(),
      accountVersion: latest.portfolio.accountVersion,
      generation: latest.portfolio.generation,
    });
    setMessage(result.message);
    setConfirmOpen(false);
    onSubmitted?.();
    window.setTimeout(() => {
      submitLock.current = false;
      setSubmitting(false);
    }, 350);
  };

  if (!quote) return null;

  return (
    <section className={`trade-ticket panel ${compact ? "compact" : ""}`}>
      <div className="ticket-head">
        <div>
          <h2>模拟下单</h2>
          <p>
            {instrument.name} · {instrument.symbol}
          </p>
        </div>
        <span className="board-badge">
          {instrument.board === "star"
            ? "科创板"
            : instrument.board === "chinext"
              ? "创业板"
              : instrument.board === "st"
                ? "ST"
                : instrument.board === "us"
                  ? "美股"
                  : "主板"}
        </span>
      </div>
      <SegmentedControl<OrderSide>
        label="买卖方向"
        value={side}
        options={[
          { value: "buy", label: "买入" },
          { value: "sell", label: "卖出" },
        ]}
        onChange={(next) => {
          setSide(next);
          setMessage(null);
        }}
        className={`trade-side ${side}`}
      />
      <SegmentedControl<OrderType>
        label="委托类型"
        value={type}
        options={[
          { value: "limit", label: "限价单" },
          { value: "market", label: "市价单" },
        ]}
        onChange={(next) => {
          setType(next);
          setMessage(null);
        }}
        className="order-type-control"
      />

      <div className="field-grid">
        <label>
          <span>
            <Term id="limitOrder">委托价格</Term>
          </span>
          <div className="price-input-wrap">
            <em>{market.currencySymbol}</em>
            <input
              type="number"
              step={market.tickSize}
              min={market.tickSize}
              value={type === "market" ? "" : price}
              placeholder={type === "market" ? "按五档盘口" : "0.00"}
              disabled={type === "market"}
              onChange={(event) => {
                setPrice(event.target.value);
                setMessage(null);
              }}
              aria-label="委托价格"
            />
          </div>
        </label>
        <label>
          <span>委托数量</span>
          <div className="price-input-wrap">
            <input
              type="number"
              min={1}
              step={rule.increment}
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                setMessage(null);
              }}
              aria-label="委托数量"
            />
            <em>股</em>
          </div>
        </label>
      </div>
      <div className="position-shortcuts" aria-label="快捷仓位">
        {[25, 50, 75, 100].map((percent) => (
          <button
            key={percent}
            type="button"
            onClick={() => setPositionPercent(percent)}
          >
            {percent}%
          </button>
        ))}
      </div>
      <div className="ticket-availability">
        <span>
          可买{" "}
          <strong>{formatNumber(Math.max(0, risk.maxBuyQuantity), 0)} 股</strong>
        </span>
        <span>
          可卖{" "}
          <strong>{formatNumber(risk.sellableQuantity, 0)} 股</strong>
        </span>
      </div>
      <div className="lot-hint">
        {instrument.board === "star"
          ? "最低 200 股，200 股以上可按 1 股递增"
          : instrument.board === "us"
            ? "1 股起，T+0 当日可卖"
            : `每笔 ${rule.increment} 股整数倍，持仓不足 ${rule.minimum} 股时可一次卖清`}
        {" · "}
        {market.settlement}
      </div>

      <label className="note-field">
        <span>
          交易理由 / 计划 <em>可选，仅用于复盘</em>
        </span>
        <textarea
          value={note}
          maxLength={100}
          rows={2}
          placeholder="例如：等待回踩均线后分批买入"
          onChange={(event) => setNote(event.target.value)}
        />
        <small>{note.length}/100</small>
      </label>

      <div className="risk-preview">
        <div className="risk-title">
          <strong>成交前风险预览</strong>
          <span>仅按当前盘口估算</span>
        </div>
        <div className="risk-grid">
          <span>
            预计金额
            <b>{formatMoney(risk.estimatedAmount, market.currencySymbol)}</b>
          </span>
          <span>
            <Term id="commission">佣金</Term>
            <b>{formatMoney(risk.fees.commission, market.currencySymbol)}</b>
          </span>
          <span>
            <Term id="stampDuty">印花税</Term>
            <b>{formatMoney(risk.fees.stampDuty, market.currencySymbol)}</b>
          </span>
          <span>
            <Term id="transferFee">过户费</Term>
            <b>{formatMoney(risk.fees.transferFee, market.currencySymbol)}</b>
          </span>
          <span>
            成交后现金
            <b>{formatMoney(risk.cashAfter, market.currencySymbol)}</b>
          </span>
          <span>
            成交后仓位
            <b>{formatRate(risk.positionWeightAfter)}</b>
          </span>
          <span className="risk-wide">
            {market.supportsPriceLimit
              ? "若跌至当日跌停价，未实现盈亏"
              : "该市场无每日跌停限制"}
            <b
              className={
                market.supportsPriceLimit
                  ? risk.lowerLimitLoss >= 0
                    ? "up"
                    : "down"
                  : ""
              }
            >
              {market.supportsPriceLimit
                ? `${risk.lowerLimitLoss >= 0 ? "+" : ""}${formatMoney(
                    risk.lowerLimitLoss,
                    market.currencySymbol,
                  )}`
                : "—"}
            </b>
          </span>
        </div>
        <p>费用按模拟参数分项四舍五入到分；不是任何券商的实时费率。</p>
      </div>

      {message ? (
        <div className="ticket-message" role="status">
          <Icon name="info" size={16} />
          {message}
        </div>
      ) : null}
      {challengeReadOnly ? (
        <div className="ticket-message error">
          <Icon name="lock" size={16} />
          挑战已结束，当前账户仅可查看与导出。
        </div>
      ) : null}
      <Button
        variant={side === "buy" ? "buy" : "sell"}
        className="submit-order"
        disabled={!canSubmit || submitting}
        onClick={openConfirmation}
      >
        {submitting
          ? "处理中…"
          : `预览并提交${side === "buy" ? "买入" : "卖出"}委托`}
      </Button>

      <Modal
        open={confirmOpen}
        title={`确认${side === "buy" ? "买入" : "卖出"}委托`}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>返回修改</Button>
            <Button
              variant={side === "buy" ? "buy" : "sell"}
              onClick={confirmOrder}
              disabled={submitting}
            >
              确认委托
            </Button>
          </>
        }
      >
        <div className="confirm-order-summary">
          <div>
            <span>证券</span>
            <strong>
              {instrument.name} <em>{instrument.symbol}</em>
            </strong>
          </div>
          <div>
            <span>方向 / 类型</span>
            <strong className={side === "buy" ? "up" : "down"}>
              {side === "buy" ? "买入" : "卖出"} ·{" "}
              {type === "limit" ? "限价" : "市价"}
            </strong>
          </div>
          <div>
            <span>数量</span>
            <strong>{formatNumber(draft.quantity, 0)} 股</strong>
          </div>
          <div>
            <span>价格</span>
            <strong>
              {type === "limit"
                ? `${market.currencySymbol}${Number(price).toFixed(2)}`
                : "五档市价"}
            </strong>
          </div>
          <div>
            <span>预计费用</span>
            <strong>{formatMoney(risk.fees.total, market.currencySymbol)}</strong>
          </div>
          <div>
            <span>成交后仓位</span>
            <strong>{formatRate(risk.positionWeightAfter)}</strong>
          </div>
        </div>
        {note ? (
          <p className="confirm-note">
            交易理由：{note}
          </p>
        ) : null}
        <div className="order-disclaimer">
          该订单仅作用于虚构模拟账户，不会发送到任何真实交易所。
        </div>
        {simulation.marketId === "cn-real-demo" ? (
          <div className="real-order-warning">
            真实公司名称仅用于界面演示。该订单仅作用于虚构模拟账户，全部价格与成交均为虚构。
          </div>
        ) : null}
        <p className="confirm-fineprint">
          最终成交价与数量以提交后的模拟盘口为准；可能逐档部分成交。
        </p>
      </Modal>
    </section>
  );
}
