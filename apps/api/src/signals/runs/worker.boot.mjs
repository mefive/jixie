// Development-only child-process bootstrap. Production starts the compiled worker.js.
import { register } from 'tsx/esm/api';

register();
await import(new URL('./worker.ts', import.meta.url).href);
