// Dev-only bootstrap for an Agent quick-backtest worker.
import { register } from 'tsx/esm/api';

register();
await import(new URL('./agent-backtest-worker.ts', import.meta.url).href);
