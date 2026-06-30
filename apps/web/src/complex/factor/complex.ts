import { Complex } from '@src/lib';
import { FactorStore } from './factor-store';

export const complex = new Complex({
  name: 'Factor',
  storeClass: FactorStore,
});
