import { useSearchParams } from 'react-router-dom';
import { TopNav } from '@src/components/top-nav';
import { SDK_ENTRIES, type SdkEntry } from './sdk-reference';
import './sdk-doc.css';

type Lang = 'zh' | 'en';

/**
 * Standalone SDK reference page (route `/docs`, also opened from the lab's 文档 button and from the 📖
 * links in the editor's hovers → /docs#<method>). 中/EN togglable. The API reference renders from
 * SDK_ENTRIES — the same single source that generates the Monaco types — so nothing drifts.
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

  const groups = groupEntries(SDK_ENTRIES);

  return (
    <div className="jx-docs">
      <TopNav />
      <main className="jx-docs-body">
        <header className="jx-docs-head">
          <h1 className="jx-docs-title">{t('策略 SDK 文档', 'Strategy SDK Reference')}</h1>
          <LangToggle lang={lang} onChange={setLang} />
        </header>

        <section className="jx-docs-sec">
          <h2 className="jx-docs-h2">{t('怎么写', 'How to write')}</h2>
          <p className="jx-docs-p">
            {t(
              '一个策略就是 export default defineStrategy({ onBar(ctx) {…} })。引擎逐个交易日调用 onBar(ctx),你通过 ctx 读数据、下单。不要写任何 import —— defineStrategy / ctx 都是注入的。',
              'A strategy is just export default defineStrategy({ onBar(ctx) {…} }). The engine calls onBar(ctx) each trading day; you read data and place orders through ctx. Do NOT write imports — defineStrategy / ctx are injected.',
            )}
          </p>
          <pre className="jx-docs-code">{QUICKSTART}</pre>
        </section>

        <section className="jx-docs-sec">
          <h2 className="jx-docs-h2">{t('引擎自动强制(你不用管)', 'Enforced by the engine (you don’t handle it)')}</h2>
          <ul className="jx-docs-list">
            <li>{t('整手:买入按 100 股整手(真实股数);茅台 100 万只够买 5 手', 'Whole 手 (100-share lots): buys size in real round lots; ￥1M of Maotai buys only 5 手')}</li>
            <li>{t('涨跌停:开在涨停板买不进、跌停板卖不出(当日作废,策略下个 bar 重判即自动重试)', 'Price limits: can’t buy at the up-limit open nor sell at the down-limit open (voided that day; the strategy re-expresses intent next bar)')}</li>
            <li>{t('T+1:当日买入次日才能卖;停牌当日不成交;下单次日开盘价成交', 'T+1: shares bought today are sellable next day; suspended = no fill; orders fill at next open')}</li>
            <li>{t('复权:内部后复权算收益(含分红再投资);成本:佣金万 2.5(最低 5 元)+ 印花税千 0.5(仅卖)+ 过户费', 'hfq prices for returns (dividends reinvested); costs: commission 0.025% (min ￥5) + stamp duty 0.05% (sell) + transfer fee')}</li>
          </ul>
        </section>

        <section className="jx-docs-sec">
          <h2 className="jx-docs-h2">{t('横截面选股例子', 'Cross-sectional example')}</h2>
          <pre className="jx-docs-code">{XSECTION}</pre>
        </section>

        <section className="jx-docs-sec">
          <h2 className="jx-docs-h2">{t('全部 API', 'Full API')}</h2>
          {groups.map(([group, entries]) => (
            <div className="jx-docs-group" key={group}>
              <h3 className="jx-docs-h3">{group}</h3>
              {entries.map((e) => (
                <div className="jx-docs-entry" id={e.name} key={`${e.iface}.${e.name}`}>
                  <code className="jx-docs-sig">
                    {(e.iface === 'Universe' ? '' : 'ctx.') + e.sig}
                  </code>
                  <p className="jx-docs-desc">{t(e.zh, e.en)}</p>
                </div>
              ))}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

// —— 子组件 / 帮助函数 ——

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="jx-docs-lang">
      {(['zh', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          className={'jx-docs-langBtn' + (lang === l ? ' jx-docs-langBtn--on' : '')}
          onClick={() => onChange(l)}
        >
          {l === 'zh' ? '中文' : 'EN'}
        </button>
      ))}
    </div>
  );
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
