import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
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
import marketEntry from '@src/complex/market';
import factorWeatherEntry from '@src/complex/factor-weather';
import valuationEntry from '@src/complex/valuation';
import signalsEntry from '@src/complex/signals';
import { TopNav } from '@src/components/top-nav';
import { authStore } from '@src/store';
import './app-layout.css';

// Standalone trade-detail page (opened from the backtest result modal's "open in page" button).
const TradePage = lazy(() => import('@src/complex/lab/trade-page'));

export function AppRoutes() {
  return <RouterProvider router={router} />;
}

// —— Subcomponents / helpers ——

// Stock detail route: read :code, pass it as setupParams (memoized), key by code so a different
// stock remounts the complex.
function StockRoute() {
  const { code = '' } = useParams();
  const setupParams = useMemo(() => ({ code }), [code]);
  return <ComplexRoute key={code} entry={stockEntry} setupParams={setupParams} />;
}

// Factor research: `/factors?factor=&report=` restores one immutable report and its parameters. Capture
// the params once; later URL syncs from the store must not re-setup the page.
function FactorRoute() {
  const [searchParams] = useSearchParams();
  const setupParams = useRef({
    factor: searchParams.get('factor') || undefined,
    report: searchParams.get('report') || undefined,
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
    factorKey: searchParams.get('factorKey') || undefined,
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

// Auth failures during an outage leave the current URL untouched under the maintenance Gate. Redirect only
// after /me successfully confirms that there is no authenticated user.
const RequireAuth = observer(({ children }: { children: ReactNode }) => {
  const location = useLocation();
  if (!authStore.authenticationResolved) {
    return null;
  }
  if (!authStore.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
});

// A data router gives workbenches a supported navigation blocker for unsaved editor state while
// preserving the same route tree and persistent authenticated layout.
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<ComplexRoute entry={loginEntry} />} />
      {/* Market is the product homepage; each workbench keeps its own stable route. */}
      <Route path="/" element={<Navigate to="/market" replace />} />
      {/* Shared layout for the TopNav pages: TopNav is rendered ONCE here and persists across
          navigations (react-router only swaps <Outlet/> below it) — so switching pages no longer
          unmounts/remounts the nav and flashes it. */}
      <Route element={<AuthedLayout />}>
        <Route path="/market" element={<ComplexRoute key="market" entry={marketEntry} />} />
        <Route
          path="/factor-weather"
          element={<ComplexRoute key="factor-weather" entry={factorWeatherEntry} />}
        />
        <Route path="/lab" element={<LabRoute />} />
        <Route path="/screen" element={<ComplexRoute key="screen" entry={screenEntry} />} />
        <Route path="/factors" element={<FactorRoute />} />
        <Route
          path="/valuation"
          element={<ComplexRoute key="valuation" entry={valuationEntry} />}
        />
        <Route path="/stock/:code" element={<StockRoute />} />
        <Route path="/trades" element={<TradePage />} />
        <Route path="/signals" element={<ComplexRoute key="signals" entry={signalsEntry} />} />
      </Route>
      <Route path="/learn" element={<ExternalRedirect to="/docs/help" />} />
      <Route path="/help/*" element={<LegacyHelpRedirect />} />
      <Route path="*" element={<Navigate to="/market" replace />} />
    </>,
  ),
);

function ExternalRedirect({ to }: { to: string }): null {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);

  return null;
}

function LegacyHelpRedirect() {
  const location = useLocation();
  const suffix = location.pathname.slice('/help'.length);

  return <ExternalRedirect to={`/docs/help${suffix}${location.search}${location.hash}`} />;
}
