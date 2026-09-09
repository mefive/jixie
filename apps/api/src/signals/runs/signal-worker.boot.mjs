// Development-only child-process bootstrap. Production starts the compiled signal-worker.js.
import { register } from 'tsx/esm/api';

register();
await import(new URL('./signal-worker.ts', import.meta.url).href);
