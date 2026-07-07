import { lazy, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Outlet,
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
import { TopNav } from '@src/components/top-nav';
import { authStore } from '@src/store';
import './app-layout.css';

// Standalone SDK reference page (also opened from the lab Docs button + the 📖 links in editor hovers).
const SdkDocPage = lazy(() => import('@src/complex/lab/sdk-doc'));
// Standalone getting-started tutorial (linear learning path; linked from /docs + the lab hero).
const LearnPage = lazy(() => import('@src/complex/lab/learn'));
// Standalone trade-detail page (opened from the backtest result modal's "open in page" button).
const TradePage = lazy(() => import('@src/complex/lab/trade-page'));

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<ComplexRoute entry={loginEntry} />} />
        {/* The backtest workbench lives at a stable /lab route; bare "/" just redirects there. */}
        <Route path="/" element={<Navigate to="/lab" replace />} />
        {/* Shared layout for the TopNav pages: TopNav is rendered ONCE here and persists across
            navigations (react-router only swaps <Outlet/> below it) — so switching pages no longer
            unmounts/remounts the nav and flashes it. */}
        <Route element={<AuthedLayout />}>
          <Route path="/lab" element={<LabRoute />} />
          <Route path="/screen" element={<ComplexRoute key="screen" entry={screenEntry} />} />
          <Route path="/factors" element={<FactorRoute />} />
          <Route path="/stock/:code" element={<StockRoute />} />
          <Route path="/trades" element={<TradePage />} />
        </Route>
        {/* Standalone doc pages: authed but full-screen, no TopNav. */}
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
          path="/learn"
          element={
            <RequireAuth>
              <Suspense fallback={null}>
                <LearnPage />
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

// Factor research: `/factors?factor=&freq=&start=&end=` restores a specific analysis on mount (refresh-safe /
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

// Backtest workbench: `/lab` = last strategy (or blank if none); `/lab?id=<sid>` = that saved strategy;
// `/lab?new=1` = force the blank new-strategy hero. The id rides as a query param (a plain parameter, not a REST
// path). NO `key` here — switching strategies must NOT remount (a remount tears down Monaco/Splitters =
// a full-page flash). The initial id/new is captured once for setup; later URL changes are synced into
// the store in-place by the Lab component (openSaved / newStrategy), so navigation is seamless.
function LabRoute() {
  const [searchParams] = useSearchParams();
  const setupParams = useRef({
    id: searchParams.get('id') || undefined,
    isNew: searchParams.has('new'),
  }).current;
  return <ComplexRoute entry={labEntry} setupParams={setupParams} />;
}

// Wire a complex's store lifecycle into react-router: createInstance on mount,
// store.setup when setupParams arrive/change, cleanup on unmount. render() returns null until store is ready.
type ComplexInstance = {
  store?: { setup: (params?: any) => void; ready?: boolean };
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
  const setupParamsRef = useRef<Record<string, unknown> | null>(null);
  if (!instanceRef.current) {
    instanceRef.current = entry.createInstance();
  }
  const stableSetupParams = useMemo(() => setupParams ?? {}, [setupParams]);

  // First setup runs HERE, during the initial render, not in an effect: complex.render returns
  // null until setup() flips store.ready, and when the mount was scheduled at default priority
  // (initial mount after a full reload) even a layout effect's re-render lands in a later task —
  // the browser paints the null frame in between as a blank body under the persistent TopNav.
  // Setting up synchronously (same render-phase moment the store itself is created) means the
  // very first committed frame already has the page content, regardless of scheduling lane.
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
      // StrictMode's simulated unmount ran cleanup() (ready=false) without a re-render; re-setup.
      instance.store.setup(stableSetupParams);
    }
    return () => instance?.cleanup();
  }, [stableSetupParams]);
  return instanceRef.current.render();
}

// Shared layout for the TopNav pages: auth guard + a persistent TopNav over the routed page (<Outlet/>).
// TopNav lives here (not inside each page) so it stays mounted across navigations — no nav flash.
function AuthedLayout() {
  return (
    <RequireAuth>
      <div className="jx-app">
        <TopNav />
        <div className="jx-app-body">
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </RequireAuth>
  );
}

// Auth guard: if authStore.authenticated is false → redirect to /login, carrying the source path
const RequireAuth = observer(({ children }: { children: ReactNode }) => {
  const location = useLocation();
  if (!authStore.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
});
