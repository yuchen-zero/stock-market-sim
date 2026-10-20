import { useMemo, useState } from "react";
import { visibleNewsAt } from "../engine/news";
import { dateToEpochSec } from "../engine/time";
import type { NewsEvent } from "../types/domain";
import { useCurrentSimulationView } from "../store/useSimulationStore";
import { CATEGORY_LABELS, NewsFeed } from "../components/NewsFeed";
import { Icon } from "../components/Icons";
import { EmptyState, Panel, SectionHeading } from "../components/ui";

type Filter = "all" | NewsEvent["category"];

export function NewsPage() {
  const simulation = useCurrentSimulationView((current) =>
    current
      ? {
          news: current.news,
          simulatedDate: current.simulatedDate,
          minuteOfDay: current.minuteOfDay,
        }
      : null,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const allVisible = simulation
    ? visibleNewsAt(
        simulation.news,
        dateToEpochSec(simulation.simulatedDate, simulation.minuteOfDay),
      )
    : [];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return allVisible.filter(
      (item) =>
        (filter === "all" || item.category === filter) &&
        (!normalized ||
          item.headline.toLowerCase().includes(normalized) ||
          item.summary.toLowerCase().includes(normalized) ||
          item.source.toLowerCase().includes(normalized)),
    );
  }, [simulation, filter, query]);
  if (!simulation) return null;
  const categories: Filter[] = [
    "all",
    "macro",
    "policy",
    "sector",
    "company",
    "earnings",
    "overseas",
  ];
  const counts = Object.fromEntries(
    categories.map((category) => [
      category,
      category === "all"
        ? allVisible.length
        : allVisible.filter((item) => item.category === category).length,
    ]),
  ) as Record<Filter, number>;

  return (
    <div className="page news-page">
      <div className="page-title-row">
        <div>
          <div className="page-kicker">本地生成 · 按模拟发布时间解锁</div>
          <h1>资讯中心</h1>
          <p>
            新闻与价格路径共用确定性种子；尚未到发布时刻的事件不会出现在页面、搜索或调试列表中。
          </p>
        </div>
        <div className="news-count">
          已发布 <strong>{allVisible.length}</strong> 条
        </div>
      </div>

      <Panel className="news-filter-panel">
        <div className="news-filter-row">
          <div className="filter-chips" role="group" aria-label="资讯分类">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={filter === category ? "active" : ""}
                aria-pressed={filter === category}
                onClick={() => setFilter(category)}
              >
                {category === "all" ? "全部" : CATEGORY_LABELS[category]}
                <span>{counts[category]}</span>
              </button>
            ))}
          </div>
          <div className="search-field">
            <Icon name="search" size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、摘要或来源"
              aria-label="搜索已发布资讯"
            />
          </div>
        </div>
        <div className="future-news-note">
          <Icon name="lock" size={14} />
          未来新闻保留在仿真状态中，仅会在模拟时钟到达发布时间后进入可见列表。
        </div>
      </Panel>

      <Panel className="news-list-panel">
        <SectionHeading
          title={filter === "all" ? "全部已发布资讯" : `${CATEGORY_LABELS[filter]}资讯`}
          description={`${filtered.length} 条结果 · 来源均为虚构模拟媒体`}
        />
        {filtered.length > 0 ? (
          <NewsFeed news={filtered} />
        ) : (
          <EmptyState
            title="没有匹配的资讯"
            description={
              allVisible.length === 0
                ? "继续推进仿真时间，新闻会按计划陆续发布。"
                : "尝试切换分类或清空搜索关键词。"
            }
            icon="news"
          />
        )}
      </Panel>
    </div>
  );
}
