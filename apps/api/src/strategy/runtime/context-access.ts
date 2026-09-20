import { z } from 'zod';
import type { BarContext } from '#engine/types.js';
import { identifierSchema, finiteNumberSchema } from '#infra/runtime/protocol.js';
import { strategyCommandSchema } from './protocol.js';
import { replayCommands } from './commands.js';

const code = identifierSchema;
const window = finiteNumberSchema;
const field = z.enum(['open', 'high', 'low', 'close']);
const valuation = z.enum(['pe', 'peTtm', 'pb']);
const readSchema = z.discriminatedUnion('method', [
  read('bar', z.tuple([code])),
  read('bars', z.tuple([code, window])),
  read('resampledBars', z.tuple([code, z.enum(['weekly', 'monthly']), window])),
  read('listDays', z.tuple([code])),
  read('industry', z.tuple([code])),
  read('lhbNet', z.tuple([code])),
  read('price', z.tuple([code])),
  read('history', z.tuple([code, field, window])),
  read('factor', z.tuple([code, code])),
  read('future', z.tuple([code])),
  read(
    'futureHistory',
    z.tuple([code, z.enum(['open', 'high', 'low', 'close', 'settle']), window]),
  ),
  read('futurePosition', z.tuple([code])),
  read('shares', z.tuple([code])),
  read('indexValues', z.tuple([code])),
  read('indexSma', z.tuple([code, window])),
  read('indexPercentile', z.tuple([code, valuation, window.nullable()])),
]);
const accessSchema = z.union([
  z.strictObject({ type: z.literal('read'), request: readSchema }),
  z.strictObject({ type: z.literal('command'), command: strategyCommandSchema }),
]);

/** Only synchronous engine primitives are exposed, never storage or arbitrary property access. */
export function accessStrategyContext(context: BarContext, input: unknown): unknown {
  const access = accessSchema.parse(input);
  if (access.type === 'command') {
    replayCommands(context, [access.command]);
    return null;
  }
  const request = access.request;
  switch (request.method) {
    case 'bar':
      return context.bar(...request.args);
    case 'bars':
      return context.bars(...request.args);
    case 'resampledBars':
      return context.resampledBars(...request.args);
    case 'listDays':
      return context.listDays(...request.args);
    case 'industry':
      return context.industry(...request.args);
    case 'lhbNet':
      return context.lhbNet(...request.args);
    case 'price':
      return context.price(...request.args);
    case 'history':
      return context.history(...request.args);
    case 'factor':
      return context.factor(...request.args);
    case 'future':
      return context.future(...request.args);
    case 'futureHistory':
      return context.futureHistory(...request.args);
    case 'futurePosition':
      return context.futurePosition(...request.args);
    case 'shares':
      return context.shares(...request.args);
    case 'indexValues': {
      const index = context.index(request.args[0]);
      return { close: index.close, pe: index.pe, peTtm: index.peTtm, pb: index.pb };
    }
    case 'indexSma':
      return context.index(request.args[0]).sma(request.args[1]);
    case 'indexPercentile':
      return context
        .index(request.args[0])
        .percentile(request.args[1], request.args[2] ?? undefined);
  }
}

function read<Method extends string, Args extends z.ZodType>(method: Method, args: Args) {
  return z.strictObject({ method: z.literal(method), args });
}
