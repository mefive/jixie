// A single line of background-job progress log (backtest / factor analysis). Lines are tagged at the
// worker boundary so the UI can tell apart engine progress from the user's own console output:
//  - source 'system' = engine/analysis progress (the "开始回测…" lines)
//  - source 'user'   = the strategy/factor code's console.log/warn/error, captured in the sandbox
// The poll cursor is the array index (nextSince = logs.length), so a line carries no seq/ts of its own.

export type LogSource = 'system' | 'user';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  source: LogSource;
  level: LogLevel;
  text: string;
}
