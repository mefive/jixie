// Dev-only worker bootstrap. Worker threads do not inherit tsx's transform hook.
import { register } from 'tsx/esm/api';

register();
await import(new URL('./strategy-scan-worker.ts', import.meta.url).href);
