import { Complex } from '@src/lib';
import { SdkStore } from './sdk-store';

export const complex = new Complex({
  name: 'Sdk',
  storeClass: SdkStore,
});
