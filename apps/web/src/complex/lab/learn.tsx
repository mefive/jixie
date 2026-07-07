import { useEffect, useState, type ReactNode } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react';
import banner from '@src/assets/banner.png';
import { localeStore } from '@src/i18n/locale-store';
import './learn.css';

/**
 * Standalone getting-started tutorial (route `/learn`, linked from /docs's top bar + the lab hero).
 * A *linear* learning path (vs /docs, which is the by-symbol reference): copy a running strategy, then
 * build up the mental model — onBar/T+1, bar vs bars, order vs target — hands-on, with a short "why"
 * aside only where it prevents a real pitfall. Same Apple-docs ink shell as sdk-doc; bilingual (中/EN),
 * driven by the app-wide localeStore (its own compact toggle in the bar, since it has no TopNav).
 */
export default observer(function LearnPage() {
  const locale = localeStore.locale;
  const t = (zh: string, en: string) => (locale === 'en' ? en : zh);
  const active = useScrollSpy(SECTIONS.map((s) => s.id));

  return (
    <div className="jx-learn">
      <header className="jx-learn-bar">
        <a className="jx-learn-brand" href="/lab">
          <img className="jx-learn-banner" src={banner} alt="机械交易系" />
          <span className="jx-learn-brandSub">{t('· 策略入门', '· Getting started')}</span>
        </a>
        <nav className="jx-learn-topnav">
          <a className="jx-learn-topLink jx-learn-topLink--on" href="/learn">
            {t('教程', 'Tutorial')}
          </a>
          <a className="jx-learn-topLink" href="/docs">
            {t('SDK 文档', 'SDK Reference')}
          </a>
          <div className="jx-learn-lang">
            {(['zh', 'en'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={classNames('jx-learn-langBtn', {
                  'jx-learn-langBtn--on': locale === option,
                })}
                onClick={() => localeStore.setLocale(option)}
              >
                {option === 'zh' ? '中' : 'EN'}
              </button>
            ))}
          </div>
          <a className="jx-learn-topCta" href="/lab">
            {t('打开工作台 →', 'Open workbench →')}
          </a>
        </nav>
      </header>

      <div className="jx-learn-layout">
        <nav className="jx-learn-nav">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={navCls('jx-learn-navLink', s.id === active)}>
              <span className="jx-learn-navNum">{s.num}</span>
              {t(s.nav.zh, s.nav.en)}
            </a>
          ))}
        </nav>

        <main className="jx-learn-main">
          <div className="jx-learn-eyebrow">{t('教程', 'Tutorial')}</div>
          <h1 className="jx-learn-title">
            {t('十分钟写出你的第一个策略', 'Write your first strategy in ten minutes')}
          </h1>
          <p className="jx-learn-abstract">
            {t(
              '从复制一个能跑的策略开始,建立「引擎每天调一次 onBar」的心智,弄懂读数据的 ',
              'Start by copying a strategy that runs. Build the intuition that the engine calls onBar once a day. Learn the data readers ',
            )}
            <code>bar</code>/<code>bars</code>
            {t(' 和下单的 ', ' and the order verbs ')}
            <code>order</code>/<code>target</code>
            {t(
              ',最后自己搭一个截面选股。整手、涨跌停、T+1、复权、成本都由引擎在背后强制,你只写逻辑。',
              ', then build your own cross-section stock picker. Whole-lot rounding, price limits, T+1, back-adjustment and costs are all enforced by the engine behind the scenes — you just write the logic.',
            )}
          </p>

          {/* 01 —— first strategy */}
          <Section
            id="quickstart"
            num="01"
            title={t('五分钟:你的第一个策略', 'Five minutes: your first strategy')}
          >
            <p className="jx-learn-p">
              {t('先跑通,再理解。打开', 'Run it first, understand it later. Open the ')}
              <a className="jx-learn-inlineLink" href="/lab">
                {t('回测工作台', 'backtest workbench')}
              </a>
              {t(
                ',把下面这段粘进代码编辑器,选好回测区间,点「运行」。它做的事很简单:',
                ', paste the snippet below into the code editor, pick a backtest range, and click Run. What it does is simple: ',
              )}
              <b>
                {t(
                  '收盘价上穿 20 日均线就满仓买入,下穿就清仓',
                  'go all-in when the close crosses above the 20-day moving average, liquidate when it crosses below',
                )}
              </b>
              {t('。', '.')}
            </p>
            <pre className="jx-learn-code">{CODE_MA20}</pre>
            <p className="jx-learn-p">
              {t(
                '跑完你会看到净值曲线、成交明细、和一堆绩效指标。这已经是一次',
                "When it finishes you'll see the equity curve, the trade log and a batch of performance metrics. This is already a ",
              )}
              <b>{t('贴近真实的 A 股回测', 'realistic A-share backtest')}</b>
              {t(
                ' —— 买入按 100 股整手、当日买次日才能卖(T+1)、开在涨停板买不进、佣金印花税都算了。这些你一行没写,是引擎替你强制的。',
                " — buys are rounded to 100-share lots, shares bought today can only be sold the next day (T+1), you can't buy into a limit-up open, and commission and stamp duty are all counted. You wrote none of it — the engine enforces it for you.",
              )}
            </p>
            <Why label={t('为什么', 'Why')}>
              {t('不用写任何 ', 'You need no ')}
              <code>import</code>
              {t('。', '. ')}
              <code>defineStrategy</code>
              {t(' 和 ', ' and ')}
              <code>ctx</code>
              {t(
                ' 都是注入的全局,编辑器已经认识它们(悬停符号能看类型、⌘I 查文档)。',
                ' are injected globals — the editor already knows them (hover a symbol for its type, ⌘I for docs).',
              )}
            </Why>
          </Section>

          {/* 02 —— onBar */}
          <Section
            id="onbar"
            num="02"
            title={t('onBar:策略的心跳', "onBar: the strategy's heartbeat")}
          >
            <p className="jx-learn-p">
              {t(
                '引擎按交易日一天天往前走,',
                'The engine walks forward one trading day at a time, ',
              )}
              <b>
                {t('每个交易日调用一次你的 ', 'calling your ')}
                <code>onBar(ctx)</code>
                {t('', ' once per trading day')}
              </b>
              {t('。关键是那个 ', '. The key is that ')}
              <code>ctx</code>
              {t(':它', ': it is ')}
              <b>{t('永远绑定「今天」', 'always bound to "today"')}</b>
              {t(
                ',没有 date 参数。所以一天里发生三件事:',
                ', with no date parameter. So three things happen within a day:',
              )}
            </p>
            <ol className="jx-learn-steps">
              <li>
                <b>{t('执行昨天排的单', "Execute yesterday's queued orders")}</b>
                {t(
                  ' —— 昨天收盘你下的意图,在',
                  ' — the intent you placed at yesterday’s close fills at ',
                )}
                <b>{t('今天开盘价', "today's open")}</b>
                {t('成交。', '.')}
              </li>
              <li>
                <b>{t('按今天收盘估值', "Mark to today's close")}</b>
                {t(
                  ' —— 记一个净值点,连起来就是权益曲线。',
                  ' — record one equity point; joined together they form the equity curve.',
                )}
              </li>
              <li>
                <b>{t('调 onBar,你做决定', 'Call onBar, you decide')}</b>
                {t(
                  ' —— 你能读到的最新数据截止今天;下的单进队列,',
                  ' — the latest data you can read stops at today; the orders you place go into the queue, ',
                )}
                <b>{t('留给明天开盘', "left for tomorrow's open")}</b>
                {t('成交。', ' to fill.')}
              </li>
            </ol>
            <Why label={t('为什么', 'Why')}>
              {t('为什么 ', 'Why does ')}
              <code>ctx</code>
              {t(
                ' 没有 date 参数、决策和成交要隔一天?因为这从',
                ' have no date parameter, and why are decision and fill a day apart? Because this ',
              )}
              <b>{t('物理上杜绝了未来函数', 'physically rules out look-ahead bias')}</b>
              {t(
                ': 你在今天收盘做决策时,根本拿不到明天的价格,也就不可能「偷看」结果再下单。这是回测可信的地基。',
                ': when you decide at today’s close you simply cannot access tomorrow’s price, so you can’t "peek" at the outcome before ordering. This is the foundation of a trustworthy backtest.',
              )}
            </Why>
          </Section>

          {/* 03 —— bar vs bars */}
          <Section
            id="data"
            num="03"
            title={t(
              '读数据:bar 一横排,bars 一纵列',
              'Reading data: bar is a row, bars is a column',
            )}
          >
            <p className="jx-learn-p">
              {t('名字只差一个 ', 'One ')}
              <code>s</code>
              {t(',却是两个世界。', ' apart in name, but two different worlds. ')}
              <code>bar</code>
              {t(' 是', ' is ')}
              <b>
                {t(
                  '今天全市场里某只票的一整行',
                  "one whole row for a single stock across today's market",
                )}
              </b>
              {t('(横切), ', ' (a horizontal slice), while ')}
              <code>bars</code>
              {t(' 是', ' is ')}
              <b>{t('某只票最近 n 根 K 线', "a single stock's most recent n candles")}</b>
              {t('(纵切)。', ' (a vertical slice).')}
            </p>
            <table className="jx-learn-table">
              <thead>
                <tr>
                  <th></th>
                  <th>
                    <code>ctx.bar(code)</code> {t('单数', 'singular')}
                  </th>
                  <th>
                    <code>ctx.bars(code, n)</code> {t('复数', 'plural')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t('切法', 'Slice')}</td>
                  <td>{t('今天这一天,一整行', 'Today, one whole row')}</td>
                  <td>{t('一只票,最近 n 根', 'One stock, most recent n')}</td>
                </tr>
                <tr>
                  <td>{t('字段', 'Fields')}</td>
                  <td>
                    {t(
                      '全:OHLC + 估值(PE/PB)+ ROE + 换手',
                      'Full: OHLC + valuation (PE/PB) + ROE + turnover',
                    )}
                  </td>
                  <td>{t('少:只有 OHLC + 量额', 'Few: only OHLC + volume/amount')}</td>
                </tr>
                <tr>
                  <td>{t('数据源', 'Source')}</td>
                  <td>
                    {t('截面(', 'Cross-section (loaded by ')}
                    <code>universe()</code>
                    {t(' 加载)', ')')}
                  </td>
                  <td>
                    {t('K 线缓存(', 'Candle cache (')}
                    <code>watch</code> / <code>ensureBars</code>
                    {t(')', ')')}
                  </td>
                </tr>
                <tr>
                  <td>{t('用来', 'Used for')}</td>
                  <td>{t('排序选股', 'Ranking and picking stocks')}</td>
                  <td>
                    {t('算指标(均线、突破、ATR)', 'Computing indicators (MA, breakout, ATR)')}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="jx-learn-p">
              {t('技术指标 ', 'The technical indicators ')}
              <code>ctx.sma / ema / atr / highest</code>
              {t(' 都是在 ', ' are all computed over that ')}
              <code>bars</code>
              {t(' 那一列历史上算出来的,所以它们和 ', ' column of history, so like ')}
              <code>bars</code>
              {t(' 一样,需要该票的 K 线', ' they need the stock’s candles ')}
              <b>{t('先加载进来', 'loaded in first')}</b>
              {t('。加载有两条路:', '. There are two ways to load:')}
            </p>
            <pre className="jx-learn-code">{CODE_LOAD}</pre>
            <Why label={t('为什么', 'Why')}>
              {t('最常见的新手坑:', 'The most common beginner trap: ')}
              <code>await ctx.universe()</code>
              {t(' 拿到一批 code 后直接 ', ' gives you a batch of codes and you immediately call ')}
              <code>ctx.sma(code, 20)</code>
              {t(', 结果全是 ', ', only to get all ')}
              <code>null</code>
              {t('。因为 ', '. That’s because ')}
              <code>universe()</code>
              {t(
                ' 只加载了「今天这一横排」,没加载每只票的纵向历史。 选完票要算指标,记得先 ',
                ' only loaded "today’s horizontal row", not each stock’s vertical history. After picking, to compute indicators remember to ',
              )}
              <code>await ctx.ensureBars(codes)</code>
              {t('。', ' first.')}
            </Why>
          </Section>

          {/* 04 —— order vs target */}
          <Section
            id="orders"
            num="04"
            title={t(
              '下单:order 是动作,target 是目标',
              'Placing orders: order is an action, target is a goal',
            )}
          >
            <p className="jx-learn-p">
              {t(
                '引擎给两种下单范式,一根 bar 里用哪套由你定:',
                'The engine offers two order paradigms; which one you use within a bar is up to you:',
              )}
            </p>
            <table className="jx-learn-table">
              <thead>
                <tr>
                  <th></th>
                  <th>{t('命令式 · order', 'Imperative · order')}</th>
                  <th>{t('声明式 · target', 'Declarative · target')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t('你说的话', 'What you say')}</td>
                  <td>{t('「买 500 股 A、清仓 B」', '"Buy 500 shares of A, liquidate B"')}</td>
                  <td>
                    {t(
                      '「我最终要持有 A、B、C 各 1/3」',
                      '"I want to end up holding A, B, C at 1/3 each"',
                    )}
                  </td>
                </tr>
                <tr>
                  <td>{t('你给的量', 'What you give')}</td>
                  <td>{t('绝对股数(+买 / −卖)', 'Absolute share count (+buy / −sell)')}</td>
                  <td>
                    {t(
                      '目标权重(0~1),引擎换算股数',
                      'Target weight (0–1); the engine converts to shares',
                    )}
                  </td>
                </tr>
                <tr>
                  <td>{t('写法', 'Syntax')}</td>
                  <td>
                    <code>ctx.order(c, n)</code> / <code>ctx.exit(c)</code>
                  </td>
                  <td>
                    <code>ctx.equalWeight(codes)</code> / <code>ctx.setHoldings(w)</code>
                  </td>
                </tr>
                <tr>
                  <td>{t('天生适合', 'Naturally suits')}</td>
                  <td>
                    {t(
                      '单标的择时(海龟:加仓、止损)',
                      'Single-instrument timing (Turtle: add to position, stop-loss)',
                    )}
                  </td>
                  <td>
                    {t(
                      '组合 / 截面选股(一篮子调仓)',
                      'Portfolio / cross-section picking (rebalancing a basket)',
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="jx-learn-p">
              {t('为什么选股要用 ', 'Why use ')}
              <code>target</code>
              {t(' 而不是自己 ', ' for stock picking instead of ordering yourself with ')}
              <code>order</code>
              {t(
                '?因为月度调仓时新旧持仓有重叠,用 order 你得自己算 「哪只清、哪只减、哪只加、各多少股」;而 ',
                '? Because monthly rebalances overlap old and new holdings; with order you’d have to work out yourself "which to liquidate, which to trim, which to add, and how many shares each", whereas with ',
              )}
              <code>target</code>
              {t(' 你只描述', ' you only describe the ')}
              <b>{t('想要的终局', 'end state you want')}</b>
              {t(
                ',差额(先卖非目标、再买)引擎替你做。',
                ', and the engine handles the difference (sell non-targets first, then buy).',
              )}
            </p>
            <Why label={t('为什么', 'Why')}>
              <code>target</code>
              {t(' 是', ' is a ')}
              <b>{t('全量快照,不是增量改单', 'full snapshot, not an incremental edit')}</b>
              {t(':你交出的这份清单', ': the list you hand over ')}
              <b>{t('就是', 'is')}</b>
              {t(
                '完整目标, 任何没列进去的持仓一律按目标 0 处理——',
                ' the complete target, and any holding not on it is treated as target 0 — ',
              )}
              <b>{t('会被卖光', 'it gets sold off')}</b>
              {t('。所以别只写想动的那只(', ". So don't write only the one you want to move (")}
              <code>setHoldings(&#123;A:0.5&#125;)</code>
              {t(
                ' 会清掉 B、C);想清空整个组合,传空 ',
                ' would clear B and C); to empty the whole portfolio, pass an empty ',
              )}
              <code>setHoldings(&#123;&#125;)</code>
              {t(
                ' 即可。而只清一只、别的不动,用命令式的 ',
                '. To exit just one and leave the rest untouched, use the imperative ',
              )}
              <code>ctx.exit('A')</code>
              {t('。', '.')}
            </Why>
          </Section>

          {/* 05 —— hands-on */}
          <Section
            id="walkthrough"
            num="05"
            title={t(
              '实战:一步步搭一个截面选股',
              'Hands-on: build a cross-section picker step by step',
            )}
          >
            <p className="jx-learn-p">
              {t('目标:', 'Goal: ')}
              <b>{t('每月', 'every month')}</b>
              {t('在沪深 300 里挑 ', ', pick the ')}
              <b>
                {t(
                  'ROE>15 且最便宜(EP 最高)的 30 只,等权持有',
                  '30 stocks in the CSI 300 with ROE > 15 and the cheapest (highest EP), held equally weighted',
                )}
              </b>
              {t('。一步步来。', '. Step by step.')}
            </p>
            <p className="jx-learn-p">
              <b>{t('第一步 · 每月只跑一次。', 'Step 1 · run once a month. ')}</b>
              {t(
                '引擎每天都调 onBar,但调仓是月度的,用 ',
                'The engine calls onBar every day, but the rebalance is monthly — use ',
              )}
              <code>ctx.period</code>
              {t(' 配一个 ', ' with a ')}
              <code>let last</code>
              {t(
                ' 守卫,月份没变就直接返回:',
                ' guard, and return early if the month hasn’t changed:',
              )}
            </p>
            <pre className="jx-learn-code">{CODE_STEP1}</pre>
            <p className="jx-learn-p">
              <b>{t('第二步 · 选票。', 'Step 2 · pick stocks. ')}</b>
              {t(
                '拿今天的沪深 300 成分作候选池,链式地过滤 → 排序 → 取头部,再等权下单。 注意用了 ',
                "Take today's CSI 300 constituents as the candidate pool, then chain filter → rank → take the top, and place equal-weight orders. Note that an onBar using ",
              )}
              <code>universe</code>
              {t(' 的 onBar 必须是 ', ' must be ')}
              <code>async</code>
              {t(':', ':')}
            </p>
            <pre className="jx-learn-code">{CODE_STEP2}</pre>
            <p className="jx-learn-p">
              {t('就这样。', "That's it. ")}
              <code>where</code>
              {t(' 过滤、', ' filters, ')}
              <code>rankBy</code>
              {t(' 按 EP(1/PE)从高到低、', ' sorts by EP (1/PE) high to low, ')}
              <code>top(30)</code>
              {t(' 取前 30、', ' takes the top 30, and ')}
              <code>equalWeight</code>
              {t(
                ' 等权建仓——剩下的调仓、成交、成本全归引擎。这个例子只用了 ',
                ' builds an equal-weight position — the engine handles the rest: rebalancing, fills, costs. This example only uses ',
              )}
              <code>bar</code>
              {t(
                ' 的截面字段; 如果你的信号要均线,记得在 ',
                "'s cross-section fields; if your signal needs a moving average, remember to ",
              )}
              <code>top</code>
              {t(' 之后 ', ' after ')}
              <code>await ctx.ensureBars(picks)</code>
              {t('。', '.')}
            </p>
          </Section>

          {/* 06 —— pitfalls */}
          <Section id="pitfalls" num="06" title={t('常见坑', 'Common pitfalls')}>
            <dl className="jx-learn-faq">
              {PITFALLS.map((p) => (
                <div className="jx-learn-faqRow" key={p.q.zh}>
                  <dt className="jx-learn-faqQ">{t(p.q.zh, p.q.en)}</dt>
                  <dd className="jx-learn-faqA">{t(p.a.zh, p.a.en)}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {/* 07 —— next */}
          <Section id="next" num="07" title={t('下一步', 'Next steps')}>
            <p className="jx-learn-p">
              {t(
                '你已经会写两类策略了。接下来:',
                'You can now write both kinds of strategy. Next:',
              )}
            </p>
            <div className="jx-learn-cards">
              <a className="jx-learn-card" href="/docs">
                <div className="jx-learn-cardTitle">{t('SDK 文档 →', 'SDK Reference →')}</div>
                <div className="jx-learn-cardDesc">
                  {t('按符号查 API:', 'Look up the API by symbol: every method on ')}
                  <code>ctx</code>
                  {t(' 的每个方法、', ', the ')}
                  <code>Universe</code>
                  {t(' 链式操作、', ' chain operations, and all ')}
                  <code>BarRow</code>
                  {t(' 全字段。', ' fields.')}
                </div>
              </a>
              <a className="jx-learn-card" href="/lab">
                <div className="jx-learn-cardTitle">
                  {t('回测工作台 →', 'Backtest workbench →')}
                </div>
                <div className="jx-learn-cardDesc">
                  {t(
                    '用一句话描述策略让 AI 写成代码,或直接把上面的例子改成你自己的。',
                    'Describe a strategy in one sentence and let AI turn it into code, or just adapt the example above into your own.',
                  )}
                </div>
              </a>
            </div>
          </Section>
        </main>
      </div>
    </div>
  );
});

// —— subcomponents / helpers ——

// One numbered chapter with a scroll-spy anchor.
function Section({
  id,
  num,
  title,
  children,
}: {
  id: string;
  num: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="jx-learn-section">
      <div className="jx-learn-num">{num}</div>
      <h2 className="jx-learn-h2">{title}</h2>
      {children}
    </section>
  );
}

// A short "why it works this way" aside — used sparingly, only where it prevents a real pitfall.
// `label` is the localized tag text ("为什么" / "Why"), passed by the caller.
function Why({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="jx-learn-why">
      <span className="jx-learn-whyTag">{label}</span>
      <div className="jx-learn-whyBody">{children}</div>
    </aside>
  );
}

function navCls(base: string, on: boolean): string {
  return on ? `${base} ${base}--on` : base;
}

// Highlight the section nearest the top of the viewport as the reader scrolls (same as sdk-doc).
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState('');
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver(
      (entries) => {
        const onscreen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (onscreen[0]) {
          setActive(onscreen[0].target.id);
        }
      },
      { rootMargin: '-72px 0px -72% 0px' },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return active;
}

// Section nav labels carry both languages; ids/nums are language-agnostic (also drive scroll-spy).
const SECTIONS = [
  { id: 'quickstart', num: '01', nav: { zh: '第一个策略', en: 'Your first strategy' } },
  { id: 'onbar', num: '02', nav: { zh: 'onBar 心跳', en: 'onBar heartbeat' } },
  { id: 'data', num: '03', nav: { zh: 'bar vs bars', en: 'bar vs bars' } },
  { id: 'orders', num: '04', nav: { zh: 'order vs target', en: 'order vs target' } },
  { id: 'walkthrough', num: '05', nav: { zh: '实战:截面选股', en: 'Hands-on: cross-section' } },
  { id: 'pitfalls', num: '06', nav: { zh: '常见坑', en: 'Common pitfalls' } },
  { id: 'next', num: '07', nav: { zh: '下一步', en: 'Next steps' } },
];

const PITFALLS: { q: { zh: string; en: string }; a: { zh: string; en: string } }[] = [
  {
    q: { zh: 'sma / ema 一直返回 null', en: 'sma / ema keeps returning null' },
    a: {
      zh: '该票的 K 线没加载。单标的策略在顶层声明 watch: [...];截面策略选完票要 await ctx.ensureBars(codes)。',
      en: "The stock's candles aren't loaded. Single-instrument strategies declare watch: [...] at the top level; cross-section strategies must await ctx.ensureBars(codes) after picking.",
    },
  },
  {
    q: {
      zh: 'setHoldings 后别的持仓莫名被清空',
      en: 'Other holdings mysteriously get cleared after setHoldings',
    },
    a: {
      zh: 'target 是全量快照:没列进清单的持仓等于目标 0,会被卖掉。每次要把想继续持有的都写全,别只写要改的那只。',
      en: 'target is a full snapshot: a holding not on the list means target 0 and gets sold. Always list everything you want to keep holding, not just the one you want to change.',
    },
  },
  {
    q: {
      zh: '用了 universe 却报错 / 不生效',
      en: 'Using universe throws an error / has no effect',
    },
    a: {
      zh: 'universe() 是异步的,onBar 必须写成 async onBar,并且 await ctx.universe(...)。',
      en: 'universe() is async — onBar must be written as async onBar, and you must await ctx.universe(...).',
    },
  },
  {
    q: { zh: '明明有信号却不成交', en: 'There is a signal but no trade fills' },
    a: {
      zh: '可能撞了 A 股规则:开在涨停板买不进、跌停板卖不出、停牌当日不成交、当日买入 T+1 次日才能卖。当日作废的单下个 bar 会自动重判。',
      en: "You may have hit an A-share rule: you can't buy at a limit-up open, can't sell at limit-down, no trading on a suspension day, and shares bought today can only be sold the next day (T+1). Orders voided that day are automatically re-evaluated on the next bar.",
    },
  },
  {
    q: { zh: '买入数量比预期少很多', en: 'The buy quantity is far smaller than expected' },
    a: {
      zh: '按 100 股整手向下取整成交。高价股尤其明显——￥100 万只够买 5 手茅台。',
      en: 'Fills are floored to whole 100-share lots. This is especially visible for high-priced stocks — ￥1M only buys 5 lots of Moutai.',
    },
  },
  {
    q: { zh: '回测跑出来是空的 / 没交易', en: 'The backtest comes out empty / with no trades' },
    a: {
      zh: '多半是区间内数据不足(指标要预热 n 根),或候选池为空(过滤太严 / 指数成分数据未覆盖到那么早)。',
      en: "Usually not enough data in the range (indicators need n bars to warm up), or the candidate pool is empty (filters too strict / index constituent data doesn't reach that far back).",
    },
  },
];

const CODE_MA20 = `// Single stock: go all-in when close crosses above the 20-day MA, liquidate when it crosses below
export default defineStrategy({
  name: 'MA20 breakout',
  watch: ['600519.SH'],                       // preload this stock's candles
  onBar(ctx) {
    const c = '600519.SH';
    const px = ctx.price(c), ma = ctx.sma(c, 20);
    if (px == null || ma == null) return;       // indicators not warmed up yet, skip
    if (px > ma && ctx.shares(c) === 0) ctx.order(c, Math.floor(ctx.cash / px));
    else if (px < ma && ctx.shares(c) > 0) ctx.exit(c);
  },
});`;

const CODE_LOAD = `// Path A · fixed instruments: declare watch at the top, engine preloads at startup
export default defineStrategy({
  watch: ['600000.SH', '000001.SZ'],
  onBar(ctx) { const ma = ctx.sma('600000.SH', 20); /* ready to use */ },
});

// Path B · dynamic picks: load them yourself after picking, then compute indicators
const codes = (await ctx.universe('000300.SH')).top(50);
await ctx.ensureBars(codes);                  // <- the crucial second step
const ma = ctx.sma(codes[0], 20);             // now it has a value`;

const CODE_STEP1 = `let last = '';
export default defineStrategy({
  name: 'EP · CSI 300 quality',
  async onBar(ctx) {
    if (ctx.period('monthly') === last) return; // already rebalanced this month -> skip
    last = ctx.period('monthly');
    // …stock-picking logic goes here
  },
});`;

const CODE_STEP2 = `    const picks = (await ctx.universe('000300.SH'))    // today's CSI 300 constituents
      .where(b => (b.roe ?? 0) > 15 && b.peTtm != null && b.peTtm > 0)
      .rankBy(b => 1 / b.peTtm)                        // EP = 1/PE, higher is cheaper
      .top(30);
    ctx.equalWeight(picks);                            // equal-weight position, engine rebalances`;
