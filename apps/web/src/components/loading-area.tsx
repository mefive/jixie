import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { reactUtils, type LoaderModel } from '@src/lib';
import './loading-area.css';

/** Default delay (ms) before the loading indicator appears — a load shorter than this shows nothing,
 * so fast data never flashes a spinner. This is the whole point of LoadingArea. */
export const LOADING_DELAY_MS = 150;

/**
 * `active` returns true only after it has stayed active for `delay` ms; if it ends within the window,
 * `true` is never returned. Powers "don't flash a spinner when data comes back fast". `delay<=0` = immediate.
 */
function useDelayed(active: boolean, delay: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) {
      setReady(false);
      return undefined;
    }
    if (delay <= 0) {
      setReady(true);
      return undefined;
    }
    const timer = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return active && ready;
}

export type LoaderLike<T = unknown> = Partial<
  Pick<LoaderModel<T>, 'loaded' | 'loading' | 'error' | 'errorObject' | 'run' | 'result'>
>;

interface LoadingAreaProps<T = unknown> {
  /** A single loader; its `result` is passed to children (function form) once loaded + non-null. */
  loader?: LoaderLike<T>;
  /** Multiple loaders: all must be loaded to render children; any loading → spinner, any error → error.
   * In this mode children gets `undefined` — read each result from your closure. */
  loaders?: LoaderLike[];
  /** Custom error render; default shows 加载失败 + message + 重试. */
  error?: (errorObject: Error | null) => ReactElement;
  /** Custom loading render (e.g. a skeleton); default is a centered spinner. */
  loading?: () => ReactElement;
  /** Rendered once loaded; function form receives `loader.result` (loaded + non-null → no null guard). */
  children?: ReactNode | ((result: T) => ReactNode);
  /** Single-loader empty state (loaded but result==null); default is a centered 暂无数据. */
  empty?: () => ReactElement;
  /** Declare "the current result is empty" for list loaders (whose empty is `[]`, not null, so LoadingArea
   * can't detect it). Makes empty not count as content → reloading from empty also shows loading. */
  isEmpty?: boolean;
  /** Loading-indicator delay (ms). A load shorter than this shows no spinner; 0 disables the delay. */
  loadingDelay?: number;
}

const LoadingAreaImpl = reactUtils.observer((props: LoadingAreaProps<any>) => {
  const {
    loader,
    loaders: loadersProp,
    error,
    loading,
    children,
    empty,
    isEmpty: isEmptyProp,
    loadingDelay = LOADING_DELAY_MS,
  } = props;

  const loaders: LoaderLike[] = loadersProp ?? (loader ? [loader] : []);

  // Track which loaders have EVER loaded — on refresh, `loaded` momentarily flips false, but run() keeps
  // the old result, so we pin the children instead of collapsing the layout (silent refresh, no flash).
  const everLoadedRef = useRef<boolean[]>([]);
  loaders.forEach((l, i) => {
    if (l?.loaded) {
      everLoadedRef.current[i] = true;
    }
  });
  if (everLoadedRef.current.length > loaders.length) {
    everLoadedRef.current = everLoadedRef.current.slice(0, loaders.length);
  }

  const allEverLoaded = loaders.length > 0 && loaders.every((_, i) => everLoadedRef.current[i]);
  const anyLoading = loaders.some((l) => l?.loading);
  const erroredLoader = loaders.find((l) => l?.error);

  const resolvedResult = loadersProp ? undefined : loader?.result;
  const isTopLevelNull = !loadersProp && loader != null && resolvedResult == null;
  const isEmptyState = isTopLevelNull || !!isEmptyProp;
  const showContent = allEverLoaded && !isEmptyState;

  // Enter the loading view only when there's no content to show and something is loading — including
  // "reload from empty". The spinner appears only after `loadingDelay`, so fast data never flashes it.
  const wantLoading = anyLoading && !erroredLoader && !showContent;
  const showLoading = useDelayed(wantLoading, loadingDelay);

  // Error has top priority — a real load failure (status ERROR) overrides stale content. (A reload
  // in flight has status LOADING with errorObject cleared, so it won't hit this; old data stays.)
  if (erroredLoader) {
    if (typeof error === 'function') {
      return error(erroredLoader.errorObject ?? null);
    }
    return (
      <DefaultErrorView
        errorObject={erroredLoader.errorObject ?? null}
        onRetry={() => loaders.forEach((l) => l?.run?.())}
      />
    );
  }
  // Content: render it (kept during a reload → silent refresh).
  if (showContent) {
    if (typeof children === 'function') {
      return children(resolvedResult) as ReactElement;
    }
    return (children as ReactElement) ?? null;
  }
  // Loading view: first load / reload-from-empty. Only after the delay; within the window nothing shows.
  if (wantLoading && showLoading) {
    return loading ? loading() : <DefaultLoadingView />;
  }
  // Ever loaded but empty (not loading, or loading within the delay window) → keep the empty state.
  if (allEverLoaded && isEmptyState) {
    if (isTopLevelNull) {
      return empty ? empty() : <DefaultEmptyView />;
    }
    if (typeof children === 'function') {
      return children(resolvedResult) as ReactElement;
    }
    return (children as ReactElement) ?? null;
  }
  return null;
}, 'LoadingArea');

// observer fixes the generic; cast back to a generic signature so callers infer children's result type.
export const LoadingArea = LoadingAreaImpl as <T = unknown>(
  props: LoadingAreaProps<T>,
) => ReactElement;

// —— default views ——

function DefaultLoadingView() {
  return (
    <div className="jx-loadingArea">
      <FontAwesomeIcon icon={faSpinner} spin />
    </div>
  );
}

function DefaultEmptyView() {
  const { t } = useTranslation('components');
  return <div className="jx-loadingArea jx-loadingArea--muted">{t('noData')}</div>;
}

export function DefaultErrorView({
  errorObject,
  onRetry,
}: {
  errorObject: Error | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation('components');
  return (
    <div className="jx-loadingArea jx-loadingArea--error">
      <div className="jx-loadingArea-errorHead">
        <FontAwesomeIcon icon={faTriangleExclamation} />
        {t('loadFailed')}
      </div>
      {errorObject?.message && (
        <div className="jx-loadingArea-errorDesc">{errorObject.message}</div>
      )}
      <Button size="small" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
