import { useEffect, useState, type ReactNode } from 'react';
import banner from '@src/assets/banner.png';
import './learn.css';

/**
 * Standalone getting-started tutorial (route `/learn`, linked from /docs's top bar + the lab hero).
 * A *linear* learning path (vs /docs, which is the by-symbol reference): copy a running strategy, then
 * build up the mental model — onBar/T+1, bar vs bars, order vs target — hands-on, with a short "why"
 * aside only where it prevents a real pitfall. Same Apple-docs ink shell as sdk-doc, Chinese-first.
 */
export default function LearnPage() {
  const active = useScrollSpy(SECTIONS.map((s) => s.id));
  return (
    <div className="jx-learn">
      <header className="jx-learn-bar">
        <a className="jx-learn-brand" href="/lab">
          <img className="jx-learn-banner" src={banner} alt="机械交易系" />
          <span className="jx-learn-brandSub">· 策略入门</span>
        </a>
        <nav className="jx-learn-topnav">
          <a className="jx-learn-topLink jx-learn-topLink--on" href="/learn">
            教程
          </a>
          <a className="jx-learn-topLink" href="/docs">
            SDK 文档
          </a>
          <a className="jx-learn-topCta" href="/lab">
            打开工作台 →
          </a>
        </nav>
      </header>

      <div className="jx-learn-layout">
        <nav className="jx-learn-nav">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={navCls('jx-learn-navLink', s.id === active)}
            >
              <span className="jx-learn-navNum">{s.num}</span>
              {s.nav}
            </a>
          ))}
        </nav>

        <main className="jx-learn-main">
          <div className="jx-learn-eyebrow">教程</div>
          <h1 className="jx-learn-title">十分钟写出你的第一个策略</h1>
          <p className="jx-learn-abstract">
            从复制一个能跑的策略开始,建立「引擎每天调一次 onBar」的心智,弄懂读数据的{' '}
            <code>bar</code>/<code>bars</code> 和下单的 <code>order</code>/<code>target</code>,最后自己搭一个截面选股。
            整手、涨跌停、T+1、复权、成本都由引擎在背后强制,你只写逻辑。
          </p>

          {/* 01 —— 第一个策略 */}
          <Section id="quickstart" num="01" title="五分钟:你的第一个策略">
            <p className="jx-learn-p">
              先跑通,再理解。打开<a className="jx-learn-inlineLink" href="/lab">回测工作台</a>,把下面这段粘进代码编辑器,选好回测区间,点「运行」。它做的事很简单:
              <b>收盘价上穿 20 日均线就满仓买入,下穿就清仓</b>。
            </p>
            <pre className="jx-learn-code">{CODE_MA20}</pre>
            <p className="jx-learn-p">
              跑完你会看到净值曲线、成交明细、和一堆绩效指标。这已经是一次<b>贴近真实的 A 股回测</b>——
              买入按 100 股整手、当日买次日才能卖(T+1)、开在涨停板买不进、佣金印花税都算了。这些你一行没写,是引擎替你强制的。
            </p>
            <Why>
              不用写任何 <code>import</code>。<code>defineStrategy</code> 和 <code>ctx</code> 都是注入的全局,
              编辑器已经认识它们(悬停符号能看类型、⌘I 查文档)。
            </Why>
          </Section>

          {/* 02 —— onBar */}
          <Section id="onbar" num="02" title="onBar:策略的心跳">
            <p className="jx-learn-p">
              引擎按交易日一天天往前走,<b>每个交易日调用一次你的 <code>onBar(ctx)</code></b>。
              关键是那个 <code>ctx</code>:它<b>永远绑定「今天」</b>,没有 date 参数。所以一天里发生三件事:
            </p>
            <ol className="jx-learn-steps">
              <li>
                <b>执行昨天排的单</b> —— 昨天收盘你下的意图,在<b>今天开盘价</b>成交。
              </li>
              <li>
                <b>按今天收盘估值</b> —— 记一个净值点,连起来就是权益曲线。
              </li>
              <li>
                <b>调 onBar,你做决定</b> —— 你能读到的最新数据截止今天;下的单进队列,<b>留给明天开盘</b>成交。
              </li>
            </ol>
            <Why>
              为什么 <code>ctx</code> 没有 date 参数、决策和成交要隔一天?因为这从<b>物理上杜绝了未来函数</b>:
              你在今天收盘做决策时,根本拿不到明天的价格,也就不可能「偷看」结果再下单。这是回测可信的地基。
            </Why>
          </Section>

          {/* 03 —— bar vs bars */}
          <Section id="data" num="03" title="读数据:bar 一横排,bars 一纵列">
            <p className="jx-learn-p">
              名字只差一个 <code>s</code>,却是两个世界。<code>bar</code> 是<b>今天全市场里某只票的一整行</b>(横切),
              <code>bars</code> 是<b>某只票最近 n 根 K 线</b>(纵切)。
            </p>
            <table className="jx-learn-table">
              <thead>
                <tr>
                  <th></th>
                  <th>
                    <code>ctx.bar(code)</code> 单数
                  </th>
                  <th>
                    <code>ctx.bars(code, n)</code> 复数
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>切法</td>
                  <td>今天这一天,一整行</td>
                  <td>一只票,最近 n 根</td>
                </tr>
                <tr>
                  <td>字段</td>
                  <td>全:OHLC + 估值(PE/PB)+ ROE + 换手</td>
                  <td>少:只有 OHLC + 量额</td>
                </tr>
                <tr>
                  <td>数据源</td>
                  <td>
                    截面(<code>universe()</code> 加载)
                  </td>
                  <td>
                    K 线缓存(<code>watch</code> / <code>ensureBars</code>)
                  </td>
                </tr>
                <tr>
                  <td>用来</td>
                  <td>排序选股</td>
                  <td>算指标(均线、突破、ATR)</td>
                </tr>
              </tbody>
            </table>
            <p className="jx-learn-p">
              技术指标 <code>ctx.sma / ema / atr / highest</code> 都是在 <code>bars</code> 那一列历史上算出来的,所以它们和{' '}
              <code>bars</code> 一样,需要该票的 K 线<b>先加载进来</b>。加载有两条路:
            </p>
            <pre className="jx-learn-code">{CODE_LOAD}</pre>
            <Why>
              最常见的新手坑:<code>await ctx.universe()</code> 拿到一批 code 后直接 <code>ctx.sma(code, 20)</code>,
              结果全是 <code>null</code>。因为 <code>universe()</code> 只加载了「今天这一横排」,没加载每只票的纵向历史。
              选完票要算指标,记得先 <code>await ctx.ensureBars(codes)</code>。
            </Why>
          </Section>

          {/* 04 —— order vs target */}
          <Section id="orders" num="04" title="下单:order 是动作,target 是目标">
            <p className="jx-learn-p">
              引擎给两种下单范式,一根 bar 里用哪套由你定:
            </p>
            <table className="jx-learn-table">
              <thead>
                <tr>
                  <th></th>
                  <th>命令式 · order</th>
                  <th>声明式 · target</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>你说的话</td>
                  <td>「买 500 股 A、清仓 B」</td>
                  <td>「我最终要持有 A、B、C 各 1/3」</td>
                </tr>
                <tr>
                  <td>你给的量</td>
                  <td>绝对股数(+买 / −卖)</td>
                  <td>目标权重(0~1),引擎换算股数</td>
                </tr>
                <tr>
                  <td>写法</td>
                  <td>
                    <code>ctx.order(c, n)</code> / <code>ctx.exit(c)</code>
                  </td>
                  <td>
                    <code>ctx.equalWeight(codes)</code> / <code>ctx.setHoldings(w)</code>
                  </td>
                </tr>
                <tr>
                  <td>天生适合</td>
                  <td>单标的择时(海龟:加仓、止损)</td>
                  <td>组合 / 截面选股(一篮子调仓)</td>
                </tr>
              </tbody>
            </table>
            <p className="jx-learn-p">
              为什么选股要用 <code>target</code> 而不是自己 <code>order</code>?因为月度调仓时新旧持仓有重叠,用 order 你得自己算
              「哪只清、哪只减、哪只加、各多少股」;而 <code>target</code> 你只描述<b>想要的终局</b>,差额(先卖非目标、再买)引擎替你做。
            </p>
            <Why>
              <code>target</code> 是<b>全量快照,不是增量改单</b>:你交出的这份清单<b>就是</b>完整目标,
              任何没列进去的持仓一律按目标 0 处理——<b>会被卖光</b>。所以别只写想动的那只(<code>setHoldings(&#123;A:0.5&#125;)</code>
              会清掉 B、C);想清空整个组合,传空 <code>setHoldings(&#123;&#125;)</code> 即可。而只清一只、别的不动,用命令式的{' '}
              <code>ctx.exit('A')</code>。
            </Why>
          </Section>

          {/* 05 —— 实战 */}
          <Section id="walkthrough" num="05" title="实战:一步步搭一个截面选股">
            <p className="jx-learn-p">
              目标:<b>每月</b>在沪深 300 里挑 <b>ROE&gt;15 且最便宜(EP 最高)的 30 只,等权持有</b>。一步步来。
            </p>
            <p className="jx-learn-p">
              <b>第一步 · 每月只跑一次。</b>引擎每天都调 onBar,但调仓是月度的,用 <code>ctx.period</code> 配一个{' '}
              <code>let last</code> 守卫,月份没变就直接返回:
            </p>
            <pre className="jx-learn-code">{CODE_STEP1}</pre>
            <p className="jx-learn-p">
              <b>第二步 · 选票。</b>拿今天的沪深 300 成分作候选池,链式地过滤 → 排序 → 取头部,再等权下单。
              注意用了 <code>universe</code> 的 onBar 必须是 <code>async</code>:
            </p>
            <pre className="jx-learn-code">{CODE_STEP2}</pre>
            <p className="jx-learn-p">
              就这样。<code>where</code> 过滤、<code>rankBy</code> 按 EP(1/PE)从高到低、<code>top(30)</code> 取前 30、
              <code>equalWeight</code> 等权建仓——剩下的调仓、成交、成本全归引擎。这个例子只用了 <code>bar</code> 的截面字段;
              如果你的信号要均线,记得在 <code>top</code> 之后 <code>await ctx.ensureBars(picks)</code>。
            </p>
          </Section>

          {/* 06 —— 常见坑 */}
          <Section id="pitfalls" num="06" title="常见坑">
            <dl className="jx-learn-faq">
              {PITFALLS.map((p) => (
                <div className="jx-learn-faqRow" key={p.q}>
                  <dt className="jx-learn-faqQ">{p.q}</dt>
                  <dd className="jx-learn-faqA">{p.a}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {/* 07 —— 下一步 */}
          <Section id="next" num="07" title="下一步">
            <p className="jx-learn-p">
              你已经会写两类策略了。接下来:
            </p>
            <div className="jx-learn-cards">
              <a className="jx-learn-card" href="/docs">
                <div className="jx-learn-cardTitle">SDK 文档 →</div>
                <div className="jx-learn-cardDesc">
                  按符号查 API:<code>ctx</code> 的每个方法、<code>Universe</code> 链式操作、<code>BarRow</code> 全字段。
                </div>
              </a>
              <a className="jx-learn-card" href="/lab">
                <div className="jx-learn-cardTitle">回测工作台 →</div>
                <div className="jx-learn-cardDesc">
                  用一句话描述策略让 AI 写成代码,或直接把上面的例子改成你自己的。
                </div>
              </a>
            </div>
          </Section>
        </main>
      </div>
    </div>
  );
}

// —— 子组件 / 帮助函数 ——

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
function Why({ children }: { children: ReactNode }) {
  return (
    <aside className="jx-learn-why">
      <span className="jx-learn-whyTag">为什么</span>
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
        if (onscreen[0]) setActive(onscreen[0].target.id);
      },
      { rootMargin: '-72px 0px -72% 0px' },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return active;
}

const SECTIONS = [
  { id: 'quickstart', num: '01', nav: '第一个策略' },
  { id: 'onbar', num: '02', nav: 'onBar 心跳' },
  { id: 'data', num: '03', nav: 'bar vs bars' },
  { id: 'orders', num: '04', nav: 'order vs target' },
  { id: 'walkthrough', num: '05', nav: '实战:截面选股' },
  { id: 'pitfalls', num: '06', nav: '常见坑' },
  { id: 'next', num: '07', nav: '下一步' },
];

const PITFALLS: { q: string; a: string }[] = [
  {
    q: 'sma / ema 一直返回 null',
    a: '该票的 K 线没加载。单标的策略在顶层声明 watch: [...];截面策略选完票要 await ctx.ensureBars(codes)。',
  },
  {
    q: 'setHoldings 后别的持仓莫名被清空',
    a: 'target 是全量快照:没列进清单的持仓等于目标 0,会被卖掉。每次要把想继续持有的都写全,别只写要改的那只。',
  },
  {
    q: '用了 universe 却报错 / 不生效',
    a: 'universe() 是异步的,onBar 必须写成 async onBar,并且 await ctx.universe(...)。',
  },
  {
    q: '明明有信号却不成交',
    a: '可能撞了 A 股规则:开在涨停板买不进、跌停板卖不出、停牌当日不成交、当日买入 T+1 次日才能卖。当日作废的单下个 bar 会自动重判。',
  },
  {
    q: '买入数量比预期少很多',
    a: '按 100 股整手向下取整成交。高价股尤其明显——￥100 万只够买 5 手茅台。',
  },
  {
    q: '回测跑出来是空的 / 没交易',
    a: '多半是区间内数据不足(指标要预热 n 根),或候选池为空(过滤太严 / 指数成分数据未覆盖到那么早)。',
  },
];

const CODE_MA20 = `// 单只:收盘价上穿 20 日均线满仓买入、下穿清仓
export default defineStrategy({
  name: 'MA20 突破',
  watch: ['600519.SH'],                       // 预载这只票的 K 线
  onBar(ctx) {
    const c = '600519.SH';
    const px = ctx.price(c), ma = ctx.sma(c, 20);
    if (px == null || ma == null) return;       // 数据没预热好,先跳过
    if (px > ma && ctx.shares(c) === 0) ctx.order(c, Math.floor(ctx.cash / px));
    else if (px < ma && ctx.shares(c) > 0) ctx.exit(c);
  },
});`;

const CODE_LOAD = `// 路 A · 固定标的:顶层声明 watch,引擎开场预载
export default defineStrategy({
  watch: ['600000.SH', '000001.SZ'],
  onBar(ctx) { const ma = ctx.sma('600000.SH', 20); /* 直接能用 */ },
});

// 路 B · 动态选票:选完自己加载,再算指标
const codes = (await ctx.universe('000300.SH')).top(50);
await ctx.ensureBars(codes);                  // ← 关键第二步
const ma = ctx.sma(codes[0], 20);             // 现在才有值`;

const CODE_STEP1 = `let last = '';
export default defineStrategy({
  name: 'EP · 沪深300优质',
  async onBar(ctx) {
    if (ctx.period('monthly') === last) return; // 本月已调过 → 跳过
    last = ctx.period('monthly');
    // …选股逻辑写这里
  },
});`;

const CODE_STEP2 = `    const picks = (await ctx.universe('000300.SH'))    // 今日沪深300成分
      .where(b => (b.roe ?? 0) > 15 && b.peTtm != null && b.peTtm > 0)
      .rankBy(b => 1 / b.peTtm)                        // EP = 1/PE,越大越便宜
      .top(30);
    ctx.equalWeight(picks);                            // 等权建仓,引擎自动调仓`;
