import { imageCommands } from './commands.mjs';
import { runCli } from './run.mjs';

process.exitCode = await runCli('docs:images', imageCommands);
