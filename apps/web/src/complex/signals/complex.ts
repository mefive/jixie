import { Complex } from '@src/lib';
import { SignalsStore } from './signals-store';

export const complex = new Complex({
  name: 'Signals',
  storeClass: SignalsStore,
});
