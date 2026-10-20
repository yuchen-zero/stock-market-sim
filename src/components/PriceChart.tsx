import { useEffect, useMemo, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../types/domain";

export type ChartPeriod = "1D" | "5D" | "1M" | "3M" | "1Y";

function movingAverage(
  candles: Candle[],
  window: number,
  intradayTime: boolean,
): LineData[] {
  return candles.flatMap((candle, index) => {
    if (index < window - 1) return [];
    const average =
      candles
        .slice(index - window + 1, index + 1)
        .reduce((sum, item) => sum + item.close, 0) / window;
    return [
      {
        time: candleTime(candle, intradayTime),
        value: average,
      },
    ];
  });
}

function candleTime(candle: Candle, intraday: boolean): Time {
  if (intraday) return candle.timeSec as UTCTimestamp;
  return new Date(candle.timeSec * 1000).toISOString().slice(0, 10);
}

function macdSeries(candles: Candle[], short = 12, long = 26, signal = 9) {
  const closes = candles.map((item) => item.close);
  const ema: number[] = [];
  const shortFactor = 2 / (short + 1);
  const longFactor = 2 / (long + 1);
  let shortEma = closes[0] ?? 0;
  let longEma = closes[0] ?? 0;
  closes.forEach((close) => {
    shortEma = close * shortFactor + shortEma * (1 - shortFactor);
    longEma = close * longFactor + longEma * (1 - longFactor);
    ema.push(shortEma - longEma);
  });
  const signalFactor = 2 / (signal + 1);
  let signalLine = ema[0] ?? 0;
  const hist = ema.map((value) => {
    signalLine = value * signalFactor + signalLine * (1 - signalFactor);
    return value - signalLine;
  });
  return hist.slice(-70);
}

export function PriceChart({
  candles,
  period,
  previousClose,
  showAverage,
  showMA5,
  showMA10,
  showMA20,
  showMACD,
}: {
  candles: Candle[];
  period: ChartPeriod;
  previousClose: number;
  showAverage: boolean;
  showMA5: boolean;
  showMA10: boolean;
  showMA20: boolean;
  showMACD: boolean;
}) {
  const priceContainerRef = useRef<HTMLDivElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const intraday = period === "1D";
  const intradayTime = period === "1D" || period === "5D";
  const displayedCandles = useMemo(() => {
    if (intraday) return candles;
    if (period === "5D") return candles;
    if (period === "1M") return candles.slice(-22);
    if (period === "3M") return candles.slice(-66);
    return candles.slice(-260);
  }, [candles, period, intraday]);
  const macd = useMemo(
    () => (showMACD ? macdSeries(displayedCandles) : []),
    [displayedCandles, showMACD],
  );

  useEffect(() => {
    const priceContainer = priceContainerRef.current;
    const volumeContainer = volumeContainerRef.current;
    if (!priceContainer || !volumeContainer || displayedCandles.length === 0) {
      return;
    }
    const axisTime = (time: Time) => {
      if (typeof time === "string") {
        return period === "1Y"
          ? time.slice(0, 7).replace("-", "/")
          : time.slice(5).replace("-", "/");
      }
      if (typeof time === "number") {
        const date = new Date(time * 1000);
        const hh = String(date.getUTCHours()).padStart(2, "0");
        const mm = String(date.getUTCMinutes()).padStart(2, "0");
        return period === "5D"
          ? `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(
              date.getUTCDate(),
            ).padStart(2, "0")} ${hh}:${mm}`
          : `${hh}:${mm}`;
      }
      return `${time.month}/${time.day}`;
    };
    const commonOptions = {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#667085",
        fontFamily:
          '"DIN Alternate", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#f0f2f5" },
        horzLines: { color: "#f0f2f5" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#98a2b3",
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1f2937",
        },
        horzLine: {
          color: "#98a2b3",
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1f2937",
        },
      },
      localization: {
        locale: "zh-CN",
        timeFormatter: axisTime,
      },
    };
    const priceChart = createChart(priceContainer, {
      ...commonOptions,
      autoSize: true,
      rightPriceScale: {
        borderColor: "#e4e7ec",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        visible: false,
        tickMarkFormatter: axisTime,
      },
    });
    const volumeChart = createChart(volumeContainer, {
      ...commonOptions,
      autoSize: true,
      rightPriceScale: {
        borderColor: "#e4e7ec",
        scaleMargins: { top: 0.08, bottom: 0.04 },
      },
      handleScroll: false,
      handleScale: false,
      timeScale: {
        borderColor: "#e4e7ec",
        timeVisible: intraday || period === "5D",
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: intraday ? 3 : 7,
        tickMarkFormatter: axisTime,
      },
    });
    priceChartRef.current = priceChart;
    volumeChartRef.current = volumeChart;

    let priceSeries:
      | ISeriesApi<"Area">
      | ISeriesApi<"Candlestick">;
    if (intraday) {
      const lineSeries = priceChart.addAreaSeries({
        lineColor: "#1677ff",
        topColor: "rgba(22, 119, 255, .16)",
        bottomColor: "rgba(22, 119, 255, .015)",
        lineWidth: 2,
        priceLineVisible: false,
      });
      lineSeries.setData(
        displayedCandles.map((candle) => ({
          time: candleTime(candle, true),
          value: candle.close,
        })),
      );
      if (previousClose > 0) {
        lineSeries.createPriceLine({
          price: previousClose,
          color: "#98a2b3",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "昨收",
        });
      }
      if (showAverage) {
        const averageSeries = priceChart.addLineSeries({
          color: "#d97706",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        let turnover = 0;
        let volumeSum = 0;
        const averageData = displayedCandles.map((candle) => {
          turnover += candle.close * candle.volume;
          volumeSum += candle.volume;
          return {
            time: candleTime(candle, true),
            value: volumeSum > 0 ? turnover / volumeSum : candle.close,
          };
        });
        averageSeries.setData(averageData);
      }
      priceSeries = lineSeries;
    } else {
      const candleSeries = priceChart.addCandlestickSeries({
        upColor: "#e5484d",
        downColor: "#16a36a",
        borderVisible: false,
        wickUpColor: "#e5484d",
        wickDownColor: "#16a36a",
        priceLineVisible: false,
      });
      const data: CandlestickData[] = displayedCandles.map((candle) => ({
          time: candleTime(candle, intradayTime),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));
      candleSeries.setData(data);
      if (previousClose > 0 && period !== "5D") {
        candleSeries.createPriceLine({
          price: previousClose,
          color: "#98a2b3",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "昨收",
        });
      }
      if (showMA5 || showMA10 || showMA20) {
        ([
          { window: 5, color: "#d97706" },
          { window: 10, color: "#1677ff" },
          { window: 20, color: "#7a5af8" },
        ] as const).forEach(({ window, color }) => {
          const enabled =
            (window === 5 && showMA5) ||
            (window === 10 && showMA10) ||
            (window === 20 && showMA20);
          if (!enabled) return;
          const series = priceChart.addLineSeries({
            color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          series.setData(
            movingAverage(
              displayedCandles,
              window,
              intradayTime,
            ).map((point) => ({
              ...point,
              time: point.time,
            })),
          );
        });
      }
      priceSeries = candleSeries;
    }

    const volumeData: HistogramData[] = displayedCandles.map((candle) => ({
      time: candleTime(candle, intradayTime),
      value: candle.volume,
      color:
        candle.close >= candle.open
          ? "rgba(229, 72, 77, .42)"
          : "rgba(22, 163, 106, .42)",
    }));
    const volumeSeries = volumeChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeries.setData(volumeData);

    priceChart.timeScale().fitContent();
    volumeChart.timeScale().fitContent();
    const initialRange = priceChart.timeScale().getVisibleLogicalRange();
    if (initialRange) {
      volumeChart.timeScale().setVisibleLogicalRange(initialRange);
    }

    let syncingRange = false;
    let crosshairSource: "price" | "volume" = "price";
    const markPriceSource = () => {
      crosshairSource = "price";
    };
    const markVolumeSource = () => {
      crosshairSource = "volume";
    };
    priceContainer.addEventListener("mouseenter", markPriceSource);
    volumeContainer.addEventListener("mouseenter", markVolumeSource);
    const rangesMatch = (
      left: { from: number; to: number } | null,
      right: { from: number; to: number } | null,
    ) =>
      Boolean(
        left &&
          right &&
          Math.abs(left.from - right.from) < 0.01 &&
          Math.abs(left.to - right.to) < 0.01,
      );
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (
        syncingRange ||
        !range ||
        rangesMatch(range, volumeChart.timeScale().getVisibleLogicalRange())
      ) {
        return;
      }
      syncingRange = true;
      volumeChart.timeScale().setVisibleLogicalRange(range);
      syncingRange = false;
    });

    const timeKey = (time: Time) =>
      typeof time === "string"
        ? time
        : typeof time === "number"
          ? String(time)
          : `${time.year}-${time.month}-${time.day}`;
    const candleByTime = new Map(
      displayedCandles.map((candle) => [
        timeKey(candleTime(candle, intradayTime)),
        candle,
      ]),
    );
    priceChart.subscribeCrosshairMove((param) => {
      if (crosshairSource !== "price") return;
      if (!param.time) {
        volumeChart.clearCrosshairPosition();
        return;
      }
      const candle = candleByTime.get(timeKey(param.time));
      if (!candle) return;
      volumeChart.setCrosshairPosition(
        candle.volume,
        param.time,
        volumeSeries,
      );
    });
    volumeChart.subscribeCrosshairMove((param) => {
      if (crosshairSource !== "volume") return;
      if (!param.time) {
        priceChart.clearCrosshairPosition();
        return;
      }
      const candle = candleByTime.get(timeKey(param.time));
      if (!candle) return;
      priceChart.setCrosshairPosition(
        candle.close,
        param.time,
        priceSeries,
      );
    });

    return () => {
      priceContainer.removeEventListener("mouseenter", markPriceSource);
      volumeContainer.removeEventListener("mouseenter", markVolumeSource);
      priceChart.remove();
      volumeChart.remove();
      priceChartRef.current = null;
      volumeChartRef.current = null;
    };
  }, [
    displayedCandles,
    intraday,
    intradayTime,
    period,
    previousClose,
    showAverage,
    showMA5,
    showMA10,
    showMA20,
  ]);

  if (displayedCandles.length === 0) {
    return (
      <div className="chart-empty">
        <span>行情即将开始</span>
        <small>继续仿真后将生成当前交易日的分时数据。</small>
      </div>
    );
  }

  return (
    <div className="chart-stack">
      <div className="chart-legend" aria-hidden="true">
        {period === "1D" ? (
          <>
            <span className="legend-line price-line" />
            分时
            {showAverage ? (
              <>
                <span className="legend-line avg-line" />
                均价
              </>
            ) : null}
          </>
        ) : (
          <>
            {showMA5 ? (
              <>
                <span className="legend-line ma5" />
                MA5
              </>
            ) : null}
            {showMA10 ? (
              <>
                <span className="legend-line ma10" />
                MA10
              </>
            ) : null}
            {showMA20 ? (
              <>
                <span className="legend-line ma20" />
                MA20
              </>
            ) : null}
          </>
        )}
      </div>
      <div
        ref={priceContainerRef}
        className="price-chart"
        role="img"
        aria-label={`${period} 独立价格图，包含可选均线指标`}
      />
      <div className="volume-chart-head">
        <span>成交量</span>
        <span>VOL</span>
      </div>
      <div
        ref={volumeContainerRef}
        className="volume-chart"
        role="img"
        aria-label={`${period} 独立成交量图`}
      />
      {showMACD && macd.length > 0 ? (
        <div className="macd-panel">
          <div className="macd-title">
            <span>MACD (12, 26, 9)</span>
            <span className={macd[macd.length - 1] >= 0 ? "up" : "down"}>
              {macd[macd.length - 1].toFixed(3)}
            </span>
          </div>
          <div className="macd-bars" aria-hidden="true">
            {macd.map((value, index) => {
              const height = Math.min(36, Math.max(3, Math.abs(value) * 180));
              return (
                <i
                  key={index}
                  className={value >= 0 ? "up" : "down"}
                  style={{
                    height: `${height}%`,
                    alignSelf: value >= 0 ? "flex-start" : "flex-end",
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
