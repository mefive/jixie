import { parseCommandArguments, validateDateRange, type CommandRequest } from '../command-entry.js';
import { syncCommands, type SyncCommand } from './commands.js';

export type SyncRequest = CommandRequest<SyncCommand>;

/** Parse before loading configuration or importing any database/network code. */
export function parseSyncArguments(input: string[]): SyncRequest {
  return parseCommandArguments('sync', syncCommands, input, validateParameters);
}

function validateParameters(command: SyncCommand, args: string[]): void {
  if (command.kind === 'financial') {
    validateFinancialParameters(args);
    return;
  }

  const maximum = { dates: 2, months: 2, indices: 3, index: 3, etf: 4, none: 0 }[command.kind];
  if (args.length > maximum || args.some((value) => value.startsWith('-'))) {
    throw new Error(`Usage: pnpm sync ${command.name} ${command.usage}`.trim());
  }
  const dateArguments = command.kind === 'index' ? args.slice(1, 3) : args.slice(0, 2);
  validateDateRange(dateArguments, command.kind === 'months');

  switch (command.kind) {
    case 'index':
      validateSelector(args[0], ['market-state']);
      break;
    case 'indices':
      validateSelector(args[2], ['major']);
      break;
    case 'etf':
      validateSelector(args[2], ['registry', 'major']);
      if (args[3] !== undefined && args[3] !== 'refresh') {
        throw new Error('The fourth ETF argument must be refresh.');
      }
      break;
  }
}

function validateSelector(value: string | undefined, selectors: string[]): void {
  if (value === undefined || selectors.includes(value)) {
    return;
  }
  // Index providers also use alphanumeric identifiers and suffixes such as H00300.CSI.
  if (!value.split(',').every((code) => /^[a-z\d]+\.[a-z\d]+$/i.test(code.trim()))) {
    throw new Error(`Expected ${selectors.join(', ')} or comma-separated security codes.`);
  }
}

function validateFinancialParameters(args: string[]): void {
  if (!args.length) {
    return;
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!['--repair-code', '--start', '--end'].includes(name) || !value || values.has(name)) {
      throw new Error(
        'Usage: pnpm sync fina [--repair-code CODE --start YYYYMMDD [--end YYYYMMDD]]',
      );
    }
    values.set(name, value);
  }
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(values.get('--repair-code') ?? '')) {
    throw new Error('--repair-code must be an A-share ts_code');
  }
  const start = values.get('--start');
  if (!start) {
    throw new Error('--repair-code requires --start YYYYMMDD');
  }
  const end = values.get('--end');
  validateDateRange(end ? [start, end] : [start]);
}
