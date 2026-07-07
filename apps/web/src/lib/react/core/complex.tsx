import React, { useContext } from 'react';
import { Observer } from 'mobx-react';
import { observer } from './react-utils';

type ComplexConfig<StoreClass> = {
  name: string;
  storeClass: StoreClass;
};

type EntryComponent = React.FunctionComponent<{}> | React.ComponentClass<{}, any>;

export class Complex<StoreClass extends new (parentStore?: any) => any> {
  private config: ComplexConfig<StoreClass>;

  private context: React.Context<{ store: InstanceType<StoreClass> }>;

  constructor(config: ComplexConfig<StoreClass>) {
    this.config = { ...config };
    this.context = React.createContext(null);
  }

  public get name() {
    return this.config.name;
  }

  public component<P>(Component: React.FC<P>, componentName: string) {
    return observer(Component, `${this.name}/${componentName}`);
  }

  public useStore() {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const contextValue = useContext(this.context);
    return contextValue?.store;
  }

  public createStore(parentStore?: any) {
    const StoreClass = this.config.storeClass;
    return StoreClass ? (new StoreClass(parentStore) as InstanceType<StoreClass>) : null;
  }

  public render(store: InstanceType<StoreClass>, element: React.ReactElement) {
    if (this.config.storeClass && (!store || !((store as any) instanceof this.config.storeClass))) {
      throw new Error('a store of the expected type must be provided');
    }
    return (
      <Observer>
        {() => {
          if (store && !(store.prepareLoader.loaded && store?.ready)) {
            return null;
          }
          const { Provider } = this.context;
          return <Provider value={{ store }}>{element}</Provider>;
        }}
      </Observer>
    );
  }

  public entry(entryComponent: EntryComponent) {
    return {
      createInstance: (parentStore?: any) => {
        const store = this.createStore(parentStore);
        return {
          store,
          render: (
            props?: Omit<React.ComponentProps<EntryComponent>, 'children'>,
            ...children: React.ReactNode[]
          ) => this.render(store, React.createElement(entryComponent, props, ...children)),
          cleanup: () => {
            store?.cleanup();
          },
        };
      },
    };
  }
}
