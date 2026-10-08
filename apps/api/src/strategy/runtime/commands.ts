import type { EngineContext } from '#backtesting/contract.js';
import type { StrategyCommand } from './protocol.js';

export function replayCommands(context: EngineContext, commands: StrategyCommand[]): void {
  for (const command of commands) {
    switch (command.operation) {
      case 'futures.orderContracts':
        context.futures.orderContracts(command.arguments.code, command.arguments.contracts);
        break;
      case 'futures.setTargetContracts':
        context.futures.setTargetContracts(command.arguments.code, command.arguments.contracts);
        break;
      case 'futures.setTargetNotional':
        context.futures.setTargetNotional(command.arguments.code, command.arguments.notional);
        break;
      case 'futures.hedgeStock':
        context.futures.hedgeStock(command.arguments.code, command.arguments.beta);
        break;
      case 'futures.closePosition':
        context.futures.closePosition(command.arguments.code);
        break;
      case 'stock.setTargetWeight':
        context.stock.setTargetWeight(command.arguments.code, command.arguments.weight);
        break;
      case 'stock.setTargetWeights':
        context.stock.setTargetWeights(command.arguments.weights);
        break;
      case 'stock.orderAdjustedShares':
        context.stock.orderAdjustedShares(command.arguments.code, command.arguments.shares);
        break;
      case 'stock.orderLots':
        context.stock.orderLots(command.arguments.code, command.arguments.lots);
        break;
      case 'stock.closePosition':
        context.stock.closePosition(command.arguments.code);
        break;
      case 'stock.stopLossAtAdjustedPrice':
        context.stock.stopLossAtAdjustedPrice(command.arguments.code, command.arguments.price);
        break;
      case 'stock.trailingStopByFraction':
        context.stock.trailingStopByFraction(command.arguments.code, command.arguments.percentage);
        break;
      case 'stock.limitBuyAtAdjustedPrice':
        context.stock.limitBuyAtAdjustedPrice(
          command.arguments.code,
          command.arguments.price,
          command.arguments.shares,
        );
        break;
      case 'stock.takeProfitByFraction':
        context.stock.takeProfitByFraction(command.arguments.code, command.arguments.percentage);
        break;
      case 'stock.cancelConditional':
        context.stock.cancelConditional(
          command.arguments.code,
          command.arguments.kind ?? undefined,
        );
        break;
    }
  }
}
