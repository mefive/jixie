export const zhHelp = {
  title: '使用帮助',
  allArticles: '文档目录',
  onThisPage: '本页内容',
  articlePager: '文章导航',
  previous: '上一篇',
  next: '下一篇',
  home: {
    eyebrow: '机械交易系学习中心',
    title: '从学习路径开始，也可以按页面查找',
    intro:
      '学习路径把概念、项目内真实例子、可复现练习和完成检查串在一起；页面手册继续提供所有功能的操作说明。',
    guidedTitle: '沿七条学习路径实践',
    guidedDescription:
      '从可信研究、策略和 Factor 证据，继续练习信号治理、多资产归因、商品期限结构与样本外裁决，并保留失败案例。',
    guidedAction: '从描述性研究开始',
    manualTitle: '按页面查使用方法',
    manualDescription: '适合已经知道要使用哪项功能，直接查看当前控件、口径和限制。',
    manualAction: '打开产品与页面导航',
    paths: {
      research: {
        eyebrow: '第一条 · 描述性研究',
        title: '可信跨市场研究',
        description:
          '用沪深 300、恒生和标普 500 的月度价格指数，学习币种口径、日期对齐、滚动相关、区块 bootstrap 和诚实结论。',
        start: '开始描述性研究',
        stepsTitle: '这条路径怎样推进',
        steps: {
          question: {
            title: '冻结问题',
            description: '在看结果前写下样本、预期和反证条件。',
          },
          semantics: {
            title: '核对语义',
            description: '区分价格指数、ETF、本币收益和人民币收益。',
          },
          compute: {
            title: '可复现计算',
            description: '用稳定 ID 和完整月份生成共同样本。',
          },
          uncertainty: {
            title: '表达不确定性',
            description: '同时检查全样本、滚动窗口和区块 bootstrap。',
          },
          conclusion: {
            title: '限制结论',
            description: '保留冲突证据，不把历史相关写成配置建议。',
          },
        },
      },
      strategy: {
        eyebrow: '第二条 · 策略研究',
        title: '沪深 300 趋势策略',
        description:
          '把均线趋势写成可执行 ETF 规则，用买入持有基线、参数邻域、交易成本和样本外结果检查它是否站得住。',
        start: '开始策略研究',
        stepsTitle: '这条路径怎样推进',
        steps: {
          rules: {
            title: '冻结规则',
            description: '固定 ETF、信号、仓位、样本与反证条件。',
          },
          baseline: {
            title: '建立基线',
            description: '先运行同一 ETF 的买入持有，避免只看策略曲线。',
          },
          scan: {
            title: '审查参数',
            description: '预先指定主参数，再比较 20／60／120 日敏感性。',
          },
          costs: {
            title: '核对成本',
            description: '检查成交、换手、费用、滑点和压力成本。',
          },
          verdict: {
            title: '阅读样本外',
            description: '保留失败结果，不把一次回测写成可部署策略。',
          },
        },
      },
      factor: {
        eyebrow: '第三条 · 因子研究',
        title: '沪深 300 价值因子',
        description:
          '阅读沪深 300 盈利收益率历史案例，理解 Rank IC、十组收益、中性化和不同样本区间。',
        start: '开始因子研究',
        stepsTitle: '这条路径怎样推进',
        steps: {
          hypothesis: {
            title: '明确研究问题',
            description: '说明预期方向和需要观察的指标。',
          },
          scope: {
            title: '冻结范围',
            description: '使用沪深 300 历史时点成分与月频全局排序。',
          },
          rank: {
            title: '阅读排序证据',
            description: '区分 Rank IC、十组收益和多空研究构造。',
          },
          samples: {
            title: '比较样本区间',
            description: '核对历史报告的日期和方法，理解各区间差异。',
          },
          verdict: {
            title: '裁决证据',
            description: '保留冲突和失败，不自动发布或转成策略。',
          },
        },
      },
      allocation: {
        eyebrow: '第四条 · 配置归因',
        title: '股债配置与风险归因',
        description:
          '用不含黄金和商品的股债 Panel Factor 运行月度轮动，通过股票、静态股债、零成本与真实成本四组实跑拆分配置、择时和成本。',
        start: '开始配置归因',
        stepsTitle: '这条路径怎样推进',
        steps: {
          universe: {
            title: '冻结股债范围',
            description: '区分 Factor 资产域、Panel 研究池和策略交易池。',
          },
          baseline: {
            title: '建立诊断对照',
            description: '实跑股票、静态股债、动态零成本和动态真实成本。',
          },
          attribution: {
            title: '对账收益与风险',
            description: '比较平均权重、收益贡献、风险贡献和真实成本。',
          },
          correlation: {
            title: '阅读条件关系',
            description: '核对滚动股债相关和不同利率环境下的历史表现。',
          },
          stress: {
            title: '压力测试并裁决',
            description: '区分资产配置、择时与成本，保留证据不支持生产的结果。',
          },
        },
      },
      commodity: {
        eyebrow: '第五条 · 商品研究',
        title: '商品 Carry 历史案例',
        description: '阅读黄金、铜、原油和豆粕历史报告，理解期限结构、代理误差及不稳定结果。',
        start: '开始商品研究',
        stepsTitle: '这条路径怎样推进',
        steps: {
          semantics: {
            title: '定义期限结构',
            description: '区分 Carry、连续收益、换月价差和真实盈亏。',
          },
          proxies: {
            title: '审计代理误差',
            description: '核对实际期货品种与四只映射 ETF 的差异。',
          },
          design: {
            title: '阅读两种分析',
            description: '比较横截面排序和逐商品时间序列的研究问题。',
          },
          samples: {
            title: '核对历史样本',
            description: '比较历史报告的日期范围与不同统计口径。',
          },
          verdict: {
            title: '保留失败裁决',
            description: '不在 Rank IC、收益和单品种 t 值间事后挑选。',
          },
        },
      },
      positiveFactor: {
        eyebrow: '第六条 · 正面准入',
        title: '销售收益率与因子准入',
        description: '阅读销售收益率原始历史报告，核对代码、冗余、成本和样本敏感性。',
        start: '开始正面因子研究',
        stepsTitle: '这条路径怎样推进',
        steps: {
          definition: {
            title: '冻结销售收益率',
            description: '定义 1/PS_TTM、方向、缺失规则和数据边界。',
          },
          gates: {
            title: '检查三类证据',
            description: '结合 Rank IC、冗余、成本和辅助证据解释结果。',
          },
          explore: {
            title: '读取探索与冗余',
            description: '先确认方向，再排除 EP、BP 和规模换皮。',
          },
          samples: {
            title: '核对另一段样本',
            description: '阅读既有结果，不把重复检查称为新样本。',
          },
          advance: {
            title: '晋级但不跳级',
            description: '准入研究菜单，同时保留权重与末月敏感性。',
          },
        },
      },
    },
    manualSectionTitle: '页面手册',
    manualSectionDescription: '从产品区域进入完整文章目录；每篇文章保持中英文同步。',
    articleCount: '{{count}} 篇文章',
    manualGroups: {
      gettingStarted: '登录、导航和第一次研究。',
      basics: '市场对象、收益风险和研究局限。',
      research: '文档、财报数据、Agent、嵌入分析与快照。',
      stockDetail: '价格、复权、估值和成交数据。',
      backtesting: '策略草稿、历史报告、结果比较与组合风险。',
      factorResearch: '因子定义、报告、稳健推断和发布。',
      factorWeather: '持续观察预置和已发布自定义单因子的近期状态。',
      marketValuation: '市场气象、估值和历史回放。',
    },
  },
  groups: {
    learningPaths: '学习路径',
    gettingStarted: '开始使用',
    basics: '量化交易基础',
    research: '研究工作台',
    stockDetail: '对象详情',
    backtesting: '策略工作台',
    factorResearch: '因子研究',
    factorWeather: '因子气象',
    marketValuation: '市场与估值',
  },
};
