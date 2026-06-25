// Dev-only worker bootstrap. Worker threads don't inherit tsx's on-the-fly TS loader, so we register
// it here (in the worker thread) before importing the real .ts worker. Plain .mjs on purpose, so Node
// loads it with no TS transform. In prod the compiled backtest-worker.js is spawned directly and this
// file is never used (so tsx stays a dev-only dependency).
import { register } from 'tsx/esm/api';

register();
await import(new URL('./backtest-worker.ts', import.meta.url).href);
