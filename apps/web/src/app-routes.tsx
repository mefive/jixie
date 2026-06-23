import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { observer } from 'mobx-react';
import loginEntry from '@src/complex/login';
import dashboardEntry from '@src/complex/dashboard';
import { authStore } from '@src/store';

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<ComplexRoute entry={loginEntry} />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <ComplexRoute entry={dashboardEntry} />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

// —— Subcomponents / helpers ——

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
