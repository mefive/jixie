import type { DtsFactorOption, Locale } from '@jixie/shared';
import { buildSdkDts } from '@jixie/shared';

/**
 * The strategy SDK surface, as an ambient .d.ts fed to Monaco (addExtraLib) so the editor gives real
 * autocomplete + type-checking against `ctx` / `defineStrategy`. GENERATED from sdk-reference.ts (the
 * single source, in @jixie/shared) — each member's hover carries the active-locale copy + a 📖 link
 * to /docs#<method>. Don't hand-edit; add or change methods in sdk-reference.ts and this, the doc
 * page, and the codegen prompt all stay in sync.
 * The signatures never vary by locale — only the doc-comment language does — so re-registering on a
 * language switch keeps typecheck identical.
 */
export const sdkDts = (locale: Locale, factorOptions?: DtsFactorOption[]): string =>
  buildSdkDts(locale, undefined, factorOptions);
