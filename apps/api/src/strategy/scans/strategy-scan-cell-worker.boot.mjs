// Dev-only bootstrap for one parameter-scan cell process.
import { register } from 'tsx/esm/api';

register();
await import(new URL('./strategy-scan-cell-worker.ts', import.meta.url).href);
