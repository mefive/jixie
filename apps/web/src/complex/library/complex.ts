import { Complex } from '@src/lib';
import { LibraryStore } from './library-store';

export const complex = new Complex({ name: 'library', storeClass: LibraryStore });
