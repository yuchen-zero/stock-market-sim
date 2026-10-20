# 严格验收矩阵

验收日期：2026-10-20  
结论：**PASS**

## 最终命令门槛

| 命令 | 实际结果 | 判定 |
| --- | --- | --- |
| `npm test` | 4 个测试文件，62 项测试全部通过 | PASS |
| `npm run build` | TypeScript 检查、Vite 生产构建成功 | PASS |
| `npm run test:e2e` | Chromium + Firefox + WebKit，33 项全部通过 | PASS |

浏览器验收使用 Playwright 1.64.1，`workers=1`，无跳过、无重试掩盖。测试状态由确定性引擎直接生成并注入 `localStorage`，避免模拟时钟竞态。

## 严格补丁项

| # | 验收项 | 证据 | 判定 |
| --- | --- | --- | --- |
| 1 | 集合竞价按买卖可见容量较小值撮合，按 `createdAtSec`、订单序号消耗；容量耗尽后不再成交 | `engine.test.ts`：auction capacity、shared capacity、createdAtSec priority、continuous-to-close 用例 | PASS |
| 2 | 30 日窗口 earnings 恰好 4–8 个；普通新闻不生成 earnings；真实名称无 earnings；财报更新基本面 | `engine.test.ts`：earnings window、deterministic publication、fairValue/EPS/PE/revenueGrowth 用例 | PASS |
| 3 | 补齐提示词第 17 节测试 | 下方 17.1、17.2、17.3 全部逐项通过 | PASS |
| 4 | Chromium、Firefox、WebKit 验收 | 11 个流程 × 3 引擎，33/33 通过 | PASS |
| 5 | tick、页面切换、设置修改、引导步骤均一次 Zustand 提交；页面用切片选择器 | `store.test.ts` 提交次数测试；`components.test.tsx` 切片重渲染测试；页面统一使用 `useCurrentSimulationView` | PASS |
| 6 | 价格图与成交量图为两个独立实例，逻辑范围与十字线同步 | `PriceChart.tsx` 双 `createChart`、单向范围跟随、事件源隔离十字线；E2E 检查两个 canvas 并验证价格图悬停会改变成交量图 | PASS |
| 7 | 三条命令全部通过后才判定完成 | 上方命令表 | PASS |

## 17.1 引擎单元测试

| # | 要求 | 自动测试覆盖 | 判定 |
| --- | --- | --- | --- |
| 1 | 同种子初始与 10 tick 一致 | `is reproducible for the same seed...` | PASS |
| 2 | 260 日、30 分钟、分钟 OHLC/成交量约束 | `builds valid 260-day...` | PASS |
| 3 | 价格为正、A 股不越涨跌停、美股无涨跌停 | `keeps A-share prices inside board limits...` | PASS |
| 4 | 主板/ST/创业板/科创板涨跌停比例 | `uses the correct board price limits...` | PASS |
| 5 | 100 股单位、科创板 200 股与 1 股递增、零股卖清 | board quantity、odd-lot 用例 | PASS |
| 6 | A 股 T+1、美股 T+0 | `enforces A-share T+1 and US T+0` | PASS |
| 7 | 佣金/印花税/过户费分项取整、最低佣金一次 | fee half-cent、partial commission 用例 | PASS |
| 8 | 市价单五档成交、部分成交、余量撤销 | `matches a market order across finite five-level depth...` | PASS |
| 9 | 限价未触价 pending，触价后成交 | pending/cancel、跨分钟继续成交、竞价成交用例 | PASS |
| 10 | 竞价限价制、两个禁撤窗口、连续单进入收盘竞价 | auction、禁撤、closing carry 用例 | PASS |
| 11 | 撤单释放资金/股份，收盘未成交过期 | cash/sellable release、closing expiry 用例 | PASS |
| 12 | 幂等与冲突意图 | `is idempotent...` | PASS |
| 13 | 重置/导入/恢复新世代，旧请求失效，版本递增 | generation、store reset/import/restore、old-generation 用例 | PASS |
| 14 | 新闻发布可见性、财报更新、真实名称无财报 | earnings window/update、real-name neutral 用例 | PASS |
| 15 | 同种子新闻顺序与价格路径复现 | deterministic news/price 用例 | PASS |
| 16 | 评分、评级、回撤、分散、纪律、理由覆盖率和洞察 | score formula、score parts、30-day report 用例 | PASS |
| 17 | 现金、冻结、持仓、FIFO、成交金额可对账 | reconciliation 与 next-day FIFO sale 用例 | PASS |
| 18 | 快照不含派生图表且载入可重建 | `serializes without derived chart blocks...` | PASS |

