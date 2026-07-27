import { Complex } from '@src/lib';
import { ValuationStore } from './valuation-store';

export const complex = new Complex({
  name: 'Valuation',
  storeClass: ValuationStore,
});
