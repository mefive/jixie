// Dev-only worker bootstrap (mirrors sql-worker.boot.mjs). Worker threads don't inherit tsx's TS
// loader, so register it here before importing the real .ts worker. Prod spawns the compiled .js and
// this file is never used.
import { register } from 'tsx/esm/api';

register();
await import(new URL('./analyze-worker.ts', import.meta.url).href);