## 17.2 状态与组件测试

| # | 要求 | 自动测试覆盖 | 判定 |
| --- | --- | --- | --- |
| 1 | 六槽位互不覆盖 | storage 六槽位测试 | PASS |
| 2 | 切换后持仓、订单、时间、种子保持 | store switch 测试 | PASS |
| 3 | 导出导入恢复并生成新世代 | storage import 测试 | PASS |
| 4 | 损坏存档恢复提示；配额失败不丢内存 | corrupt-load UI、backup、quota store 测试 | PASS |
| 5 | 资金不足、可卖不足、非交易、竞价市价中文原因 | engine 错误码与中文 message 测试、Chromium/Firefox/WebKit UI 测试 | PASS |
| 6 | 点击盘口带价并切换限价 | component quote-click 测试 | PASS |
| 7 | A 股/美股币种、单位、涨跌停信息 | engine 规则、E2E 股票详情断言 | PASS |
| 8 | 真实名称模式声明 | AppShell component、三引擎真实模式流程 | PASS |
| 9 | 风险预览逐字段与引擎一致 | `matches every risk-preview field...` | PASS |
| 10 | 引导跳过/步骤恢复/重播；帮助关闭按钮/Esc/遮罩 | onboarding、persistence、help drawer 关闭测试 | PASS |
| 11 | 双击只生成一个订单 | component double-click 测试 | PASS |

## 17.3 验收流程

| # | 流程 | 证据 | 判定 |
| --- | --- | --- | --- |
| 1 | 首次打开进入虚构 A 股行情页 | E2E `opens the market directly...` | PASS |
| 2 | 浏览行情、添加自选、进入个股、查看图表/盘口 | E2E watchlist/terms/chart 流程 | PASS |
| 3 | 限价买入 A 股，确认 T+1，次日可卖 | engine T+1、next-day FIFO 测试 | PASS |
| 4 | 超额买入、超额卖出、重复提交 | engine funds/shares、component double-click 测试 | PASS |
| 5 | 市价买入逐档成交、费用和持仓更新 | engine depth、E2E 市价交易与持仓测试 | PASS |
| 6 | 688981 最低 200 股、1 股递增 | 三引擎 E2E | PASS |
| 7 | 两个禁撤窗口与 15:00 收盘撮合 | 三引擎 E2E 禁撤；engine closing-capacity 测试 | PASS |
| 8 | 真实名称声明与中性新闻 | 三引擎无利好/利空声明检查；engine 中性模板测试 | PASS |
| 9 | 美股 T+0、1 股、美元、无涨跌停 | 三引擎 E2E + engine 规则测试 | PASS |
| 10 | 美股盘前盘后市价拒绝、限价可提交 | 三引擎 E2E | PASS |
| 11 | 30 日挑战加速、报告、评级、覆盖率、洞察 | 三引擎 E2E + engine 30 close 测试 | PASS |
| 12 | 刷新恢复市场/模式/时间并重建图表 | 三引擎 E2E 刷新图表测试 | PASS |
| 13 | 导出、重置、导入、旧世代失效 | 三引擎 E2E | PASS |
| 14 | 1440×900、1024×768、390×844 无页面级横向溢出 | 三引擎 E2E | PASS |
| 15 | `npm test` 与 `npm run build` 全部通过 | 命令门槛表 | PASS |

## 三引擎矩阵

| 浏览器流程 | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| 首次启动、自选、真实名称声明 | PASS | PASS | PASS |
| 09:20–09:25 撤单拒绝 | PASS | PASS | PASS |
| 14:57–15:00 撤单拒绝 | PASS | PASS | PASS |
| 688981 最低 200 股与 1 股递增 | PASS | PASS | PASS |
| 资金不足与 T+1 可卖限制 | PASS | PASS | PASS |
| 美股 T+0 与 1 股交易 | PASS | PASS | PASS |
| 美股盘前盘后市价拒绝、限价接受 | PASS | PASS | PASS |
| 刷新、导出、重置、导入、旧世代失效 | PASS | PASS | PASS |
| 30 日挑战报告、评级、覆盖率、洞察 | PASS | PASS | PASS |
| 行情表头、KPI、图表指标术语入口 | PASS | PASS | PASS |
| 独立价格/成交量图与三种视口 | PASS | PASS | PASS |

## 运行产物

- Playwright HTML 报告：`playwright-report/index.html`
- 三引擎图表截图与导出样本：`test-results/`
- 本矩阵中的 PASS 仅对应当前仓库状态；任何后续代码修改必须重新运行三条命令并更新矩阵。
