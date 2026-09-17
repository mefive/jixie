import { Complex } from '@src/lib';
import { StrategyStore } from './strategy-store';

export const complex = new Complex({
  name: 'Strategy',
  storeClass: StrategyStore,
});
