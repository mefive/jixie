import { Complex } from '@src/lib';
import { HelpStore } from './help-store';

export const complex = new Complex({
  name: 'Help',
  storeClass: HelpStore,
});
