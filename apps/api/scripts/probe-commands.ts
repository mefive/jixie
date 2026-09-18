import {
  parseCommandArguments,
  validateDateRange,
  type CommandDefinition,
} from './command-entry.js';

export const probeCommands: CommandDefinition[] = [
  {
    name: 'tushare',
    entry: 'scripts/probes/smoke.js',
    usage: '',
    description:
      'Check Tushare connectivity and token permissions; external requests, no database writes.',
  },
  {
    name: 'asset-allocation',
    entry: 'scripts/probes/probe-asset-allocation.js',
    usage: '[--date YYYYMMDD] [--json] [--persist] [--persist-if-stale] [--max-age-days 7]',
    description:
      'Probe asset-allocation data capabilities; persistence flags write capability observations.',
  },
];

export function parseProbeArguments(input: string[]) {
  return parseCommandArguments('probe', probeCommands, input, validateProbeParameters);
}

function validateProbeParameters(command: CommandDefinition, input: string[]): void {
  // The old deployment invocation includes an optional separator after the task name.
  const args = input[0] === '--' ? input.slice(1) : input;
  if (command.name === 'tushare') {
    if (args.length) {
      throw new Error('Usage: pnpm probe tushare');
    }
    return;
  }
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (seen.has(name)) {
      throw new Error(`Duplicate option: ${name}`);
    }
    seen.add(name);
    switch (name) {
      case '--json':
      case '--persist':
      case '--persist-if-stale':
        break;
      case '--date': {
        const value = args[++index];
        if (!value) {
          throw new Error('--date requires YYYYMMDD');
        }
        validateDateRange([value]);
        break;
      }
      case '--max-age-days': {
        const value = Number(args[++index]);
        if (!Number.isInteger(value) || value < 1 || value > 365) {
          throw new Error('--max-age-days must be an integer between 1 and 365');
        }
        break;
      }
      default:
        throw new Error(`Unknown probe option: ${name}. Use pnpm probe asset-allocation --help.`);
    }
  }
}
