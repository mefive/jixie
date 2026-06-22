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

// —— 子组件 / 帮助函数 ——

// 把 complex 的 store 生命周期接进 react-router：mount 时 createInstance，
// setupParams 到位/变化时 store.setup，unmount 时 cleanup。store 未 ready 时 render() 返 null。
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

// 未登录守卫：authStore.authenticated 为假 → 跳 /login，带上来源路径
const RequireAuth = observer(({ children }: { children: ReactNode }) => {
  const location = useLocation();
  if (!authStore.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
});
