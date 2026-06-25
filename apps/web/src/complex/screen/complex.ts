import { Complex } from '@src/lib';
import { ScreenStore } from './screen-store';

export const complex = new Complex({
  name: 'Screen',
  storeClass: ScreenStore,
});
