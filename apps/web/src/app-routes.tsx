import { lazy, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { observer } from 'mobx-react';
import loginEntry from '@src/complex/login';
import labEntry from '@src/complex/lab';
import screenEntry from '@src/complex/screen';
import stockEntry from '@src/complex/stock';
import factorEntry from '@src/complex/factor';
import { authStore } from '@src/store';

// Standalone SDK reference page (also opened from the lab 文档 button + the 📖 links in editor hovers).
const SdkDocPage = lazy(() => import('@src/complex/lab/sdk-doc'));
// Standalone 交易详情 page (opened from the backtest result modal's 页面打开 button).
const TradePage = lazy(() => import('@src/complex/lab/trade-page'));

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<ComplexRoute entry={loginEntry} />} />
        {/* The backtest workbench lives at a stable /lab route; bare "/" just redirects there. */}
        <Route path="/" element={<Navigate to="/lab" replace />} />
        {/* Distinct keys so navigating between pages remounts ComplexRoute (without a key React reuses
            the instance and only swaps the `entry` prop, leaving the previous page's store/render in place). */}
        <Route
          path="/lab"
          element={
            <RequireAuth>
              <LabRoute />
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
          path="/factors"
          element={
            <RequireAuth>
              <FactorRoute />
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
        <Route
          path="/docs"
          element={
            <RequireAuth>
              <Suspense fallback={null}>
                <SdkDocPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/trades"
          element={
            <RequireAuth>
              <Suspense fallback={null}>
                <TradePage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/lab" replace />} />
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

// 因子研究: `/factors?factor=&freq=&start=&end=` restores a specific analysis on mount (refresh-safe /
// shareable). Capture the params once — later URL syncs from the store must not re-setup the page, so
// no `key` here (factor/param changes go through store methods, not a remount).
function FactorRoute() {
  const [searchParams] = useSearchParams();
  const setupParams = useRef({
    factor: searchParams.get('factor') || undefined,
    freq: (searchParams.get('freq') as 'month' | 'week') || undefined,
    start: searchParams.get('start') || undefined,
    end: searchParams.get('end') || undefined,
  }).current;
  return <ComplexRoute entry={factorEntry} setupParams={setupParams} />;
}

// Backtest workbench: `/lab` = fresh strategy; `/lab?id=<sid>` = a saved strategy (loaded on mount →
// refresh-safe). The strategy id rides as a query param (a plain parameter, not a REST resource path).
// Key by it so switching strategies remounts the store.
function LabRoute() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ?? '';
  const setupParams = useMemo(() => ({ id }), [id]);
  return <ComplexRoute key={id || 'new'} entry={labEntry} setupParams={setupParams} />;
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
