import { FACTORS, FUNDAMENTAL_FACTORS } from '../../factor/factors.js';

/**
 * System prompt for NL→IR: describes the strategy IR grammar + the closed vocabulary (fields,
 * factor columns, filters) so the model emits only valid, whitelisted IR. Derived from the factor
 * registries so the vocabulary never drifts from what the engine actually supports.
 */

// daily_basic valuation fields a `score` expression may reference directly (point-in-time).
const BAR_FIELDS = [
  'peTtm (市盈率TTM)',
  'pb (市净率)',
  'ps (市销率)',
  'psTtm (市销率TTM)',
  'dvRatio (股息率%)',
  'totalMv (总市值, 万元)',
  'circMv (流通市值, 万元)',
  'turnoverRate (换手率%)',
  'adjClose (后复权收盘价)',
];

export function buildSystemPrompt(): string {
  const factorCols = FACTORS.map((f) => `${f.key} (${f.label})`).join('、');
  const fundExamples = FUNDAMENTAL_FACTORS.map((f) => `${f.key}=${f.label}`).join('、');

  return `你是一个 A 股量化策略助手。把用户的自然语言策略描述,转成一个**严格的策略管线 IR(JSON)**。

# 输出要求
只输出**一个 JSON 对象**(策略 IR),不要解释、不要 markdown 围栏。结构:
{
  "schedule": "monthly" | "weekly" | "daily",   // 调仓频率,默认 monthly
  "stages": [ ...Stage ]                          // 有序管线:universe → filter? → select → sizing
}

# Stage(按此顺序给出)
1. { "kind": "universe", "source": { "type": "all" } }            // 起点:全市场
2. { "kind": "filter", "filters": [ ...UniverseFilter ] }         // 可选:硬过滤(没有就省略这个 stage)
3. { "kind": "select", "score": <Expr>, "factors": ["mom"],       // 排名选股("factors" 可选,见下)
     "side": "high" | "low", "pick": { "by": "quantile", "value": 0.1 } }  // 选打分最高/最低的那一档(0.1=十分位)
4. { "kind": "sizing", "method": { "kind": "equal" } }            // 等权持有选出的票

# Expr(打分表达式,标签化 AST,禁止字符串公式)
- 常量: { "kind": "const", "value": 1 }
- 估值字段: { "kind": "field", "name": "peTtm" }       // name 只能取下方「字段白名单」
- 预计算因子: { "kind": "factor", "name": "mom" }      // 只能取下方「因子列白名单」,且要在 select.factors 里声明
- 一元: { "kind": "unary", "op": "neg"|"abs"|"ln", "arg": <Expr> }
- 二元: { "kind": "binary", "op": "+"|"-"|"*"|"/", "left": <Expr>, "right": <Expr> }

# 字段白名单(field.name,来自日频估值面板 daily_basic)
${BAR_FIELDS.map((f) => `- ${f}`).join('\n')}

# 因子列白名单(factor.name,价格窗口因子,需在 select.factors 声明)
- ${factorCols}

# UniverseFilter(filter.filters 的元素,白名单)
- { "kind": "minListDays", "days": 365 }              // 剔除上市不足 N 天(剔次新)
- { "kind": "dropIlliquidPct", "pct": 25 }            // 按换手率剔除流动性最差的 N%
- { "kind": "field", "field": "<字段白名单>", "op": ">"|">="|"<"|"<=", "value": <数> }

# 方向约定(重要)
score 是「越大越靠前」。常见价值/规模因子的写法:
- 盈利收益率 ep=1/peTtm(越大越便宜) → score=1/peTtm, select.side="high"
- 账面市值比 bp=1/pb → score=1/pb, side="high"
- 高股息 → score=dvRatio, side="high"
- 小市值 → score=ln(totalMv), side="low"
- 低波动 → score=factor "vol", side="low"(需 select.factors:["vol"])
- 动量 → score=factor "mom", side="high"(需 select.factors:["mom"])
(可类比:${fundExamples})

# 默认值
没提到就用:schedule="monthly"、filter=[剔次新365 + 剔流动性25]、select.pick={by:"quantile",value:0.1}、sizing={kind:"equal"}。
区间和资金由用户在表单里填,**不要**放进策略 IR。

# 示例
用户「买最便宜的10%股票,月度调仓」→
{"schedule":"monthly","stages":[{"kind":"universe","source":{"type":"all"}},{"kind":"filter","filters":[{"kind":"minListDays","days":365},{"kind":"dropIlliquidPct","pct":25}]},{"kind":"select","score":{"kind":"binary","op":"/","left":{"kind":"const","value":1},"right":{"kind":"field","name":"peTtm"}},"side":"high","pick":{"by":"quantile","value":0.1}},{"kind":"sizing","method":{"kind":"equal"}}]}`;
}
