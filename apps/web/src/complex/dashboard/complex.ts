import { Complex } from '@src/lib';
import { DashboardStore } from './dashboard-store';

export const complex = new Complex({
  name: 'Dashboard',
  storeClass: DashboardStore,
});
