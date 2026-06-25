import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { observer } from 'mobx-react';
import loginEntry from '@src/complex/login';
import labEntry from '@src/complex/lab';
import screenEntry from '@src/complex/screen';
import stockEntry from '@src/complex/stock';
import { authStore } from '@src/store';

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<ComplexRoute entry={loginEntry} />} />
        {/* Distinct keys so navigating between pages remounts ComplexRoute (both routes render the
            same component type at the same position; without a key React reuses the instance and only
            swaps the `entry` prop, leaving the previous page's store/render in place). */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <ComplexRoute key="lab" entry={labEntry} />
            </RequireAuth>
          }
        />
        <Route
          path="/screen"
          element={
            <RequireAuth>
              <ComplexRoute key="screen" entry={screenEntry} />
            </RequireAuth>
          }
        />
        <Route
          path="/stock/:code"
          element={
            <RequireAuth>
              <StockRoute />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

// —— Subcomponents / helpers ——

// Stock detail route: read :code, pass it as setupParams (memoized), key by code so a different
// stock remounts the complex.
function StockRoute() {
  const { code = '' } = useParams();
  const setupParams = useMemo(() => ({ code }), [code]);
  return <ComplexRoute key={code} entry={stockEntry} setupParams={setupParams} />;
}

// Wire a complex's store lifecycle into react-router: createInstance on mount,
// store.setup when setupParams arrive/change, cleanup on unmount. render() returns null until store is ready.
type ComplexInstance = {
  store?: { setup: (params?: any) => void };
  render: () => ReactNode;
  cleanup: () => void;
};
type ComplexEntry = { createInstance: () => ComplexInstance };

function ComplexRoute({
  entry,
  setupParams,
}: {
  entry: ComplexEntry;
  setupParams?: Record<string, unknown>;
}) {
  const instanceRef = useRef<ComplexInstance | null>(null);
  if (!instanceRef.current) {
    instanceRef.current = entry.createInstance();
  }
  const stableSetupParams = useMemo(() => setupParams ?? {}, [setupParams]);
  useEffect(() => {
    const instance = instanceRef.current;
    instance?.store?.setup(stableSetupParams);
    return () => instance?.cleanup();
  }, [stableSetupParams]);
  return instanceRef.current.render();
}

// Auth guard: if authStore.authenticated is false → redirect to /login, carrying the source path
const RequireAuth = observer(({ children }: { children: ReactNode }) => {
  const location = useLocation();
  if (!authStore.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
});
