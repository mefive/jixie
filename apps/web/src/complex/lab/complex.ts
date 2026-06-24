import { Complex } from '@src/lib';
import { LabStore } from './lab-store';

export const complex = new Complex({
  name: 'Lab',
  storeClass: LabStore,
});
