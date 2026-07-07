/**
 * Extract the agent-facing manual of lib/stats.ts from its JSDoc — single source of truth: the
 * function's own doc comment. `scripts/gen-stats-doc.ts` materializes the result into stats-doc.ts
 * (checked in, imported by the analyzeData tool description); stats-doc.test.ts re-runs this
 * extraction against the source and fails on drift, so the manual can't silently fall behind.
 */

export interface StatsFunctionDoc {
  name: string;
  params: string; // the parameter list as written in the signature (types included)
  doc: string; // the JSDoc collapsed to one line
}

export function extractStatsDocs(source: string): StatsFunctionDoc[] {
  const docs: StatsFunctionDoc[] = [];

  // The doc block must not cross its own `*/` (else a preceding comment gets swallowed), and only
  // a JSDoc DIRECTLY above an `export function` counts.
  for (const match of source.matchAll(
    /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*export function (\w+)\(/g,
  )) {
    const doc = match[1]
      .split('\n')
      .map((line) => line.replace(/^\s*\*?\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const name = match[2];

    // The parameter list ends at the matching close paren (types may contain nested parens).
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') {
        depth++;
      } else if (source[i] === ')') {
        depth--;
      }
      i++;
    }
    const params = source
      .slice(start, i - 1)
      .replace(/\s+/g, ' ')
      .replace(/,\s*$/, '') // multi-line signatures leave a trailing comma
      .trim();
    docs.push({ name, params, doc });
  }
  return docs;
}

/** Every exported function that is MISSING a JSDoc (would be invisible to the agent). */
export function undocumentedExports(source: string): string[] {
  const documented = new Set(extractStatsDocs(source).map((f) => f.name));
  return [...source.matchAll(/export function (\w+)\(/g)]
    .map((match) => match[1])
    .filter((name) => !documented.has(name));
}

export function buildStatsDoc(source: string): string {
  return extractStatsDocs(source)
    .map((f) => `- stats.${f.name}(${f.params}) — ${f.doc}`)
    .join('\n');
}
