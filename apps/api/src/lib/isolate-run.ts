import { readFileSync } from 'node:fs';
import ivm from 'isolated-vm';
import { transform } from 'esbuild';

/**
 * Hard sandbox for user/model-authored code (Phase A: factor compute + analyzeData; the strategy
 * onBar ctx bridge is Phase B — see python-and-sandbox.md).
 *
 * The layering, spelled out once:
 *   - DB access belongs to OUR code (prisma in workers, the readonly SQL worker) — never injected;
 *   - user code runs inside a V8 *isolate*: a separate JS world with NO Node APIs, no require, no
 *     process — a prototype-chain escape lands in an empty global, not in the host;
 *   - data crosses the wall as JSON strings, results come back the same way. Crossings are
 *     batched (per call / per stock / per date) because each one pays a serialization toll;
 *   - the isolate enforces its own memory limit and per-run CPU timeout natively.
 * new Function remains only in compileStrategy (Phase B) — everything else moved off it.
 */

const DEFAULT_MEMORY_MB = 256;

/** lib/stats.ts compiled to CJS once, evaluated INSIDE isolates that ask for stats — the functions
 * live in-wall, so stats calls don't cross. Source resolves to .ts in dev, compiled .js in prod. */
let statsJsPromise: Promise<string> | null = null;
function statsJs(): Promise<string> {
  statsJsPromise ??= (async () => {
    const url = new URL(
      import.meta.url.endsWith('.ts') ? './stats.ts' : './stats.js',
      import.meta.url,
    );
    const source = readFileSync(url, 'utf8');
    const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
    return code;
  })();
  return statsJsPromise;
}

/** esbuild-strip a user module to CJS (same validation error shape the old sandboxes threw). */
export async function toCommonJs(source: string, noun = 'code'): Promise<string> {
  try {
    const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
    return code;
  } catch (e) {
    throw new Error(`${noun} compilation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A CJS module evaluated inside its own isolate. `callJson` invokes a named in-wall entry with
 * JSON-string arguments; console.* inside the wall is captured and drained per call. */
export interface IsolatedModule {
  /** Evaluate `__entries.<entry>(...jsonArgs)` in-wall; the entry must return a JSON string. */
  callJson(entry: string, jsonArgs: string[], opts?: { timeoutMs?: number }): Promise<string>;
  /** Console lines captured in-wall since the last drain (fed to the run-log sink by callers). */
  drainLogs(): string[];
  dispose(): void;
}

const BOOTSTRAP = `
globalThis.__logs = [];
const __fmt = (args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
globalThis.console = {
  log: (...a) => __logs.push(__fmt(a)),
  info: (...a) => __logs.push(__fmt(a)),
  warn: (...a) => __logs.push('[warn] ' + __fmt(a)),
  error: (...a) => __logs.push('[error] ' + __fmt(a)),
};
globalThis.__drainLogs = () => { const out = JSON.stringify(__logs); __logs.length = 0; return out; };
globalThis.__entries = {};
`;

/**
 * Load a user CJS module into a fresh isolate. `setup` is extra in-wall JS (evaluated AFTER the
 * user module) that registers callable entries on __entries, closing over `__module.exports`.
 * `injectGlobals` are extra identifiers visible to the user module (e.g. defineFactor shim).
 */
export async function loadIsolatedModule(opts: {
  userJs: string;
  setup: string;
  injectGlobals?: string; // in-wall JS evaluated BEFORE the user module
  withStats?: boolean;
  memoryMb?: number;
  noun?: string; // for error messages: 'factor code' / 'analysis code'
}): Promise<IsolatedModule> {
  const noun = opts.noun ?? 'code';
  const isolate = new ivm.Isolate({ memoryLimit: opts.memoryMb ?? DEFAULT_MEMORY_MB });
  const context = await isolate.createContext();

  const evalInWall = async (js: string, phase: string, timeoutMs = 5_000): Promise<void> => {
    try {
      await context.eval(js, { timeout: timeoutMs });
    } catch (e) {
      isolate.dispose();
      throw new Error(`${noun} ${phase}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await evalInWall(BOOTSTRAP, 'sandbox init failed');
  if (opts.withStats) {
    const stats = await statsJs();
    await evalInWall(
      `{ const module = { exports: {} }; (function (module, exports) { ${stats}\n })(module, module.exports); globalThis.stats = module.exports; }`,
      'stats library load failed',
    );
  }
  if (opts.injectGlobals) {
    await evalInWall(opts.injectGlobals, 'injection failed');
  }
  await evalInWall(
    `globalThis.__module = { exports: {} };
     (function (module, exports, require) { ${opts.userJs}\n })(
       __module, __module.exports,
       function (id) { throw new Error('cannot import external module (' + id + ')'); },
     );`,
    'execution error',
  );
  await evalInWall(opts.setup, 'entry registration failed');

  return {
    async callJson(entry, jsonArgs, callOpts) {
      const argRefs = jsonArgs.map((json) => new ivm.ExternalCopy(json));
      try {
        const script = `__entries[${JSON.stringify(entry)}](${jsonArgs.map((_arg, i) => `__arg${i}`).join(', ')})`;
        for (let i = 0; i < argRefs.length; i++) {
          await context.global.set(`__arg${i}`, argRefs[i].copyInto({ release: true }));
        }
        const result = await context.eval(script, {
          timeout: callOpts?.timeoutMs ?? 10_000,
          promise: true, // tolerate async user code
          copy: true,
        });
        if (typeof result !== 'string') {
          throw new Error('entry must return a JSON string');
        }
        return result;
      } catch (e) {
        throw new Error(`${noun} execution error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    drainLogs() {
      try {
        const json = context.evalSync('__drainLogs()', { copy: true }) as string;
        return JSON.parse(json) as string[];
      } catch {
        return [];
      }
    },
    dispose() {
      try {
        isolate.dispose();
      } catch {
        /* already disposed (e.g. after a fatal error) */
      }
    },
  };
}
