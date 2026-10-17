import { runStrategy } from './strategy-runner.js';
import type { StrategyRunnerCommandHandler, StrategyRunnerHost } from './strategy-runner.js';

/**
 * 定义策略 isolate 可调用的受限同步宿主函数。
 * Describe the restricted synchronous host function available inside a strategy isolate.
 */
interface HostFunction {
  applySync(receiver: undefined, args: string[]): string;
}
declare const __hostEmit: HostFunction;
declare const __hostAccess: HostFunction;

let receiveCommand: StrategyRunnerCommandHandler = (frame) => {
  if (frame.type !== 'start') {
    throw new Error(`Unsupported strategy command: ${frame.type}`);
  }

  return runStrategy(frame, host);
};

const host: StrategyRunnerHost = {
  receive: (handler) => {
    receiveCommand = handler;
  },
  emit: (frame) => {
    __hostEmit.applySync(undefined, [JSON.stringify(frame)]);
  },
  access: (json) => __hostAccess.applySync(undefined, [json]),
};

(globalThis as Record<string, unknown>).__receiveCommand = (json: string) =>
  receiveCommand(JSON.parse(json));
