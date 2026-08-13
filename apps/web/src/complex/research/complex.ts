import { Complex } from '@src/lib';
import { ResearchStore } from './research-store';

export const complex = new Complex({
  name: 'Research',
  storeClass: ResearchStore,
});
