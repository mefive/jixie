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
    guidedTitle: '沿五条学习路径实践',
    guidedDescription:
      '从可信研究、策略和 Factor 证据，继续练习可追溯的回测、信号治理、多资产归因与压力情景，并保留失败案例。',
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
          '用盈利收益率预设冻结沪深 300 股票横截面问题，结合 Rank IC、十组收益、中性化和一次正式保留段揭示裁决证据。',
        start: '开始因子研究',
        stepsTitle: '这条路径怎样推进',
        steps: {
          hypothesis: {
            title: '预注册假设',
            description: '固定正向预期、主要标准和唯一诊断。',
          },
          scope: {
            title: '冻结范围',
            description: '使用沪深 300 历史时点成分与月频全局排序。',
          },
          rank: {
            title: '阅读排序证据',
            description: '区分 Rank IC、十组收益和多空研究构造。',
          },
          holdout: {
            title: '揭示保留段',
            description: '核对冻结协议，只进行一次不可逆揭示。',
          },
          verdict: {
            title: '裁决证据',
            description: '保留冲突和失败，不自动发布或转成策略。',
          },
        },
      },
      signal: {
        eyebrow: '第四条 · 信号治理',
        title: '国债曲线到每日信号',
        description:
          '用国债收益率曲线 Factor 串联正式保留段、费后回测、部署和指定日期信号，区分系统运行正确与策略证据合格。',
        start: '开始信号治理',
        stepsTitle: '这条路径怎样推进',
        steps: {
          evidence: {
            title: '设置证据门槛',
            description: '先冻结国债曲线假设和稳健 t 值标准。',
          },
          lineage: {
            title: '保留失败证据',
            description: '一次揭示正式 Holdout，并接受方向反转。',
          },
          backtest: {
            title: '核对费后回测',
            description: '追踪 Factor key、代码 hash、费用与实际成交。',
          },
          deploy: {
            title: '冻结部署快照',
            description: '确认策略和曲线输入进入不可变运行版本。',
          },
          audit: {
            title: '审计每日信号',
            description: '区分指令、模拟成交和实际执行，并暂停失败候选。',
          },
        },
      },
      allocation: {
        eyebrow: '第五条 · 配置归因',
        title: '股债配置与风险归因',
        description:
          '用不含黄金和商品的股债 Panel Factor 运行月度轮动，对照股票基线，核对收益贡献、风险集中、相关性、利率环境和压力情景。',
        start: '开始配置归因',
        stepsTitle: '这条路径怎样推进',
        steps: {
          universe: {
            title: '冻结股债范围',
            description: '区分 Factor 资产域、Panel 研究池和策略交易池。',
          },
          baseline: {
            title: '建立股票基线',
            description: '用相同日期、资金和成本运行沪深 300 买入持有。',
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
            description: '区分线性情景、历史复现和预测，保留收益落后的结果。',
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
      research: '文档、数据、运行、Agent 与快照。',
      publicLibrary: '分享和复制公开研究资产。',
      stockDetail: '价格、复权、估值和成交数据。',
      backtesting: '策略、运行、结果、成本和组合风险。',
      factorResearch: '因子定义、报告、稳健推断和发布。',
      factorWeather: '持续观察已发布 Factor 的近期状态。',
      marketValuation: '市场气象、估值和历史回放。',
      signals: '部署、信号、条件单和执行记录。',
    },
  },
  groups: {
    learningPaths: '学习路径',
    gettingStarted: '开始使用',
    basics: '量化交易基础',
    research: '自然语言研究',
    publicLibrary: '公共资产库',
    stockDetail: '对象详情',
    backtesting: '回测工作台',
    factorResearch: '因子研究',
    factorWeather: '因子气象',
    marketValuation: '市场与估值',
    signals: '今日信号',
  },
};
