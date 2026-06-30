import { buildSdkDts } from './sdk-reference';

/**
 * The strategy SDK surface, as an ambient .d.ts fed to Monaco (addExtraLib) so the editor gives real
 * autocomplete + type-checking against `ctx` / `defineStrategy`. GENERATED from sdk-reference.ts (the
 * single source) — each member's hover carries 中 + EN + a 📖 link to /docs#<method>. Don't hand-edit;
 * add or change methods in sdk-reference.ts and both this and the doc page stay in sync.
 */
export const SDK_DTS = buildSdkDts();
