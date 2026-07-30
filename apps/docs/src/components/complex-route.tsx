import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';

type ComplexInstance = {
  store?: { setup: (params?: any) => void; ready?: boolean };
  render: () => ReactNode;
  cleanup: () => void;
};

type ComplexEntry = {
  createInstance: () => ComplexInstance;
};

export function ComplexRoute({
  entry,
  setupParams,
}: {
  entry: ComplexEntry;
  setupParams?: Record<string, unknown>;
}) {
  const instanceRef = useRef<ComplexInstance | null>(null);
  const setupParamsRef = useRef<Record<string, unknown> | null>(null);
  if (!instanceRef.current) {
    instanceRef.current = entry.createInstance();
  }
  const stableSetupParams = useMemo(() => setupParams ?? {}, [setupParams]);

  if (setupParamsRef.current === null) {
    setupParamsRef.current = stableSetupParams;
    instanceRef.current.store?.setup(stableSetupParams);
  }

  useLayoutEffect(() => {
    const instance = instanceRef.current;
    if (setupParamsRef.current !== stableSetupParams) {
      setupParamsRef.current = stableSetupParams;
      instance?.store?.setup(stableSetupParams);
    } else if (instance?.store && !instance.store.ready) {
      instance.store.setup(stableSetupParams);
    }
    return () => instance?.cleanup();
  }, [stableSetupParams]);

  return instanceRef.current.render();
}
