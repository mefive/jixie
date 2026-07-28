import { Complex } from '@src/lib';
import { MarketStore } from './market-store';

export const complex = new Complex({
  name: 'Market',
  storeClass: MarketStore,
});
