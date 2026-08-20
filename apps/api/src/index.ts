import { startServer } from './server.js';
import { probePythonRuntime } from './strategy/python/session.js';

const port = Number(process.env.PORT ?? 3001);
await startServer(port);
console.log(`API listening on http://localhost:${port}`);

if (process.env.NODE_ENV !== 'production') {
  void reportDevelopmentPythonRuntime();
}

async function reportDevelopmentPythonRuntime(): Promise<void> {
  try {
    const mode = await probePythonRuntime();
    console.log(`[python-runtime] ready (${mode})`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[python-runtime] unavailable: ${detail}`);
    console.warn('[python-runtime] Start the full development environment with: pnpm dev');
  }
}
