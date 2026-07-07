import { prisma } from '../lib/prisma.js';

/**
 * Direct instrument resolution: map a raw query to specific ts_codes when it is a *reference* to a stock
 * (a 6-digit code, an exact name, or a short name fragment) rather than a metric screen. This is the
 * deterministic fast-path the unified query endpoint tries BEFORE the LLM — a pure code / exact name is
 * unambiguous, so a DB lookup is both instant and *more* accurate than a model (which could mistranscribe
 * a code). Empty result = "not a direct reference"; the caller then falls back to NL parsing.
 *
 * Codes always come from our own stock_basic — even on the LLM lookup path the model only normalizes a
 * name, which we re-resolve here, so a hallucinated code can never reach the user.
 */

const CODE_RE = /^(\d{6})(\.(SH|SZ|BJ))?$/i;
// A short pure-name fragment (CJK or latin, no spaces/digits/operators) worth a substring match.
const NAME_TOKEN_RE = /^[一-龥A-Za-z]{2,8}$/;

const MAX_HITS = 50;

/** Resolve one raw token to ts_codes: pure code → exact name → short-fragment substring. Order-preserving
 * within each tier; returns [] when the token isn't a plausible instrument reference. */
export async function resolveInstruments(text: string): Promise<string[]> {
  const t = text.trim();
  if (!t) {
    return [];
  }

  // 1. Pure code (600519 / 600519.SH). symbol is the 6-digit; maps to exactly one A-share ts_code.
  const m = t.match(CODE_RE);
  if (m) {
    const symbol = m[1];
    const rows = await prisma.stockBasic.findMany({ where: { symbol }, select: { tsCode: true } });
    return rows.map((r) => r.tsCode);
  }

  // 2. Exact full name (工商银行 → 601398.SH).
  const exact = await prisma.stockBasic.findMany({ where: { name: t }, select: { tsCode: true } });
  if (exact.length) {
    return exact.map((r) => r.tsCode);
  }

  // 3. Short name fragment (茅台 → 贵州茅台; 平安 → 中国平安 / 平安银行). A screen phrase ("便宜的高股息")
  //    simply matches no name → [] → caller goes to the LLM. Capped so a generic fragment can't flood.
  if (NAME_TOKEN_RE.test(t)) {
    const hits = await prisma.stockBasic.findMany({
      where: { name: { contains: t } },
      select: { tsCode: true },
      orderBy: { tsCode: 'asc' },
      take: MAX_HITS,
    });
    return hits.map((r) => r.tsCode);
  }

  return [];
}
