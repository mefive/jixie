import { ENGINE_FACTORS, FACTOR_KEY_PATTERN } from '@jixie/shared';

const ENGINE_FACTOR_KEYS = new Set<string>(ENGINE_FACTORS.map((factor) => factor.key));

/** Extract literal factor keys from declarations and ctx.factor() calls without evaluating user code. */
export function extractFactorKeys(source: string): string[] {
  const callKeys = [...source.matchAll(/\bctx\s*\.\s*factor\s*\(\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
  const declarationKeys = [...source.matchAll(/\bfactors\s*[:=]\s*\[([\s\S]*?)\]/g)].flatMap(
    (declaration) => [...declaration[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]),
  );
  const keys = [...callKeys, ...declarationKeys];
  return [
    ...new Set(keys.filter((key) => FACTOR_KEY_PATTERN.test(key) && !ENGINE_FACTOR_KEYS.has(key))),
  ];
}
