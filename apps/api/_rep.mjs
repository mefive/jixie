const BASE = 'http://localhost:3001';
const login = await fetch(`${BASE}/api/auth/dev/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'dev@jixie.local' }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const code = `
const entryDay = new Map();
let day = 0;
export default defineStrategy({
  name:'中证2000 羊群短线',
  async onBar(ctx){
    day++;
    for (const p of ctx.positions()) { if (day-(entryDay.get(p.code)??day)>=3){ctx.exit(p.code);entryDay.delete(p.code);} }
    const top=(await ctx.select('932000.CSI')).where(b=>b.turnoverRate!=null).rankBy(b=>b.turnoverRate,'desc').top(100);
    await ctx.ensureBars(top);
    const cand=[];
    for(const c of top){ if(ctx.shares(c)>0)continue; const px=ctx.price(c); const w=ctx.history(c,'close',6); const amt=ctx.bar(c)?.amount; const avg=ctx.avgAmount(c,20); if(px==null||w.length<6||amt==null||avg==null)continue; const ret5=w[5]/w[0]-1; if(amt>avg*1.5&&ret5>0)cand.push({code:c,ret5,px}); }
    cand.sort((a,b)=>b.ret5-a.ret5);
    const unit=ctx.value*0.01; let slots=100-ctx.positions().length;
    for(const c of cand.slice(0,5)){ if(slots<=0)break; const s=Math.floor(unit/c.px); if(s>0){ctx.order(c.code,s);entryDay.set(c.code,day);slots--;} }
  },
});`;
async function run(start, end) {
  const post = await (
    await fetch(`${BASE}/api/app/strategy/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'rep', start, end, initialCash: 1000000, code }),
    })
  ).json();
  const t0 = Date.now();
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const j = await (
      await fetch(`${BASE}/api/app/strategy/backtest/${post.jobId}?since=0`, {
        headers: { cookie },
      })
    ).json();
    if (j.status !== 'running') {
      const s = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `${start}~${end} (${s}s):`,
        j.result
          ? `${j.result.trades} 笔, 收益 ${(j.result.totalReturn * 100).toFixed(2)}%`
          : 'ERR ' + j.message,
      );
      return;
    }
  }
  console.log(`${start}~${end}: 超时未完成`);
}
await run('20200101', '20241231');
