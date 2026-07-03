import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import classNames from 'classnames';
import banner from '@src/assets/banner.png';
import { SDK_ENTRIES, OHLC_FIELDS, LINKABLE_TYPES, type SdkEntry } from './sdk-reference';
import './sdk-doc.css';

type Lang = 'zh' | 'en';

/**
 * Standalone SDK reference (route `/docs`, opened from the lab 文档 button + the 📖 links / ⌘I action in
 * the editor → /docs#<member>). Apple-Developer-docs information architecture — sticky sidebar nav with
 * scroll-spy, eyebrow→title→abstract per symbol, a Declaration block whose type names link to the type's
 * doc — kept monochrome to match the app. 中/EN togglable. Renders from SDK_ENTRIES, the single source
 * that also generates the Monaco types.
 */
export default function SdkDocPage() {
  const [params, setParams] = useSearchParams();
  const lang: Lang = params.get('lang') === 'en' ? 'en' : 'zh';
  const setLang = (l: Lang) => {
    const next = new URLSearchParams(params);
    if (l === 'en') next.set('lang', 'en');
    else next.delete('lang');
    setParams(next, { replace: true });
  };
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  const groups = useMemo(() => groupEntries(SDK_ENTRIES), []);
  const active = useScrollSpy(['overview', 'StrategyCtx', ...SDK_ENTRIES.map((e) => e.name), 'OhlcBar']);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <div className="jx-docs">
      <header className="jx-docs-bar">
        <a className="jx-docs-brand" href="/lab">
          <img className="jx-docs-banner" src={banner} alt="机械交易系" />
          <span className="jx-docs-brandSub">· 策略 SDK</span>
        </a>
        <div className="jx-docs-barRight">
          <a className="jx-docs-tutLink" href="/learn">
            {t('入门教程 ↗', 'Tutorial ↗')}
          </a>
          <div className="jx-docs-lang">
            {(['zh', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={classNames('jx-docs-langBtn', { 'jx-docs-langBtn--on': lang === l })}
                onClick={() => setLang(l)}
              >
                {l === 'zh' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="jx-docs-layout">
        <nav className="jx-docs-nav">
          <a className={navCls('overview', active)} href="#overview">
            {t('概览', 'Overview')}
          </a>
          {groups.map(([group, entries]) => (
            <div className="jx-docs-navGroup" key={group}>
              <div className="jx-docs-navGroupTitle">{group}</div>
              {entries.map((e) => (
                <a key={`${e.iface}.${e.name}`} className={navCls(e.name, active)} href={`#${e.name}`}>
                  {e.name}
                </a>
              ))}
            </div>
          ))}
          <div className="jx-docs-navGroup">
            <div className="jx-docs-navGroupTitle">{t('业务类型 OhlcBar', 'Type OhlcBar')}</div>
            <a className={navCls('OhlcBar', active)} href="#OhlcBar">OhlcBar</a>
          </div>
        </nav>

        <main className="jx-docs-main">
          <div className="jx-docs-eyebrow">{t('框架', 'Framework')}</div>
          <h1 className="jx-docs-title">{t('策略 SDK', 'Strategy SDK')}</h1>
          <p className="jx-docs-abstract">
            {t(
              '用 TypeScript 写策略:一个 onBar(ctx),逐个交易日跑。ctx 永远绑定「今天」—— 没有 date 参数,也就没有未来函数。整手、涨跌停、T+1、复权、成本由引擎在下单背后强制。',
              'Write strategies in TypeScript: one onBar(ctx), run each trading day. ctx is always bound to "today" — no date arg, so no look-ahead. Whole-手 lots, price limits, T+1, adjustment and costs are enforced by the engine.',
            )}
          </p>

          <section id="overview" className="jx-docs-section">
            <h2 className="jx-docs-h2">{t('概览', 'Overview')}</h2>
            <p className="jx-docs-p">
              {t(
                '一个策略就是 export default defineStrategy({ onBar(ctx) {…} })。不要写任何 import —— defineStrategy 与 ctx 都是注入的。',
                'A strategy is just export default defineStrategy({ onBar(ctx) {…} }). Do NOT write imports — defineStrategy and ctx are injected.',
              )}
            </p>
            <pre className="jx-docs-code">{QUICKSTART}</pre>

            <h3 className="jx-docs-h3">{t('引擎自动强制', 'Enforced by the engine')}</h3>
            <dl className="jx-docs-rules">
              {ENGINE_RULES.map((r) => (
                <div className="jx-docs-rule" key={r.zh[0]}>
                  <dt className="jx-docs-ruleK">{t(r.zh[0], r.en[0])}</dt>
                  <dd className="jx-docs-ruleV">{t(r.zh[1], r.en[1])}</dd>
                </div>
              ))}
            </dl>

            <h3 className="jx-docs-h3">{t('横截面选股例子', 'Cross-sectional example')}</h3>
            <pre className="jx-docs-code">{XSECTION}</pre>
          </section>

          <section id="StrategyCtx" className="jx-docs-section">
            <div className="jx-docs-eyebrow">{t('业务类型', 'Type')}</div>
            <h2 className="jx-docs-h2">StrategyCtx</h2>
            <p className="jx-docs-p">
              {t(
                'onBar(ctx) 里 ctx 的类型 —— 策略每个 bar 看到、操作的入口。下面所有 ctx.xxx 都是它的方法(读数据、算指标、下单);ctx 恒为「今天」,没有 date 参数。',
                'The type of ctx in onBar(ctx) — the entry through which a strategy reads data and places orders each bar. Every ctx.xxx below is its method; ctx is always bound to "today" (no date arg).',
              )}
            </p>
          </section>

          {groups.map(([group, entries]) => (
            <section className="jx-docs-section" id={typeAnchor(entries[0].iface)} key={group}>
              <h2 className="jx-docs-h2">{group}</h2>
              {entries.map((e) => (
                <article id={e.name} className="jx-docs-symbol" key={`${e.iface}.${e.name}`}>
                  <div className="jx-docs-symKind">{t(kindZh(e.iface), kindEn(e.iface))}</div>
                  <h3 className="jx-docs-symName">{e.name}</h3>
                  <p className="jx-docs-symAbstract">{t(e.zh, e.en)}</p>
                  <div className="jx-docs-declLabel">{t('声明', 'Declaration')}</div>
                  <Declaration prefix={e.iface === 'StrategyCtx' ? 'ctx.' : ''} sig={e.sig} />
                </article>
              ))}
            </section>
          ))}

          <section className="jx-docs-section" id="OhlcBar">
            <h2 className="jx-docs-h2">{t('业务类型 OhlcBar(K 线字段)', 'Type OhlcBar (bar fields)')}</h2>
            <p className="jx-docs-p">{t('ctx.bars() 返回的单元 —— 后复权 OHLC + 量额。', 'The unit ctx.bars() returns — adjusted OHLC + volume/turnover.')}</p>
            <dl className="jx-docs-rules">
              {OHLC_FIELDS.map((f) => (
                <div className="jx-docs-rule" key={f.name}>
                  <dt className="jx-docs-ruleK jx-docs-mono">{f.name}: {f.type}</dt>
                  <dd className="jx-docs-ruleV">{t(f.zh, f.en)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
}

// —— 子组件 / 帮助函数 ——

// A signature rendered as a Declaration block — member name emphasized, types (BarRow/OhlcBar/Universe)
// rendered as links to their doc section.
function Declaration({ prefix, sig }: { prefix: string; sig: string }) {
  const paren = sig.search(/[(:]/); // method '(' or field ':'
  const name = paren < 0 ? sig : sig.slice(0, paren);
  const rest = paren < 0 ? '' : sig.slice(paren);
  return (
    <pre className="jx-docs-decl">
      <code>
        <span className="jx-docs-declMuted">{prefix}</span>
        <span className="jx-docs-declName">{name}</span>
        <span className="jx-docs-declMuted">{linkifyTypes(rest)}</span>
      </code>
    </pre>
  );
}

const TYPE_RE = new RegExp(`\\b(${LINKABLE_TYPES.join('|')})\\b`, 'g');

function linkifyTypes(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TYPE_RE.lastIndex = 0;
  while ((m = TYPE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a className="jx-docs-typeLink" href={`#${m[1]}`} key={m.index}>
        {m[1]}
      </a>,
    );
    last = m.index + m[1].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// A type that has its own doc section anchor (so a Declaration link / the editor can jump to it).
function typeAnchor(iface: SdkEntry['iface']): string | undefined {
  return iface === 'Universe' || iface === 'BarRow' ? iface : undefined;
}

const kindZh = (i: SdkEntry['iface']) => (i === 'Universe' ? '链式方法' : i === 'BarRow' ? '字段' : '实例方法');
const kindEn = (i: SdkEntry['iface']) => (i === 'Universe' ? 'Chain Method' : i === 'BarRow' ? 'Property' : 'Instance Method');

function navCls(id: string, active: string): string {
  return classNames('jx-docs-navLink', { 'jx-docs-navLink--on': id === active });
}

// Highlight the symbol nearest the top of the viewport as the reader scrolls (Apple-style scroll-spy).
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

// Stable group order (first appearance in SDK_ENTRIES), each with its members.
function groupEntries(entries: SdkEntry[]): [string, SdkEntry[]][] {
  const order: string[] = [];
  const by = new Map<string, SdkEntry[]>();
  for (const e of entries) {
    if (!by.has(e.group)) (by.set(e.group, []), order.push(e.group));
    by.get(e.group)!.push(e);
  }
  return order.map((g) => [g, by.get(g)!]);
}

const ENGINE_RULES: { zh: [string, string]; en: [string, string] }[] = [
  { zh: ['整手', '买入按 100 股整手(真实股数);茅台 100 万只够买 5 手'], en: ['Whole 手', 'Buys size in real 100-share lots; ￥1M of Maotai buys only 5 手'] },
  { zh: ['涨跌停', '开在涨停板买不进、跌停板卖不出(当日作废,下个 bar 重判即自动重试)'], en: ['Price limits', 'Can’t buy at the up-limit open nor sell at the down-limit open (voided that day; re-tried next bar)'] },
  { zh: ['T+1 / 停牌', '当日买入次日才能卖;停牌当日不成交;下单次日开盘价成交'], en: ['T+1 / suspension', 'Bought today, sellable next day; suspended = no fill; orders fill at next open'] },
  { zh: ['复权 / 成本', '内部后复权算收益(含分红再投资);佣金万 2.5(最低 5 元)+ 印花税千 0.5(仅卖)+ 过户费'], en: ['Adjustment / costs', 'hfq prices for returns (dividends reinvested); commission 0.025% (min ￥5) + stamp duty 0.05% (sell) + transfer fee'] },
];

const QUICKSTART = `// 单只:收盘价上穿 20 日均线满仓买入、下穿清仓
export default defineStrategy({
  name: 'MA20 突破',
  watch: ['600519.SH'],
  onBar(ctx) {
    const c = '600519.SH';
    const px = ctx.price(c), ma = ctx.sma(c, 20);
    if (px == null || ma == null) return;
    if (px > ma && ctx.shares(c) === 0) ctx.order(c, Math.floor(ctx.cash / px));
    else if (px < ma && ctx.shares(c) > 0) ctx.exit(c);
  },
});`;

const XSECTION = `// 每月:沪深300 里 ROE>15 且最便宜的 30 只,等权
let last = '';
export default defineStrategy({
  name: 'EP · 沪深300优质',
  async onBar(ctx) {                       // 用了 universe 必须 async
    if (ctx.period('monthly') === last) return;
    last = ctx.period('monthly');
    const picks = (await ctx.universe('000300.SH'))
      .where(b => (b.roe ?? 0) > 15 && b.peTtm != null && b.peTtm > 0)
      .rankBy(b => 1 / b.peTtm)
      .top(30);
    ctx.equalWeight(picks);
  },
});`;
