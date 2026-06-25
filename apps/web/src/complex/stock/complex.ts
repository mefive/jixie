import { Complex } from '@src/lib';
import { StockStore } from './stock-store';

export const complex = new Complex({
  name: 'Stock',
  storeClass: StockStore,
});
