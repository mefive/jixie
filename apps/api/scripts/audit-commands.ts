import {
  parseCommandArguments,
  validateDateRange,
  type CommandDefinition,
} from './command-entry.js';

export const auditCommands: CommandDefinition[] = [
  {
    name: 'data',
    entry: 'scripts/audit/audit-data.js',
    usage: '[start] [end] [--window=60] [--points=5] [--json] [--strict]',
    description:
      'Read-only market data quality and coverage audit; --strict fails on error findings.',
  },
  {
    name: 'etf',
    entry: 'scripts/audit/audit-etf-registry.js',
    usage: '[expected-history-start] [coverage-through] [--json] [--strict]',
    description: 'Read-only ETF registry and history coverage audit.',
  },
  {
    name: 'financial-selected',
    entry: 'scripts/audit/audit-selected-financials.js',
    usage: 'date [tsCode ...]',
    description:
      'Read-only audit of financial versions selected by the SDK and accounting relationships.',
  },
  {
    name: 'valuation-samples',
    entry: 'scripts/audit/audit-valuation-samples.js',
    usage: 'date output.json',
    description: 'Read-only source and historical-slice audit; writes the specified JSON file.',
  },
];

export function parseAuditArguments(input: string[]) {
  return parseCommandArguments('data:audit', auditCommands, input, validateAuditParameters);
}

function validateAuditParameters(command: CommandDefinition, args: string[]): void {
  const usage = `Usage: pnpm data:audit ${command.name} ${command.usage}`;
  switch (command.name) {
    case 'data':
    case 'etf': {
      const dates: string[] = [];
      const seen = new Set<string>();
      for (const argument of args) {
        if (!argument.startsWith('-')) {
          dates.push(argument);
          continue;
        }
        const [name, value, extra] = argument.split('=');
        if (seen.has(name)) {
          throw new Error(`Duplicate option: ${name}`);
        }
        seen.add(name);
        if (['--json', '--strict'].includes(name) && value === undefined) {
          continue;
        }
        const limits: Record<string, [number, number] | undefined> = {
          '--window': [20, 504],
          '--points': [1, 12],
        };
        const bounds = limits[name];
        if (command.name !== 'data' || !bounds || value === undefined || extra !== undefined) {
          throw new Error(usage);
        }
        const number = Number(value);
        if (!Number.isInteger(number) || number < bounds[0] || number > bounds[1]) {
          throw new Error(`${name} must be an integer between ${bounds[0]} and ${bounds[1]}`);
        }
      }
      if (dates.length > 2) {
        throw new Error(usage);
      }
      validateDateRange(dates);
      break;
    }
    case 'financial-selected':
      // The audit itself reports excluded identifiers; keep that diagnostic behavior.
      if (!args.length || args.slice(1).some((code) => !code || code.startsWith('-'))) {
        throw new Error(usage);
      }
      validateDateRange(args.slice(0, 1));
      break;
    case 'valuation-samples':
      if (args.length !== 2 || !args[1] || args[1].startsWith('-')) {
        throw new Error(usage);
      }
      validateDateRange(args.slice(0, 1));
      break;
    default:
      throw new Error(`Missing audit argument validator: ${command.name}`);
  }
}
