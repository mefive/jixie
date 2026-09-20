import type { BarContext } from '#engine/types.js';
import type { StrategyCommand } from './protocol.js';

export function replayCommands(context: BarContext, commands: StrategyCommand[]): void {
  for (const command of commands) {
    switch (command.operation) {
      case 'order_future':
        context.orderFuture(command.arguments.code, command.arguments.contracts);
        break;
      case 'set_future_target_contracts':
        context.setFutureTargetContracts(command.arguments.code, command.arguments.contracts);
        break;
      case 'set_future_target_notional':
        context.setFutureTargetNotional(command.arguments.code, command.arguments.notional);
        break;
      case 'hedge_future':
        context.hedgeFuture(command.arguments.code, command.arguments.beta);
        break;
      case 'exit_future':
        context.exitFuture(command.arguments.code);
        break;
      case 'order_target_percent':
        context.orderTargetPercent(command.arguments.code, command.arguments.weight);
        break;
      case 'set_holdings':
        context.setHoldings(command.arguments.weights);
        break;
      case 'order':
        context.order(command.arguments.code, command.arguments.shares);
        break;
      case 'order_lots':
        context.orderLots(command.arguments.code, command.arguments.lots);
        break;
      case 'exit':
        context.exit(command.arguments.code);
        break;
      case 'stop_loss':
        context.stopLoss(command.arguments.code, command.arguments.price);
        break;
      case 'trailing_stop':
        context.trailingStop(command.arguments.code, command.arguments.percentage);
        break;
      case 'limit_buy':
        context.limitBuy(command.arguments.code, command.arguments.price, command.arguments.shares);
        break;
      case 'take_profit':
        context.takeProfit(command.arguments.code, command.arguments.percentage);
        break;
      case 'cancel_conditional':
        context.cancelConditional(command.arguments.code, command.arguments.kind ?? undefined);
        break;
    }
  }
}
