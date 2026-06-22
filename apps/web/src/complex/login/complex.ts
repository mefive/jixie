import { Complex } from '@src/lib';
import { LoginStore } from './login-store';

export const complex = new Complex({
  name: 'Login',
  storeClass: LoginStore,
});
