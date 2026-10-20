import type { NewsEvent } from "../types/domain";
import { formatDateTime } from "../engine/time";
import { EmptyState } from "./ui";

export const CATEGORY_LABELS: Record<NewsEvent["category"], string> = {
  macro: "宏观",
  sector: "行业",
  company: "公司",
  earnings: "财报",
  policy: "政策",
  overseas: "海外",
};

export const SENTIMENT_LABELS: Record<NewsEvent["sentiment"], string> = {
  positive: "利好",
  neutral: "中性",
  negative: "利空",
};

export function NewsFeed({
  news,
  limit,
  compact = false,
}: {
  news: NewsEvent[];
  limit?: number;
  compact?: boolean;
}) {
  const visible = limit ? news.slice(0, limit) : news;
  if (visible.length === 0) {
    return (
      <EmptyState
        title="暂无已发布资讯"
        description="未来新闻只会在模拟时间到达后出现。"
        icon="news"
      />
    );
  }
  return (
    <div className={compact ? "news-feed compact" : "news-feed"}>
      {visible.map((item) => (
        <article
          key={item.id}
          className={`news-item sentiment-${item.sentiment}`}
        >
          <div className="news-meta">
            <time dateTime={item.simulatedDate}>
              {formatDateTime(item.publishedAtSec)}
            </time>
            <span>{item.source}</span>
            <span className={`news-sentiment ${item.sentiment}`}>
              {SENTIMENT_LABELS[item.sentiment]}
            </span>
          </div>
          <h3>{item.headline}</h3>
          <p>{item.summary}</p>
          <div className="news-tags">
            <span>{CATEGORY_LABELS[item.category]}</span>
            <span>
              范围{" "}
              {item.scope === "market"
                ? "全市场"
                : item.scope === "sector"
                  ? `行业·${item.target}`
                  : `个股·${item.target}`}
            </span>
            <span>
              影响
              {item.impact === "large"
                ? "较大"
                : item.impact === "medium"
                  ? "中等"
                  : "较小"}
            </span>
            <span>{item.durationMinutes} 分钟</span>
          </div>
        </article>
      ))}
    </div>
  );
}
