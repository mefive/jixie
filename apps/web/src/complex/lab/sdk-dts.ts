import type { Locale } from '@jixie/shared';
import { buildSdkDts } from './sdk-reference';

/**
 * The strategy SDK surface, as an ambient .d.ts fed to Monaco (addExtraLib) so the editor gives real
 * autocomplete + type-checking against `ctx` / `defineStrategy`. GENERATED from sdk-reference.ts (the
 * single source) — each member's hover carries the active-locale copy + a 📖 link to /docs#<method>.
 * Don't hand-edit; add or change methods in sdk-reference.ts and both this and the doc page stay in sync.
 * The signatures never vary by locale — only the doc-comment language does — so re-registering on a
 * language switch keeps typecheck identical.
 */
export const sdkDts = (locale: Locale): string => buildSdkDts(locale);
